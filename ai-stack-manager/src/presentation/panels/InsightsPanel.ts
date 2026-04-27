/**
 * @module presentation/panels/InsightsPanel
 * @description Painel webview para o Insights Engine do AI Stack.
 * Exibe o mapa de cobertura do workflow, inventário de segurança e saúde das dependências.
 */

import * as vscode from 'vscode';
import { WebviewHelper } from '../webview/WebviewHelper';
import { InsightsGenerator } from '../../infrastructure/services/InsightsGenerator';

export class InsightsPanel {
  public static currentPanel: InsightsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private readonly _generator: InsightsGenerator;
  private _initialized = false;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, generator: InsightsGenerator) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._generator = generator;

    this.update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(e => {
      if (e.command === 'refresh') { this.update(); }
    }, null, this._disposables);
  }

  public static createOrShow(extensionUri: vscode.Uri, generator: InsightsGenerator): void {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (InsightsPanel.currentPanel) {
      InsightsPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'daiInsights',
      'DescomplicAI: Insights Engine',
      column || vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [extensionUri], retainContextWhenHidden: true }
    );

    InsightsPanel.currentPanel = new InsightsPanel(panel, extensionUri, generator);
  }

  public dispose(): void {
    InsightsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  private async update(): Promise<void> {
    const report = await this._generator.generateReport();

    const state = { html: this.renderReport(report) };
    if (!this._initialized) {
      this._panel.webview.html = WebviewHelper.buildStatefulHtml({
        webview: this._panel.webview,
        extensionUri: this._extensionUri,
        title: 'DescomplicAI: Insights Engine',
        initialState: state,
        scriptContent: this.getScript(),
      });
      this._initialized = true;
      return;
    }

    WebviewHelper.postState(this._panel.webview, state);
  }

  private renderReport(report: import('../../domain/entities/InsightsReport').InsightsReport): string {
    return /*html*/`
<div class="dai-container dai-insights-root">
  <style>
    .dai-insights-root { padding: 24px; max-width: 1200px; margin: 0 auto; color: var(--vscode-foreground); }
    .insights-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; }
    .insights-title { font-size: 2rem; font-weight: 800; margin: 0; display: flex; align-items: center; gap: 12px; }
    .insights-subtitle { color: var(--vscode-descriptionForeground); margin-top: 4px; }
    
    .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 24px; }
    
    .dashboard-card { background: var(--vscode-editor-background); border: 1px solid var(--border-color); border-radius: 12px; padding: 24px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    .card-title { font-size: 1.1rem; font-weight: 600; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    
    /* Coverage Map */
    .coverage-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .coverage-node { padding: 16px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center; position: relative; background: rgba(0,0,0,0.1); transition: all 0.2s; }
    .coverage-node.active { background: rgba(236, 112, 0, 0.1); border-color: var(--itau-primary); box-shadow: 0 0 16px rgba(236,112,0,0.1); }
    .coverage-node.active .node-icon { opacity: 1; transform: scale(1.1); }
    .node-icon { font-size: 24px; display: block; margin-bottom: 8px; opacity: 0.3; transition: all 0.2s; }
    .node-label { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; color: var(--vscode-foreground); }
    
    /* Alerts */
    .alert-list { display: flex; flex-direction: column; gap: 12px; }
    .alert-item { padding: 12px; border-radius: 6px; border-left: 4px solid var(--itau-warning); background: rgba(255,179,0,0.05); display: flex; flex-direction: column; gap: 4px; }
    .alert-item.danger { border-left-color: var(--itau-error); background: rgba(211,47,47,0.05); }
    .alert-item.ok { border-left-color: var(--itau-success); background: rgba(0,200,83,0.05); }
    .alert-title { font-weight: 600; font-size: 0.9rem; display: flex; align-items: center; gap: 6px; }
    .alert-desc { font-size: 0.8rem; color: var(--vscode-descriptionForeground); }
    
    .score-circle { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 120px; height: 120px; border-radius: 50%; border: 8px solid var(--itau-primary); margin: 0 auto 24px; font-size: 2rem; font-weight: 800; box-shadow: 0 0 32px rgba(236,112,0,0.2); }
    .score-label { font-size: 0.8rem; font-weight: 400; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 1px; }
  </style>

  <div class="insights-header ${this._initialized ? '' : 'animate-fade-in'}">
    <div>
      <h1 class="insights-title"><span class="dai-stack-icon" style="width: 32px; height: 32px;"><div class="dai-stack-layer dai-layer-1" style="width:24px; height:24px;"></div><div class="dai-stack-layer dai-layer-2" style="width:24px; height:24px;"></div><div class="dai-stack-layer dai-layer-3" style="width:24px; height:24px;"></div></span> Insights Engine</h1>
      <p class="insights-subtitle">Métricas avançadas da sua infraestrutura de AI Agents</p>
    </div>
    <button class="dai-btn dai-btn-primary" id="refresh-insights">↻ Atualizar</button>
  </div>

  <div class="dashboard-grid">
    
    <!-- Mapa de Cobertura -->
    <div class="dashboard-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.1s; grid-column: span 2;">
      <div class="card-title">🗺️ Mapa de Cobertura do Workflow</div>
      <p style="font-size: 0.85rem; color: var(--vscode-descriptionForeground); margin-bottom: 24px;">
        Visualiza em quais etapas do fluxo de desenvolvimento você possui agentes instalados. Uma cobertura alta significa maior automação.
      </p>
      
      <div class="coverage-grid">
        <div class="coverage-node ${report.coverage.triage ? 'active' : ''}">
          <span class="node-icon">🧠</span><span class="node-label">Triagem</span>
        </div>
        <div class="coverage-node ${report.coverage.plan ? 'active' : ''}">
          <span class="node-icon">📐</span><span class="node-label">Planejamento</span>
        </div>
        <div class="coverage-node ${report.coverage.design ? 'active' : ''}">
          <span class="node-icon">🏛️</span><span class="node-label">Design</span>
        </div>
        <div class="coverage-node ${report.coverage.execute ? 'active' : ''}">
          <span class="node-icon">⚡</span><span class="node-label">Execução</span>
        </div>
        <div class="coverage-node ${report.coverage.validate ? 'active' : ''}">
          <span class="node-icon">🧪</span><span class="node-label">Validação</span>
        </div>
        <div class="coverage-node ${report.coverage.critic ? 'active' : ''}">
          <span class="node-icon">🛡️</span><span class="node-label">Revisão Crítica</span>
        </div>
      </div>
    </div>

    <!-- Pontuação do Ecossistema -->
    <div class="dashboard-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.2s">
      <div class="card-title">📊 Pontuação do Ecossistema</div>
      <div class="score-circle">
        ${report.coverageScore}%
        <span class="score-label">Cobertura</span>
      </div>
      <div style="text-align: center; color: var(--vscode-descriptionForeground);">
        ${report.installedAgentsCount} agents operacionais na rede.
      </div>
    </div>

    <!-- Segurança e Inventário de Ferramentas -->
    <div class="dashboard-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.3s; grid-column: span 2;">
      <div class="card-title">🔐 Segurança e Inventário de Ferramentas</div>
      <div class="alert-list">
        ${report.securityAlerts.length === 0 ? '<div class="alert-item ok"><span class="alert-title">🟢 Seguro</span><span class="alert-desc">Nenhum agente com permissões de terminal detectado.</span></div>' : ''}
        
        ${report.securityAlerts.map(a => `
          <div class="alert-item ${a.terminalAccess && !a.isGuardianPresent ? 'danger' : ''}">
            <span class="alert-title">
              ${a.terminalAccess && !a.isGuardianPresent ? '🔴 Risco Crítico' : '🟡 Atenção'} — ${a.agentName}
            </span>
            <span class="alert-desc">
              Este agente possui ferramentas destrutivas (${a.terminalAccess ? 'execute ' : ''}${a.fileEditAccess ? 'edit' : ''}). 
              ${a.isGuardianPresent ? '<b>✓ Guardian instalado</b> na rede para mitigar riscos.' : '⚠️ <b>Nenhum Guardian (Critic)</b> instalado para validar os outputs!'}
            </span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Saúde das Dependências -->
    <div class="dashboard-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.4s">
      <div class="card-title">🔗 Saúde das Dependências</div>
      <div class="alert-list">
        ${report.missingDependencies.length === 0 ? '<div class="alert-item ok"><span class="alert-title">🟢 Saudável</span><span class="alert-desc">Nenhum gap na rede de agents detectado.</span></div>' : ''}
        
        ${report.missingDependencies.map(d => `
          <div class="alert-item">
            <span class="alert-title">🟡 Especialista Ausente</span>
            <span class="alert-desc">O Orchestrator delegará para <b>${d}</b>, mas ele não está instalado. O Orchestrator fará fallback para LLM puro.</span>
          </div>
        `).join('')}
      </div>
    </div>

  </div>

</div>`;
  }

  private getScript(): string {
    return /*js*/`
      const render = (state) => state.html || '<div class="dai-container"></div>';
      const bind = (_state, app) => {
        app.root.querySelector('#refresh-insights')?.addEventListener('click', () => {
          app.postMessage({ command: 'refresh' });
        });
      };
    `;
  }
}
