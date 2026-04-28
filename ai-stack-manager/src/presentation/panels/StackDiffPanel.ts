/**
 * @module presentation/panels/StackDiffPanel
 * @description Painel webview que exibe um diff visual entre os pacotes instalados
 * no workspace e um bundle-alvo escolhido.
 *
 * Fluxo de dados:
 *  1. `createOrShow()` recebe o registry de pacotes, o scanner de workspace
 *     e um `targetBundleId` opcional (pré-selecionado via command palette ou
 *     participante de chat).
 *  2. `update()` busca todos os pacotes, todos os bundles e IDs instalados em
 *     paralelo, depois chama `StackDiffBuilder.build()` para produzir um `StackDiff`.
 *  3. O diff é serializado como JSON e embutido diretamente no HTML.
 *  4. O JavaScript client-side renderiza três grupos de cards:
 *     ✅ Instalados  •  🆕 Pendentes  •  🔄 Extras
 *
 * Sem bibliotecas CDN externas — toda a renderização é HTML/CSS/JS puro.
 */

import * as vscode from 'vscode';
import { IPackageRepository, IWorkspaceScanner } from '../../domain/interfaces';
import {
  StackDiffBuilder,
  StackDiff,
  PackageDiffEntry,
} from '../../infrastructure/services/StackDiffBuilder';
import { UxDiagnosticsService } from '../../infrastructure/services/UxDiagnosticsService';

// ─── Auxiliares puros ──────────────────────────────────────────────────────────────

/** Gera um relatório Markdown a partir de um snapshot de StackDiff.
 *  Exportada para permitir testes unitários independentes da API do VS Code.
 */
