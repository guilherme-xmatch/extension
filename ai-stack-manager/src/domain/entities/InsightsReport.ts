/**
 * @module domain/entities/InsightsReport
 * @description Entities and types for the Insights Engine (Phase 2).
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

export interface InsightsReport {
  installedAgentsCount: number;
  coverage: CoverageMap;
  coverageScore: number; // 0 to 100
  securityAlerts: SecurityAlert[];
  missingDependencies: string[];
}
