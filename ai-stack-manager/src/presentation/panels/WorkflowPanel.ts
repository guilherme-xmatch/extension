/**
 * @module presentation/panels/WorkflowPanel
 * @description Painel webview para o visualizador interativo de workflow de agentes.
 *
 * Renderiza um quadro de pipeline dinâmico e orientado a dados que reflete os agentes
 * instalados no workspace. Quando nenhum agente está instalado, um card de estado vazio
 * orienta o usuário a explorar o catálogo.
 *
 * Fluxo de dados:
 *  1. `createOrShow()` recebe o registry de pacotes e o scanner de workspace
 *  2. `update()` busca os IDs de agentes instalados + todos os pacotes, depois chama
 *     `WorkflowGraphBuilder.buildGraph()` para produzir um `WorkflowGraphData`
 *  3. O grafo é serializado como JSON e embutido diretamente no HTML
 *  4. O JavaScript client-side renderiza as raias de pipeline e desenha setas
 *     Bezier em SVG para as arestas de delegação após o layout do DOM ser concluído
 *
 * Sem bibliotecas CDN externas — toda a renderização é HTML/CSS/JS puro,
 * totalmente compatível com o ambiente sandboxado do webview do VS Code.
 */

import * as vscode from 'vscode';
import { IPackageRepository, IWorkspaceScanner } from '../../domain/interfaces';
import { WorkflowGraphBuilder, WorkflowGraphData } from '../../infrastructure/services/WorkflowGraphBuilder';

export class WorkflowPanel {
  public static currentPanel: WorkflowPanel | undefined;
  private readonly _panel:        vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _registry:     IPackageRepository;
  private readonly _scanner:      IWorkspaceScanner;
  private readonly _builder:      WorkflowGraphBuilder;
  private _disposables:           vscode.Disposable[] = [];

  private constructor(
    panel:        vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    registry:     IPackageRepository,
    scanner:      IWorkspaceScanner,
  ) {
    this._panel        = panel;
    this._extensionUri = extensionUri;
    this._registry     = registry;
    this._scanner      = scanner;
    this._builder      = new WorkflowGraphBuilder();

    void this.update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Permite que o webview solicite um refresh ou abra a barra lateral do catálogo
    this._panel.webview.onDidReceiveMessage(async (e: { type: string }) => {
      if (e.type === 'refresh') { await this.update(); }
      if (e.type === 'openCatalog') {
        void vscode.commands.executeCommand('workbench.view.extension.descomplicai-sidebar');
      }
      // 'saveZoom' é tratado inteiramente no cliente via vscode.setState() — nenhuma ação no servidor necessária
    }, null, this._disposables);
  }

  // ─── API Pública ──────────────────────────────────────────────────────────────────────────

  public static createOrShow(
    extensionUri: vscode.Uri,
    registry:     IPackageRepository,
    scanner:      IWorkspaceScanner,
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (WorkflowPanel.currentPanel) {
      WorkflowPanel.currentPanel._panel.reveal(column);
      void WorkflowPanel.currentPanel.update();   // atualiza ao revelar novamente
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'daiWorkflow',
      'DescomplicAI: Workflow',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts:           true,
        localResourceRoots:      [extensionUri],
        retainContextWhenHidden: true,
      },
    );

