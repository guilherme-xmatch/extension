/**
 * @module presentation/panels/StackDiffPanel
 * @description Webview panel that shows a visual diff between the packages
 * currently installed in the workspace and a chosen target bundle.
 *
 * Data flow:
 *  1. `createOrShow()` receives the package registry, workspace scanner,
 *     and an optional `targetBundleId` (pre-selected from command palette or
 *     chat participant).
 *  2. `update()` fetches all packages, all bundles, and installed IDs in
 *     parallel, then calls `StackDiffBuilder.build()` to produce a `StackDiff`.
 *  3. The diff is serialised as JSON and embedded directly into the HTML.
 *  4. Client-side JavaScript renders three card groups:
 *     ✅ Installed  •  🆕 Missing  •  🔄 Extra
 *
 * No external CDN libraries — all rendering is pure HTML/CSS/JS.
 */

import * as vscode from 'vscode';
import { IPackageRepository, IWorkspaceScanner } from '../../domain/interfaces';
import { StackDiffBuilder, StackDiff } from '../../infrastructure/services/StackDiffBuilder';

export class StackDiffPanel {
  public static currentPanel: StackDiffPanel | undefined;

  private readonly _panel:        vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _registry:     IPackageRepository;
  private readonly _scanner:      IWorkspaceScanner;
  private readonly _builder:      StackDiffBuilder;
  private _targetBundleId:        string | undefined;
  private _disposables:           vscode.Disposable[] = [];

  private constructor(
    panel:          vscode.WebviewPanel,
    extensionUri:   vscode.Uri,
    registry:       IPackageRepository,
    scanner:        IWorkspaceScanner,
    targetBundleId: string | undefined,
  ) {
    this._panel          = panel;
    this._extensionUri   = extensionUri;
    this._registry       = registry;
    this._scanner        = scanner;
    this._builder        = new StackDiffBuilder();
    this._targetBundleId = targetBundleId;

    void this.update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(async (e: { type: string; bundleId?: string }) => {
      if (e.type === 'selectBundle' && e.bundleId) {
        this._targetBundleId = e.bundleId;
        await this.update();
      }
      if (e.type === 'refresh') { await this.update(); }
      if (e.type === 'installBundle') {
        void vscode.commands.executeCommand('dai.installBundle');
      }
    }, null, this._disposables);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  public static createOrShow(
    extensionUri:   vscode.Uri,
    registry:       IPackageRepository,
    scanner:        IWorkspaceScanner,
    targetBundleId?: string,
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (StackDiffPanel.currentPanel) {
      if (targetBundleId) {
        StackDiffPanel.currentPanel._targetBundleId = targetBundleId;
      }
      StackDiffPanel.currentPanel._panel.reveal(column);
      void StackDiffPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'daiStackDiff',
      'DescomplicAI: Stack Diff',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts:           true,
        localResourceRoots:      [extensionUri],
        retainContextWhenHidden: true,
      },
    );

    StackDiffPanel.currentPanel = new StackDiffPanel(
      panel, extensionUri, registry, scanner, targetBundleId,
    );
  }

  public dispose(): void {
    StackDiffPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  // ─── Data loading ──────────────────────────────────────────────────────────

  public async update(): Promise<void> {
    try {
      const [allPackages, bundles, installedIds] = await Promise.all([
        this._registry.getAll(),
        this._registry.getAllBundles(),
        this._scanner.getInstalledPackageIds(),
      ]);

      if (bundles.length === 0) {
        this._panel.webview.html = this._getErrorHtml('Nenhum bundle encontrado no catálogo.');
        return;
      }

      // If no target bundle pre-selected, pick the first one
      let targetBundle = bundles.find(b => b.id === this._targetBundleId) ?? bundles[0];
      this._targetBundleId = targetBundle.id;

      const diff = this._builder.build({ targetBundle, allPackages, installedIds });

      this._panel.webview.html = this._getHtmlForWebview(
        this._panel.webview,
        diff,
        bundles.map(b => ({ id: b.id, displayName: b.displayName, icon: b.icon })),
      );
    } catch (err) {
      this._panel.webview.html = this._getErrorHtml(String(err));
    }
  }

  // ─── HTML generation ───────────────────────────────────────────────────────

  private _getHtmlForWebview(
    webview:   vscode.Webview,
    diff:      StackDiff,
    allBundles: Array<{ id: string; displayName: string; icon: string }>,
  ): string {
    const mainCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'main.css'),
    );

