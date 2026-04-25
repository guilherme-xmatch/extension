/**
 * @module presentation/providers/HealthViewProvider
 * @description WebviewViewProvider for the Health Check sidebar panel.
 * Shows validation results with score, findings, and actionable fixes.
 */

import * as vscode from 'vscode';
import { WebviewHelper } from '../webview/WebviewHelper';
import { HealthCheckerService } from '../../infrastructure/services/HealthChecker';
import { HealthReport, HealthSeverity } from '../../domain/entities/HealthReport';
import { IOperationCoordinator } from '../../domain/interfaces';
import { OperationMetricsSnapshot, OperationSnapshot } from '../../domain/entities/Operation';

type HealthMessage = { command: 'runCheck' };

function isHealthMessage(value: unknown): value is HealthMessage {
  if (!value || typeof value !== 'object') { return false; }
  const message = value as Record<string, unknown>;
  return message.command === 'runCheck';
}

export class HealthViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dai-health';
  private _view?: vscode.WebviewView;
  private _initialized = false;
  private _lastReport?: HealthReport;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _healthChecker: HealthCheckerService,
    private readonly _operations: IOperationCoordinator,
  ) {
    this._operations.onDidChangeCurrentOperation(() => {
      if (this._view) {
        this.renderCurrentState();
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
      if (!isHealthMessage(message)) { return; }
      if (message.command === 'runCheck') { await this.runAndRender(); }
    });

    this.renderInitial();
  }

  public async refresh(): Promise<void> { await this.runAndRender(); }

  private renderInitial(): void {
    if (!this._view) { return; }

    const state = { html: this.renderHero(), loading: false };
    if (!this._initialized) {
      this._view.webview.html = WebviewHelper.buildStatefulHtml({
        webview: this._view.webview,
        extensionUri: this._extensionUri,
        title: 'DescomplicAI — Health Check',
        initialState: state,
        scriptContent: this.getScript(),
      });
      this._initialized = true;
      return;
    }

    WebviewHelper.postState(this._view.webview, state);
  }

  private renderCurrentState(): void {
    if (!this._view) { return; }

    if (this._lastReport) {
      WebviewHelper.postState(this._view.webview, { html: this.renderReport(this._lastReport), loading: false });
      return;
    }

    WebviewHelper.postState(this._view.webview, { html: this.renderHero(), loading: false });
  }

  private async runAndRender(): Promise<void> {
    if (!this._view) { return; }
    WebviewHelper.postState(this._view.webview, { html: this.renderHero(true), loading: true });
    const report = await this._operations.run({
      kind: 'health-check',
      label: 'Executando health check',
      refreshTargets: [],
    }, async (operation) => {
      operation.setProgress(20, 'Validando infraestrutura');
      const value = await this._healthChecker.check();
      operation.setProgress(100, 'Health check concluído');
      return value;
    });
    this._lastReport = report;
    WebviewHelper.postState(this._view.webview, { html: this.renderReport(report), loading: false });
  }

  private renderHero(loading = false): string {
    return /*html*/`
    <div class="dai-container">
      ${this.renderOperationBanner()}
      <div class="dai-health-hero ${this._initialized ? '' : 'animate-fade-in'}">
        <div class="dai-health-icon-large">🩺</div>
        <h3 class="dai-health-title">Health Check da Infraestrutura</h3>
        <p class="dai-health-subtitle">Valide a integridade dos seus agents, skills, MCPs e instructions.</p>
        <button class="dai-btn dai-btn-primary dai-btn-lg ${loading ? 'dai-btn-loading' : ''}" id="run-check">
          ${loading ? '<span class="dai-spinner"></span> Escaneando...' : '<span class="dai-btn-icon">▶</span> Executar Health Check'}
        </button>
      </div>
    </div>`;
  }

  private renderReport(report: HealthReport): string {
    const scoreColor = report.score >= 90 ? 'var(--itau-success)'
      : report.score >= 60 ? 'var(--itau-warning)'
      : 'var(--itau-error)';

    const circumference = 2 * Math.PI * 40;
    const dashOffset = circumference - (report.score / 100) * circumference;

    return /*html*/`
    <div class="dai-container">
      ${this.renderOperationBanner()}
      <!-- Score Ring -->
      <div class="dai-health-score ${this._initialized ? '' : 'animate-scale-in'}">
        <div class="dai-score-ring">
          <svg viewBox="0 0 100 100" width="120" height="120">
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--vscode-widget-border, rgba(255,255,255,0.1))" stroke-width="6"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="${scoreColor}" stroke-width="6"
              stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"
              stroke-linecap="round" transform="rotate(-90 50 50)"
              class="dai-score-progress"/>
          </svg>
          <div class="dai-score-value">
            <span class="dai-score-number">${report.score}</span>
            <span class="dai-score-label">Score</span>
          </div>
        </div>
        <div class="dai-score-status">
          <span class="dai-score-emoji">${report.statusEmoji}</span>
          <span class="dai-score-text">${report.statusLabel}</span>
        </div>
      </div>

      <!-- Stats Bar -->
      <div class="dai-health-stats ${this._initialized ? '' : 'animate-slide-in'}" style="--delay: 0.1s">
        <div class="dai-stat" style="--stat-color: var(--itau-error)">
          <span class="dai-stat-value">${report.errors.length}</span>
          <span class="dai-stat-label">Erros</span>
        </div>
        <div class="dai-stat" style="--stat-color: var(--itau-warning)">
          <span class="dai-stat-value">${report.warnings.length}</span>
          <span class="dai-stat-label">Avisos</span>
        </div>
        <div class="dai-stat" style="--stat-color: var(--itau-info)">
          <span class="dai-stat-value">${report.infos.length}</span>
          <span class="dai-stat-label">Info</span>
        </div>
        <div class="dai-stat" style="--stat-color: var(--itau-success)">
          <span class="dai-stat-value">${report.scanDurationMs}ms</span>
          <span class="dai-stat-label">Tempo</span>
        </div>
      </div>

      ${this.renderOperationInsights()}

      <!-- Findings -->
      <div class="dai-section">
        <div class="dai-section-header">
          <span class="dai-section-title">Descobertas</span>
          <button class="dai-btn dai-btn-ghost dai-btn-sm" id="rerun-check">↻ Re-scan</button>
        </div>
        ${report.findings.length === 0 ? '<div class="dai-empty">Tudo perfeito! Nenhum problema encontrado.</div>' : ''}
        ${report.findings.map((f, i) => {
          const icon = f.severity === HealthSeverity.Error ? '🔴'
            : f.severity === HealthSeverity.Warning ? '🟡'
            : f.severity === HealthSeverity.Ok ? '🟢'
            : '🔵';
          const severityClass = `severity-${f.severity}`;

          return /*html*/`
          <div class="dai-finding ${this._initialized ? '' : 'animate-slide-in'} ${severityClass}" style="--delay: ${(i + 2) * 0.06}s">
            <div class="dai-finding-icon">${icon}</div>
            <div class="dai-finding-content">
              <span class="dai-finding-title">${f.title}</span>
              <span class="dai-finding-message">${f.message}</span>
              ${f.fix ? `<span class="dai-finding-fix">💡 ${f.fix}</span>` : ''}
            </div>
            <span class="dai-finding-category">${f.category}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  private getScript(): string {
    return /*js*/`
    const render = (state) => state.html || '<div class="dai-container"></div>';
    const bind = (state, app) => {
      app.root.querySelector('#run-check')?.addEventListener('click', () => {
        app.postMessage({ command: 'runCheck' });
      });
      app.root.querySelector('#rerun-check')?.addEventListener('click', () => {
        app.postMessage({ command: 'runCheck' });
      });
    };
    `;
  }

  private renderOperationBanner(): string {
    const operation = this._operations.getCurrentOperation();
    if (!operation || operation.kind === 'health-check') {
      return '';
    }

    const progress = typeof operation.progress === 'number' ? `${operation.progress}%` : 'Em andamento';
    return /*html*/`
    <div class="dai-recommendation-banner">
      <div class="dai-rec-icon">⏳</div>
      <div class="dai-rec-content">
        <p class="dai-rec-msg"><b>${operation.label}</b>${operation.message ? ` — ${operation.message}` : ''}</p>
        <span class="dai-tag">${progress}</span>
      </div>
    </div>`;
  }

  private renderOperationInsights(): string {
    const metrics = this._operations.getMetrics();
    const history = this._operations.getRecentOperations(5);

    if (metrics.length === 0 && history.length === 0) {
      return '';
    }

    const topMetrics = metrics
      .slice()
      .sort((left, right) => right.totalRuns - left.totalRuns)
      .slice(0, 3);

    return /*html*/`
    <div class="dai-section">
      <div class="dai-section-header">
        <span class="dai-section-title">Operações Recentes</span>
      </div>
      <div class="dai-health-stats">
        ${topMetrics.map(metric => this.renderMetricCard(metric)).join('')}
      </div>
      <div class="alert-list">
        ${history.map(entry => this.renderHistoryEntry(entry)).join('')}
      </div>
    </div>`;
  }

  private renderMetricCard(metric: OperationMetricsSnapshot): string {
    const successRate = metric.totalRuns > 0
      ? Math.round((metric.completedRuns / metric.totalRuns) * 100)
      : 0;

    return /*html*/`
    <div class="dai-stat" style="--stat-color: var(--itau-info)">
      <span class="dai-stat-value">${metric.totalRuns}</span>
      <span class="dai-stat-label">${this.toMetricLabel(metric.kind)}</span>
      <span class="dai-form-hint">${successRate}% sucesso · avg ${metric.averageDurationMs}ms</span>
    </div>`;
  }

  private renderHistoryEntry(entry: OperationSnapshot): string {
    const isSuccess = entry.status === 'completed';
    const duration = entry.finishedAt ? `${Math.max(0, entry.finishedAt - entry.startedAt)}ms` : 'em andamento';
    const cssClass = isSuccess ? 'ok' : entry.status === 'failed' ? 'warning' : '';
    const icon = isSuccess ? '🟢' : entry.status === 'failed' ? '🔴' : '🔵';
    const detail = entry.errorMessage ?? entry.message ?? 'Sem detalhes adicionais';

    return /*html*/`
    <div class="alert-item ${cssClass}">
      <span class="alert-title">${icon} ${entry.label}</span>
      <span class="alert-desc">${this.toMetricLabel(entry.kind)} · ${entry.status} · ${duration} — ${detail}</span>
    </div>`;
  }

  private toMetricLabel(kind: OperationSnapshot['kind']): string {
    const labels: Record<OperationSnapshot['kind'], string> = {
      'catalog-sync': 'Catálogo',
      'package-install': 'Instalação',
      'bundle-install': 'Bundles',
      'package-uninstall': 'Remoção',
      'health-check': 'Health',
      'custom-mcp-import': 'Importação MCP',
      'package-publish': 'Publicação',
    };

    return labels[kind];
  }
}
