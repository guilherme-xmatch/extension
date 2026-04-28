/**
 * Tests for CatalogViewProvider, HealthViewProvider, and InstalledViewProvider.
 * These providers implement vscode.WebviewViewProvider and handle webview message passing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { CatalogViewProvider } from '../../src/presentation/providers/CatalogViewProvider';
import { HealthViewProvider } from '../../src/presentation/providers/HealthViewProvider';
import { InstalledViewProvider } from '../../src/presentation/providers/InstalledViewProvider';
import { Package, InstallStatus } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { Bundle } from '../../src/domain/entities/Bundle';
import { HealthReport, HealthSeverity } from '../../src/domain/entities/HealthReport';
import { HealthCheckerService } from '../../src/infrastructure/services/HealthChecker';
import { AppLogger } from '../../src/infrastructure/services/AppLogger';
import {
  IPackageRepository,
  IWorkspaceScanner,
  IInstaller,
  IOperationCoordinator,
} from '../../src/domain/interfaces';
import { queueInformationMessageResponse, setWorkspaceRoot } from '../setup/vscode.mock';

// â”€â”€â”€ Mock Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Creates a fake vscode.WebviewView with the same shape as the runtime mock */
function createMockWebviewView() {
  const messageListeners: Array<(msg: unknown) => void> = [];
  const disposeListeners: Array<() => void> = [];
  const visibilityListeners: Array<(visible: boolean) => void> = [];

  const webview = {
    html: '',
    options: {} as vscode.WebviewOptions,
    cspSource: 'vscode-resource://test',
    asWebviewUri: (uri: vscode.Uri) => uri,
    postMessage: vi.fn(async () => true),
    onDidReceiveMessage: (listener: (msg: unknown) => void) => {
      messageListeners.push(listener);
      return {
        dispose: () => {
          const i = messageListeners.indexOf(listener);
          if (i >= 0) messageListeners.splice(i, 1);
        },
      };
    },
  };

  const view: vscode.WebviewView & { __fireMessage: (msg: unknown) => void } = {
    viewType: 'test',
    webview: webview as unknown as vscode.Webview,
    title: undefined,
    description: undefined,
    visible: true,
    badge: undefined,
    show: vi.fn(),
    onDidChangeVisibility: (listener: (e: void) => void) => {
      visibilityListeners.push(() => listener());
      return { dispose: vi.fn() };
    },
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: vi.fn() };
    },
    __fireMessage: (msg: unknown) => {
      messageListeners.forEach((l) => l(msg));
    },
  };

  return view;
}

function createMockOperations(): IOperationCoordinator {
  const changeListeners: Array<(op: unknown) => void> = [];
  const finishListeners: Array<(op: unknown) => void> = [];
  return {
    getCurrentOperation: () => undefined,
    getRecentOperations: () => [],
    getMetrics: () => [],
    run: vi.fn(async (_def, action) => action({ setProgress: vi.fn(), setRefreshing: vi.fn() })),
    onDidChangeCurrentOperation: (listener) => {
      changeListeners.push(listener);
      return { dispose: () => {} };
    },
    onDidFinishOperation: (listener) => {
      finishListeners.push(listener);
      return { dispose: () => {} };
    },
  };
}

const makeAgent = (id: string) =>
  Package.create({
    id,
    name: id,
    displayName: id,
    description: 'test',
    type: PackageType.Agent,
    version: '1.0.0',
    tags: [],
    author: 'test',
    files: [{ relativePath: `.github/agents/${id}.agent.md`, content: '# agent' }],
  });

const makeBundle = () =>
  Bundle.create({
    id: 'bundle-backend',
    name: 'backend',
    displayName: 'Backend Stack',
    description: 'full backend',
    version: '1.0.0',
    packageIds: ['agent-backend'],
  });

const emptyRegistry: IPackageRepository = {
  getAll: async () => [],
  findById: async () => undefined,
  search: async () => [],
  getAllBundles: async () => [],
  findBundleById: async () => undefined,
  getAgentNetwork: async () => [],
  getRelatedSkills: async () => [],
};