    const diffJson    = JSON.stringify(diff);
    const bundlesJson = JSON.stringify(allBundles);

    return /* html */`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DescomplicAI: Stack Diff</title>
  <link rel="stylesheet" href="${mainCssUri}">
  <style>
    :root {
      --color-installed: #28a745;
      --color-missing:   #0d6efd;
      --color-extra:     #6c757d;
      --radius:          8px;
    }
    body { padding: 0; margin: 0; background: var(--vscode-editor-background); }

    /* ── Top bar ── */
    .sd-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--border-color, rgba(255,255,255,.08));
      position: sticky; top: 0; z-index: 10;
    }
    .sd-header h1 { font-size: 1rem; font-weight: 600; margin: 0; flex: 1; }
    .sd-bundle-select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .sd-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 4px;
      padding: 6px 14px; font-size: 0.82rem; cursor: pointer;
    }
    .sd-btn:hover { opacity: .85; }

    /* ── Coverage bar ── */
    .sd-coverage {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 20px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--border-color, rgba(255,255,255,.08));
    }
    .sd-coverage-bar-wrap {
      flex: 1;
      height: 8px;
      background: var(--vscode-progressBar-background, rgba(255,255,255,.1));
      border-radius: 4px;
      overflow: hidden;
    }
    .sd-coverage-bar-fill {
      height: 100%;
      background: var(--color-installed);
      border-radius: 4px;
      transition: width .4s ease;
    }
    .sd-coverage-label { font-size: 0.78rem; color: var(--vscode-descriptionForeground); white-space: nowrap; }

    /* ── Columns ── */
    .sd-columns {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 1px;
      background: var(--border-color, rgba(255,255,255,.06));
      min-height: calc(100vh - 120px);
    }
    .sd-col {
      background: var(--vscode-editor-background);
      padding: 16px;
      overflow-y: auto;
    }
    .sd-col-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid;
    }
    .sd-col-header.installed { border-color: var(--color-installed); }
    .sd-col-header.missing   { border-color: var(--color-missing);   }
    .sd-col-header.extra     { border-color: var(--color-extra);      }
    .sd-col-header h2 { font-size: 0.88rem; font-weight: 600; margin: 0; flex: 1; }
    .sd-col-count {
      font-size: 0.75rem;
      background: rgba(255,255,255,.08);
      border-radius: 10px;
      padding: 2px 8px;
    }

    /* ── Package cards ── */
    .sd-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      margin-bottom: 6px;
      border-radius: var(--radius);
      border: 1px solid var(--border-color, rgba(255,255,255,.08));
      background: var(--vscode-sideBar-background);
    }
    .sd-card-emoji { font-size: 1.2rem; line-height: 1; padding-top: 2px; }
    .sd-card-body  { flex: 1; min-width: 0; }
    .sd-card-name  { font-size: 0.84rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sd-card-desc  { font-size: 0.75rem; color: var(--vscode-descriptionForeground); margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .sd-type-badge {
      font-size: 0.68rem;
      padding: 1px 6px;
      border-radius: 10px;
      white-space: nowrap;
      border: 1px solid rgba(255,255,255,.12);
      opacity: .75;
    }
    .sd-empty { text-align: center; padding: 32px 0; color: var(--vscode-descriptionForeground); font-size: 0.82rem; }
  </style>
</head>
<body>
  <!-- Top bar -->
  <div class="sd-header">
    <span style="font-size:1.3rem">📊</span>
    <h1>Stack Diff</h1>
    <select id="bundle-select" class="sd-bundle-select"></select>
    <button class="sd-btn" id="btn-install">⬇️ Instalar Pendentes</button>
    <button class="sd-btn" id="btn-refresh" style="background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)">↺ Atualizar</button>
  </div>

  <!-- Coverage bar -->
  <div class="sd-coverage">
    <span class="sd-coverage-label" id="coverage-text"></span>
    <div class="sd-coverage-bar-wrap">
      <div class="sd-coverage-bar-fill" id="coverage-fill" style="width:0%"></div>
    </div>
    <span class="sd-coverage-label" id="coverage-pct"></span>
  </div>

  <!-- Three-column diff grid -->
  <div class="sd-columns">
    <div class="sd-col" id="col-installed"></div>
    <div class="sd-col" id="col-missing"></div>
    <div class="sd-col" id="col-extra"></div>
  </div>

  <script>
    const vscode   = acquireVsCodeApi();
    const DIFF     = ${diffJson};
    const BUNDLES  = ${bundlesJson};

    /* ── Bundle picker ── */
    const sel = document.getElementById('bundle-select');
    BUNDLES.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.displayName;
      if (b.id === DIFF.targetBundle.id) { opt.selected = true; }
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      vscode.postMessage({ type: 'selectBundle', bundleId: sel.value });
    });

    document.getElementById('btn-refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('btn-install').addEventListener('click', () => {
      vscode.postMessage({ type: 'installBundle' });
    });

    /* ── Coverage ── */
    document.getElementById('coverage-text').textContent =
      DIFF.installed.length + '/' + (DIFF.installed.length + DIFF.missing.length) + ' instalados';
    document.getElementById('coverage-fill').style.width = DIFF.coveragePercent + '%';
    document.getElementById('coverage-pct').textContent  = DIFF.coveragePercent + '%';

    /* ── Render helpers ── */
    function makeCard(entry) {
      const card    = document.createElement('div');
      card.className = 'sd-card';
      const emoji   = entry.categoryEmoji || (entry.typeValue === 'skill' ? '📐' : entry.typeValue === 'mcp' ? '🔌' : '📦');
      card.innerHTML = \`
        <div class="sd-card-emoji">\${emoji}</div>
        <div class="sd-card-body">
          <div class="sd-card-name">\${entry.displayName}</div>
          <div class="sd-card-desc">\${entry.description}</div>
        </div>
        <span class="sd-type-badge">\${entry.typeLabel}</span>
      \`;
      return card;
    }

    function renderColumn(colId, title, statusClass, icon, entries) {
      const col = document.getElementById(colId);
      const header = document.createElement('div');
      header.className = 'sd-col-header ' + statusClass;
      header.innerHTML = \`
        <span style="font-size:1.1rem">\${icon}</span>
        <h2>\${title}</h2>
        <span class="sd-col-count">\${entries.length}</span>
      \`;
      col.appendChild(header);

      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sd-empty';
        empty.textContent = 'Nenhum pacote nesta categoria';
        col.appendChild(empty);
      } else {
        entries.forEach(e => col.appendChild(makeCard(e)));
      }
    }

    renderColumn('col-installed', 'Instalados',          'installed', '✅', DIFF.installed);
    renderColumn('col-missing',   'Pendentes',            'missing',   '🆕', DIFF.missing);
    renderColumn('col-extra',     'Extras (fora do bundle)', 'extra',  '🔄', DIFF.extras);
  </script>
</body>
</html>`;
  }

  private _getErrorHtml(message: string): string {
    return /* html */`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Stack Diff — Erro</title></head>
<body style="padding:32px;font-family:sans-serif">
  <h2>⚠️ Erro ao carregar Stack Diff</h2>
  <pre style="color:var(--vscode-errorForeground,red)">${message}</pre>
  <p>Verifique se o catálogo está acessível e tente novamente.</p>
</body>
</html>`;
  }
}
