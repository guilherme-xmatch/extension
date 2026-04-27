/**
 * @module infrastructure/services/HealthCheckScheduler
 * @description Runs periodic background health checks on the workspace's AI infrastructure.
 *
 * ## Responsibilities
 * - Schedule automatic `HealthCheckerService.check()` calls on a configurable interval
 * - Persist `lastRunTime` to `ExtensionContext.globalState` so the interval
 *   survives VS Code restarts (next run fires only when the full interval has elapsed)
 * - Notify the user when new error-level findings appear (without spamming)
 * - Expose the last report and a `runNow()` method for manual / command triggers
 * - Be fully disposable (safe to call `dispose()` on deactivation)
 *
 * ## Configuration
 * Reads `descomplicai.healthCheckIntervalHours` (default `6`).
 * Setting the value to `0` disables automatic scheduling.
 */

import * as vscode from 'vscode';
import { IHealthChecker } from '../../domain/interfaces';
import { HealthReport, HealthSeverity } from '../../domain/entities/HealthReport';
import { AppLogger } from './AppLogger';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal interface for the status bar so this service remains testable */
export interface IStatusBarBridge {
  setWorking(task: string): void;
  setSuccess(message: string): void;
  setError(message: string): void;
  setIdle(): void;
}

/** Snapshot persisted to globalState */
interface PersistedState {
  lastRunTime: number;   // Unix timestamp (ms)
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
   * Start the periodic scheduler.
   *
   * @param intervalMs Milliseconds between scheduled runs. 0 = disabled.
   *
   * On start:
   * 1. Checks `globalState` for when the last run happened.
   * 2. If more than `intervalMs` has elapsed since the last run, fires immediately.
   * 3. Schedules future runs at `intervalMs`.
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

    // First run (possibly deferred by 3 s if stale, or deferred to next interval)
    setTimeout(() => {
      void this._runChecked();
      this._timer = setInterval(() => void this._runChecked(), intervalMs);
    }, delay);
  }

  /** Force an immediate health check, bypassing the timer. */
  public async runNow(): Promise<HealthReport> {
    return this._runChecked();
  }

  /** Most recent health report, or undefined if no run has completed yet. */
  public get lastReport(): HealthReport | undefined {
    return this._lastReport;
  }

  /** Timestamp of the most recent completed run. */
  public get lastRunTime(): Date | undefined {
    const state = this._loadState();
    return state ? new Date(state.lastRunTime) : undefined;
  }

  /** Whether a check is currently in progress. */
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

    // Status bar
    if (errorCount > 0) {
      this._statusBar?.setError(`${errorCount} erro(s) na infra`);
    } else {
      this._statusBar?.setSuccess(`${warnCount} aviso(s) na infra`);
    }

    // Notify only when errors are new (count increased vs. last run)
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

// ─── Config helper ────────────────────────────────────────────────────────────

/** Read the configured interval (in ms) for the health check scheduler. */
export function getSchedulerIntervalMs(): number {
  const hours = vscode.workspace.getConfiguration('descomplicai')
    .get<number>('healthCheckIntervalHours', 6);
  if (!hours || hours <= 0) { return 0; }
  return hours * 60 * 60 * 1000;
}
