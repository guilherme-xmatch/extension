/**
 * @module infrastructure/services/InsightsGenerator
 * @description Gera o InsightsReport analisando os pacotes instalados no momento.
 */

import { InsightsReport, CoverageMap, SecurityAlert } from '../../domain/entities/InsightsReport';
import { Package, InstallStatus } from '../../domain/entities/Package';
import { IPackageRepository, IWorkspaceScanner } from '../../domain/interfaces';

export class InsightsGenerator {
  constructor(
    private readonly _registry: IPackageRepository,
    private readonly _scanner: IWorkspaceScanner
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
    
    // Calcula a Cobertura
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

    // Calcula os Alertas de Segurança
    const securityAlerts: SecurityAlert[] = [];
    for (const agent of agents) {
      const tools = agent.agentMeta?.tools || [];
      const terminalAccess = tools.some(tool => this.isTerminalTool(tool));
      const fileEditAccess = tools.some(tool => this.isEditTool(tool));

      if (terminalAccess || fileEditAccess) {
        securityAlerts.push({
          agentName: agent.displayName,
          terminalAccess,
          fileEditAccess,
          isGuardianPresent: hasGuardian
        });
      }
    }

    // Calcula as Dependências Faltantes
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

  private isTerminalTool(tool: string): boolean {
    return [
      'execute',
      'runInTerminal',
      'bash',
      'terminal',
      'runCommands',
    ].includes(tool) || tool.startsWith('runCommands/');
  }

  private isEditTool(tool: string): boolean {
    return [
      'edit',
      'editFiles',
      'file-manager',
    ].includes(tool) || tool.startsWith('edit/');
  }
}
