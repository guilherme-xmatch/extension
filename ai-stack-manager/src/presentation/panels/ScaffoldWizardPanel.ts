/**
 * @module presentation/panels/ScaffoldWizardPanel
 * @description Multi-step webview wizard for creating new AI infrastructure packages.
 *
 * The wizard walks the user through 3 steps:
 *  1. **Type** — select package type (agent, skill, instruction, prompt)
 *  2. **Details** — name, displayName, description + type-specific fields
 *  3. **Preview** — shows generated file content before writing to disk
 *
 * When the user confirms, the extension:
 *  - Creates the target directory
 *  - Writes the generated file(s)
 *  - Opens the new file in the editor
 *
 * No external CDN libraries — all rendering is pure HTML/CSS/JS.
 */

import * as path from 'path';
import * as vscode from 'vscode';

/** All possible fields the wizard can collect */
export interface ScaffoldFormData {
  type:         'agent' | 'skill' | 'instruction' | 'prompt';
  name:         string;            // slug: lowercase letters and hyphens
  displayName:  string;
  description:  string;
  author:       string;
  tags:         string;            // comma-separated

  // Agent-specific
  workflowPhase?:  string;
  tools?:          string;         // comma-separated
  userInvocable?:  boolean;
  delegatesTo?:    string;         // comma-separated
  relatedSkills?:  string;         // comma-separated

  // Skill-specific
  applyToAudience?: string;        // target description

  // Instruction-specific
  applyTo?: string;                // glob pattern

  // Prompt-specific
  promptMode?: string;             // e.g. "agent", "chat"
}

// ─── Template generators ──────────────────────────────────────────────────────

