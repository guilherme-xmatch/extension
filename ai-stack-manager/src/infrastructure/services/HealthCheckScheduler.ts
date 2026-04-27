/**
 * @module infrastructure/services/HealthCheckScheduler
 * @description Executa verificações periódicas de saúde em segundo plano na infraestrutura de AI do workspace.
 *
 * ## Responsabilidades
 * - Agendar chamadas automáticas a `HealthCheckerService.check()` em um intervalo configurável
 * - Persistir `lastRunTime` em `ExtensionContext.globalState` para que o intervalo
 *   sobreviva a reinicializações do VS Code (a próxima execução ocorre somente após o intervalo completo)
 * - Notificar o usuário quando novos erros críticos aparecerem (sem spam)
 * - Expor o último relatório e um método `runNow()` para acionamento manual / por comando
 * - Ser totalmente disponsível (seguro chamar `dispose()` na desativação)
 *
 * ## Configuração
 * Lê `descomplicai.healthCheckIntervalHours` (padrão `6`).
 * Definir o valor como `0` desativa o agendamento automático.
 */

import * as vscode from 'vscode';
import { IHealthChecker } from '../../domain/interfaces';
import { HealthReport, HealthSeverity } from '../../domain/entities/HealthReport';
import { AppLogger } from './AppLogger';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Interface mínima para a status bar, mantendo este serviço testável */
export interface IStatusBarBridge {
  setWorking(task: string): void;
  setSuccess(message: string): void;
  setError(message: string): void;
  setIdle(): void;
}

/** Snapshot persistido em globalState */
interface PersistedState {
  lastRunTime: number;   // timestamp Unix (ms)
  lastErrorCount: number;
}

const STATE_KEY = 'descomplicai.scheduler.state';

// ─── Scheduler ────────────────────────────────────────────────────────────────

export class HealthCheckScheduler {
  private _timer?: ReturnType<typeof setInterval>;
  private _lastReport?: HealthReport;
  private _logger = AppLogger.getInstance();
  private _isRunning = false;

  constructor(
    private readonly _checker:    IHealthChecker,
    private readonly _context:    vscode.ExtensionContext,
    private readonly _statusBar?: IStatusBarBridge,
  ) {}

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Inicia o agendador periódico.
   *
   * @param intervalMs Milissegundos entre execuções agendadas. 0 = desativado.
   *
   * Na inicialização:
   * 1. Verifica no `globalState` quando foi a última execução.
   * 2. Se mais de `intervalMs` passou desde a última execução, dispara imediatamente.
   * 3. Agenda execuções futuras em `intervalMs`.
   */
  public start(intervalMs: number): void {
    if (intervalMs <= 0) {
      this._logger.info('[HealthCheckScheduler] Auto-schedule disabled (intervalMs=0)');
      return;
    }

    const state = this._loadState();
    const elapsed = Date.now() - (state?.lastRunTime ?? 0);
    const delay = elapsed >= intervalMs ? 3_000 : intervalMs - elapsed;

    this._logger.info(`[HealthCheckScheduler] Next run in ${Math.round(delay / 1000)}s`);

    // Primeira execução (possivelmente adiada 3 s se obsoleta, ou adiada para o próximo intervalo)
    setTimeout(() => {
      void this._runChecked();
      this._timer = setInterval(() => void this._runChecked(), intervalMs);
    }, delay);
  }

  /** Força uma verificação de saúde imediata, ignorando o timer. */
  public async runNow(): Promise<HealthReport> {
    return this._runChecked();
  }

  /** Relatório de saúde mais recente, ou undefined se nenhuma execução foi concluída. */
  public get lastReport(): HealthReport | undefined {
    return this._lastReport;
  }

  /** Timestamp da execução mais recente concluída. */
  public get lastRunTime(): Date | undefined {
    const state = this._loadState();
    return state ? new Date(state.lastRunTime) : undefined;
  }

  /** Indica se uma verificação está em andamento. */
  public get isRunning(): boolean {
    return this._isRunning;
  }

  public dispose(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private async _runChecked(): Promise<HealthReport> {
    if (this._isRunning) {
      this._logger.warn('[HealthCheckScheduler] Check already in progress — skipping');
      return this._lastReport ?? HealthReport.create([], 0);
    }

    this._isRunning = true;
    this._statusBar?.setWorking('Checando infraestrutura…');

    try {
      const report = await this._checker.check();
      this._lastReport = report;
      this._handleResult(report);
      this._persistState(report);
      return report;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._logger.error('[HealthCheckScheduler] Check failed', err as Error);
      this._statusBar?.setError(`Health check falhou: ${msg}`);
      return HealthReport.create([], 0);
    } finally {
      this._isRunning = false;
    }
  }

  private _handleResult(report: HealthReport): void {
    const errorCount = report.errors.length;
    const warnCount  = report.warnings.length;
    const prev       = this._loadState();

    if (errorCount === 0 && warnCount === 0) {
      this._statusBar?.setSuccess('Infraestrutura saudável ✓');
      return;
    }

    // Barra de status
    if (errorCount > 0) {
      this._statusBar?.setError(`${errorCount} erro(s) na infra`);
    } else {
      this._statusBar?.setSuccess(`${warnCount} aviso(s) na infra`);
    }

    // Notifica somente quando os erros são novos (contagem aumentou vs. última execução)
    const prevErrors = prev?.lastErrorCount ?? 0;
    if (errorCount > prevErrors) {
      const titles = report.errors.slice(0, 3).map(f => f.title).join(', ');
      void vscode.window.showWarningMessage(
        `🔴 DescomplicAI Health: ${errorCount} problema(s) crítico(s) encontrado(s). ${titles}`,
        'Ver Relatório',
        'Ignorar',
      ).then(choice => {
        if (choice === 'Ver Relatório') {
          void vscode.commands.executeCommand('dai-health.focus');
        }
      });
    }
  }

  private _persistState(report: HealthReport): void {
    const state: PersistedState = {
      lastRunTime:   Date.now(),
      lastErrorCount: report.errors.length,
    };
    void this._context.globalState.update(STATE_KEY, state);
  }

  private _loadState(): PersistedState | undefined {
    return this._context.globalState.get<PersistedState>(STATE_KEY);
  }
}

// ─── Auxiliar de configuração ────────────────────────────────────────────────────────────

/** Lê o intervalo configurado (em ms) para o agendador de health check. */
export function getSchedulerIntervalMs(): number {
  const hours = vscode.workspace.getConfiguration('descomplicai')
    .get<number>('healthCheckIntervalHours', 6);
  if (!hours || hours <= 0) { return 0; }
  return hours * 60 * 60 * 1000;
}
