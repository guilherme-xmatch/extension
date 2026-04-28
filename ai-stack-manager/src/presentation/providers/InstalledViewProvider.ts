/**
 * @module presentation/providers/InstalledViewProvider
 * @description WebviewViewProvider para o painel lateral de pacotes instalados.
 * Exibe os pacotes instalados no workspace com ações de gerenciamento.
 */

import * as vscode from 'vscode';
import { WebviewHelper } from '../webview/WebviewHelper';
import { Package, InstallStatus } from '../../domain/entities/Package';
import {
  IPackageRepository,
  IWorkspaceScanner,
  IInstaller,
  IOperationCoordinator,
} from '../../domain/interfaces';
import { AppLogger } from '../../infrastructure/services/AppLogger';

type InstalledMessage =
  | { command: 'uninstall'; packageId: string }
  | { command: 'openFile'; filePath: string }
  | { command: 'configure'; packageId: string }
  | { command: 'refresh' }
  | { command: 'openExternal'; url?: string };

function isInstalledMessage(value: unknown): value is InstalledMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const msg = value as Record<string, unknown>;
  if (typeof msg.command !== 'string') {
    return false;
  }
  switch (msg.command) {
    case 'uninstall':
    case 'configure':
      return typeof msg.packageId === 'string' && msg.packageId.length > 0;
    case 'openFile':
      return (
        typeof msg.filePath === 'string' &&
        msg.filePath.length > 0 &&
        !msg.filePath.includes('..') &&
        !msg.filePath.startsWith('/')
      );
    case 'refresh':
      return true;
    case 'openExternal': {
      if (msg.url === undefined) {
        return true;
      }
      if (typeof msg.url !== 'string') {
        return false;
      }
      try {
        return new URL(msg.url).protocol === 'https:';
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export class InstalledViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dai-installed';
  private _view?: vscode.WebviewView;
  private _initialized = false;
  private readonly _logger = AppLogger.getInstance();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _registry: IPackageRepository,
    private readonly _scanner: IWorkspaceScanner,
    private readonly _installer: IInstaller,
    private readonly _operations: IOperationCoordinator,
  ) {
    this._operations.onDidChangeCurrentOperation(() => {
      if (this._view) {
        void this.updateView();
      }
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };

    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isInstalledMessage(message)) {
        return;
      }

      switch (message.command) {
        case 'uninstall':
          await this.handleUninstall(message.packageId);
          break;
        case 'openFile':
          await this.handleOpenFile(message.filePath);
          break;
        case 'configure':
          vscode.commands.executeCommand('dai.configureAgent', message.packageId);
          break;
        case 'refresh':
          await this.updateView({ showLoading: true });
          break;
        case 'openExternal':
          if (message.url && this.isSafeExternalUrl(message.url)) {
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
          }
          break;
      }
    });

    void this.updateView({ showLoading: true });
  }

  public async refresh(): Promise<void> {
    await this.updateView({ showLoading: true });
  }

  private async updateView(options: { showLoading?: boolean } = {}): Promise<void> {
    if (!this._view) {
      return;
    }

    const showLoading = options.showLoading === true;
    if (!this._initialized) {
      this._view.webview.html = WebviewHelper.buildStatefulHtml({
        webview: this._view.webview,
        extensionUri: this._extensionUri,
        title: 'DescomplicAI — Instalados',
        initialState: { html: this.renderLoading() },
        scriptContent: this.getScript(),
      });
      this._initialized = true;
    } else if (showLoading) {
      WebviewHelper.postState(this._view.webview, { html: this.renderLoading() });
    }

    const allPackages = await this._registry.getAll();
    const installed: Array<{ pkg: Package; status: InstallStatus }> = [];

    await Promise.all(
      allPackages.map(async (pkg) => {
        const status = await this._scanner.getInstallStatus(pkg);
        if (
          status === InstallStatus.Installed ||
          status === InstallStatus.Partial ||
          status === InstallStatus.Outdated
        ) {
          installed.push({ pkg, status });
        }
      }),
    );

    const grouped = new Map<string, Array<{ pkg: Package; status: InstallStatus }>>();
    for (const item of installed) {
      const key = item.pkg.agentMeta?.category.label ?? item.pkg.type.label;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(item);
    }

    const state = {
      html: this.renderInstalled(installed, grouped),
      animationsEnabled: !this._initialized,
    };

    WebviewHelper.postState(this._view.webview, state);
  }

  private renderInstalled(
    installed: Array<{ pkg: Package; status: InstallStatus }>,
    grouped: Map<string, Array<{ pkg: Package; status: InstallStatus }>>,
  ): string {
    const outdatedCount = installed.filter((item) => item.status === InstallStatus.Outdated).length;
    const partialCount = installed.filter((item) => item.status === InstallStatus.Partial).length;

    if (installed.length === 0) {
      return /*html*/ `
      <div class="dai-container">
        <div class="dai-empty ${this.animClass('animate-fade-in')}" role="status" aria-live="polite">
          <span class="dai-empty-icon">📦</span>
          <span class="dai-empty-text">Nenhum pacote instalado</span>
          <span class="dai-empty-hint">Navegue no Catálogo para instalar seu primeiro pacote</span>
        </div>
      </div>`;
    }

    let html = /*html*/ `<div class="dai-container">
      ${this.renderOperationBanner()}
      <div class="dai-installed-summary ${this.animClass('animate-fade-in')}" role="status" aria-live="polite">
        <div class="dai-summary-stat">
          <span class="dai-summary-number">${installed.length}</span>
          <span class="dai-summary-label">Pacotes ativos no workspace</span>
        </div>
        <div class="dai-summary-meta">
          ${outdatedCount > 0 ? `<span class="dai-status-pill dai-status-pill-warning">${outdatedCount} com atualização</span>` : ''}
          ${partialCount > 0 ? `<span class="dai-status-pill dai-status-pill-active">${partialCount} incompletos</span>` : ''}
          ${outdatedCount === 0 && partialCount === 0 ? '<span class="dai-status-pill dai-status-pill-ready">Tudo sincronizado</span>' : ''}
        </div>
        <button class="dai-btn dai-btn-ghost dai-btn-sm" type="button" id="refresh-installed" aria-label="Atualizar lista de instalados">Atualizar</button>
      </div>`;

    let animIndex = 0;
    for (const [typeName, items] of grouped) {
      html += /*html*/ `
      <div class="dai-section">
        <div class="dai-section-header">
          <span class="dai-section-title">${typeName}s</span>
          <span class="dai-section-count">${items.length}</span>
        </div>
        <div class="dai-packages-list" role="list" aria-label="Pacotes instalados em ${this.escapeAttribute(typeName)}">
        ${items
          .map(({ pkg, status }) => {
            animIndex++;
            const catColor = pkg.agentMeta?.category.color ?? pkg.type.color;
            return /*html*/ `
          <div class="dai-installed-item ${this.animClass('animate-slide-in')}" style="--delay: ${animIndex * 0.05}s; --type-color: ${catColor}" role="listitem" aria-label="${this.escapeAttribute(pkg.displayName)}">
            <div class="dai-installed-info">
              <span class="dai-installed-name">${pkg.displayName}</span>
              <span class="dai-installed-path" title="${this.escapeAttribute(pkg.primaryFilePath)}">${pkg.primaryFilePath}</span>
              <span class="dai-installed-path" title="${this.escapeAttribute(`${pkg.sourceLabel} · ${pkg.maturityLabel} · ${pkg.stats.installsTotal} installs`)}">${pkg.sourceLabel} · ${pkg.maturityLabel} · ${pkg.stats.installsTotal} installs</span>
            </div>
            <div class="dai-installed-actions">
              ${status === InstallStatus.Partial ? '<span class="dai-partial-badge">Incompleto</span>' : ''}
              ${status === InstallStatus.Outdated ? '<span class="dai-outdated-badge">↑ Atualizar</span>' : ''}
              ${pkg.type.value === 'agent' ? `<button class="dai-btn dai-btn-ghost dai-btn-sm" type="button" data-config="${pkg.id}" title="Configurar agente" aria-label="Configurar ${this.escapeAttribute(pkg.displayName)}">Configurar</button>` : ''}
              ${pkg.docs.links[0] ? `<button class="dai-btn dai-btn-ghost dai-btn-sm" type="button" data-link="${pkg.docs.links[0].url}" title="Abrir documentação" aria-label="Abrir documentação de ${this.escapeAttribute(pkg.displayName)}">Docs</button>` : ''}
              <button class="dai-btn dai-btn-ghost dai-btn-sm" type="button" data-open="${pkg.primaryFilePath}" title="Abrir arquivo" aria-label="Abrir arquivo principal de ${this.escapeAttribute(pkg.displayName)}">Abrir</button>
              <button class="dai-btn dai-btn-danger dai-btn-sm" type="button" data-uninstall="${pkg.id}" title="Desinstalar" aria-label="Desinstalar ${this.escapeAttribute(pkg.displayName)}">Remover</button>
            </div>
          </div>`;
          })
          .join('')}
        </div>
      </div>`;
    }

    html += '</div>';
    return html;
  }

  private async handleUninstall(packageId: string): Promise<void> {
    const pkg = await this._registry.findById(packageId);
    if (!pkg) {
      return;
    }
    try {
      await this._operations.run(
        {
          kind: 'package-uninstall',
          label: `Removendo ${pkg.displayName}`,
          targetId: pkg.id,
          refreshTargets: ['catalog', 'installed'],
        },
        async (operation) => {
          operation.setProgress(10, pkg.displayName);
          await this._installer.uninstall(pkg, {
            onProgress: () => operation.setProgress(100, pkg.displayName),
          });
        },
      );
      this.notifyWebview(
        'success',
        'Pacote removido',
        `${pkg.displayName} foi removido do workspace.`,
      );
    } catch (error) {
      this.notifyWebview(
        'error',
        'Falha ao remover pacote',
        error instanceof Error ? error.message : `Não foi possível remover ${pkg.displayName}.`,
      );
    }
  }

  private async handleOpenFile(filePath: string): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return;
    }
    const uri = vscode.Uri.file(`${root}/${filePath}`);
    try {
      await vscode.window.showTextDocument(uri);
    } catch (error) {
      this._logger.warn('INSTALLED_OPEN_FILE_FAILED', { filePath, error });
      this.notifyWebview(
        'warning',
        'Arquivo não encontrado',
        `Não foi possível abrir ${filePath}.`,
      );
      vscode.window.showWarningMessage(`Não foi possível abrir o arquivo solicitado: ${filePath}.`);
    }
  }

  private renderLoading(): string {
    return /*html*/ `
      <div class="dai-container" aria-busy="true" aria-live="polite">
        <div class="dai-installed-summary animate-fade-in">
          <div class="dai-summary-stat" style="width: 100%;">
            <div class="dai-skeleton-line" data-size="lg" style="width: 32%;"></div>
            <div class="dai-skeleton-line" style="width: 48%;"></div>
          </div>
          <div class="dai-summary-meta">
            <span class="dai-skeleton-pill"></span>
            <span class="dai-skeleton-pill"></span>
          </div>
        </div>

        <div class="dai-section animate-slide-in" style="--delay: 0.1s;">
          <div class="dai-section-header">
            <span class="dai-section-title">Sincronizando pacotes instalados</span>
          </div>
          <div class="dai-packages-list" role="list" aria-label="Carregando pacotes instalados">
            <div class="dai-skeleton-block" role="listitem"></div>
            <div class="dai-skeleton-block" role="listitem"></div>
            <div class="dai-skeleton-block" role="listitem"></div>
          </div>
        </div>
      </div>`;
  }

  private getScript(): string {
    return /*js*/ `
    const render = (state) => state.html || '<div class="dai-container"></div>';
    const bind = (_state, app) => {
      app.root.querySelector('#refresh-installed')?.addEventListener('click', () => {
        app.postMessage({ command: 'refresh' });
      });

      app.root.querySelectorAll('[data-uninstall]').forEach((btn) => {
        btn.addEventListener('click', () => {
          app.postMessage({ command: 'uninstall', packageId: btn.dataset.uninstall });
        });
      });

      app.root.querySelectorAll('[data-open]').forEach((btn) => {
        btn.addEventListener('click', () => {
          app.postMessage({ command: 'openFile', filePath: btn.dataset.open });
        });
      });

      app.root.querySelectorAll('[data-config]').forEach((btn) => {
        btn.addEventListener('click', () => {
          app.postMessage({ command: 'configure', packageId: btn.dataset.config });
        });
      });

      app.root.querySelectorAll('[data-link]').forEach((btn) => {
        btn.addEventListener('click', () => {
          app.postMessage({ command: 'openExternal', url: btn.dataset.link });
        });
      });
    };
    `;
  }

  private animClass(className: string): string {
    return this._initialized ? '' : className;
  }

  private isSafeExternalUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'https:';
    } catch (error) {
      this._logger.debug('INSTALLED_EXTERNAL_URL_REJECTED', { value, error });
      return false;
    }
  }

  private renderOperationBanner(): string {
    const operation = this._operations.getCurrentOperation();
    if (!operation) {
      return '';
    }

    const progressValue =
      typeof operation.progress === 'number'
        ? Math.max(6, Math.min(100, Math.round(operation.progress)))
        : 24;
    const progressLabel =
      typeof operation.progress === 'number' ? `${progressValue}%` : 'Em andamento';
    const message = operation.message
      ? operation.message
      : 'Sincronizando itens instalados no workspace.';
    return /*html*/ `
    <section class="dai-operation-banner" role="status" aria-live="polite" aria-label="Progresso da operação atual">
      <div class="dai-operation-head">
        <div class="dai-operation-copy">
          <span class="dai-operation-kicker">Execução em andamento</span>
          <p class="dai-operation-label">${operation.label}</p>
          <p class="dai-operation-message">${message}</p>
        </div>
        <span class="dai-status-pill dai-status-pill-active">${progressLabel}</span>
      </div>
      <div class="dai-progress-track" aria-hidden="true">
        <span class="dai-progress-value" style="width: ${progressValue}%"></span>
      </div>
    </section>`;
  }

  private notifyWebview(
    kind: 'success' | 'warning' | 'error' | 'info',
    title: string,
    message: string,
  ): void {
    if (!this._view) {
      return;
    }
    WebviewHelper.postNotification(this._view.webview, { kind, title, message });
  }

  private escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }
}