function generateContent(data: ScaffoldFormData): { filePath: string; content: string } {
  const { type, name, displayName, description, author, tags } = data;
  const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const tagYaml = tagList.length > 0
    ? tagList.map(t => `  - ${t}`).join('\n')
    : '  - custom';

  switch (type) {
    case 'agent': {
      const phase       = data.workflowPhase || 'execute';
      const toolsList   = (data.tools || 'read,edit,search').split(',').map(t => `  - ${t.trim()}`).join('\n');
      const invocable   = data.userInvocable ? 'true' : 'false';
      const delegates   = data.delegatesTo
        ? data.delegatesTo.split(',').map(d => `  - ${d.trim()}`).join('\n')
        : '';
      const skills      = data.relatedSkills
        ? data.relatedSkills.split(',').map(s => `  - ${s.trim()}`).join('\n')
        : '';

      return {
        filePath: `.github/agents/${name}.agent.md`,
        content: `---
name: ${name}
displayName: "${displayName}"
description: >
  ${description}
type: agent
version: "1.0.0"
author: "${author}"
tags:
${tagYaml}
agentMeta:
  workflowPhase: ${phase}
  userInvocable: ${invocable}
  tools:
${toolsList}${delegates ? '\n  delegatesTo:\n' + delegates : ''}${skills ? '\n  relatedSkills:\n' + skills : ''}
---

# ${displayName}

> ${description}

## Responsabilidades

- Descreva aqui as responsabilidades deste agent
- Adicione mais itens conforme necessário

## Ferramentas

Este agent tem acesso às seguintes ferramentas: \`${(data.tools || 'read, edit, search')}\`

## Comportamento

Descreva aqui o comportamento esperado do agent, incluindo:
- Como ele recebe tarefas
- Como ele as executa
- Quando ele delega para outros agents
`,
      };
    }

    case 'skill': {
      const audience = data.applyToAudience || 'Desenvolvedores';
      return {
        filePath: `.github/skills/${name}/SKILL.md`,
        content: `---
name: ${name}
displayName: "${displayName}"
description: "${description}"
type: skill
version: "1.0.0"
author: "${author}"
tags:
${tagYaml}
---

# ${displayName}

> ${description}

**Público-alvo:** ${audience}

## Objetivo

Descreva aqui o objetivo desta skill e quando ela deve ser usada.

## Instruções

1. Passo 1 — Descreva o primeiro passo
2. Passo 2 — Descreva o segundo passo
3. Passo 3 — Descreva o terceiro passo

## Exemplos

\`\`\`
// Exemplo de uso
\`\`\`

## Referências

- Adicione links e referências úteis aqui
`,
      };
    }

    case 'instruction': {
      const applyTo = data.applyTo || '**';
      return {
        filePath: `.github/instructions/${name}.instructions.md`,
        content: `---
applyTo: "${applyTo}"
---

# ${displayName}

> ${description}

## Regras

- Regra 1 — Descreva a primeira regra
- Regra 2 — Descreva a segunda regra

## Contexto

Descreva aqui o contexto em que estas instruções devem ser aplicadas.
`,
      };
    }

    case 'prompt': {
      const mode = data.promptMode || 'agent';
      return {
        filePath: `.github/prompts/${name}.prompt.md`,
        content: `---
description: "${description}"
mode: ${mode}
---

# ${displayName}

> ${description}

## Prompt

${description}

Forneça os seguintes detalhes:
- Detalhe 1
- Detalhe 2

## Saída Esperada

Descreva aqui o formato e o conteúdo esperado na saída.
`,
      };
    }
  }
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export class ScaffoldWizardPanel {
  public static currentPanel: ScaffoldWizardPanel | undefined;

  private readonly _panel:        vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables:           vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel        = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(async (msg: {
      type: 'preview' | 'create' | 'close';
      data?: ScaffoldFormData;
    }) => {
      if (msg.type === 'preview' && msg.data) {
        const { content } = generateContent(msg.data);
        void this._panel.webview.postMessage({ type: 'previewResult', content });
        return;
      }

      if (msg.type === 'create' && msg.data) {
        await this._createPackage(msg.data);
        return;
      }

      if (msg.type === 'close') {
        this.dispose();
      }
    }, null, this._disposables);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ScaffoldWizardPanel.currentPanel) {
      ScaffoldWizardPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'daiScaffold',
      'DescomplicAI: Novo Pacote',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts:  true,
        localResourceRoots: [extensionUri],
      },
    );

    ScaffoldWizardPanel.currentPanel = new ScaffoldWizardPanel(panel, extensionUri);
  }

  public dispose(): void {
    ScaffoldWizardPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  // ─── File creation ───────────────────────────────────────────────────────────

  private async _createPackage(data: ScaffoldFormData): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      void this._panel.webview.postMessage({ type: 'error', message: 'Nenhum workspace aberto.' });
      return;
    }

    try {
      const { filePath: relPath, content } = generateContent(data);
      const fullPath = vscode.Uri.file(path.join(root, relPath));
      const dirPath  = vscode.Uri.file(path.dirname(fullPath.fsPath));

      await vscode.workspace.fs.createDirectory(dirPath);
      await vscode.workspace.fs.writeFile(fullPath, Buffer.from(content, 'utf-8'));

      const doc = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`✨ Criado ${data.type}: ${data.name}`);

      void this._panel.webview.postMessage({ type: 'success', filePath: relPath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void this._panel.webview.postMessage({ type: 'error', message: msg });
    }
  }

  // ─── HTML generation ─────────────────────────────────────────────────────────

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const mainCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'main.css'),
    );

    return /* html */`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DescomplicAI: Novo Pacote</title>
  <link rel="stylesheet" href="${mainCssUri}">
  <style>
    :root { --orange: #EC7000; --navy: #003366; }
    body { margin: 0; padding: 0; background: var(--vscode-editor-background);
           color: var(--vscode-foreground); font-family: var(--vscode-font-family, sans-serif); }

    /* ── Layout ── */
    .sw-container { max-width: 700px; margin: 0 auto; padding: 32px 24px; }

    /* ── Header ── */
    .sw-header { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
    .sw-header h1 { font-size: 1.4rem; font-weight: 700; margin: 0; }
    .sw-header-sub { font-size: 0.82rem; color: var(--vscode-descriptionForeground); margin-top: 3px; }

    /* ── Steps indicator ── */
    .sw-steps { display: flex; align-items: center; gap: 0; margin-bottom: 28px; }
    .sw-step { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; }
    .sw-step-num { width: 24px; height: 24px; border-radius: 50%; border: 2px solid;
      display: flex; align-items: center; justify-content: center; font-weight: 700;
      font-size: 0.72rem; flex-shrink: 0; transition: all 0.2s; }
    .sw-step.active   .sw-step-num { background: var(--orange); border-color: var(--orange); color: #fff; }
    .sw-step.done     .sw-step-num { background: #28a745; border-color: #28a745; color: #fff; }
    .sw-step.inactive .sw-step-num { background: transparent; border-color: rgba(255,255,255,.2); color: rgba(255,255,255,.4); }
    .sw-step-label { color: var(--vscode-descriptionForeground); }
    .sw-step.active .sw-step-label { color: var(--vscode-foreground); font-weight: 600; }
    .sw-step-sep { flex: 1; height: 1px; background: rgba(255,255,255,.1); margin: 0 12px; min-width: 20px; }

    /* ── Type cards grid ── */
    .sw-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .sw-type-card { padding: 16px; border-radius: 10px; border: 2px solid rgba(255,255,255,.08);
      cursor: pointer; transition: all 0.15s; background: var(--vscode-sideBar-background); }
    .sw-type-card:hover { border-color: var(--orange); transform: translateY(-2px); }
    .sw-type-card.selected { border-color: var(--orange); background: rgba(236,112,0,0.08); }
    .sw-type-card-icon { font-size: 1.8rem; margin-bottom: 8px; }
    .sw-type-card-name { font-weight: 700; font-size: 0.95rem; margin-bottom: 4px; }
    .sw-type-card-desc { font-size: 0.78rem; color: var(--vscode-descriptionForeground); line-height: 1.4; }

    /* ── Form fields ── */
    .sw-form { display: flex; flex-direction: column; gap: 14px; }
    .sw-field { display: flex; flex-direction: column; gap: 5px; }
    .sw-label { font-size: 0.82rem; font-weight: 600; color: var(--vscode-foreground); }
    .sw-label span { font-weight: 400; color: var(--vscode-descriptionForeground); margin-left: 4px; }
    .sw-input, .sw-textarea, .sw-select {
      padding: 8px 10px; border-radius: 6px; font-size: 0.85rem;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, rgba(255,255,255,.12));
      font-family: inherit; width: 100%; box-sizing: border-box;
      transition: border-color 0.15s;
    }
    .sw-input:focus, .sw-textarea:focus { outline: none; border-color: var(--orange); }
    .sw-input.error { border-color: #f44336; }
    .sw-textarea { resize: vertical; min-height: 80px; }
    .sw-hint { font-size: 0.73rem; color: var(--vscode-descriptionForeground); }
    .sw-err { font-size: 0.73rem; color: #f44336; display: none; }
    .sw-err.visible { display: block; }
    .sw-checkbox-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .sw-checkbox-row input { width: 16px; height: 16px; cursor: pointer; accent-color: var(--orange); }

    /* ── Preview pane ── */
    .sw-preview { background: var(--vscode-editor-background);
      border: 1px solid rgba(255,255,255,.08); border-radius: 8px;
      padding: 16px; overflow: auto; max-height: 380px; }
    .sw-preview pre { margin: 0; font-size: 0.78rem; white-space: pre-wrap;
      word-break: break-word; font-family: var(--vscode-editor-font-family, monospace); }

    /* ── Section divider ── */
    .sw-section-title { font-size: 0.82rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--vscode-descriptionForeground);
      margin: 8px 0 4px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.07); }

    /* ── Action buttons ── */
    .sw-actions { display: flex; justify-content: space-between; align-items: center;
      margin-top: 24px; gap: 12px; }
    .sw-btn { padding: 9px 22px; border-radius: 7px; border: none; cursor: pointer;
      font-size: 0.88rem; font-weight: 600; transition: all 0.15s; }
    .sw-btn-primary { background: var(--orange); color: #fff; }
    .sw-btn-primary:hover { background: #d46200; transform: translateY(-1px); }
    .sw-btn-secondary { background: transparent; color: var(--vscode-foreground);
      border: 1px solid rgba(255,255,255,.15); }
    .sw-btn-secondary:hover { background: rgba(255,255,255,.05); }
    .sw-btn:disabled { opacity: .4; cursor: not-allowed; transform: none; }

    /* ── Success state ── */
    .sw-success { text-align: center; padding: 48px 0; }
    .sw-success-icon { font-size: 3rem; margin-bottom: 16px; }
    .sw-success h2 { font-size: 1.2rem; margin: 0 0 8px; }
    .sw-success p { color: var(--vscode-descriptionForeground); font-size: 0.85rem; margin: 0 0 24px; }
  </style>
</head>
<body>
<div class="sw-container">

  <!-- Header -->
  <div class="sw-header">
    <span style="font-size:2rem">✨</span>
    <div>
      <h1>Novo Pacote</h1>
      <div class="sw-header-sub">Crie um novo agent, skill, instruction ou prompt</div>
    </div>
  </div>

  <!-- Steps indicator -->
  <div class="sw-steps" id="sw-steps">
    <div class="sw-step active" data-step="1">
      <div class="sw-step-num">1</div>
      <div class="sw-step-label">Tipo</div>
    </div>
    <div class="sw-step-sep"></div>
    <div class="sw-step inactive" data-step="2">
      <div class="sw-step-num">2</div>
      <div class="sw-step-label">Detalhes</div>
    </div>
    <div class="sw-step-sep"></div>
    <div class="sw-step inactive" data-step="3">
      <div class="sw-step-num">3</div>
      <div class="sw-step-label">Preview</div>
    </div>
  </div>

  <!-- Content area (steps are shown/hidden by JS) -->
  <div id="sw-content"></div>

</div>

<script>
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────
  var currentStep = 1;
  var formData = {
    type: null,
    name: '', displayName: '', description: '', author: '', tags: '',
    workflowPhase: 'execute', tools: 'read,edit,search', userInvocable: false,
    delegatesTo: '', relatedSkills: '',
    applyToAudience: '', applyTo: '**', promptMode: 'agent',
  };

  // ── Type definitions ────────────────────────────────────
  var TYPES = [
    { id: 'agent',       icon: '🤖', name: 'Agent',       desc: 'Profissional de IA que executa tarefas autônomas dentro de um workflow.' },
    { id: 'skill',       icon: '📐', name: 'Skill',        desc: 'Conjunto de instruções especializadas que capacitam um agent.' },
    { id: 'instruction', icon: '📋', name: 'Instruction',  desc: 'Regra ou diretriz aplicada globalmente ao Copilot no workspace.' },
    { id: 'prompt',      icon: '💬', name: 'Prompt',       desc: 'Template de prompt reutilizável para tarefas específicas.' },
  ];

  var PHASES = ['triage','plan','design','execute','validate','critic','deliver','memory'];

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Steps indicator ─────────────────────────────────────
  function setStep(n) {
    currentStep = n;
    document.querySelectorAll('.sw-step').forEach(function (el) {
      var s = parseInt(el.dataset.step, 10);
      el.className = 'sw-step ' + (s < n ? 'done' : s === n ? 'active' : 'inactive');
    });
    renderStep(n);
  }

  // ── Render step ─────────────────────────────────────────
  function renderStep(n) {
    var el = document.getElementById('sw-content');
    if (n === 1) { el.innerHTML = renderStep1(); bindStep1(); }
    if (n === 2) { el.innerHTML = renderStep2(); bindStep2(); }
    if (n === 3) { el.innerHTML = renderStep3(); bindStep3(); requestPreview(); }
  }

  // ── Step 1: Type ────────────────────────────────────────
  function renderStep1() {
    return '<div class="sw-type-grid">'
      + TYPES.map(function (t) {
          return '<div class="sw-type-card' + (formData.type === t.id ? ' selected' : '') + '"'
            + ' data-type="' + t.id + '">'
            + '<div class="sw-type-card-icon">' + t.icon + '</div>'
            + '<div class="sw-type-card-name">' + t.name + '</div>'
            + '<div class="sw-type-card-desc">' + escHtml(t.desc) + '</div>'
            + '</div>';
        }).join('')
      + '</div>'
      + '<div class="sw-actions">'
      + '<div></div>'
      + '<button class="sw-btn sw-btn-primary" id="btn-step1-next"'
      + (formData.type ? '' : ' disabled') + '>Próximo →</button>'
      + '</div>';
  }

  function bindStep1() {
    document.querySelectorAll('.sw-type-card').forEach(function (card) {
      card.addEventListener('click', function () {
        formData.type = this.dataset.type;
        document.querySelectorAll('.sw-type-card').forEach(function (c) { c.classList.remove('selected'); });
        this.classList.add('selected');
        document.getElementById('btn-step1-next').disabled = false;
      }.bind(card));
    });
    document.getElementById('btn-step1-next').addEventListener('click', function () {
      if (formData.type) { setStep(2); }
    });
  }

  // ── Step 2: Details ─────────────────────────────────────
  function renderStep2() {
    var t = TYPES.find(function (x) { return x.id === formData.type; });
    var typeSpecific = '';

    if (formData.type === 'agent') {
      typeSpecific = '<div class="sw-section-title">⚙️ Opções do Agent</div>'
        + field('sw-phase','Fase no Workflow',
            '<select class="sw-select" id="sw-phase">'
            + PHASES.map(function (p) { return '<option value="' + p + '"' + (formData.workflowPhase === p ? ' selected' : '') + '>' + p + '</option>'; }).join('')
            + '</select>')
        + field('sw-tools','Ferramentas <span>(separadas por vírgula)</span>',
            '<input class="sw-input" id="sw-tools" value="' + escHtml(formData.tools) + '" placeholder="read,edit,search,run">')
        + field('sw-delegates','Delega para <span>(IDs separados por vírgula)</span>',
            '<input class="sw-input" id="sw-delegates" value="' + escHtml(formData.delegatesTo) + '" placeholder="agent-backend,agent-tester">')
        + field('sw-skills','Skills Relacionadas <span>(IDs separados por vírgula)</span>',
            '<input class="sw-input" id="sw-skills" value="' + escHtml(formData.relatedSkills) + '" placeholder="skill-api-design,skill-security">')
        + '<div class="sw-field"><label class="sw-checkbox-row">'
        + '<input type="checkbox" id="sw-invocable"' + (formData.userInvocable ? ' checked' : '') + '>'
        + '<span class="sw-label">Usuário pode invocar com @agent</span></label></div>';
    } else if (formData.type === 'instruction') {
      typeSpecific = '<div class="sw-section-title">⚙️ Opções da Instruction</div>'
        + field('sw-applyto','Padrão applyTo <span>(glob)</span>',
            '<input class="sw-input" id="sw-applyto" value="' + escHtml(formData.applyTo) + '" placeholder="**">'
            + '<div class="sw-hint">Exemplos: <code>**</code> (tudo), <code>**/*.ts</code> (TypeScript), <code>src/**</code></div>');
    } else if (formData.type === 'prompt') {
      typeSpecific = '<div class="sw-section-title">⚙️ Opções do Prompt</div>'
        + field('sw-mode','Modo',
            '<select class="sw-select" id="sw-mode">'
            + ['agent','chat','edit'].map(function (m) { return '<option value="' + m + '"' + (formData.promptMode === m ? ' selected' : '') + '>' + m + '</option>'; }).join('')
            + '</select>');
    } else if (formData.type === 'skill') {
      typeSpecific = '<div class="sw-section-title">⚙️ Opções da Skill</div>'
        + field('sw-audience','Público-alvo',
            '<input class="sw-input" id="sw-audience" value="' + escHtml(formData.applyToAudience) + '" placeholder="Desenvolvedores backend">');
    }

    return '<div class="sw-form">'
      + '<div class="sw-section-title">' + (t ? t.icon + ' ' + t.name : '') + ' — Informações Básicas</div>'
      + field('sw-name','Nome do pacote <span>(slug: letras minúsculas e hífens)</span>',
          '<input class="sw-input" id="sw-name" value="' + escHtml(formData.name) + '" placeholder="meu-agent-customizado">'
          + '<div class="sw-err" id="sw-name-err">apenas letras minúsculas, números e hífens</div>')
      + field('sw-displayname','Nome de exibição',
          '<input class="sw-input" id="sw-displayname" value="' + escHtml(formData.displayName) + '" placeholder="Meu Agent Customizado">')
      + field('sw-description','Descrição',
          '<textarea class="sw-textarea" id="sw-description">' + escHtml(formData.description) + '</textarea>')
      + field('sw-author','Autor',
          '<input class="sw-input" id="sw-author" value="' + escHtml(formData.author) + '" placeholder="sua-equipe">')
      + field('sw-tags','Tags <span>(separadas por vírgula)</span>',
          '<input class="sw-input" id="sw-tags" value="' + escHtml(formData.tags) + '" placeholder="custom,backend">')
      + typeSpecific
      + '</div>'
      + '<div class="sw-actions">'
      + '<button class="sw-btn sw-btn-secondary" id="btn-step2-back">← Voltar</button>'
      + '<button class="sw-btn sw-btn-primary" id="btn-step2-next">Prévia →</button>'
      + '</div>';
  }

  function field(id, label, inputHtml) {
    return '<div class="sw-field"><label class="sw-label" for="' + id + '">' + label + '</label>'
      + inputHtml + '</div>';
  }

  function bindStep2() {
    var inputs = {
      'sw-name':        function (v) { formData.name        = v; },
      'sw-displayname': function (v) { formData.displayName = v; },
      'sw-description': function (v) { formData.description = v; },
      'sw-author':      function (v) { formData.author      = v; },
      'sw-tags':        function (v) { formData.tags        = v; },
    };
    if (formData.type === 'agent') {
      inputs['sw-phase']     = function (v) { formData.workflowPhase = v; };
      inputs['sw-tools']     = function (v) { formData.tools         = v; };
      inputs['sw-delegates'] = function (v) { formData.delegatesTo   = v; };
      inputs['sw-skills']    = function (v) { formData.relatedSkills = v; };
    } else if (formData.type === 'instruction') {
      inputs['sw-applyto'] = function (v) { formData.applyTo = v; };
    } else if (formData.type === 'prompt') {
      inputs['sw-mode'] = function (v) { formData.promptMode = v; };
    } else if (formData.type === 'skill') {
      inputs['sw-audience'] = function (v) { formData.applyToAudience = v; };
    }

    Object.keys(inputs).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) { return; }
      el.addEventListener('input', function () { inputs[id](this.value); });
      el.addEventListener('change', function () { inputs[id](this.value); });
    });

    var invocable = document.getElementById('sw-invocable');
    if (invocable) {
      invocable.addEventListener('change', function () { formData.userInvocable = this.checked; });
    }

    document.getElementById('btn-step2-back').addEventListener('click', function () { setStep(1); });
    document.getElementById('btn-step2-next').addEventListener('click', function () {
      if (validateStep2()) { setStep(3); }
    });
  }

  function validateStep2() {
    var name    = (formData.name || '').trim();
    var nameErr = document.getElementById('sw-name-err');
    var nameIn  = document.getElementById('sw-name');
    if (!name || !/^[a-z0-9-]+$/.test(name)) {
      nameErr.classList.add('visible');
      nameIn.classList.add('error');
      nameIn.focus();
      return false;
    }
    nameErr.classList.remove('visible');
    nameIn.classList.remove('error');
    if (!formData.displayName) { formData.displayName = name; }
    if (!formData.description) { formData.description = name + ' — pacote customizado'; }
    return true;
  }

  // ── Step 3: Preview ─────────────────────────────────────
  function renderStep3() {
    return '<div class="sw-form">'
      + '<div class="sw-section-title">📄 Pré-visualização do Arquivo</div>'
      + '<div class="sw-preview" id="sw-preview-box"><pre id="sw-preview-content">Gerando prévia…</pre></div>'
      + '</div>'
      + '<div class="sw-actions">'
      + '<button class="sw-btn sw-btn-secondary" id="btn-step3-back">← Editar</button>'
      + '<button class="sw-btn sw-btn-primary" id="btn-step3-create">✨ Criar Pacote</button>'
      + '</div>';
  }

  function bindStep3() {
    document.getElementById('btn-step3-back').addEventListener('click', function () { setStep(2); });
    document.getElementById('btn-step3-create').addEventListener('click', function () {
      this.disabled = true;
      this.textContent = '⏳ Criando…';
      vscode.postMessage({ type: 'create', data: formData });
    });
  }

  function requestPreview() {
    vscode.postMessage({ type: 'preview', data: formData });
  }

  // ── Message handling ────────────────────────────────────
  window.addEventListener('message', function (event) {
    var msg = event.data;

    if (msg.type === 'previewResult') {
      var pre = document.getElementById('sw-preview-content');
      if (pre) { pre.textContent = msg.content; }
      return;
    }

    if (msg.type === 'success') {
      var el = document.getElementById('sw-content');
      el.innerHTML = '<div class="sw-success">'
        + '<div class="sw-success-icon">🎉</div>'
        + '<h2>Pacote criado com sucesso!</h2>'
        + '<p>Arquivo: <code>' + escHtml(msg.filePath) + '</code></p>'
        + '<p>O arquivo foi aberto no editor.</p>'
        + '<button class="sw-btn sw-btn-secondary" id="btn-create-another">Criar outro</button>'
        + '</div>';
      document.querySelectorAll('.sw-step').forEach(function (s) { s.className = 'sw-step done'; });
      document.getElementById('btn-create-another').addEventListener('click', function () {
        formData = { type: null, name: '', displayName: '', description: '', author: '', tags: '',
          workflowPhase: 'execute', tools: 'read,edit,search', userInvocable: false,
          delegatesTo: '', relatedSkills: '', applyToAudience: '', applyTo: '**', promptMode: 'agent' };
        setStep(1);
      });
      return;
    }

    if (msg.type === 'error') {
      var btn = document.getElementById('btn-step3-create');
      if (btn) { btn.disabled = false; btn.textContent = '✨ Criar Pacote'; }
      var box = document.getElementById('sw-preview-box');
      if (box) {
        var errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#f44336;font-size:.8rem;margin-top:8px;';
        errDiv.textContent = '❌ Erro: ' + msg.message;
        box.appendChild(errDiv);
      }
    }
  });

  // ── Boot ───────────────────────────────────────────────
  setStep(1);

}());
</script>
</body>
</html>`;
  }
}