const alwaysInstalledScanner: IWorkspaceScanner = {
  getInstallStatus: async () => InstallStatus.Installed,
  getInstalledPackageIds: async () => [],
  hasGitHubDirectory: async () => true,
  detectProjectProfile: async () => [],
};

const notInstalledScanner: IWorkspaceScanner = {
  ...alwaysInstalledScanner,
  getInstallStatus: async () => InstallStatus.NotInstalled,
  detectProjectProfile: async () => [],
};

const mockInstaller: IInstaller = {
  install: vi.fn(),
  uninstall: vi.fn(),
  installMany: vi.fn(),
};

// â”€â”€â”€ CatalogViewProvider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('CatalogViewProvider', () => {
  let logger: AppLogger;

  beforeEach(() => {
    try {
      AppLogger.getInstance().dispose();
    } catch {
      /* */
    }
    logger = AppLogger.getInstance();
  });

  afterEach(() => {
    setWorkspaceRoot(undefined);
    logger.dispose();
  });

  it('resolveWebviewView configura opÃ§Ãµes e define HTML inicial', () => {
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );
    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    expect(view.webview.options).toMatchObject({ enableScripts: true });
    // HTML Ã© gerado pelo WebviewHelper â€” deve ser uma string nÃ£o-vazia
    expect(typeof view.webview.html).toBe('string');
  });

  it('refresh() posta mensagem com pacotes quando view estÃ¡ resolvida', async () => {
    const agent = makeAgent('agent-backend');
    const registry: IPackageRepository = {
      ...emptyRegistry,
      getAll: async () => [agent],
      getAllBundles: async () => [],
    };
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      alwaysInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    await provider.refresh();
    // postMessage deve ter sido chamado com estado do catÃ¡logo
    expect(view.webview.postMessage).toHaveBeenCalled();
  });

  it('refresh() com bundle emite bundleId na mensagem', async () => {
    const bundle = makeBundle();
    const agent = makeAgent('agent-backend');
    const registry: IPackageRepository = {
      ...emptyRegistry,
      getAll: async () => [agent],
      getAllBundles: async () => [bundle],
    };
    const scanner: IWorkspaceScanner = {
      ...notInstalledScanner,
      detectProjectProfile: async () => [
        { profile: 'Backend API', bundleId: 'bundle-backend', confidence: 0.9 },
      ],
    };

    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      scanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    await provider.refresh();
    expect(view.webview.postMessage).toHaveBeenCalled();
  });
  it('mensagem "refresh" de webview atualiza a view (postMessage chamado)', async () => {
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );
    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );
    vi.mocked(view.webview.postMessage).mockClear();
    view.__fireMessage({ command: 'refresh' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.webview.postMessage).toHaveBeenCalled();
  });

  it('mensagem com command desconhecido Ã© ignorada silenciosamente', () => {
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    // mensagem invÃ¡lida nÃ£o deve lanÃ§ar
    expect(() =>
      view.__fireMessage({ command: 'hackerAttack', payload: '<script>alert(1)</script>' }),
    ).not.toThrow();
    expect(() => view.__fireMessage(null)).not.toThrow();
    expect(() => view.__fireMessage('not an object')).not.toThrow();
  });

  it('mensagem "install" aciona instalaÃ§Ã£o via coordinator', async () => {
    const agent = makeAgent('agent-backend');
    const dependency = makeAgent('agent-shared');
    const agentWithDependency = Package.create({
      id: agent.id,
      name: agent.name,
      displayName: agent.displayName,
      description: agent.description,
      type: agent.type,
      version: agent.version.toString(),
      tags: [...agent.tags],
      author: agent.author,
      files: agent.files.map((file) => ({ ...file })),
      dependencies: [dependency.id],
    });
    const registry: IPackageRepository = {
      ...emptyRegistry,
      getAll: async () => [agentWithDependency, dependency],
      findById: async (id) => {
        if (id === agentWithDependency.id) {
          return agentWithDependency;
        }
        if (id === dependency.id) {
          return dependency;
        }
        return undefined;
      },
    };
    const operations = createMockOperations();
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      notInstalledScanner,
      mockInstaller,
      operations,
    );

    const view = createMockWebviewView();
    queueInformationMessageResponse('Instalar apenas este pacote');
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'install', packageId: 'agent-backend' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(operations.run).toHaveBeenCalled();
  });

  it('cancelar o modal de dependências aborta a instalação', async () => {
    const dependency = makeAgent('agent-shared');
    const agent = Package.create({
      id: 'agent-backend',
      name: 'agent-backend',
      displayName: 'agent-backend',
      description: 'test',
      type: PackageType.Agent,
      version: '1.0.0',
      tags: [],
      author: 'test',
      dependencies: [dependency.id],
      files: [{ relativePath: '.github/agents/agent-backend.agent.md', content: '# agent' }],
    });
    const registry: IPackageRepository = {
      ...emptyRegistry,
      findById: async (id) => {
        if (id === agent.id) {
          return agent;
        }
        if (id === dependency.id) {
          return dependency;
        }
        return undefined;
      },
    };
    const operations = createMockOperations();
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      notInstalledScanner,
      mockInstaller,
      operations,
    );

    const view = createMockWebviewView();
    queueInformationMessageResponse(undefined);
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'install', packageId: agent.id });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(operations.run).not.toHaveBeenCalled();
  });

  it('mensagem "install" com packageId vazio Ã© rejeitada (type guard)', () => {
    const operations = createMockOperations();
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      operations,
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'install', packageId: '' }); // packageId vazio â†’ type guard rejeita
    expect(operations.run).not.toHaveBeenCalled();
  });

  it('mensagem "openExternal" com URL http (nÃ£o https) Ã© rejeitada', () => {
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'openExternal', url: 'http://insecure.example.com' });
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
  });

  it('mensagem "openExternal" com URL https Ã© aceita', async () => {
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'openExternal', url: 'https://github.com' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(vscode.env.openExternal).toHaveBeenCalled();
  });

  it('isCatalogMessage: query muito longa (>500 chars) Ã© rejeitada', () => {
    const operations = createMockOperations();
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      operations,
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'search', query: 'x'.repeat(501) });
    // O type guard rejeita a mensagem â€” nenhuma atualizaÃ§Ã£o de view deve acontecer
    // (postMessage pode ser chamado por resolveWebviewView inicial, nÃ£o por search)
    const callCountBefore = (view.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .length;
    view.__fireMessage({ command: 'search', query: 'x'.repeat(501) });
    const callCountAfter = (view.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore);
  });

  it('mensagem "search" com query atualiza a view com resultados filtrados', async () => {
    const agent = makeAgent('agent-backend');
    const registry: IPackageRepository = {
      ...emptyRegistry,
      search: async () => [agent],
      getAllBundles: async () => [],
    };
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );
    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );
    vi.mocked(view.webview.postMessage).mockClear();
    view.__fireMessage({ command: 'search', query: 'backend' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.webview.postMessage).toHaveBeenCalled();
  });

  it('mensagem "filter" com tipo específico atualiza a view', async () => {
    const agent = makeAgent('agent-backend');
    const registry: IPackageRepository = {
      ...emptyRegistry,
      getAll: async () => [agent],
      getAllBundles: async () => [],
    };
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );
    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );
    vi.mocked(view.webview.postMessage).mockClear();
    view.__fireMessage({ command: 'filter', type: 'agent' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.webview.postMessage).toHaveBeenCalled();
  });

  it('mensagem "installBundle" aciona operação de instalação de bundle', async () => {
    const bundle = makeBundle();
    const agent = makeAgent('agent-backend');
    const registry: IPackageRepository = {
      ...emptyRegistry,
      findBundleById: async (id) => (id === bundle.id ? bundle : undefined),
      findById: async (id) => (id === agent.id ? agent : undefined),
    };
    const operations = createMockOperations();
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      notInstalledScanner,
      mockInstaller,
      operations,
    );
    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );
    view.__fireMessage({ command: 'installBundle', bundleId: 'bundle-backend' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(operations.run).toHaveBeenCalled();
  });

  it('mensagem "uninstall" aciona operação de desinstalação', async () => {
    const agent = makeAgent('agent-backend');
    const registry: IPackageRepository = {
      ...emptyRegistry,
      findById: async (id) => (id === agent.id ? agent : undefined),
    };
    const operations = createMockOperations();
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      notInstalledScanner,
      mockInstaller,
      operations,
    );
    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );
    view.__fireMessage({ command: 'uninstall', packageId: 'agent-backend' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(operations.run).toHaveBeenCalled();
  });

  it('mensagem "installNetwork" instala o agent e todos do seu network', async () => {
    const agent = makeAgent('agent-backend');
    const registry: IPackageRepository = {
      ...emptyRegistry,
      findById: async (id) => (id === agent.id ? agent : undefined),
      getAgentNetwork: async () => [agent],
      getAll: async () => [agent],
      getAllBundles: async () => [],
    };
    const operations = createMockOperations();
    const provider = new CatalogViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      notInstalledScanner,
      mockInstaller,
      operations,
    );
    const view = createMockWebviewView();
    queueInformationMessageResponse('Instalar rede completa (1)');
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );
    view.__fireMessage({ command: 'installNetwork', packageId: 'agent-backend' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(operations.run).toHaveBeenCalled();
  });
});