export function generateMarkdown(diff: StackDiff): string {
  const { targetBundle, installed, missing, extras, coveragePercent } = diff;
  const date = new Date().toLocaleDateString('pt-BR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const total = installed.length + missing.length;

  const tableRow = (e: PackageDiffEntry): string =>
    `| ${e.categoryEmoji} ${e.displayName} | ${e.typeLabel} | ${e.description} |`;

  const table = (entries: PackageDiffEntry[]): string => {
    if (entries.length === 0) {
      return '_Nenhum._';
    }
    return [
      '| Pacote | Tipo | Descrição |',
      '|--------|------|-----------|',
      ...entries.map(tableRow),
    ].join('\n');
  };

  return [
    `# Stack Diff — ${targetBundle.displayName}`,
    '',
    `> **Cobertura: ${Math.round(coveragePercent)}%** — ${installed.length} de ${total} pacotes instalados`,
    '',
    `## ✅ Instalados (${installed.length})`,
    '',
    table(installed),
    '',
    `## 🆕 Pendentes (${missing.length})`,
    '',
    table(missing),
    '',
    `## 🔄 Extras — fora do bundle (${extras.length})`,
    '',
    table(extras),
    '',
    '---',
    `*Gerado por DescomplicAI em ${date}*`,
  ].join('\n');
}

export class StackDiffPanel {
  public static currentPanel: StackDiffPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _registry: IPackageRepository;
  private readonly _scanner: IWorkspaceScanner;
  private readonly _builder: StackDiffBuilder;
  private _targetBundleId: string | undefined;
  private _currentDiff: StackDiff | null = null;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    registry: IPackageRepository,
    scanner: IWorkspaceScanner,
    targetBundleId: string | undefined,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._registry = registry;
    this._scanner = scanner;
    this._builder = new StackDiffBuilder();
    this._targetBundleId = targetBundleId;

    void this.update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (e: { type: string; bundleId?: string }) => {
        if (e.type === 'selectBundle' && e.bundleId) {
          this._targetBundleId = e.bundleId;
          await this.update();
        }
        if (e.type === 'refresh') {
          await this.update();
        }
        if (e.type === 'installBundle') {
          void vscode.commands.executeCommand('dai.installBundle');
        }
        if (e.type === 'copyMarkdown') {
          if (!this._currentDiff) {
            return;
          }
          UxDiagnosticsService.getInstance().track('panel.stackDiff.copyMarkdown', {
            surface: 'panel',
          });
          const md = generateMarkdown(this._currentDiff);
          await vscode.env.clipboard.writeText(md);
          void this._panel.webview.postMessage({
            type: 'toast',
            kind: 'success',
            title: 'Markdown copiado',
            message: 'O relatório foi enviado para a área de transferência.',
          });
          void vscode.window.showInformationMessage(
            'O relatório do Stack Diff foi copiado para a área de transferência.',
          );
        }
        if (e.type === 'exportMarkdown') {
          if (!this._currentDiff) {
            return;
          }
          UxDiagnosticsService.getInstance().track('panel.stackDiff.exportMarkdown', {
            surface: 'panel',
          });
          const md = generateMarkdown(this._currentDiff);
          const doc = await vscode.workspace.openTextDocument({
            content: md,
            language: 'markdown',
          });
          await vscode.window.showTextDocument(doc);
          void vscode.window.showInformationMessage(
            'O relatório do Stack Diff foi aberto como documento Markdown.',
          );
          void this._panel.webview.postMessage({
            type: 'toast',
            kind: 'info',
            title: 'Markdown exportado',
            message: 'O relatório foi aberto em uma nova aba de Markdown.',
          });
        }
      },
      null,
      this._disposables,
    );
  }

  // ─── API Pública ──────────────────────────────────────────────────────────────────────────

  public static createOrShow(
    extensionUri: vscode.Uri,
    registry: IPackageRepository,
    scanner: IWorkspaceScanner,
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
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      },
    );

    StackDiffPanel.currentPanel = new StackDiffPanel(
      panel,
      extensionUri,
      registry,
      scanner,
      targetBundleId,
    );
  }

  public dispose(): void {
    StackDiffPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  // ─── Carregamento de dados ──────────────────────────────────────────────────────────────────────

  public async update(): Promise<void> {
    try {
      this._panel.webview.html = this._getLoadingHtml(this._panel.webview);

      const [allPackages, bundles, installedIds] = await Promise.all([
        this._registry.getAll(),
        this._registry.getAllBundles(),
        this._scanner.getInstalledPackageIds(),
      ]);

      if (bundles.length === 0) {
        this._panel.webview.html = this._getErrorHtml('Nenhum bundle encontrado no catálogo.');
        return;
      }

      // Se nenhum bundle foi pré-selecionado, usa o primeiro
      let targetBundle = bundles.find((b) => b.id === this._targetBundleId) ?? bundles[0];
      this._targetBundleId = targetBundle.id;

      const diff = this._builder.build({ targetBundle, allPackages, installedIds });
      this._currentDiff = diff;

      this._panel.webview.html = this._getHtmlForWebview(
        this._panel.webview,
        diff,
        bundles.map((b) => ({ id: b.id, displayName: b.displayName, icon: b.icon })),
      );
    } catch (err) {
      this._panel.webview.html = this._getErrorHtml(String(err));
    }
  }

  // ─── Geração de HTML ────────────────────────────────────────────────────────────────────────

  private getPanelStyles(): string {
    return /* css */ `
    :root {
      --color-installed: #28a745;
      --color-missing: #0d6efd;
      --color-extra: #6c757d;
      --radius: 12px;
    }
    body { padding: 0; margin: 0; background: var(--vscode-editor-background); color: var(--vscode-foreground); }

    .sd-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      background: var(--dai-surface-glass);
      border-bottom: 1px solid var(--dai-border-soft);
      position: sticky; top: 0; z-index: 10;
      backdrop-filter: blur(14px);
    }
    .sd-header h1 { font-size: 1rem; font-weight: 700; margin: 0; flex: 1; }
    .sd-toolbar-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--dai-text-muted);
    }
    .sd-bundle-select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--dai-border-soft);
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 0.85rem;
      cursor: pointer;
      min-width: 220px;
    }
    .sd-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 10px;
      padding: 8px 14px;
      font-size: 0.82rem;
      cursor: pointer;
      min-height: 34px;
    }
    .sd-btn:hover { opacity: .9; }
    .sd-btn:focus-visible,
    .sd-bundle-select:focus-visible,
    .sd-card:focus-visible {
      outline: none;
      box-shadow: var(--dai-shadow-focus);
    }

    .sd-coverage {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 20px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--dai-border-soft);
    }
    .sd-coverage-bar-wrap {
      flex: 1;
      height: 8px;
      background: var(--vscode-progressBar-background, rgba(255,255,255,.1));
      border-radius: 999px;
      overflow: hidden;
    }
    .sd-coverage-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--itau-primary-dark), var(--itau-primary-light));
      border-radius: 999px;
      transition: width .4s ease;
    }
    .sd-coverage-label { font-size: 0.78rem; color: var(--dai-text-muted); white-space: nowrap; }

    .sd-selection-panel {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--dai-border-soft);
      background: rgba(var(--dai-accent-rgb), 0.08);
    }
    .sd-selection-title { font-size: 0.82rem; font-weight: 700; }
    .sd-selection-copy { font-size: 0.76rem; color: var(--dai-text-muted); line-height: 1.5; }

    .sd-columns {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 1px;
      background: var(--dai-border-soft);
      min-height: calc(100vh - 164px);
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
    .sd-col-header.missing   { border-color: var(--color-missing); }
    .sd-col-header.extra     { border-color: var(--color-extra); }
    .sd-col-header h2 { font-size: 0.88rem; font-weight: 700; margin: 0; flex: 1; }
    .sd-col-count {
      font-size: 0.75rem;
      background: rgba(255,255,255,.08);
      border-radius: 999px;
      padding: 2px 8px;
    }

    .sd-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      width: 100%;
      padding: 12px;
      margin-bottom: 8px;
      border-radius: var(--radius);
      border: 1px solid var(--dai-border-soft);
      background: var(--dai-surface-glass);
      color: var(--vscode-foreground);
      text-align: left;
      cursor: pointer;
      font: inherit;
      transition: transform var(--dai-duration-base) var(--dai-ease-standard), border-color var(--dai-duration-base) var(--dai-ease-standard), box-shadow var(--dai-duration-base) var(--dai-ease-standard);
    }
    .sd-card:hover {
      transform: translateY(-2px);
      border-color: var(--dai-border-strong);
    }
    .sd-card.is-selected {
      border-color: var(--dai-border-strong);
      box-shadow: 0 0 0 1px rgba(var(--dai-accent-rgb), 0.24), var(--dai-shadow-sm);
      background: linear-gradient(135deg, rgba(var(--dai-accent-rgb), 0.08), transparent 70%), var(--dai-surface-glass);
    }
    .sd-card-emoji { font-size: 1.2rem; line-height: 1; padding-top: 2px; }
    .sd-card-body { flex: 1; min-width: 0; }
    .sd-card-name { font-size: 0.84rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sd-card-desc { font-size: 0.75rem; color: var(--dai-text-muted); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5; }
    .sd-type-badge {
      font-size: 0.68rem;
      padding: 2px 8px;
      border-radius: 999px;
      white-space: nowrap;
      border: 1px solid rgba(255,255,255,.12);
      color: var(--dai-text-muted);
    }
    .sd-empty { text-align: center; padding: 32px 0; color: var(--dai-text-muted); font-size: 0.82rem; }

    .sd-loading-card { display: flex; flex-direction: column; gap: 10px; }

    @media (max-width: 960px) {
      .sd-columns { grid-template-columns: 1fr; }
      .sd-col { min-height: 220px; }
    }
  `;
  }

  private _getHtmlForWebview(
    webview: vscode.Webview,
    diff: StackDiff,
    allBundles: Array<{ id: string; displayName: string; icon: string }>,
  ): string {
    const mainCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'main.css'),
    );

    const diffJson = JSON.stringify(diff);
    const bundlesJson = JSON.stringify(allBundles);

    return /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DescomplicAI: Stack Diff</title>
  <link rel="stylesheet" href="${mainCssUri}">
  <style>${this.getPanelStyles()}</style>
