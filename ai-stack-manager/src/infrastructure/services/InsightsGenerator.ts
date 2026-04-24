/**
 * @module infrastructure/services/InsightsGenerator
 * @description Generates the InsightsReport by analyzing the currently installed packages.
 */

import { InsightsReport, CoverageMap, SecurityAlert } from '../../domain/entities/InsightsReport';
import { Package, InstallStatus } from '../../domain/entities/Package';
import { LocalRegistry } from '../repositories/LocalRegistry';
import { WorkspaceScanner } from './WorkspaceScanner';

export class InsightsGenerator {
  constructor(
    private readonly _registry: LocalRegistry,
    private readonly _scanner: WorkspaceScanner
  ) {}

  public async generateReport(): Promise<InsightsReport> {
    const allPackages = await this._registry.getAll();
    const installedPackages: Package[] = [];

    for (const pkg of allPackages) {
      const status = await this._scanner.getInstallStatus(pkg);
      if (status === InstallStatus.Installed || status === InstallStatus.Partial) {
        installedPackages.push(pkg);
      }
    }

    const agents = installedPackages.filter(p => p.isAgent);
    
    // Calculate Coverage
    const coverage: CoverageMap = {
      triage: false, plan: false, design: false, execute: false, validate: false, critic: false
    };

    let hasGuardian = false;
    const orchestrators: Package[] = [];

    for (const agent of agents) {
      const phase = agent.agentMeta?.workflowPhase?.toLowerCase() || '';
      if (phase.includes('triage') || phase.includes('orchestrator')) { coverage.triage = true; orchestrators.push(agent); }
      if (phase.includes('plan')) coverage.plan = true;
      if (phase.includes('design') || phase.includes('architect')) coverage.design = true;
      if (phase.includes('execute') || phase.includes('specialist')) coverage.execute = true;
      if (phase.includes('validate') || phase.includes('test')) coverage.validate = true;
      if (phase.includes('critic') || phase.includes('reviewer')) { coverage.critic = true; hasGuardian = true; }
    }

    const coverageValues = Object.values(coverage);
    const coverageScore = Math.round((coverageValues.filter(Boolean).length / coverageValues.length) * 100);

    // Calculate Security Alerts
    const securityAlerts: SecurityAlert[] = [];
    for (const agent of agents) {
      const tools = agent.agentMeta?.tools || [];
      const terminalAccess = tools.includes('runInTerminal');
      const fileEditAccess = tools.includes('editFiles');

      if (terminalAccess || fileEditAccess) {
        securityAlerts.push({
          agentName: agent.displayName,
          terminalAccess,
          fileEditAccess,
          isGuardianPresent: hasGuardian
        });
      }
    }

    // Calculate Missing Dependencies
    const missingDependencies: string[] = [];
    for (const orch of orchestrators) {
      const delegates = orch.agentMeta?.delegatesTo || [];
      for (const d of delegates) {
        const isInstalled = agents.some(a => a.name === d);
        if (!isInstalled && !missingDependencies.includes(d)) {
          missingDependencies.push(d);
        }
      }
    }

    return {
      installedAgentsCount: agents.length,
      coverage,
      coverageScore,
      securityAlerts,
      missingDependencies
    };
  }
}
