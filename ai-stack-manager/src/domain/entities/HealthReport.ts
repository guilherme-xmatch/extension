/**
 * @module domain/entities/HealthReport
 * @description Resultado de uma verificação de saúde na infraestrutura de AI do workspace.
 * Contém resultados individuais de verificação com severidade, mensagem e correção acionável.
 */

/** Níveis de severidade para os resultados de verificação de saúde. */
export enum HealthSeverity {
  /** Tudo está bem. */
  Ok = 'ok',
  /** Recomendação não crítica. */
  Info = 'info',
  /** Problema potencial que pode causar falhas. */
  Warning = 'warning',
  /** Problema crítico que causará falhas. */
  Error = 'error',
}

/** Um único resultado de verificação de saúde. */
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

/** Relatório agregado de saúde do workspace. */
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

  /** Pontuação geral de saúde (0–100). */
  get score(): number {
    if (this.findings.length === 0) { return 100; }
    const errorCount = this.errors.length;
    const warningCount = this.warnings.length;
    const penalty = errorCount * 20 + warningCount * 5;
    return Math.max(0, 100 - penalty);
  }

  /** Emoji do status geral. */
  get statusEmoji(): string {
    if (this.score >= 90) { return '🟢'; }
    if (this.score >= 60) { return '🟡'; }
    return '🔴';
  }

  /** Rótulo do status geral. */
  get statusLabel(): string {
    if (this.score >= 90) { return 'Saudável'; }
    if (this.score >= 60) { return 'Precisa de Atenção'; }
    return 'Problemas Críticos';
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
