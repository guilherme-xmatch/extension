/**
 * @module presentation/panels/ScaffoldWizardPanel
 * @description Wizard webview de múltiplas etapas para criar novos pacotes de infraestrutura de AI.
 *
 * O wizard guia o usuário por 3 etapas:
 *  1. **Tipo** — seleciona o tipo de pacote (agent, skill, instruction, prompt)
 *  2. **Detalhes** — nome, displayName, descrição + campos específicos do tipo
 *  3. **Preview** — exibe o conteúdo gerado antes de gravar no disco
 *
 * Ao confirmar, a extensão:
 *  - Cria o diretório de destino
 *  - Grava o(s) arquivo(s) gerado(s)
 *  - Abre o novo arquivo no editor
 *
 * Sem bibliotecas CDN externas — toda a renderização é HTML/CSS/JS puro.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { UxDiagnosticsService } from '../../infrastructure/services/UxDiagnosticsService';

/** Todos os campos possíveis que o wizard pode coletar. */
export interface ScaffoldFormData {
  type: 'agent' | 'skill' | 'instruction' | 'prompt';
  name: string; // slug: letras minúsculas e hifens
  displayName: string;
  description: string;
  author: string;
  tags: string; // separadas por vírgula

  // Específico de agent
  workflowPhase?: string;
  tools?: string; // separadas por vírgula
  userInvocable?: boolean;
  delegatesTo?: string; // separadas por vírgula
  relatedSkills?: string; // separadas por vírgula

  // Específico de skill
  applyToAudience?: string; // descrição do público-alvo

  // Específico de instruction
  applyTo?: string; // padrão glob

  // Específico de prompt
  promptMode?: string; // ex.: "agent", "chat"
}

// ─── Geradores de template ───────────────────────────────────────────────────

