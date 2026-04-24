/**
 * @module presentation/providers/HealthViewProvider
 * @description WebviewViewProvider for the Health Check sidebar panel.
 * Shows validation results with score, findings, and actionable fixes.
 */

import * as vscode from 'vscode';
import { WebviewHelper } from '../webview/WebviewHelper';
import { HealthCheckerService } from '../../infrastructure/services/HealthChecker';
import { HealthReport, HealthSeverity } from '../../domain/entities/HealthReport';

export class HealthViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dai-health';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _healthChecker: HealthCheckerService,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'runCheck') { await this.runAndRender(); }
    });

    this.renderInitial();
  }

  public async refresh(): Promise<void> { await this.runAndRender(); }

  private renderInitial(): void {
    if (!this._view) { return; }

    this._view.webview.html = WebviewHelper.buildHtml({
      webview: this._view.webview,
      extensionUri: this._extensionUri,
      title: 'DescomplicAI — Health Check',
      bodyContent: /*html*/`
      <div class="dai-container">
        <div class="dai-health-hero animate-fade-in">
          <div class="dai-health-icon-large">🩺</div>
          <h3 class="dai-health-title">Health Check da Infraestrutura</h3>
          <p class="dai-health-subtitle">Valide a integridade dos seus agents, skills, MCPs e instructions.</p>
          <button class="dai-btn dai-btn-primary dai-btn-lg" id="run-check">
            <span class="dai-btn-icon">▶</span> Executar Health Check
          </button>
        </div>
      </div>`,
      scriptContent: /*js*/`
      document.getElementById('run-check').addEventListener('click', () => {
        document.getElementById('run-check').classList.add('dai-btn-loading');
        document.getElementById('run-check').innerHTML = '<span class="dai-spinner"></span> Escaneando...';
        vscode.postMessage({ command: 'runCheck' });
      });`,
    });
  }

  private async runAndRender(): Promise<void> {
    if (!this._view) { return; }
    const report = await this._healthChecker.check();

    this._view.webview.html = WebviewHelper.buildHtml({
      webview: this._view.webview,
      extensionUri: this._extensionUri,
      title: 'DescomplicAI — Health Check',
      bodyContent: this.renderReport(report),
      scriptContent: /*js*/`
      document.getElementById('rerun-check')?.addEventListener('click', () => {
        vscode.postMessage({ command: 'runCheck' });
      });`,
    });
  }

  private renderReport(report: HealthReport): string {
    const scoreColor = report.score >= 90 ? 'var(--itau-success)'
      : report.score >= 60 ? 'var(--itau-warning)'
      : 'var(--itau-error)';

    const circumference = 2 * Math.PI * 40;
    const dashOffset = circumference - (report.score / 100) * circumference;

    return /*html*/`
    <div class="dai-container">
      <!-- Score Ring -->
      <div class="dai-health-score animate-scale-in">
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
      <div class="dai-health-stats animate-slide-in" style="--delay: 0.1s">
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
          <div class="dai-finding animate-slide-in ${severityClass}" style="--delay: ${(i + 2) * 0.06}s">
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
}
