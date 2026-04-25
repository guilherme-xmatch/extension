export type OperationKind =
  | 'catalog-sync'
  | 'package-install'
  | 'bundle-install'
  | 'package-uninstall'
  | 'health-check'
  | 'custom-mcp-import'
  | 'package-publish';

export type OperationStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'refreshing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type OperationRefreshTarget = 'catalog' | 'installed' | 'health';

export interface OperationSnapshot {
  readonly id: string;
  readonly kind: OperationKind;
  readonly label: string;
  readonly status: OperationStatus;
  readonly targetId?: string;
  readonly progress?: number;
  readonly message?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly errorMessage?: string;
  readonly refreshTargets: ReadonlyArray<OperationRefreshTarget>;
}

export interface OperationMetricsSnapshot {
  readonly kind: OperationKind;
  readonly totalRuns: number;
  readonly completedRuns: number;
  readonly failedRuns: number;
  readonly averageDurationMs: number;
  readonly lastDurationMs?: number;
  readonly lastRunAt?: number;
  readonly lastErrorMessage?: string;
}

export interface OperationDefinition {
  readonly kind: OperationKind;
  readonly label: string;
  readonly targetId?: string;
  readonly refreshTargets?: ReadonlyArray<OperationRefreshTarget>;
  readonly exclusive?: boolean;
}

export interface OperationContext {
  setProgress(progress: number, message?: string): void;
  setRefreshing(message?: string): void;
}