function generateContent(data: ScaffoldFormData): { filePath: string; content: string } {
  const { type, name, displayName, description, author, tags } = data;
  const tagList = tags
    ? tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const tagYaml = tagList.length > 0 ? tagList.map((t) => `  - ${t}`).join('\n') : '  - custom';

  switch (type) {
    case 'agent': {
      const phase = data.workflowPhase || 'execute';
      const toolsList = (data.tools || 'read,edit,search')
        .split(',')
        .map((t) => `  - ${t.trim()}`)
        .join('\n');
      const invocable = data.userInvocable ? 'true' : 'false';
      const delegates = data.delegatesTo
        ? data.delegatesTo
            .split(',')
            .map((d) => `  - ${d.trim()}`)
            .join('\n')
        : '';
      const skills = data.relatedSkills
        ? data.relatedSkills
            .split(',')
            .map((s) => `  - ${s.trim()}`)
            .join('\n')
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

Este agent tem acesso às seguintes ferramentas: \`${data.tools || 'read, edit, search'}\`

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

// ─── Painel ─────────────────────────────────────────────────────────────────────────────

export class ScaffoldWizardPanel {
  public static currentPanel: ScaffoldWizardPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _hasCreatedPackage = false;
  private _lastStep = 1;
  private _isDisposed = false;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (msg: {
        type: 'preview' | 'create' | 'close' | 'progress';
        data?: ScaffoldFormData;
        step?: number;
      }) => {
        if (msg.type === 'preview' && msg.data) {
          const { content } = generateContent(msg.data);
          void this._panel.webview.postMessage({ type: 'previewResult', content });
          return;
        }

        if (msg.type === 'progress' && typeof msg.step === 'number') {
          this._lastStep = msg.step;
          if (msg.step === 1) {
            this._hasCreatedPackage = false;
          }
          return;
        }

        if (msg.type === 'create' && msg.data) {
          await this._createPackage(msg.data);
          return;
        }

        if (msg.type === 'close') {
          this.dispose();
        }
      },
      null,
      this._disposables,
    );
  }

  // ─── API Pública ────────────────────────────────────────────────────────────────────────────

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
        enableScripts: true,
        localResourceRoots: [extensionUri],
      },
    );

    ScaffoldWizardPanel.currentPanel = new ScaffoldWizardPanel(panel, extensionUri);
  }

  public dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    if (!this._hasCreatedPackage) {
      UxDiagnosticsService.getInstance().track('panel.scaffold.abandoned', {
        surface: 'panel',
        step: this._lastStep,
      });
    }
    ScaffoldWizardPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  // ─── Criação de arquivo ────────────────────────────────────────────────────────────────────────

  private async _createPackage(data: ScaffoldFormData): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      void this._panel.webview.postMessage({ type: 'error', message: 'Nenhum workspace aberto.' });
      return;
    }

    try {
      const { filePath: relPath, content } = generateContent(data);
      const fullPath = vscode.Uri.file(path.join(root, relPath));
      const dirPath = vscode.Uri.file(path.dirname(fullPath.fsPath));

      await vscode.workspace.fs.createDirectory(dirPath);
      await vscode.workspace.fs.writeFile(fullPath, Buffer.from(content, 'utf-8'));

      const doc = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(doc);
      this._hasCreatedPackage = true;
      vscode.window.showInformationMessage(`Novo ${data.type} criado: ${data.name}.`);

      void this._panel.webview.postMessage({ type: 'success', filePath: relPath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      UxDiagnosticsService.getInstance().track('panel.scaffold.createFailed', {
        surface: 'panel',
        category: UxDiagnosticsService.categorizeError(err),
        step: this._lastStep,
      });
      void this._panel.webview.postMessage({ type: 'error', message: msg });
    }
  }

  // ─── Geração de HTML ─────────────────────────────────────────────────────────

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const mainCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'main.css'),
    );

    return /* html */ `<!DOCTYPE html>
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
    .sw-input:focus, .sw-textarea:focus, .sw-select:focus {
      outline: 2px solid rgba(236,112,0,.28);
      outline-offset: 2px;
      border-color: var(--orange);
      box-shadow: 0 0 0 3px rgba(236,112,0,.14);
    }
    .sw-input.error, .sw-textarea.error, .sw-select.error { border-color: #f44336; }
    .sw-field.invalid .sw-label { color: #ffb4ac; }
    .sw-textarea { resize: vertical; min-height: 80px; }
    .sw-hint { font-size: 0.73rem; color: var(--vscode-descriptionForeground); }
    .sw-err { font-size: 0.73rem; color: #f44336; display: none; }
    .sw-err.visible { display: block; }
    .sw-summary {
      display: none;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid rgba(255,179,0,.32);
      background: rgba(255,179,0,.08);
      color: var(--vscode-foreground);
      font-size: 0.8rem;
      line-height: 1.5;
    }
    .sw-summary.visible { display: block; }
    .sw-summary.ok { border-color: rgba(0,200,83,.28); background: rgba(0,200,83,.08); }
    .sw-summary strong { display: block; margin-bottom: 4px; }
    .sw-checkbox-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .sw-checkbox-row input { width: 16px; height: 16px; cursor: pointer; accent-color: var(--orange); }

    /* ── Preview pane ── */
    .sw-preview { background: var(--vscode-editor-background);
      border: 1px solid rgba(255,255,255,.08); border-radius: 8px;
      padding: 16px; overflow: auto; max-height: 380px; }
    .sw-preview-loading { display: flex; flex-direction: column; gap: 10px; }
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
<div id="dai-toast-region" class="dai-toast-region" aria-live="polite" aria-atomic="false"></div>
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
  var DEFAULT_FORM_DATA = {
    type: null,
    name: '', displayName: '', description: '', author: '', tags: '',
    workflowPhase: 'execute', tools: 'read,edit,search', userInvocable: false,
    delegatesTo: '', relatedSkills: '',
    applyToAudience: '', applyTo: '**', promptMode: 'agent',
  };
  var formData = Object.assign({}, DEFAULT_FORM_DATA);

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

  function showToast(kind, title, message, duration) {
    var region = document.getElementById('dai-toast-region');
    if (!region) { return; }
    var icons = { success: 'OK', warning: '!', error: 'x', info: 'i' };
    var toast = document.createElement('div');
    toast.className = 'dai-toast dai-toast-' + (kind || 'info') + ' animate-slide-in';
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toast.innerHTML = '<span class="dai-toast-icon" aria-hidden="true">' + escHtml(icons[kind] || icons.info) + '</span>'
      + '<div class="dai-toast-copy"><strong class="dai-toast-title">' + escHtml(title || 'Atualização') + '</strong>'
      + (message ? '<span class="dai-toast-message">' + escHtml(message) + '</span>' : '')
      + '</div>'
      + '<button type="button" class="dai-toast-close" aria-label="Dispensar notificação">Fechar</button>';
    var dismiss = function () {
      toast.classList.add('dai-toast-leaving');
      window.setTimeout(function () { toast.remove(); }, 180);
    };
    toast.querySelector('.dai-toast-close').addEventListener('click', dismiss, { once: true });
    region.appendChild(toast);
    window.setTimeout(dismiss, duration || 4200);
  }

  // ── Steps indicator ─────────────────────────────────────
  function setStep(n) {
    currentStep = n;
    vscode.postMessage({ type: 'progress', step: n });
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
            + ' data-type="' + t.id + '" tabindex="0" role="button" aria-pressed="' + (formData.type === t.id ? 'true' : 'false') + '">'
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
      var activate = function () {
        formData.type = this.dataset.type;
        document.querySelectorAll('.sw-type-card').forEach(function (c) {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        });
        this.classList.add('selected');
        this.setAttribute('aria-pressed', 'true');
        document.getElementById('btn-step1-next').disabled = false;
      }.bind(card);
      card.addEventListener('click', activate);
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });
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
        '<input class="sw-input" id="sw-tools" value="' + escHtml(formData.tools) + '" placeholder="read,edit,search,run">'
        + '<div class="sw-err" id="sw-tools-err">Informe pelo menos uma ferramenta para o agent.</div>')
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
            + '<div class="sw-hint">Exemplos: <code>**</code> (tudo), <code>**/*.ts</code> (TypeScript), <code>src/**</code></div>'
            + '<div class="sw-err" id="sw-applyto-err">Defina um padrão applyTo para a instruction.</div>');
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
          + '<div class="sw-err" id="sw-name-err">Use apenas letras minúsculas, números e hífens.</div>')
      + field('sw-displayname','Nome de exibição',
          '<input class="sw-input" id="sw-displayname" value="' + escHtml(formData.displayName) + '" placeholder="Meu Agent Customizado">'
          + '<div class="sw-err" id="sw-displayname-err">Informe um nome de exibição com pelo menos 3 caracteres.</div>')
      + field('sw-description','Descrição',
          '<textarea class="sw-textarea" id="sw-description">' + escHtml(formData.description) + '</textarea>'
          + '<div class="sw-err" id="sw-description-err">Descreva o pacote com pelo menos 12 caracteres.</div>')
      + field('sw-author','Autor',
          '<input class="sw-input" id="sw-author" value="' + escHtml(formData.author) + '" placeholder="sua-equipe">'
          + '<div class="sw-err" id="sw-author-err">Informe o autor ou equipe responsável.</div>')
      + field('sw-tags','Tags <span>(separadas por vírgula)</span>',
          '<input class="sw-input" id="sw-tags" value="' + escHtml(formData.tags) + '" placeholder="custom,backend">')
      + typeSpecific
        + '<div class="sw-summary" id="sw-step2-summary" role="alert" aria-live="polite"></div>'
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
      var sync = function () {
        inputs[id](this.value);
        validateStep2(false);
      };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });

    var invocable = document.getElementById('sw-invocable');
    if (invocable) {
      invocable.addEventListener('change', function () {
        formData.userInvocable = this.checked;
        validateStep2(false);
      });
    }

    document.getElementById('btn-step2-back').addEventListener('click', function () { setStep(1); });
    document.getElementById('btn-step2-next').addEventListener('click', function () {
      if (validateStep2(true)) { setStep(3); }
    });
    validateStep2(false);
  }

  function setFieldError(id, message) {
    var field = document.getElementById(id);
    var error = document.getElementById(id + '-err');
    var wrapper = field ? field.closest('.sw-field') : null;
    if (!field || !error) { return; }
    if (message) {
      field.classList.add('error');
      field.setAttribute('aria-invalid', 'true');
      error.textContent = message;
      error.classList.add('visible');
      if (wrapper) { wrapper.classList.add('invalid'); }
      return;
    }
    field.classList.remove('error');
    field.removeAttribute('aria-invalid');
    error.textContent = '';
    error.classList.remove('visible');
    if (wrapper) { wrapper.classList.remove('invalid'); }
  }

  function updateStep2Summary(errors) {
    var summary = document.getElementById('sw-step2-summary');
    if (!summary) { return; }
    summary.classList.add('visible');
    if (errors.length > 0) {
      summary.classList.remove('ok');
      summary.innerHTML = '<strong>Revise os campos antes de continuar</strong>' + escHtml(errors.join(' • '));
      return;
    }
    summary.classList.add('ok');
    summary.innerHTML = '<strong>Pronto para gerar a prévia</strong>Os campos obrigatórios passaram na validação local.';
  }

  function validateStep2(announce) {
    var errors = [];
    var firstInvalid = null;
    var name = (formData.name || '').trim();
    var displayName = (formData.displayName || '').trim();
    var description = (formData.description || '').trim();
    var author = (formData.author || '').trim();

    if (!name || !/^[a-z0-9-]+$/.test(name)) {
      var nameMessage = 'Use apenas letras minúsculas, números e hífens no nome do pacote.';
      setFieldError('sw-name', nameMessage);
      errors.push(nameMessage);
      firstInvalid = firstInvalid || document.getElementById('sw-name');
    } else {
      setFieldError('sw-name', '');
    }

    if (displayName.length < 3) {
      var displayMessage = 'Informe um nome de exibição com pelo menos 3 caracteres.';
      setFieldError('sw-displayname', displayMessage);
      errors.push(displayMessage);
      firstInvalid = firstInvalid || document.getElementById('sw-displayname');
    } else {
      setFieldError('sw-displayname', '');
    }

    if (description.length < 12) {
      var descriptionMessage = 'Descreva o pacote com pelo menos 12 caracteres.';
      setFieldError('sw-description', descriptionMessage);
      errors.push(descriptionMessage);
      firstInvalid = firstInvalid || document.getElementById('sw-description');
    } else {
      setFieldError('sw-description', '');
    }

    if (author.length < 2) {
      var authorMessage = 'Informe o autor ou equipe responsável.';
      setFieldError('sw-author', authorMessage);
      errors.push(authorMessage);
      firstInvalid = firstInvalid || document.getElementById('sw-author');
    } else {
      setFieldError('sw-author', '');
    }

    if (formData.type === 'agent') {
      var tools = String(formData.tools || '')
        .split(',')
        .map(function (item) { return item.trim(); })
        .filter(Boolean);
      if (tools.length === 0) {
        var toolsMessage = 'Informe ao menos uma ferramenta para o agent.';
        setFieldError('sw-tools', toolsMessage);
        errors.push(toolsMessage);
        firstInvalid = firstInvalid || document.getElementById('sw-tools');
      } else {
        setFieldError('sw-tools', '');
      }
    }

    if (formData.type === 'instruction') {
      var applyTo = (formData.applyTo || '').trim();
      if (!applyTo) {
        var applyMessage = 'Defina um padrão applyTo para a instruction.';
        setFieldError('sw-applyto', applyMessage);
        errors.push(applyMessage);
        firstInvalid = firstInvalid || document.getElementById('sw-applyto');
      } else {
        setFieldError('sw-applyto', '');
      }
    }

    updateStep2Summary(errors);
    var nextBtn = document.getElementById('btn-step2-next');
    if (nextBtn) { nextBtn.disabled = errors.length > 0; }
    if (announce && errors.length > 0) {
      showToast('warning', 'Revise os campos obrigatórios', errors[0]);
      if (firstInvalid && typeof firstInvalid.focus === 'function') {
        firstInvalid.focus();
      }
      return false;
    }
    return errors.length === 0;
  }

  // ── Step 3: Preview ─────────────────────────────────────
  function renderStep3() {
    return '<div class="sw-form">'
      + '<div class="sw-section-title">📄 Pré-visualização do Arquivo</div>'
      + '<div class="sw-preview" id="sw-preview-box" aria-live="polite">'
      + '<div class="sw-preview-loading" id="sw-preview-loading">'
      + '<div class="dai-skeleton-line" data-size="lg" style="width:68%"></div>'
      + '<div class="dai-skeleton-line" style="width:94%"></div>'
      + '<div class="dai-skeleton-line" style="width:88%"></div>'
      + '<div class="dai-skeleton-line" style="width:76%"></div>'
      + '</div>'
      + '<pre id="sw-preview-content" hidden>Gerando prévia…</pre></div>'
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
    var preview = document.getElementById('sw-preview-content');
    var loading = document.getElementById('sw-preview-loading');
    if (preview) { preview.hidden = true; }
    if (loading) { loading.hidden = false; }
    vscode.postMessage({ type: 'preview', data: formData });
  }

  // ── Message handling ────────────────────────────────────
  window.addEventListener('message', function (event) {
    var msg = event.data;

    if (msg.type === 'previewResult') {
      var pre = document.getElementById('sw-preview-content');
      var loading = document.getElementById('sw-preview-loading');
      if (loading) { loading.hidden = true; }
      if (pre) {
        pre.hidden = false;
        pre.textContent = msg.content;
      }
      return;
    }

    if (msg.type === 'success') {
      showToast('success', 'Pacote criado com sucesso', 'O novo arquivo já está disponível no editor.');
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
        formData = Object.assign({}, DEFAULT_FORM_DATA);
        setStep(1);
      });
      return;
    }

    if (msg.type === 'error') {
      var btn = document.getElementById('btn-step3-create');
      if (btn) { btn.disabled = false; btn.textContent = '✨ Criar Pacote'; }
      showToast('error', 'Falha ao criar pacote', msg.message || 'Não foi possível concluir a criação do pacote.');
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
