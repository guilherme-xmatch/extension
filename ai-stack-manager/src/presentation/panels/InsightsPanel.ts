/**
 * @module presentation/panels/InsightsPanel
 * @description Painel webview para o Insights Engine do AI Stack.
 * Exibe o mapa de cobertura do workflow, inventário de segurança e saúde das dependências.
 */

import * as vscode from 'vscode';
import { WebviewHelper } from '../webview/WebviewHelper';
import { InsightsGenerator } from '../../infrastructure/services/InsightsGenerator';
import { UxDiagnosticsSummary } from '../../domain/entities/InsightsReport';

export class InsightsPanel {
  public static currentPanel: InsightsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private readonly _generator: InsightsGenerator;
  private _initialized = false;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    generator: InsightsGenerator,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._generator = generator;

    void this.update(false);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (e) => {
        if (e.command === 'refresh') {
          void this.update(true);
        }
      },
      null,
      this._disposables,
    );
  }

  public static createOrShow(extensionUri: vscode.Uri, generator: InsightsGenerator): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (InsightsPanel.currentPanel) {
      InsightsPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'daiInsights',
      'DescomplicAI: Insights Engine',
      column || vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [extensionUri], retainContextWhenHidden: true },
    );

    InsightsPanel.currentPanel = new InsightsPanel(panel, extensionUri, generator);
  }

  public dispose(): void {
    InsightsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async update(notify = false): Promise<void> {
    if (!this._initialized) {
      this._panel.webview.html = WebviewHelper.buildStatefulHtml({
        webview: this._panel.webview,
        extensionUri: this._extensionUri,
        title: 'DescomplicAI: Insights Engine',
        initialState: { html: this.renderLoading(), loading: true },
        scriptContent: this.getScript(),
      });
      this._initialized = true;
    } else {
      WebviewHelper.postState(this._panel.webview, { html: this.renderLoading(), loading: true });
    }

    try {
      const report = await this._generator.generateReport();
      WebviewHelper.postState(this._panel.webview, {
        html: this.renderReport(report),
        loading: false,
      });
      if (notify) {
        WebviewHelper.postNotification(this._panel.webview, {
          kind: 'success',
          title: 'Insights atualizados',
          message: 'As métricas do ecossistema foram recalculadas com sucesso.',
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível gerar o relatório de insights.';
      WebviewHelper.postState(this._panel.webview, {
        html: this.renderError(message),
        loading: false,
      });
      WebviewHelper.postNotification(this._panel.webview, {
        kind: 'error',
        title: 'Falha ao atualizar insights',
        message,
      });
    }
  }

  private renderStyles(): string {
    return /*html*/ `
  <style>
    .dai-insights-root { padding: 24px; max-width: 1200px; margin: 0 auto; color: var(--vscode-foreground); }
    .insights-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    .insights-title-wrap { display: flex; flex-direction: column; gap: 8px; }
    .insights-title { font-size: 2rem; font-weight: 800; margin: 0; display: flex; align-items: center; gap: 12px; }
    .insights-subtitle { color: var(--dai-text-muted); margin: 0; max-width: 640px; }
    .insights-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: flex-end; }

    .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }

    .dashboard-card {
      background: var(--dai-surface-glass);
      border: 1px solid var(--dai-border-soft);
      border-radius: 18px;
      padding: 20px;
      box-shadow: var(--dai-shadow-sm);
    }
    .dashboard-card:focus-visible {
      outline: none;
      border-color: var(--dai-border-strong);
      box-shadow: var(--dai-shadow-focus);
    }
    .card-title { font-size: 1.05rem; font-weight: 700; border-bottom: 1px solid var(--dai-border-soft); padding-bottom: 12px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }

    .coverage-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .coverage-node {
      padding: 16px;
      border-radius: 12px;
      border: 1px solid var(--dai-border-soft);
      text-align: center;
      position: relative;
      background: var(--dai-surface-1);
      transition: transform var(--dai-duration-base) var(--dai-ease-standard), border-color var(--dai-duration-base) var(--dai-ease-standard), box-shadow var(--dai-duration-base) var(--dai-ease-standard);
    }
    .coverage-node:focus-visible {
      outline: none;
      border-color: var(--dai-border-strong);
      box-shadow: var(--dai-shadow-focus);
    }
    .coverage-node.active { background: rgba(236, 112, 0, 0.1); border-color: var(--itau-primary); box-shadow: 0 0 16px rgba(236,112,0,0.1); }
    .coverage-node.active .node-icon { opacity: 1; transform: scale(1.08); }
    .node-icon { font-size: 24px; display: block; margin-bottom: 8px; opacity: 0.34; transition: all 0.2s; }
    .node-label { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--vscode-foreground); }
    .node-state { display: block; margin-top: 6px; font-size: 0.72rem; color: var(--dai-text-muted); }

    .score-circle { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 120px; height: 120px; border-radius: 50%; border: 8px solid var(--itau-primary); margin: 0 auto 20px; font-size: 2rem; font-weight: 800; box-shadow: 0 0 32px rgba(236,112,0,0.2); }
    .score-label { font-size: 0.8rem; font-weight: 500; color: var(--dai-text-muted); text-transform: uppercase; letter-spacing: 1px; }

    .alert-list { display: flex; flex-direction: column; gap: 12px; }
    .alert-item { padding: 12px; border-radius: 12px; border-left: 4px solid var(--itau-warning); background: rgba(255,179,0,0.05); display: flex; flex-direction: column; gap: 4px; }
    .alert-item.danger { border-left-color: var(--itau-error); background: rgba(211,47,47,0.05); }
    .alert-item.ok { border-left-color: var(--itau-success); background: rgba(0,200,83,0.05); }
    .alert-title { font-weight: 700; font-size: 0.9rem; display: flex; align-items: center; gap: 6px; }
    .alert-desc { font-size: 0.8rem; color: var(--dai-text-muted); line-height: 1.5; }

    .insights-loading-card { display: flex; flex-direction: column; gap: 12px; min-height: 220px; }
    .insights-loading-stack { display: flex; gap: 8px; align-items: center; }
    .insights-error-card { max-width: 620px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }

    @media (max-width: 640px) {
      .insights-header { flex-direction: column; }
      .insights-toolbar { justify-content: flex-start; }
      .coverage-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>`;
  }

  private renderLoading(): string {
    return /*html*/ `
<div class="dai-container dai-insights-root">
  ${this.renderStyles()}
  <div class="insights-header ${this._initialized ? '' : 'animate-fade-in'}">
    <div class="insights-title-wrap">
      <span class="dai-brand-kicker">Observabilidade do ecossistema</span>
      <h1 class="insights-title"><span class="dai-stack-icon dai-stack-icon--status dai-logo-loading" role="img" aria-label="Atualizando insights"><div class="dai-stack-layer dai-layer-1"></div><div class="dai-stack-layer dai-layer-2"></div><div class="dai-stack-layer dai-layer-3"></div></span> Insights Engine</h1>
      <p class="insights-subtitle">Recalculando cobertura, segurança e dependências instaladas.</p>
    </div>
    <div class="insights-toolbar">
      <span class="dai-status-pill dai-status-pill-active">Atualizando</span>
      <button class="dai-btn dai-btn-primary" type="button" disabled aria-busy="true">Atualizando...</button>
    </div>
  </div>

  <div class="dashboard-grid" role="list" aria-label="Carregando cards de insights">
    <section class="dashboard-card insights-loading-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.08s; grid-column: span 2;" role="listitem" aria-hidden="true">
      <div class="insights-loading-stack"><span class="dai-skeleton-pill"></span><span class="dai-skeleton-line" data-size="lg" style="width: 44%;"></span></div>
      <div class="dai-skeleton-line" style="width: 88%;"></div>
      <div class="coverage-grid">
        <div class="dai-skeleton-block"></div>
        <div class="dai-skeleton-block"></div>
        <div class="dai-skeleton-block"></div>
      </div>
    </section>
    <section class="dashboard-card insights-loading-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.16s;" role="listitem" aria-hidden="true">
      <span class="dai-skeleton-line" data-size="lg" style="width: 62%;"></span>
      <div class="dai-skeleton-block" style="min-height: 180px;"></div>
    </section>
    <section class="dashboard-card insights-loading-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.24s; grid-column: span 2;" role="listitem" aria-hidden="true">
      <span class="dai-skeleton-line" data-size="lg" style="width: 54%;"></span>
      <div class="dai-skeleton-line" style="width: 94%;"></div>
      <div class="dai-skeleton-line" style="width: 76%;"></div>
      <div class="dai-skeleton-block" style="min-height: 120px;"></div>
    </section>
  </div>
</div>`;
  }

  private renderError(message: string): string {
    return /*html*/ `
<div class="dai-container dai-insights-root">
  ${this.renderStyles()}
  <section class="dashboard-card insights-error-card animate-fade-in" role="alert" aria-live="assertive">
    <span class="dai-status-pill dai-status-pill-warning">Falha ao carregar</span>
    <h1 class="insights-title">Insights Engine indisponível</h1>
    <p class="insights-subtitle">${message}</p>
    <button class="dai-btn dai-btn-primary" id="refresh-insights" type="button" aria-label="Tentar atualizar insights novamente">Tentar novamente</button>
  </section>
</div>`;
  }

  private renderReport(
    report: import('../../domain/entities/InsightsReport').InsightsReport,
  ): string {
    return /*html*/ `
<div class="dai-container dai-insights-root">
  ${this.renderStyles()}

  <div class="insights-header ${this._initialized ? '' : 'animate-fade-in'}">
    <div class="insights-title-wrap">
      <span class="dai-brand-kicker">Observabilidade do ecossistema</span>
      <h1 class="insights-title"><span class="dai-stack-icon dai-stack-icon--status dai-logo-idle" role="img" aria-label="Insights do ecossistema prontos"><div class="dai-stack-layer dai-layer-1"></div><div class="dai-stack-layer dai-layer-2"></div><div class="dai-stack-layer dai-layer-3"></div></span> Insights Engine</h1>
      <p class="insights-subtitle">Métricas avançadas da sua infraestrutura de AI Agents.</p>
    </div>
    <div class="insights-toolbar">
      <span class="dai-status-pill ${report.coverageScore >= 80 ? 'dai-status-pill-ready' : report.coverageScore >= 50 ? 'dai-status-pill-warning' : 'dai-status-pill-active'}">${report.coverageScore}% cobertura</span>
      <button class="dai-btn dai-btn-primary" id="refresh-insights" type="button" aria-label="Atualizar insights do ecossistema">Atualizar</button>
    </div>
  </div>

  <div class="dashboard-grid" role="list" aria-label="Cards de insights">

    <!-- Mapa de Cobertura -->
    <section class="dashboard-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.1s; grid-column: span 2;" role="listitem region" tabindex="0" aria-label="Mapa de cobertura do workflow">
      <div class="card-title">🗺️ Mapa de Cobertura do Workflow</div>
      <p style="font-size: 0.85rem; color: var(--dai-text-muted); margin-bottom: 24px; line-height: 1.6;">
        Visualiza em quais etapas do fluxo de desenvolvimento você possui agentes instalados. Uma cobertura alta significa maior automação.
      </p>

      <div class="coverage-grid" role="list" aria-label="Cobertura por etapa do workflow">
        <div class="coverage-node ${report.coverage.triage ? 'active' : ''}" role="listitem" tabindex="0" aria-label="Triagem ${report.coverage.triage ? 'coberta' : 'não coberta'}">
          <span class="node-icon" aria-hidden="true">🧠</span><span class="node-label">Triagem</span><span class="node-state">${report.coverage.triage ? 'Coberta' : 'Pendente'}</span>
        </div>
        <div class="coverage-node ${report.coverage.plan ? 'active' : ''}" role="listitem" tabindex="0" aria-label="Planejamento ${report.coverage.plan ? 'coberto' : 'não coberto'}">
          <span class="node-icon" aria-hidden="true">📐</span><span class="node-label">Planejamento</span><span class="node-state">${report.coverage.plan ? 'Coberto' : 'Pendente'}</span>
        </div>
        <div class="coverage-node ${report.coverage.design ? 'active' : ''}" role="listitem" tabindex="0" aria-label="Design ${report.coverage.design ? 'coberto' : 'não coberto'}">
          <span class="node-icon" aria-hidden="true">🏛️</span><span class="node-label">Design</span><span class="node-state">${report.coverage.design ? 'Coberto' : 'Pendente'}</span>
        </div>
        <div class="coverage-node ${report.coverage.execute ? 'active' : ''}" role="listitem" tabindex="0" aria-label="Execução ${report.coverage.execute ? 'coberta' : 'não coberta'}">
          <span class="node-icon" aria-hidden="true">⚡</span><span class="node-label">Execução</span><span class="node-state">${report.coverage.execute ? 'Coberta' : 'Pendente'}</span>
        </div>
        <div class="coverage-node ${report.coverage.validate ? 'active' : ''}" role="listitem" tabindex="0" aria-label="Validação ${report.coverage.validate ? 'coberta' : 'não coberta'}">
          <span class="node-icon" aria-hidden="true">🧪</span><span class="node-label">Validação</span><span class="node-state">${report.coverage.validate ? 'Coberta' : 'Pendente'}</span>
        </div>
        <div class="coverage-node ${report.coverage.critic ? 'active' : ''}" role="listitem" tabindex="0" aria-label="Revisão crítica ${report.coverage.critic ? 'coberta' : 'não coberta'}">
          <span class="node-icon" aria-hidden="true">🛡️</span><span class="node-label">Revisão Crítica</span><span class="node-state">${report.coverage.critic ? 'Coberta' : 'Pendente'}</span>
        </div>
      </div>
    </section>

    <!-- Pontuação do Ecossistema -->
    <section class="dashboard-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.2s" role="listitem region" tabindex="0" aria-label="Pontuação do ecossistema">
      <div class="card-title">📊 Pontuação do Ecossistema</div>
      <div class="score-circle">
        ${report.coverageScore}%
        <span class="score-label">Cobertura</span>
      </div>
      <div style="text-align: center; color: var(--dai-text-muted); line-height: 1.5;">
        ${report.installedAgentsCount} agents operacionais na rede.
      </div>
    </section>

    <!-- Segurança e Inventário de Ferramentas -->
    <section class="dashboard-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.3s; grid-column: span 2;" role="listitem region" tabindex="0" aria-label="Segurança e inventário de ferramentas">
      <div class="card-title">🔐 Segurança e Inventário de Ferramentas</div>
      <div class="alert-list" role="list" aria-label="Alertas de segurança">
        ${report.securityAlerts.length === 0 ? '<div class="alert-item ok" role="listitem"><span class="alert-title">🟢 Seguro</span><span class="alert-desc">Nenhum agente com permissões de terminal detectado.</span></div>' : ''}

        ${report.securityAlerts
          .map(
            (a) => `
          <div class="alert-item ${a.terminalAccess && !a.isGuardianPresent ? 'danger' : ''}" role="listitem">
            <span class="alert-title">
              ${a.terminalAccess && !a.isGuardianPresent ? '🔴 Risco Crítico' : '🟡 Atenção'} — ${a.agentName}
            </span>
            <span class="alert-desc">
              Este agente possui ferramentas destrutivas (${a.terminalAccess ? 'execute ' : ''}${a.fileEditAccess ? 'edit' : ''}).
              ${a.isGuardianPresent ? '<b>✓ Guardian instalado</b> na rede para mitigar riscos.' : '⚠️ <b>Nenhum Guardian (Critic)</b> instalado para validar os outputs!'}
            </span>
          </div>
        `,
          )
          .join('')}
      </div>
    </section>

    <!-- Saúde das Dependências -->
    <section class="dashboard-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.4s" role="listitem region" tabindex="0" aria-label="Saúde das dependências">
      <div class="card-title">🔗 Saúde das Dependências</div>
      <div class="alert-list" role="list" aria-label="Dependências ausentes">
        ${report.missingDependencies.length === 0 ? '<div class="alert-item ok" role="listitem"><span class="alert-title">🟢 Saudável</span><span class="alert-desc">Nenhum gap na rede de agents detectado.</span></div>' : ''}

        ${report.missingDependencies
          .map(
            (d) => `
          <div class="alert-item" role="listitem">
            <span class="alert-title">🟡 Especialista Ausente</span>
            <span class="alert-desc">O Orchestrator delegará para <b>${d}</b>, mas ele não está instalado. O Orchestrator fará fallback para LLM puro.</span>
          </div>
        `,
          )
          .join('')}
      </div>
    </section>

    ${this.renderUxDiagnostics(report.uxDiagnostics)}

  </div>

</div>`;
  }

  private renderUxDiagnostics(uxDiagnostics?: UxDiagnosticsSummary): string {
    if (!uxDiagnostics) {
      return '';
    }

    const items: string[] = [];

    if (!uxDiagnostics.enabled) {
      items.push(
        '<div class="alert-item" role="listitem"><span class="alert-title">ℹ️ Diagnósticos locais desativados</span><span class="alert-desc">Ative descomplicai.uxDiagnostics.enabled para acompanhar padrões agregados de atrito, sem capturar conteúdo do usuário.</span></div>',
      );
    }

    if (
      uxDiagnostics.enabled &&
      uxDiagnostics.regressions.length === 0 &&
      uxDiagnostics.repeatedActions.length === 0
    ) {
      items.push(
        '<div class="alert-item ok" role="listitem"><span class="alert-title">🟢 Sem atritos relevantes</span><span class="alert-desc">Nenhum padrão recorrente de abandono, falha ou repetição foi detectado nos fluxos locais monitorados.</span></div>',
      );
    }

    uxDiagnostics.regressions.forEach((signal) => {
      const cssClass =
        signal.severity === 'error' ? 'danger' : signal.severity === 'warning' ? '' : 'ok';
      const lastSeen = signal.lastOccurredAt ? ` Última ocorrência: ${signal.lastOccurredAt}.` : '';
      items.push(
        `<div class="alert-item ${cssClass}" role="listitem"><span class="alert-title">${signal.severity === 'error' ? '🔴' : signal.severity === 'warning' ? '🟡' : '🔵'} ${signal.title} · ${signal.count}x</span><span class="alert-desc">${signal.summary}${lastSeen}</span></div>`,
      );
    });

    uxDiagnostics.repeatedActions.forEach((action) => {
      const lastSeen = action.lastOccurredAt ? ` Última ocorrência: ${action.lastOccurredAt}.` : '';
      items.push(
        `<div class="alert-item" role="listitem"><span class="alert-title">📄 ${action.title} · ${action.count}x</span><span class="alert-desc">${action.summary} Limite de atenção: ${action.threshold} ocorrências.${lastSeen}</span></div>`,
      );
    });

    return /*html*/ `
    <section class="dashboard-card ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.5s; grid-column: span 2;" role="listitem region" tabindex="0" aria-label="Sinais locais de experiência do usuário">
      <div class="card-title">🧭 Sinais Locais de UX</div>
      <p style="font-size: 0.85rem; color: var(--dai-text-muted); margin-bottom: 18px; line-height: 1.6;">
        Diagnósticos agregados, armazenados localmente, para identificar abandono de fluxo, falhas recorrentes e ações repetidas sem registrar conteúdo do usuário. ${uxDiagnostics.enabled ? `${uxDiagnostics.trackedFlows} fluxo(s) agregados com histórico local.` : 'Nenhum evento está sendo agregado no momento.'}
      </p>
      <div class="alert-list" role="list" aria-label="Diagnósticos locais de UX">
        ${items.join('')}
      </div>
    </section>`;
  }

  private getScript(): string {
    return /*js*/ `
      const render = (state) => state.html || '<div class="dai-container"></div>';
      const bind = (_state, app) => {
        app.root.querySelector('#refresh-insights')?.addEventListener('click', () => {
          app.postMessage({ command: 'refresh' });
        });
      };
    `;
  }
}