    WorkflowPanel.currentPanel = new WorkflowPanel(panel, extensionUri, registry, scanner);
  }

  public dispose(): void {
    WorkflowPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  // ─── Carregamento de dados ────────────────────────────────────────────────────────────────────

  private async update(): Promise<void> {
    try {
      const [allPackages, installedIds] = await Promise.all([
        this._registry.getAll(),
        this._scanner.getInstalledPackageIds(),
      ]);
      const graph = this._builder.buildGraph(allPackages, installedIds);
      this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, graph);
    } catch (err) {
      this._panel.webview.html = this._getErrorHtml(String(err));
    }
  }

  // ─── HTML generation ───────────────────────────────────────────────────────

  private _getHtmlForWebview(webview: vscode.Webview, graph: WorkflowGraphData): string {
    const mainCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'main.css'),
    );
    const animCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'animations.css'),
    );
    const graphJson = JSON.stringify(graph);

    return /* html */`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DescomplicAI: Workflow</title>
  <link href="${mainCssUri}" rel="stylesheet">
  <link href="${animCssUri}" rel="stylesheet">
  <style>
    /* ── Layout ────────────────────────────────────────── */
    html, body { height: 100%; margin: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground); overflow: hidden; }

    .wf-root { display: flex; flex-direction: column; height: 100vh; position: relative; }

    /* ── Header ─────────────────────────────────────────── */
    .wf-header { display: flex; align-items: center; gap: 16px; padding: 18px 28px;
      border-bottom: 1px solid var(--border-color); background: var(--vscode-editor-background);
      position: sticky; top: 0; z-index: 10; contain: layout style; flex-shrink: 0; }
    .wf-header-text { flex: 1; }
    .wf-title { font-size: 1.3rem; font-weight: 700; margin: 0; color: var(--vscode-foreground); }
    .wf-subtitle { margin: 3px 0 0; font-size: 0.82rem; color: var(--vscode-descriptionForeground); }
    .wf-badge { display: inline-flex; align-items: center; gap: 4px;
      background: rgba(236,112,0,0.12); color: #EC7000; border: 1px solid rgba(236,112,0,0.3);
      border-radius: 12px; padding: 2px 10px; font-size: 0.78rem; font-weight: 600; }
    .wf-refresh-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px;
      border-radius: 6px; border: 1px solid var(--border-color); background: transparent;
      color: var(--vscode-foreground); cursor: pointer; font-size: 0.82rem; transition: background 0.15s; }
    .wf-refresh-btn:hover { background: rgba(255,255,255,0.05); }

    /* ── Pipeline board ──────────────────────────────────── */
    .wf-board-wrapper { flex: 1; overflow: auto; padding: 28px;
      background-image: radial-gradient(var(--border-color) 1px, transparent 1px);
      background-size: 22px 22px; }
    .wf-board { display: flex; gap: 20px; align-items: flex-start; min-width: max-content; }

    /* ── Phase lane ──────────────────────────────────────── */
    .wf-lane { display: flex; flex-direction: column; gap: 12px; min-width: 180px; max-width: 220px; }
    .wf-lane-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px;
      background: var(--vscode-editor-background); border: 1px solid var(--border-color);
      border-radius: 8px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); }
    .wf-connector { display: flex; align-items: center; padding-top: 10px;
      color: var(--vscode-descriptionForeground); opacity: 0.5; font-size: 1.2rem; user-select: none; }

    /* ── Agent card ───────────────────────────────────────── */
    .wf-card { position: relative; padding: 12px 14px; background: var(--vscode-editor-background);
      border: 1px solid var(--border-color); border-radius: 8px;
      border-left: 3px solid var(--cat-color, #EC7000); cursor: default;
      transition: transform 0.15s, box-shadow 0.15s; }
    .wf-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.25); }
    .wf-card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .wf-cat-dot { width: 8px; height: 8px; border-radius: 50%;
      background: var(--cat-color, #EC7000); flex-shrink: 0; }
    .wf-card-name { font-size: 0.85rem; font-weight: 600; line-height: 1.3;
      color: var(--vscode-foreground); flex: 1; }
    .wf-cat-badge { display: inline-flex; align-items: center; gap: 3px;
      font-size: 0.72rem; color: var(--vscode-descriptionForeground); }
    .wf-user-invocable { display: inline-block; font-size: 0.68rem; margin-top: 5px;
      padding: 1px 6px; border-radius: 4px; background: rgba(0,230,118,0.12);
      color: #00E676; border: 1px solid rgba(0,230,118,0.25); }

    /* ── SVG arrow overlay ────────────────────────────────── */
    #wf-edges { position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 5; overflow: visible; }

    /* ── Legend ───────────────────────────────────────────── */
    .wf-legend { position: fixed; bottom: 20px; left: 20px;
      background: var(--vscode-editor-background); border: 1px solid var(--border-color);
      border-radius: 8px; padding: 12px 16px; font-size: 0.78rem;
      display: flex; flex-direction: column; gap: 5px; z-index: 20;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2); }
    .wf-legend-title { font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground); margin-bottom: 2px; }
    .wf-legend-row { display: flex; align-items: center; gap: 8px; }
    .wf-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

    /* ── Zoom controls ────────────────────────────────────── */
    .wf-zoom { position: fixed; bottom: 20px; right: 20px; display: flex; gap: 4px;
      background: var(--vscode-editor-background); border: 1px solid var(--border-color);
      border-radius: 6px; padding: 4px; z-index: 20; box-shadow: 0 4px 16px rgba(0,0,0,0.2); }
    .wf-zoom-btn { padding: 4px 10px; border-radius: 4px; border: none;
      background: transparent; color: var(--vscode-foreground); cursor: pointer;
      font-size: 0.85rem; transition: background 0.1s; }
    .wf-zoom-btn:hover { background: rgba(255,255,255,0.06); }

    /* ── Empty state ──────────────────────────────────────── */
    .wf-empty { display: flex; flex-direction: column; align-items: center;
      justify-content: center; flex: 1; gap: 16px; padding: 60px 40px; text-align: center; }
    .wf-empty-icon { font-size: 3.5rem; line-height: 1; }
    .wf-empty-title { font-size: 1.1rem; font-weight: 700; margin: 0; }
    .wf-empty-desc { color: var(--vscode-descriptionForeground); max-width: 340px;
      line-height: 1.5; margin: 0; }
    .wf-cta-btn { display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 20px; border-radius: 8px; border: none; background: #EC7000;
      color: #fff; cursor: pointer; font-weight: 600; font-size: 0.88rem;
      transition: background 0.15s, transform 0.1s; }
    .wf-cta-btn:hover { background: #d46200; transform: translateY(-1px); }

    /* ── Tooltip ─────────────────────────────────────────── */
    .wf-tooltip { position: fixed; z-index: 200; max-width: 240px; pointer-events: none;
      background: var(--vscode-editorHoverWidget-background, #252526);
      border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
      border-radius: 7px; padding: 10px 12px; font-size: 0.78rem;
      box-shadow: 0 4px 20px rgba(0,0,0,.45); opacity: 0;
      transition: opacity 0.12s; line-height: 1.5; display: none; }
    .wf-tooltip.visible { opacity: 1; display: block; }
    .wf-tooltip-title { font-weight: 700; font-size: 0.84rem; margin-bottom: 5px;
      display: flex; align-items: center; gap: 5px; }
    .wf-tooltip-desc { color: var(--vscode-descriptionForeground); margin-bottom: 7px; font-size: 0.75rem; }
    .wf-tooltip-row { display: flex; gap: 6px; margin-bottom: 3px; font-size: 0.73rem; }
    .wf-tooltip-label { font-weight: 600; opacity: 0.65; white-space: nowrap; min-width: 52px; }
    .wf-tooltip-val  { color: var(--vscode-foreground); word-break: break-word; }

    /* ── Minimap ─────────────────────────────────────────── */
    .wf-minimap-wrap { position: fixed; bottom: 20px; right: 176px; z-index: 20;
      background: var(--vscode-editor-background); border: 1px solid var(--border-color);
      border-radius: 7px; box-shadow: 0 4px 16px rgba(0,0,0,.2);
      overflow: hidden; cursor: pointer; user-select: none; }
    .wf-minimap-wrap svg { display: block; }
    .wf-minimap-label { font-size: 0.65rem; text-align: center; padding: 3px 0;
      color: var(--vscode-descriptionForeground); border-top: 1px solid var(--border-color); }

    /* ── Skill chips (inline in agent card) ───────────────── */
    .wf-card-skills { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 6px; }
    .wf-skill-chip { display: inline-block; font-size: 0.66rem; padding: 1px 5px;
      border-radius: 10px; white-space: nowrap; border: 1px solid rgba(255,255,255,.12); }
    .wf-skill-chip.installed { background: rgba(0,230,118,0.1); color: #00E676;
      border-color: rgba(0,230,118,0.25); }
    .wf-skill-chip.missing { background: rgba(255,255,255,0.04); color: var(--vscode-descriptionForeground);
      border-color: rgba(255,255,255,.08); }

    /* ── Skills layer (section below pipeline) ────────────── */
    .wf-skills-section { padding: 20px 28px 28px; border-top: 1px solid var(--border-color);
      background: var(--vscode-editor-background); }
    .wf-skills-header { display: flex; align-items: center; gap: 8px;
      font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--vscode-descriptionForeground);
      margin-bottom: 12px; }
    .wf-skills-grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .wf-skill-node { display: flex; align-items: center; gap: 6px; padding: 6px 10px;
      border-radius: 8px; border: 1px solid var(--border-color);
      background: var(--vscode-sideBar-background); font-size: 0.78rem; }
    .wf-skill-node.installed { border-color: rgba(0,230,118,0.3); }
    .wf-skill-node .skill-status { font-size: 0.68rem; opacity: 0.7; }
  </style>
</head>
<body>

<!-- SVG layer for delegation arrows -->
<svg id="wf-edges" aria-hidden="true">
  <defs>
    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="rgba(236,112,0,0.55)" />
    </marker>
  </defs>
</svg>

<div class="wf-root">
  <!-- Header -->
  <div class="wf-header">
    <div class="dai-stack-icon" style="width:36px;height:36px;flex-shrink:0">
      <div class="dai-stack-layer dai-layer-1" style="width:28px;height:28px"></div>
      <div class="dai-stack-layer dai-layer-2" style="width:28px;height:28px"></div>
      <div class="dai-stack-layer dai-layer-3" style="width:28px;height:28px"></div>
    </div>
    <div class="wf-header-text">
      <h1 class="wf-title">Pipeline Dinâmico</h1>
      <p class="wf-subtitle" id="wf-subtitle">Carregando…</p>
    </div>
    <span class="wf-badge" id="wf-count-badge" style="display:none"></span>
    <button class="wf-refresh-btn" id="btn-refresh" title="Atualizar">↺ Atualizar</button>
  </div>

  <!-- Board (populated by JS) -->
  <div class="wf-board-wrapper" id="wf-board-wrapper">
    <div class="wf-board" id="wf-board"></div>
  </div>

  <!-- Skills layer (populated by JS if skills exist) -->
  <div id="wf-skills-section" style="display:none"></div>
</div>

<script>
(function () {
  'use strict';

  // Injected data from extension
  const GRAPH = ${graphJson};
  const vscode = acquireVsCodeApi();

  const boardEl    = document.getElementById('wf-board');
  const subtitleEl = document.getElementById('wf-subtitle');
  const badgeEl    = document.getElementById('wf-count-badge');
  const edgesSvg   = document.getElementById('wf-edges');
  const wrapper    = document.getElementById('wf-board-wrapper');

  document.getElementById('btn-refresh').addEventListener('click', function () {
    vscode.postMessage({ type: 'refresh' });
  });

  // ── Helpers ────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Main render ────────────────────────────────────────
  function render(graph) {
    boardEl.innerHTML = '';

    if (graph.totalAgents === 0) { renderEmpty(); return; }

    subtitleEl.textContent = 'Rede de agents instalados no workspace';
    badgeEl.textContent = graph.totalAgents + ' agent' + (graph.totalAgents !== 1 ? 's' : '');
    badgeEl.style.display = 'inline-flex';

    graph.phases.forEach(function (phase, idx) {
      if (idx > 0) {
        var conn = document.createElement('div');
        conn.className = 'wf-connector';
        conn.textContent = '→';
        boardEl.appendChild(conn);
      }

      var lane = document.createElement('div');
      lane.className = 'wf-lane';
      lane.dataset.phaseId = phase.id;

      var lh = document.createElement('div');
      lh.className = 'wf-lane-header';
      lh.innerHTML = '<span class="wf-lane-emoji">' + escHtml(phase.emoji) + '</span>'
        + '<span>' + escHtml(phase.label) + '</span>';
      lane.appendChild(lh);

      phase.agents.forEach(function (agent) {
        var card = document.createElement('div');
        card.className = 'wf-card animate-fade-in';
        card.dataset.agentId = agent.id;
        card.style.setProperty('--cat-color', agent.categoryColor);

        // Find skills for this agent
        var agentSkillChips = '';
        if (graph.skills && graph.skillEdges) {
          var mySkillIds = graph.skillEdges
            .filter(function (e) { return e.agentId === agent.id; })
            .map(function (e) { return e.skillId; });
          if (mySkillIds.length > 0) {
            var chipsHtml = mySkillIds.map(function (sid) {
              var sk = graph.skills.find(function (s) { return s.id === sid; });
              var label = sk ? sk.displayName : sid;
              var cls   = (sk && sk.installed) ? 'installed' : 'missing';
              return '<span class="wf-skill-chip ' + cls + '">'
                + (sk && sk.installed ? '✅ ' : '📦 ')
                + escHtml(label)
                + '</span>';
            }).join('');
            agentSkillChips = '<div class="wf-card-skills">' + chipsHtml + '</div>';
          }
        }

        card.innerHTML =
          '<div class="wf-card-top">'
          + '<div class="wf-cat-dot"></div>'
          + '<div class="wf-card-name">' + escHtml(agent.displayName) + '</div>'
          + '</div>'
          + '<div class="wf-cat-badge"><span>' + escHtml(agent.categoryEmoji) + '</span>'
          + '<span>' + escHtml(agent.categoryLabel) + '</span></div>'
          + (agent.userInvocable ? '<div class="wf-user-invocable">@ invocável</div>' : '')
          + agentSkillChips;
        lane.appendChild(card);

        // Tooltip on hover
        var agentSnap = agent;
        card.addEventListener('mouseenter', function () { showTooltip(agentSnap, card); });
        card.addEventListener('mouseleave', hideTooltip);
      });

      boardEl.appendChild(lane);
    });

    // Draw arrows after layout settles
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { drawEdges(graph.edges); });
    });

    renderLegend(graph);
    renderZoomControls();
    renderMinimap(graph);
    renderSkillsSection(graph);
  }

  // ── Skills section ─────────────────────────────────────
  function renderSkillsSection(graph) {
    var section = document.getElementById('wf-skills-section');
    section.innerHTML = '';

    if (!graph.skills || graph.skills.length === 0) {
      section.style.display = 'none';
      return;
    }

    var installedCount = graph.skills.filter(function (s) { return s.installed; }).length;
    var total          = graph.skills.length;

    section.className = 'wf-skills-section animate-fade-in';
    section.style.display = 'block';

    var headerHtml = '<div class="wf-skills-header">'
      + '<span>🎓</span>'
      + '<span>Skills em Uso</span>'
      + '<span style="margin-left:8px;font-size:0.72rem;font-weight:400;opacity:.7">'
      + installedCount + '/' + total + ' instaladas'
      + '</span>'
      + '</div>';

    var gridHtml = '<div class="wf-skills-grid">';
    graph.skills.forEach(function (skill) {
      var cls    = skill.installed ? 'wf-skill-node installed' : 'wf-skill-node';
      var status = skill.installed ? '✅' : '📦';
      gridHtml += '<div class="' + cls + '">'
        + '<span>' + status + '</span>'
        + '<span>' + escHtml(skill.displayName) + '</span>'
        + '</div>';
    });
    gridHtml += '</div>';

    section.innerHTML = headerHtml + gridHtml;
  }

  // ── Empty state ────────────────────────────────────────
  function renderEmpty() {
    subtitleEl.textContent = 'Nenhum agent instalado';
    badgeEl.style.display = 'none';
    resetEdges();

    // Hide skills section
    var section = document.getElementById('wf-skills-section');
    if (section) { section.style.display = 'none'; }

    var empty = document.createElement('div');
    empty.className = 'wf-empty animate-fade-in';
    empty.innerHTML =
      '<div class="wf-empty-icon">🤖</div>'
      + '<h2 class="wf-empty-title">Nenhum agent instalado</h2>'
      + '<p class="wf-empty-desc">Instale agents do catálogo para visualizar o pipeline do seu workspace.</p>'
      + '<button class="wf-cta-btn" id="btn-open-catalog">📦 Explorar catálogo</button>';
    boardEl.appendChild(empty);

    document.getElementById('btn-open-catalog').addEventListener('click', function () {
      vscode.postMessage({ type: 'openCatalog' });
    });
  }

  // ── SVG arrows ─────────────────────────────────────────
  function resetEdges() {
    var defs = edgesSvg.querySelector('defs');
    edgesSvg.innerHTML = '';
    if (defs) { edgesSvg.appendChild(defs); }
  }

  function drawEdges(edges) {
    resetEdges();
    edges.forEach(function (edge) {
      var fromEl = document.querySelector('[data-agent-id="' + edge.fromId + '"]');
      var toEl   = document.querySelector('[data-agent-id="' + edge.toId   + '"]');
      if (!fromEl || !toEl) { return; }

      var fr = fromEl.getBoundingClientRect();
      var tr = toEl.getBoundingClientRect();
      var x1 = fr.right,  y1 = fr.top + fr.height / 2;
      var x2 = tr.left,   y2 = tr.top + tr.height / 2;
      var cp = Math.max((x2 - x1) * 0.5, 40);

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d',
        'M' + x1 + ',' + y1 + ' C' + (x1 + cp) + ',' + y1
        + ' ' + (x2 - cp) + ',' + y2 + ' ' + x2 + ',' + y2);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(236,112,0,0.45)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('marker-end', 'url(#arrowhead)');
      edgesSvg.appendChild(path);
    });
  }

  // ── Legend ─────────────────────────────────────────────
  function renderLegend(graph) {
    var existing = document.querySelector('.wf-legend');
    if (existing) { existing.remove(); }

    var catsSeen = new Map();
    graph.phases.forEach(function (p) {
      p.agents.forEach(function (a) {
        if (!catsSeen.has(a.categoryValue)) {
          catsSeen.set(a.categoryValue, { label: a.categoryLabel, emoji: a.categoryEmoji, color: a.categoryColor });
        }
      });
    });
    if (catsSeen.size === 0) { return; }

    var legend = document.createElement('div');
    legend.className = 'wf-legend animate-slide-in';
    legend.style.setProperty('--delay', '0.4s');
    var html = '<div class="wf-legend-title">Categorias</div>';
    catsSeen.forEach(function (cat) {
      html += '<div class="wf-legend-row">'
        + '<div class="wf-legend-dot" style="background:' + cat.color + '"></div>'
        + '<span>' + escHtml(cat.emoji) + ' ' + escHtml(cat.label) + '</span>'
        + '</div>';
    });
    // Show skill summary if present
    if (graph.skills && graph.skills.length > 0) {
      var installedSkills = graph.skills.filter(function (s) { return s.installed; }).length;
      html += '<div class="wf-legend-row" style="margin-top:4px;border-top:1px solid rgba(255,255,255,.07);padding-top:4px">'
        + '<span>🎓 ' + installedSkills + '/' + graph.skills.length + ' skills</span>'
        + '</div>';
    }
    legend.innerHTML = html;
    document.body.appendChild(legend);
  }

  // ── Zoom controls (with persistence) ──────────────────
  function renderZoomControls() {
    if (document.querySelector('.wf-zoom')) { return; }

    // Restore saved zoom from webview state
    var savedState = vscode.getState() || {};
    var scale = (typeof savedState.zoom === 'number') ? savedState.zoom : 1;

    function applyScale() {
      boardEl.style.transform = 'scale(' + scale + ')';
      boardEl.style.transformOrigin = 'top left';
      drawEdges(GRAPH.edges);
      updateMinimapViewport();
      // Persist zoom level using VS Code webview state
      var state = vscode.getState() || {};
      state.zoom = scale;
      vscode.setState(state);
      var label = document.getElementById('z-label');
      if (label) { label.textContent = Math.round(scale * 100) + '%'; }
    }

    var ctrl = document.createElement('div');
    ctrl.className = 'wf-zoom animate-slide-in';
    ctrl.style.setProperty('--delay', '0.5s');
    ctrl.innerHTML =
      '<button class="wf-zoom-btn" id="z-out" title="Diminuir zoom">−</button>'
      + '<button class="wf-zoom-btn" id="z-label" title="Resetar zoom">'
      + Math.round(scale * 100) + '%</button>'
      + '<button class="wf-zoom-btn" id="z-in" title="Aumentar zoom">+</button>';
    document.body.appendChild(ctrl);

    // Apply saved scale on initial render
    if (scale !== 1) { applyScale(); }

    document.getElementById('z-in').addEventListener('click', function () {
      scale = Math.min(scale + 0.1, 2.5); applyScale();
    });
    document.getElementById('z-out').addEventListener('click', function () {
      scale = Math.max(scale - 0.1, 0.3); applyScale();
    });
    document.getElementById('z-label').addEventListener('click', function () {
      scale = 1; applyScale();
    });

    wrapper.addEventListener('scroll', function () {
      if (GRAPH.edges.length > 0) {
        requestAnimationFrame(function () { drawEdges(GRAPH.edges); });
      }
      requestAnimationFrame(updateMinimapViewport);
    }, { passive: true });
  }

  // ── Minimap ────────────────────────────────────────────
  var _minimapSvg = null;

  function renderMinimap(graph) {
    var existing = document.querySelector('.wf-minimap-wrap');
    if (existing) { existing.remove(); }
    _minimapSvg = null;

    if (graph.totalAgents === 0) { return; }

    var MM_W = 160;
    var MM_H = 80;
    var PHASE_COUNT = graph.phases.length;
    if (PHASE_COUNT === 0) { return; }

    var phaseW = MM_W / PHASE_COUNT;
    var agentR = 4;
    var maxAgents = Math.max.apply(null, graph.phases.map(function (p) { return p.agents.length; }));
    var agentSpacing = maxAgents > 0 ? (MM_H - 10) / Math.max(maxAgents, 1) : 20;

    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(MM_W));
    svg.setAttribute('height', String(MM_H));
    svg.setAttribute('viewBox', '0 0 ' + MM_W + ' ' + MM_H);
    svg.style.display = 'block';

    // Phase backgrounds
    graph.phases.forEach(function (phase, pi) {
      var rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(pi * phaseW + 1));
      rect.setAttribute('y', '1');
      rect.setAttribute('width', String(phaseW - 2));
      rect.setAttribute('height', String(MM_H - 2));
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', 'rgba(255,255,255,0.03)');
      svg.appendChild(rect);

      // Phase label
      var txt = document.createElementNS(ns, 'text');
      txt.setAttribute('x', String(pi * phaseW + phaseW / 2));
      txt.setAttribute('y', '8');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', '5');
      txt.setAttribute('fill', 'rgba(255,255,255,0.3)');
      txt.textContent = phase.emoji;
      svg.appendChild(txt);

      // Agent dots
      phase.agents.forEach(function (agent, ai) {
        var cx = pi * phaseW + phaseW / 2;
        var cy = 14 + ai * agentSpacing;
        var circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', String(agentR));
        circle.setAttribute('fill', agent.categoryColor || '#EC7000');
        circle.setAttribute('opacity', '0.8');
        svg.appendChild(circle);
      });
    });

    // Edges (thin lines between phase centroids)
    graph.edges.forEach(function (edge) {
      var from = null, to = null;
      graph.phases.forEach(function (p, pi) {
        p.agents.forEach(function (a, ai) {
          if (a.id === edge.fromId) { from = { x: pi * phaseW + phaseW / 2, y: 14 + ai * agentSpacing }; }
          if (a.id === edge.toId)   { to   = { x: pi * phaseW + phaseW / 2, y: 14 + ai * agentSpacing }; }
        });
      });
      if (from && to) {
        var line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', String(from.x));
        line.setAttribute('y1', String(from.y));
        line.setAttribute('x2', String(to.x));
        line.setAttribute('y2', String(to.y));
        line.setAttribute('stroke', 'rgba(236,112,0,0.4)');
        line.setAttribute('stroke-width', '0.8');
        svg.appendChild(line);
      }
    });

    // Viewport rect (will be updated on scroll/zoom)
    var vp = document.createElementNS(ns, 'rect');
    vp.setAttribute('id', 'mm-viewport');
    vp.setAttribute('x', '0');
    vp.setAttribute('y', '0');
    vp.setAttribute('width', String(MM_W));
    vp.setAttribute('height', String(MM_H));
    vp.setAttribute('fill', 'rgba(236,112,0,0.08)');
    vp.setAttribute('stroke', 'rgba(236,112,0,0.5)');
    vp.setAttribute('stroke-width', '1.5');
    vp.setAttribute('rx', '2');
    svg.appendChild(vp);

    var wrap = document.createElement('div');
    wrap.className = 'wf-minimap-wrap animate-slide-in';
    wrap.style.setProperty('--delay', '0.45s');
    wrap.setAttribute('title', 'Minimap — clique para navegar');

    var label = document.createElement('div');
    label.className = 'wf-minimap-label';
    label.textContent = 'Minimap';

    wrap.appendChild(svg);
    wrap.appendChild(label);
    document.body.appendChild(wrap);

    _minimapSvg = svg;

    // Click to scroll
    wrap.addEventListener('click', function (e) {
      var svgRect = svg.getBoundingClientRect();
      var relX = (e.clientX - svgRect.left) / svgRect.width;
      var relY = (e.clientY - svgRect.top)  / svgRect.height;
      var board = document.getElementById('wf-board');
      var wr    = document.getElementById('wf-board-wrapper');
      if (!board || !wr) { return; }
      var savedState = vscode.getState() || {};
      var sc = (typeof savedState.zoom === 'number') ? savedState.zoom : 1;
      var totalW = board.scrollWidth  * sc;
      var totalH = board.scrollHeight * sc;
      wr.scrollLeft = relX * totalW - wr.clientWidth  / 2;
      wr.scrollTop  = relY * totalH - wr.clientHeight / 2;
    });
  }

  function updateMinimapViewport() {
    if (!_minimapSvg) { return; }
    var vp  = document.getElementById('mm-viewport');
    var wr  = document.getElementById('wf-board-wrapper');
    var board = document.getElementById('wf-board');
    if (!vp || !wr || !board) { return; }

    var savedState = vscode.getState() || {};
    var sc = (typeof savedState.zoom === 'number') ? savedState.zoom : 1;

    var MM_W = parseFloat(_minimapSvg.getAttribute('width') || '160');
    var MM_H = parseFloat(_minimapSvg.getAttribute('height') || '80');

    var totalW = board.scrollWidth  * sc;
    var totalH = board.scrollHeight * sc;
    if (totalW <= 0 || totalH <= 0) { return; }

    var rx = (wr.scrollLeft / totalW) * MM_W;
    var ry = (wr.scrollTop  / totalH) * MM_H;
    var rw = Math.min((wr.clientWidth  / totalW) * MM_W, MM_W);
    var rh = Math.min((wr.clientHeight / totalH) * MM_H, MM_H);

    vp.setAttribute('x', String(rx));
    vp.setAttribute('y', String(ry));
    vp.setAttribute('width',  String(rw));
    vp.setAttribute('height', String(rh));
  }

  // ── Tooltip ────────────────────────────────────────────
  var _tooltip = null;

  function setupTooltips() {
    _tooltip = document.createElement('div');
    _tooltip.className = 'wf-tooltip';
    _tooltip.id = 'wf-tooltip';
    document.body.appendChild(_tooltip);
  }

  function showTooltip(agent, targetEl) {
    if (!_tooltip) { return; }

    var toolsList = (agent.tools && agent.tools.length > 0)
      ? agent.tools.slice(0, 5).join(', ') + (agent.tools.length > 5 ? '…' : '')
      : '—';
    var delegatesList = (agent.delegatesTo && agent.delegatesTo.length > 0)
      ? agent.delegatesTo.slice(0, 3).join(', ') + (agent.delegatesTo.length > 3 ? '…' : '')
      : '—';
    var phase = agent.workflowPhase
      ? agent.workflowPhase.charAt(0).toUpperCase() + agent.workflowPhase.slice(1)
      : '—';

    _tooltip.innerHTML =
      '<div class="wf-tooltip-title">'
      + '<span>' + escHtml(agent.categoryEmoji) + '</span>'
      + '<span>' + escHtml(agent.displayName) + '</span>'
      + '</div>'
      + (agent.description
          ? '<div class="wf-tooltip-desc">' + escHtml(agent.description) + '</div>'
          : '')
      + '<div class="wf-tooltip-row"><span class="wf-tooltip-label">Fase</span>'
      + '<span class="wf-tooltip-val">' + escHtml(phase) + '</span></div>'
      + '<div class="wf-tooltip-row"><span class="wf-tooltip-label">Categoria</span>'
      + '<span class="wf-tooltip-val">' + escHtml(agent.categoryLabel) + '</span></div>'
      + '<div class="wf-tooltip-row"><span class="wf-tooltip-label">Ferramentas</span>'
      + '<span class="wf-tooltip-val">' + escHtml(toolsList) + '</span></div>'
      + '<div class="wf-tooltip-row"><span class="wf-tooltip-label">Delega a</span>'
      + '<span class="wf-tooltip-val">' + escHtml(delegatesList) + '</span></div>';

    _tooltip.classList.remove('visible');
    var rect = targetEl.getBoundingClientRect();
    _tooltip.style.display = 'block';
    var tw = _tooltip.offsetWidth;
    var th = _tooltip.offsetHeight;

    // Position to the right of the card, flip left if overflows
    var left = rect.right + 10;
    if (left + tw > window.innerWidth - 8) { left = rect.left - tw - 10; }
    var top = rect.top;
    if (top + th > window.innerHeight - 8) { top = window.innerHeight - th - 8; }
    if (top < 8) { top = 8; }

    _tooltip.style.left = left + 'px';
    _tooltip.style.top  = top  + 'px';
    _tooltip.classList.add('visible');
  }

  function hideTooltip() {
    if (_tooltip) { _tooltip.classList.remove('visible'); _tooltip.style.display = 'none'; }
  }

  // ── Zoom controls (with persistence) ──────────────────
  render(GRAPH);
  setupTooltips();

}());
</script>
</body>
</html>`;
  }

  // ─── HTML de erro ────────────────────────────────────────────────────────────────────────

  private _getErrorHtml(message: string): string {
    return /* html */`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Workflow — Erro</title>
  <style>
    body { background: #1e1e1e; color: #ccc; font-family: sans-serif;
           display: flex; align-items: center; justify-content: center;
           height: 100vh; margin: 0; }
    .err { text-align: center; color: #FF5252; }
  </style>
</head>
<body>
  <div class="err">
    <div style="font-size:2rem">⚠️</div>
    <p>Erro ao carregar o workflow:</p>
    <pre style="font-size:0.8rem;opacity:0.7">${message}</pre>
  </div>
</body>
</html>`;
  }
}