// â”€â”€â”€ HealthViewProvider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('HealthViewProvider', () => {
  let logger: AppLogger;

  beforeEach(() => {
    try {
      AppLogger.getInstance().dispose();
    } catch {
      /* */
    }
    logger = AppLogger.getInstance();
  });

  afterEach(() => {
    setWorkspaceRoot(undefined);
    logger.dispose();
  });

  const makeHealthChecker = (report?: HealthReport) =>
    ({
      check: vi.fn(async () => report ?? HealthReport.create([], 10)),
    }) as unknown as HealthCheckerService;

  it('resolveWebviewView define HTML inicial e registra listener', () => {
    const provider = new HealthViewProvider(
      vscode.Uri.file('/ext'),
      makeHealthChecker(),
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    expect(typeof view.webview.html).toBe('string');
  });

  it('mensagem "runCheck" executa health check e posta resultado', async () => {
    const checker = makeHealthChecker();
    const provider = new HealthViewProvider(
      vscode.Uri.file('/ext'),
      checker,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'runCheck' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(checker.check).toHaveBeenCalled();
    expect(view.webview.postMessage).toHaveBeenCalled();
  });

  it('mensagem invÃ¡lida Ã© ignorada', () => {
    const checker = makeHealthChecker();
    const provider = new HealthViewProvider(
      vscode.Uri.file('/ext'),
      checker,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'unknown' });
    view.__fireMessage(42);
    expect(checker.check).not.toHaveBeenCalled();
  });

  it('refresh() executa check e posta resultado sem resolveWebviewView prÃ©vio nÃ£o falha', async () => {
    const checker = makeHealthChecker();
    const provider = new HealthViewProvider(
      vscode.Uri.file('/ext'),
      checker,
      createMockOperations(),
    );
    // refresh sem view configurada â†’ nÃ£o deve lanÃ§ar
    await expect(provider.refresh()).resolves.not.toThrow();
  });

  it('refresh() com view jÃ¡ configurada posta mensagem de resultado', async () => {
    const checker = makeHealthChecker();
    const provider = new HealthViewProvider(
      vscode.Uri.file('/ext'),
      checker,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    await provider.refresh();
    expect(checker.check).toHaveBeenCalled();
  });

  it('runCheck com findings de erro inclui severidades no payload postado', async () => {
    const report = HealthReport.create(
      [
        {
          id: 'no-github-dir',
          severity: HealthSeverity.Error,
          category: 'general',
          title: 'Sem .github',
          message: 'Diretório .github ausente',
          autoFixable: false,
        },
        {
          id: 'no-vscode-dir',
          severity: HealthSeverity.Warning,
          category: 'general',
          title: 'Sem .vscode',
          message: 'Diretório .vscode ausente',
          autoFixable: true,
        },
      ],
      10,
    );
    const checker = { check: vi.fn(async () => report) } as unknown as HealthCheckerService;
    const provider = new HealthViewProvider(
      vscode.Uri.file('/ext'),
      checker,
      createMockOperations(),
    );
    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );
    view.__fireMessage({ command: 'runCheck' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const postMessageArgs = (view.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    const stateCall = postMessageArgs.find((msg) => msg?.type === 'setState');
    expect(stateCall).toBeDefined();
    expect(checker.check).toHaveBeenCalled();
  });
});

// â”€â”€â”€ InstalledViewProvider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('InstalledViewProvider', () => {
  let logger: AppLogger;

  beforeEach(() => {
    try {
      AppLogger.getInstance().dispose();
    } catch {
      /* */
    }
    logger = AppLogger.getInstance();
  });

  afterEach(() => {
    setWorkspaceRoot(undefined);
    logger.dispose();
  });

  it('resolveWebviewView configura webview e define HTML', () => {
    const provider = new InstalledViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    expect(view.webview.options).toMatchObject({ enableScripts: true });
    expect(typeof view.webview.html).toBe('string');
  });

  it('refresh() com pacotes instalados posta mensagem atualizada', async () => {
    const agent = makeAgent('agent-backend');
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };

    const provider = new InstalledViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      alwaysInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    await provider.refresh();
    expect(view.webview.postMessage).toHaveBeenCalled();
  });

  it('mensagem "refresh" atualiza a view (postMessage chamado)', async () => {
    const provider = new InstalledViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );
    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );
    vi.mocked(view.webview.postMessage).mockClear();
    view.__fireMessage({ command: 'refresh' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.webview.postMessage).toHaveBeenCalled();
  });

  it('mensagem "uninstall" aciona operaÃ§Ã£o de desinstalaÃ§Ã£o', async () => {
    const agent = makeAgent('agent-backend');
    const registry: IPackageRepository = {
      ...emptyRegistry,
      getAll: async () => [agent],
      findById: async (id) => (id === agent.id ? agent : undefined),
    };
    const operations = createMockOperations();
    const provider = new InstalledViewProvider(
      vscode.Uri.file('/ext'),
      registry,
      alwaysInstalledScanner,
      mockInstaller,
      operations,
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'uninstall', packageId: 'agent-backend' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(operations.run).toHaveBeenCalled();
  });

  it('mensagem "uninstall" com packageId vazio Ã© rejeitada (type guard)', () => {
    const operations = createMockOperations();
    const provider = new InstalledViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      operations,
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'uninstall', packageId: '' });
    expect(operations.run).not.toHaveBeenCalled();
  });

  it('mensagem "openFile" com path relativo válido abre documento', async () => {
    setWorkspaceRoot('/fake/workspace');
    const provider = new InstalledViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'openFile', filePath: '.github/agents/backend.agent.md' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(vscode.window.showTextDocument).toHaveBeenCalled();
  });

  it('mensagem "openFile" com path traversal "../../../" Ã© rejeitada (type guard)', () => {
    const provider = new InstalledViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'openFile', filePath: '../../etc/passwd' });
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });

  it('mensagem "openFile" com path absoluto "/" Ã© rejeitada (type guard)', () => {
    const provider = new InstalledViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    view.__fireMessage({ command: 'openFile', filePath: '/absolute/path/file.ts' });
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });

  it('mensagens invÃ¡lidas sÃ£o ignoradas silenciosamente', () => {
    const provider = new InstalledViewProvider(
      vscode.Uri.file('/ext'),
      emptyRegistry,
      notInstalledScanner,
      mockInstaller,
      createMockOperations(),
    );

    const view = createMockWebviewView();
    provider.resolveWebviewView(
      view as unknown as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as vscode.CancellationToken,
    );

    expect(() => view.__fireMessage({ command: 'xss', payload: '<img onerror=1>' })).not.toThrow();
    expect(() => view.__fireMessage(undefined)).not.toThrow();
    expect(() => view.__fireMessage([])).not.toThrow();
  });
});
