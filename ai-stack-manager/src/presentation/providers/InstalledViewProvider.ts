/**
 * @module presentation/providers/InstalledViewProvider
 * @description WebviewViewProvider for the Installed packages sidebar panel.
 * Shows packages currently installed in the workspace with manage actions.
 */

import * as vscode from 'vscode';
import { WebviewHelper } from '../webview/WebviewHelper';
import { Package, InstallStatus } from '../../domain/entities/Package';
import { IPackageRepository, IWorkspaceScanner, IInstaller } from '../../domain/interfaces';

type InstalledMessage =
  | { command: 'uninstall'; packageId: string }
  | { command: 'openFile'; filePath: string }
  | { command: 'configure'; packageId: string }
  | { command: 'refresh' }
  | { command: 'openExternal'; url?: string };

function isInstalledMessage(value: unknown): value is InstalledMessage {
  if (!value || typeof value !== 'object') { return false; }
  const message = value as Record<string, unknown>;
  return typeof message.command === 'string';
}

export class InstalledViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dai-installed';
  private _view?: vscode.WebviewView;
  private _initialized = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _registry: IPackageRepository,
    private readonly _scanner: IWorkspaceScanner,
    private readonly _installer: IInstaller,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };

    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isInstalledMessage(message)) { return; }

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
        case 'refresh': await this.updateView(); break;
        case 'openExternal':
          if (message.url && this.isSafeExternalUrl(message.url)) {
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
          }
          break;
      }
    });

    this.updateView();
  }

  public async refresh(): Promise<void> { await this.updateView(); }

  private async updateView(): Promise<void> {
    if (!this._view) { return; }

    const allPackages = await this._registry.getAll();
    const installed: Array<{ pkg: Package; status: InstallStatus }> = [];

    await Promise.all(
      allPackages.map(async (pkg) => {
        const status = await this._scanner.getInstallStatus(pkg);
        if (status === InstallStatus.Installed || status === InstallStatus.Partial) {
          installed.push({ pkg, status });
        }
      })
    );

    const grouped = new Map<string, Array<{ pkg: Package; status: InstallStatus }>>();
    for (const item of installed) {
      const key = item.pkg.agentMeta?.category.label ?? item.pkg.type.label;
      if (!grouped.has(key)) { grouped.set(key, []); }
      grouped.get(key)!.push(item);
    }

    const state = {
      html: this.renderInstalled(installed, grouped),
      animationsEnabled: !this._initialized,
    };

    if (!this._initialized) {
      this._view.webview.html = WebviewHelper.buildStatefulHtml({
        webview: this._view.webview,
        extensionUri: this._extensionUri,
        title: 'DescomplicAI — Instalados',
        initialState: state,
        scriptContent: this.getScript(),
      });
      this._initialized = true;
      return;
    }

    WebviewHelper.postState(this._view.webview, state);
  }

  private renderInstalled(
    installed: Array<{ pkg: Package; status: InstallStatus }>,
    grouped: Map<string, Array<{ pkg: Package; status: InstallStatus }>>,
  ): string {
    if (installed.length === 0) {
      return /*html*/`
      <div class="dai-container">
        <div class="dai-empty ${this.animClass('animate-fade-in')}">
          <span class="dai-empty-icon">📦</span>
          <span class="dai-empty-text">Nenhum pacote instalado</span>
          <span class="dai-empty-hint">Navegue no Catálogo para instalar seu primeiro pacote</span>
        </div>
      </div>`;
    }

    let html = /*html*/`<div class="dai-container">
      <div class="dai-installed-summary ${this.animClass('animate-fade-in')}">
        <div class="dai-summary-stat">
          <span class="dai-summary-number">${installed.length}</span>
          <span class="dai-summary-label">Pacotes Instalados</span>
        </div>
        <button class="dai-btn dai-btn-ghost dai-btn-sm" id="refresh-installed">↻ Atualizar</button>
      </div>`;

    let animIndex = 0;
    for (const [typeName, items] of grouped) {
      html += /*html*/`
      <div class="dai-section">
        <div class="dai-section-header">
          <span class="dai-section-title">${typeName}s</span>
          <span class="dai-section-count">${items.length}</span>
        </div>
        ${items.map(({ pkg, status }) => {
          animIndex++;
          const catColor = pkg.agentMeta?.category.color ?? pkg.type.color;
          return /*html*/`
          <div class="dai-installed-item ${this.animClass('animate-slide-in')}" style="--delay: ${animIndex * 0.05}s; --type-color: ${catColor}">
            <div class="dai-installed-info">
              <span class="dai-installed-name">${pkg.displayName}</span>
              <span class="dai-installed-path">${pkg.primaryFilePath}</span>
              <span class="dai-installed-path">${pkg.sourceLabel} · ${pkg.maturityLabel} · ${pkg.stats.installsTotal} installs</span>
            </div>
            <div class="dai-installed-actions">
              ${status === InstallStatus.Partial ? '<span class="dai-partial-badge">Incompleto</span>' : ''}
              ${pkg.type.value === 'agent' ? `<button class="dai-btn dai-btn-ghost dai-btn-sm" data-config="${pkg.id}" title="Configurar Agente">⚙️</button>` : ''}
              ${pkg.docs.links[0] ? `<button class="dai-btn dai-btn-ghost dai-btn-sm" data-link="${pkg.docs.links[0].url}" title="Abrir documentação">🔗</button>` : ''}
              <button class="dai-btn dai-btn-ghost dai-btn-sm" data-open="${pkg.primaryFilePath}" title="Abrir arquivo">📂</button>
              <button class="dai-btn dai-btn-danger dai-btn-sm" data-uninstall="${pkg.id}" title="Desinstalar">✕</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }

    html += '</div>';
    return html;
  }

  private async handleUninstall(packageId: string): Promise<void> {
    const pkg = await this._registry.findById(packageId);
    if (!pkg) { return; }
    await this._installer.uninstall(pkg);
    await this.updateView();
  }

  private async handleOpenFile(filePath: string): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return; }
    const uri = vscode.Uri.file(`${root}/${filePath}`);
    try {
      await vscode.window.showTextDocument(uri);
    } catch {
      vscode.window.showWarningMessage(`Arquivo não encontrado: ${filePath}`);
    }
  }

  private getScript(): string {
    return /*js*/`
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
    } catch {
      return false;
    }
  }
}
