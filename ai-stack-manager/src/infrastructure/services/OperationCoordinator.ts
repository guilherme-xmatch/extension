import * as vscode from 'vscode';
import { OperationContext, OperationDefinition, OperationMetricsSnapshot, OperationRefreshTarget, OperationSnapshot } from '../../domain/entities/Operation';
import { AppLogger } from './AppLogger';

export class OperationCoordinator implements vscode.Disposable {
  private static readonly HISTORY_LIMIT = 20;
  private static readonly STORAGE_KEY = 'dai.operationHistory';

  private readonly _onDidChangeCurrentOperation = new vscode.EventEmitter<OperationSnapshot | undefined>();
  private readonly _onDidFinishOperation = new vscode.EventEmitter<OperationSnapshot>();
  private readonly _logger = AppLogger.getInstance();

  private _currentOperation?: OperationSnapshot;
  private _queue: Promise<unknown> = Promise.resolve();
  private _refreshHandler?: (targets: ReadonlyArray<OperationRefreshTarget>) => Promise<void>;
  private _history: OperationSnapshot[] = [];
  private _context?: vscode.ExtensionContext;
  private _metrics = new Map<OperationSnapshot['kind'], {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    totalDurationMs: number;
    lastDurationMs?: number;
    lastRunAt?: number;
    lastErrorMessage?: string;
  }>();

  public readonly onDidChangeCurrentOperation = this._onDidChangeCurrentOperation.event;
  public readonly onDidFinishOperation = this._onDidFinishOperation.event;

  public getCurrentOperation(): OperationSnapshot | undefined {
    return this._currentOperation;
  }

  public getRecentOperations(limit = OperationCoordinator.HISTORY_LIMIT): ReadonlyArray<OperationSnapshot> {
    return this._history.slice(0, Math.max(0, limit));
  }

  public getMetrics(): ReadonlyArray<OperationMetricsSnapshot> {
    return [...this._metrics.entries()].map(([kind, metrics]) => ({
      kind,
      totalRuns: metrics.totalRuns,
      completedRuns: metrics.completedRuns,
      failedRuns: metrics.failedRuns,
      averageDurationMs: metrics.totalRuns > 0 ? Math.round(metrics.totalDurationMs / metrics.totalRuns) : 0,
      lastDurationMs: metrics.lastDurationMs,
      lastRunAt: metrics.lastRunAt,
      lastErrorMessage: metrics.lastErrorMessage,
    }));
  }

  public setRefreshHandler(handler: (targets: ReadonlyArray<OperationRefreshTarget>) => Promise<void>): void {
    this._refreshHandler = handler;
  }

  public initializePersistence(context: vscode.ExtensionContext): void {
    this._context = context;
    // Restore persisted history
    const stored = context.globalState.get<OperationSnapshot[]>(OperationCoordinator.STORAGE_KEY, []);
    // Merge stored (older) with current in-memory history, keeping most recent HISTORY_LIMIT
    this._history = [...this._history, ...stored]
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
      .slice(0, OperationCoordinator.HISTORY_LIMIT);
  }

  public async run<T>(definition: OperationDefinition, action: (context: OperationContext) => Promise<T>): Promise<T> {
    const execute = async (): Promise<T> => {
      const operationId = this.createOperationId(definition.kind);
      const baseSnapshot: OperationSnapshot = {
        id: operationId,
        kind: definition.kind,
        label: definition.label,
        targetId: definition.targetId,
        status: 'queued',
        startedAt: Date.now(),
        refreshTargets: Object.freeze([...(definition.refreshTargets ?? [])]),
      };

      this.publish(baseSnapshot);
      this._logger.info('OPERATION_QUEUED', { operationId, kind: definition.kind, targetId: definition.targetId });

      const context: OperationContext = {
        setProgress: (progress, message) => {
          const normalized = Math.max(0, Math.min(100, Math.round(progress)));
          this.publish({
            ...this._currentOperation,
            ...baseSnapshot,
            status: 'running',
            progress: normalized,
            message,
          });
        },
        setRefreshing: (message) => {
          this.publish({
            ...this._currentOperation,
            ...baseSnapshot,
            status: 'refreshing',
            progress: 100,
            message,
          });
        },
      };

      this.publish({
        ...baseSnapshot,
        status: 'running',
        progress: 0,
      });
      this._logger.info('OPERATION_STARTED', { operationId, kind: definition.kind, targetId: definition.targetId });

      try {
        const result = await action(context);
        if (baseSnapshot.refreshTargets.length > 0 && this._refreshHandler) {
          context.setRefreshing('Atualizando visualizações');
          await this._refreshHandler(baseSnapshot.refreshTargets);
        }

        const completed: OperationSnapshot = {
          ...this._currentOperation,
          ...baseSnapshot,
          status: 'completed',
          progress: 100,
          finishedAt: Date.now(),
        };
        this.finish(completed);
        this._logger.info('OPERATION_COMPLETED', { operationId, kind: definition.kind, targetId: definition.targetId });
        return result;
      } catch (error) {
        const failed: OperationSnapshot = {
          ...this._currentOperation,
          ...baseSnapshot,
          status: 'failed',
          progress: this._currentOperation?.progress,
          finishedAt: Date.now(),
          errorMessage: error instanceof Error ? error.message : String(error),
        };
        this.finish(failed);
        this._logger.error('OPERATION_FAILED', { operationId, kind: definition.kind, targetId: definition.targetId, error });
        throw error;
      }
    };

    if (definition.exclusive === false) {
      return execute();
    }

    const queued = this._queue.then(execute, execute);
    this._queue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  public dispose(): void {
    this._onDidChangeCurrentOperation.dispose();
    this._onDidFinishOperation.dispose();
  }

  private publish(snapshot: OperationSnapshot): void {
    this._currentOperation = snapshot;
    this._onDidChangeCurrentOperation.fire(snapshot);
  }

  private finish(snapshot: OperationSnapshot): void {
    this.pushHistory(snapshot);
    if (this._context) {
      void this._context.globalState.update(OperationCoordinator.STORAGE_KEY, this._history.slice(0, OperationCoordinator.HISTORY_LIMIT));
    }
    this.updateMetrics(snapshot);
    this._currentOperation = undefined;
    this._onDidFinishOperation.fire(snapshot);
    this._onDidChangeCurrentOperation.fire(undefined);
  }

  private pushHistory(snapshot: OperationSnapshot): void {
    this._history = [snapshot, ...this._history].slice(0, OperationCoordinator.HISTORY_LIMIT);
  }

  private updateMetrics(snapshot: OperationSnapshot): void {
    const current = this._metrics.get(snapshot.kind) ?? {
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      totalDurationMs: 0,
    };
    const durationMs = snapshot.finishedAt ? Math.max(0, snapshot.finishedAt - snapshot.startedAt) : 0;

    current.totalRuns += 1;
    current.totalDurationMs += durationMs;
    current.lastDurationMs = durationMs;
    current.lastRunAt = snapshot.finishedAt ?? snapshot.startedAt;
    current.lastErrorMessage = snapshot.errorMessage;

    if (snapshot.status === 'completed') {
      current.completedRuns += 1;
    }

    if (snapshot.status === 'failed') {
      current.failedRuns += 1;
    }

    this._metrics.set(snapshot.kind, current);
  }

  private createOperationId(kind: OperationDefinition['kind']): string {
    return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}