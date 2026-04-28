/**
 * @module domain/entities/InsightsReport
 * @description Entidades e tipos para o Insights Engine (Fase 2).
 */

export interface CoverageMap {
  triage: boolean;
  plan: boolean;
  design: boolean;
  execute: boolean;
  validate: boolean;
  critic: boolean;
}

export interface SecurityAlert {
  agentName: string;
  terminalAccess: boolean;
  fileEditAccess: boolean;
  isGuardianPresent: boolean;
}

export interface UxRegressionSignal {
  id: string;
  title: string;
  summary: string;
  severity: 'info' | 'warning' | 'error';
  count: number;
  lastOccurredAt?: string;
}

export interface UxRepeatedAction {
  id: string;
  title: string;
  summary: string;
  count: number;
  threshold: number;
  lastOccurredAt?: string;
}

export interface UxDiagnosticsSummary {
  enabled: boolean;
  trackedFlows: number;
  regressions: UxRegressionSignal[];
  repeatedActions: UxRepeatedAction[];
}

export interface InsightsReport {
  installedAgentsCount: number;
  coverage: CoverageMap;
  coverageScore: number; // 0 a 100
  securityAlerts: SecurityAlert[];
  missingDependencies: string[];
  uxDiagnostics?: UxDiagnosticsSummary;
}
