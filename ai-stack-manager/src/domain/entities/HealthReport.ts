/**
 * @module domain/entities/HealthReport
 * @description Result of a health check validation on the workspace's AI infrastructure.
 * Contains individual check results with severity, message, and actionable fix.
 */

/** Severity levels for health check findings */
export enum HealthSeverity {
  /** Everything is fine */
  Ok = 'ok',
  /** Non-critical recommendation */
  Info = 'info',
  /** Potential issue that may cause problems */
  Warning = 'warning',
  /** Critical problem that will cause failures */
  Error = 'error',
}

/** A single health check finding */
export interface HealthFinding {
  readonly id: string;
  readonly severity: HealthSeverity;
  readonly category: 'agent' | 'skill' | 'mcp' | 'instruction' | 'general';
  readonly title: string;
  readonly message: string;
  readonly filePath?: string;
  readonly fix?: string;
  readonly autoFixable: boolean;
}

/** Aggregate health report for the workspace */
export class HealthReport {
  private constructor(
    public readonly findings: ReadonlyArray<HealthFinding>,
    public readonly timestamp: Date,
    public readonly scanDurationMs: number,
  ) {}

  static create(
    findings: HealthFinding[],
    scanDurationMs: number,
  ): HealthReport {
    return new HealthReport(
      Object.freeze([...findings]),
      new Date(),
      scanDurationMs,
    );
  }

  /** Overall health score (0-100) */
  get score(): number {
    if (this.findings.length === 0) { return 100; }
    const errorCount = this.errors.length;
    const warningCount = this.warnings.length;
    const penalty = errorCount * 20 + warningCount * 5;
    return Math.max(0, 100 - penalty);
  }

  /** Overall status emoji */
  get statusEmoji(): string {
    if (this.score >= 90) { return '🟢'; }
    if (this.score >= 60) { return '🟡'; }
    return '🔴';
  }

  /** Overall status label */
  get statusLabel(): string {
    if (this.score >= 90) { return 'Healthy'; }
    if (this.score >= 60) { return 'Needs Attention'; }
    return 'Critical Issues';
  }

  get errors(): ReadonlyArray<HealthFinding> {
    return this.findings.filter(f => f.severity === HealthSeverity.Error);
  }

  get warnings(): ReadonlyArray<HealthFinding> {
    return this.findings.filter(f => f.severity === HealthSeverity.Warning);
  }

  get infos(): ReadonlyArray<HealthFinding> {
    return this.findings.filter(f => f.severity === HealthSeverity.Info);
  }

  get autoFixableCount(): number {
    return this.findings.filter(f => f.autoFixable).length;
  }
}