</head>
<body>
  <div id="dai-toast-region" class="dai-toast-region" aria-live="polite" aria-atomic="false"></div>
  <!-- Top bar -->
  <div class="sd-header">
    <span style="font-size:1.3rem">📊</span>
    <h1>Stack Diff</h1>
    <label class="sd-toolbar-label" for="bundle-select">Bundle alvo</label>
    <select id="bundle-select" class="sd-bundle-select" aria-label="Selecionar bundle para comparação"></select>
    <button class="sd-btn" id="btn-install" type="button" aria-label="Instalar pacotes pendentes do bundle">⬇️ Instalar Pendentes</button>
    <button class="sd-btn" id="btn-copy-md" type="button" style="background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)" aria-label="Copiar diff em Markdown">📋 Copiar Markdown</button>
    <button class="sd-btn" id="btn-export-md" type="button" style="background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)" aria-label="Exportar diff em Markdown">💾 Exportar .md</button>
    <button class="sd-btn" id="btn-refresh" type="button" style="background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)" aria-label="Atualizar comparação">↺ Atualizar</button>
  </div>

  <!-- Coverage bar -->
  <div class="sd-coverage" role="group" aria-label="Cobertura do bundle selecionado">
    <span class="sd-coverage-label" id="coverage-text"></span>
    <div class="sd-coverage-bar-wrap">
      <div class="sd-coverage-bar-fill" id="coverage-fill" style="width:0%"></div>
    </div>
    <span class="sd-coverage-label" id="coverage-pct"></span>
  </div>

  <div class="sd-selection-panel" id="sd-selection-panel" role="status" aria-live="polite">
    <span class="sd-selection-title">Navegação por teclado habilitada</span>
    <span class="sd-selection-copy">Use as setas para navegar pelos cards e comparar cada pacote com o bundle alvo.</span>
  </div>

  <!-- Three-column diff grid -->
  <div class="sd-columns" role="region" aria-label="Grade de comparação da stack">
    <section class="sd-col" id="col-installed" aria-label="Pacotes instalados"></section>
    <section class="sd-col" id="col-missing" aria-label="Pacotes pendentes"></section>
    <section class="sd-col" id="col-extra" aria-label="Pacotes extras"></section>
  </div>

  <script>
    const vscode   = acquireVsCodeApi();
    const DIFF     = ${diffJson};
    const BUNDLES  = ${bundlesJson};
    const selectionPanel = document.getElementById('sd-selection-panel');
    const cardMatrix = [[], [], []];

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function showToast(kind, title, message, duration) {
      const region = document.getElementById('dai-toast-region');
      if (!region) { return; }
      const icons = { success: 'OK', warning: '!', error: 'x', info: 'i' };
      const toast = document.createElement('div');
      toast.className = 'dai-toast dai-toast-' + (kind || 'info') + ' animate-slide-in';
      toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      toast.innerHTML = '<span class="dai-toast-icon" aria-hidden="true">' + escHtml(icons[kind] || icons.info) + '</span>'
        + '<div class="dai-toast-copy"><strong class="dai-toast-title">' + escHtml(title || 'Atualização') + '</strong>'
        + (message ? '<span class="dai-toast-message">' + escHtml(message) + '</span>' : '')
        + '</div>'
        + '<button type="button" class="dai-toast-close" aria-label="Dispensar notificação">Fechar</button>';
      const dismiss = () => {
        toast.classList.add('dai-toast-leaving');
        window.setTimeout(() => toast.remove(), 180);
      };
      toast.querySelector('.dai-toast-close')?.addEventListener('click', dismiss, { once: true });
      region.appendChild(toast);
      window.setTimeout(dismiss, duration || 4200);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'toast') {
        showToast(msg.kind, msg.title, msg.message, msg.duration);
      }
    });

    function describeStatus(statusClass) {
      if (statusClass === 'installed') {
        return { title: 'Alinhado ao bundle', copy: 'Este pacote já está presente no workspace e contribui para a cobertura do bundle.' };
      }
      if (statusClass === 'missing') {
        return { title: 'Instalação recomendada', copy: 'Este pacote faz parte do bundle alvo, mas ainda não está instalado no workspace.' };
      }
      return { title: 'Fora do bundle alvo', copy: 'Este pacote está instalado, mas não faz parte da recomendação atual do bundle selecionado.' };
    }

    function getEntry(columnIndex, cardIndex) {
      const column = cardMatrix[columnIndex] || [];
      if (!column.length) { return null; }
      const safeIndex = Math.max(0, Math.min(cardIndex, column.length - 1));
      return column[safeIndex];
    }

    function setSelection(entryObj, announce) {
      if (!entryObj || !selectionPanel) { return; }
      cardMatrix.flat().forEach((item) => {
        item.card.classList.toggle('is-selected', item === entryObj);
        item.card.tabIndex = item === entryObj ? 0 : -1;
      });
      const status = describeStatus(entryObj.statusClass);
      selectionPanel.innerHTML = '<span class="sd-selection-title">' + escHtml(entryObj.entry.displayName) + ' • ' + escHtml(status.title) + '</span>'
        + '<span class="sd-selection-copy">' + escHtml(status.copy + ' ' + entryObj.entry.description) + '</span>';
      if (announce) {
        entryObj.card.focus();
      }
    }

    function handleCardKeydown(event, entryObj) {
      let next = null;
      switch (event.key) {
        case 'ArrowRight':
          next = getEntry(entryObj.columnIndex + 1, entryObj.cardIndex);
          break;
        case 'ArrowLeft':
          next = getEntry(entryObj.columnIndex - 1, entryObj.cardIndex);
          break;
        case 'ArrowDown':
          next = getEntry(entryObj.columnIndex, entryObj.cardIndex + 1);
          break;
        case 'ArrowUp':
          next = getEntry(entryObj.columnIndex, entryObj.cardIndex - 1);
          break;
        case 'Home':
          next = getEntry(entryObj.columnIndex, 0);
          break;
        case 'End':
          next = getEntry(entryObj.columnIndex, Number.MAX_SAFE_INTEGER);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          setSelection(entryObj, false);
          return;
        default:
          return;
      }
      if (next) {
        event.preventDefault();
        setSelection(next, true);
      }
    }

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
    document.getElementById('btn-copy-md').addEventListener('click', () => {
      vscode.postMessage({ type: 'copyMarkdown' });
    });
    document.getElementById('btn-export-md').addEventListener('click', () => {
      vscode.postMessage({ type: 'exportMarkdown' });
    });

    /* ── Coverage ── */
    document.getElementById('coverage-text').textContent =
      DIFF.installed.length + '/' + (DIFF.installed.length + DIFF.missing.length) + ' instalados';
    document.getElementById('coverage-fill').style.width = DIFF.coveragePercent + '%';
    document.getElementById('coverage-pct').textContent  = DIFF.coveragePercent + '%';

    /* ── Render helpers ── */
    function makeCard(entry, statusClass, columnIndex, cardIndex) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'sd-card';
      card.setAttribute('aria-label', entry.displayName + ', ' + entry.typeLabel + ', ' + describeStatus(statusClass).title);
      card.tabIndex = -1;
      const emoji = entry.categoryEmoji || (entry.typeValue === 'skill' ? '📐' : entry.typeValue === 'mcp' ? '🔌' : '📦');
      card.innerHTML = \`
        <div class="sd-card-emoji">\${emoji}</div>
        <div class="sd-card-body">
          <div class="sd-card-name">\${escHtml(entry.displayName)}</div>
          <div class="sd-card-desc">\${escHtml(entry.description)}</div>
        </div>
        <span class="sd-type-badge">\${escHtml(entry.typeLabel)}</span>
      \`;
      const entryObj = { entry, statusClass, card, columnIndex, cardIndex };
      card.addEventListener('click', () => setSelection(entryObj, false));
      card.addEventListener('focus', () => setSelection(entryObj, false));
      card.addEventListener('keydown', (event) => handleCardKeydown(event, entryObj));
      cardMatrix[columnIndex].push(entryObj);
      return card;
    }

    function renderColumn(colId, title, statusClass, icon, entries, columnIndex) {
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
        entries.forEach((entry, cardIndex) => col.appendChild(makeCard(entry, statusClass, columnIndex, cardIndex)));
      }
    }

    renderColumn('col-installed', 'Instalados', 'installed', '✅', DIFF.installed, 0);
    renderColumn('col-missing', 'Pendentes', 'missing', '🆕', DIFF.missing, 1);
    renderColumn('col-extra', 'Extras (fora do bundle)', 'extra', '🔄', DIFF.extras, 2);

    const firstEntry = cardMatrix.flat()[0];
    if (firstEntry) {
      setSelection(firstEntry, false);
    }
  </script>
</body>
</html>`;
  }

  private _getLoadingHtml(webview: vscode.Webview): string {
    const mainCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'main.css'),
    );

    const renderSkeletonColumn = (title: string): string => `
      <section class="sd-col" aria-hidden="true">
        <div class="sd-col-header extra">
          <span style="font-size:1.1rem">⏳</span>
          <h2>${title}</h2>
          <span class="sd-col-count">...</span>
        </div>
        <div class="sd-loading-card">
          <div class="dai-skeleton-block"></div>
          <div class="dai-skeleton-block"></div>
        </div>
      </section>`;

    return /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DescomplicAI: Stack Diff</title>
  <link rel="stylesheet" href="${mainCssUri}">
  <style>${this.getPanelStyles()}</style>
</head>
<body>
  <div class="sd-header">
    <span style="font-size:1.3rem">📊</span>
    <h1>Stack Diff</h1>
    <span class="dai-status-pill dai-status-pill-active">Atualizando</span>
  </div>
  <div class="sd-coverage" aria-hidden="true">
    <span class="sd-coverage-label">Preparando comparação...</span>
    <div class="sd-coverage-bar-wrap"><div class="sd-coverage-bar-fill" style="width: 32%;"></div></div>
    <span class="sd-coverage-label">...</span>
  </div>
  <div class="sd-selection-panel" aria-hidden="true">
    <span class="sd-selection-title">Carregando diff visual</span>
    <span class="sd-selection-copy">Conferindo bundles, pacotes instalados e cobertura atual do workspace.</span>
  </div>
  <div class="sd-columns">
    ${renderSkeletonColumn('Instalados')}
    ${renderSkeletonColumn('Pendentes')}
    ${renderSkeletonColumn('Extras')}
  </div>
</body>
</html>`;
  }

  private _getErrorHtml(message: string): string {
    return /* html */ `<!DOCTYPE html>
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
