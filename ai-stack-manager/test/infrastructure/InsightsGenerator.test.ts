/**
 * Tests for InsightsGenerator and GitHubMetricsService.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { InsightsGenerator } from '../../src/infrastructure/services/InsightsGenerator';
import { GitHubMetricsService } from '../../src/infrastructure/services/GitHubMetricsService';
import { Package, InstallStatus } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { IPackageRepository, IWorkspaceScanner } from '../../src/domain/interfaces';
import { AppLogger } from '../../src/infrastructure/services/AppLogger';
import { setConfigurationValue, setAuthenticationSession } from '../setup/vscode.mock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const notInstalledScanner: IWorkspaceScanner = {
  getInstallStatus: async () => InstallStatus.NotInstalled,
  getInstalledPackageIds: async () => [],
  hasGitHubDirectory: async () => false,
  detectProjectProfile: async () => [],
};

const alwaysInstalledScanner: IWorkspaceScanner = {
  ...notInstalledScanner,
  getInstallStatus: async () => InstallStatus.Installed,
};

const partiallyInstalledScanner: IWorkspaceScanner = {
  ...notInstalledScanner,
  getInstallStatus: async () => InstallStatus.Partial,
};

const emptyRegistry: IPackageRepository = {
  getAll: async () => [],
  findById: async () => undefined,
  search: async () => [],
  getAllBundles: async () => [],
  findBundleById: async () => undefined,
  getAgentNetwork: async () => [],
  getRelatedSkills: async () => [],
};

const makeAgent = (id: string, overrides?: Partial<Parameters<typeof Package.create>[0]>) =>
  Package.create({
    id,
    name: id,
    displayName: id,
    description: 'Test agent',
    type: PackageType.Agent,
    version: '1.0.0',
    tags: [],
    author: 'test',
    files: [],
    ...overrides,
  });

// ─── InsightsGenerator ───────────────────────────────────────────────────────

describe('InsightsGenerator', () => {
  it('retorna relatório vazio quando não há pacotes instalados', async () => {
    const gen = new InsightsGenerator(emptyRegistry, notInstalledScanner);
    const report = await gen.generateReport();

    expect(report.installedAgentsCount).toBe(0);
    expect(report.coverageScore).toBe(0);
    expect(report.securityAlerts).toHaveLength(0);
    expect(report.missingDependencies).toHaveLength(0);
    expect(Object.values(report.coverage).every(v => v === false)).toBe(true);
  });

  it('conta apenas agents instalados (Installed + Partial)', async () => {
    const agent = makeAgent('agent-backend');
    const skill = Package.create({
      id: 'skill-api',
      name: 'api',
      displayName: 'API',
      description: 'skill',
      type: PackageType.Skill,
      version: '1.0.0',
      tags: [],
      author: 'test',
      files: [],
    });

    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent, skill] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    // Skill não é agent, então installedAgentsCount = 1
    expect(report.installedAgentsCount).toBe(1);
  });

  it('inclui pacotes Partial como instalados', async () => {
    const agent = makeAgent('agent-partial');
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, partiallyInstalledScanner);
    const report = await gen.generateReport();

    expect(report.installedAgentsCount).toBe(1);
  });

  it('não conta pacotes NotInstalled', async () => {
    const agent = makeAgent('agent-missing');
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, notInstalledScanner);
    const report = await gen.generateReport();

    expect(report.installedAgentsCount).toBe(0);
  });

  it('coverage.triage = true para agent com workflowPhase "orchestrator"', async () => {
    const agent = makeAgent('agent-orch', {
      agentMeta: { workflowPhase: 'orchestrator', delegatesTo: [], relatedSkills: [], tools: [], category: 'orchestrator' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    expect(report.coverage.triage).toBe(true);
  });

  it('coverage.triage = true para workflowPhase "triage"', async () => {
    const agent = makeAgent('agent-triage', {
      agentMeta: { workflowPhase: 'triage', delegatesTo: [], relatedSkills: [], tools: [], category: 'specialist' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();
    expect(report.coverage.triage).toBe(true);
  });

  it('coverage.plan = true para workflowPhase "plan"', async () => {
    const agent = makeAgent('agent-plan', {
      agentMeta: { workflowPhase: 'plan', delegatesTo: [], relatedSkills: [], tools: [], category: 'planner' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();
    expect(report.coverage.plan).toBe(true);
  });

  it('coverage.design = true para workflowPhase "architect"', async () => {
    const agent = makeAgent('agent-arch', {
      agentMeta: { workflowPhase: 'architect', delegatesTo: [], relatedSkills: [], tools: [], category: 'specialist' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();
    expect(report.coverage.design).toBe(true);
  });

  it('coverage.execute = true para workflowPhase "specialist"', async () => {
    const agent = makeAgent('agent-spec', {
      agentMeta: { workflowPhase: 'specialist', delegatesTo: [], relatedSkills: [], tools: [], category: 'specialist' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();
    expect(report.coverage.execute).toBe(true);
  });

  it('coverage.validate = true para workflowPhase "test"', async () => {
    const agent = makeAgent('agent-test', {
      agentMeta: { workflowPhase: 'test', delegatesTo: [], relatedSkills: [], tools: [], category: 'guardian' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();
    expect(report.coverage.validate).toBe(true);
  });

  it('coverage.critic = true para workflowPhase "critic"', async () => {
    const agent = makeAgent('agent-critic', {
      agentMeta: { workflowPhase: 'critic', delegatesTo: [], relatedSkills: [], tools: [], category: 'guardian' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();
    expect(report.coverage.critic).toBe(true);
  });

  it('coverageScore é 100 quando todas as dimensões estão cobertas', async () => {
    const agents = [
      makeAgent('a1', { agentMeta: { workflowPhase: 'triage', delegatesTo: [], relatedSkills: [], tools: [], category: 'orchestrator' } }),
      makeAgent('a2', { agentMeta: { workflowPhase: 'plan', delegatesTo: [], relatedSkills: [], tools: [], category: 'planner' } }),
      makeAgent('a3', { agentMeta: { workflowPhase: 'design', delegatesTo: [], relatedSkills: [], tools: [], category: 'specialist' } }),
      makeAgent('a4', { agentMeta: { workflowPhase: 'execute', delegatesTo: [], relatedSkills: [], tools: [], category: 'specialist' } }),
      makeAgent('a5', { agentMeta: { workflowPhase: 'validate', delegatesTo: [], relatedSkills: [], tools: [], category: 'guardian' } }),
      makeAgent('a6', { agentMeta: { workflowPhase: 'critic', delegatesTo: [], relatedSkills: [], tools: [], category: 'guardian' } }),
    ];
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => agents };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();
    expect(report.coverageScore).toBe(100);
  });

  it('emite securityAlert quando agent tem ferramenta de terminal', async () => {
    const agent = makeAgent('agent-terminal', {
      agentMeta: { workflowPhase: 'execute', delegatesTo: [], relatedSkills: [], tools: ['runInTerminal'], category: 'specialist' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    expect(report.securityAlerts).toHaveLength(1);
    expect(report.securityAlerts[0].terminalAccess).toBe(true);
    expect(report.securityAlerts[0].fileEditAccess).toBe(false);
  });

  it('emite securityAlert quando agent tem ferramenta de edição de arquivo', async () => {
    const agent = makeAgent('agent-edit', {
      agentMeta: { workflowPhase: 'execute', delegatesTo: [], relatedSkills: [], tools: ['editFiles'], category: 'specialist' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    expect(report.securityAlerts[0].fileEditAccess).toBe(true);
  });

  it('isGuardianPresent = true quando há agent critic presente', async () => {
    const agents = [
      makeAgent('agent-exec', { agentMeta: { workflowPhase: 'execute', delegatesTo: [], relatedSkills: [], tools: ['execute'], category: 'specialist' } }),
      makeAgent('agent-guard', { agentMeta: { workflowPhase: 'critic', delegatesTo: [], relatedSkills: [], tools: [], category: 'guardian' } }),
    ];
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => agents };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    expect(report.securityAlerts[0].isGuardianPresent).toBe(true);
  });

  it('detects ferramenta por prefixo runCommands/', async () => {
    const agent = makeAgent('agent-run', {
      agentMeta: { workflowPhase: 'execute', delegatesTo: [], relatedSkills: [], tools: ['runCommands/bash'], category: 'specialist' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    expect(report.securityAlerts[0].terminalAccess).toBe(true);
  });

  it('detects ferramenta por prefixo edit/', async () => {
    const agent = makeAgent('agent-edit-prefix', {
      agentMeta: { workflowPhase: 'execute', delegatesTo: [], relatedSkills: [], tools: ['edit/typescript'], category: 'specialist' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    expect(report.securityAlerts[0].fileEditAccess).toBe(true);
  });

  it('identifica missingDependencies quando delegate não está instalado', async () => {
    const orchestrator = makeAgent('agent-orch', {
      agentMeta: {
        workflowPhase: 'orchestrator',
        delegatesTo: ['backend-specialist', 'frontend-specialist'],
        relatedSkills: [],
        tools: [],
        category: 'orchestrator',
      },
    });
    // Nenhum delegate instalado
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [orchestrator] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    expect(report.missingDependencies).toContain('backend-specialist');
    expect(report.missingDependencies).toContain('frontend-specialist');
  });

  it('não duplica missingDependencies quando mesmo delegate referenciado 2 vezes', async () => {
    const orch1 = makeAgent('agent-orch1', {
      agentMeta: { workflowPhase: 'orchestrator', delegatesTo: ['missing-dep'], relatedSkills: [], tools: [], category: 'orchestrator' },
    });
    const orch2 = makeAgent('agent-orch2', {
      agentMeta: { workflowPhase: 'orchestrator', delegatesTo: ['missing-dep'], relatedSkills: [], tools: [], category: 'orchestrator' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [orch1, orch2] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    const occurrences = report.missingDependencies.filter(d => d === 'missing-dep');
    expect(occurrences).toHaveLength(1);
  });

  it('não adiciona missingDependency se delegate estiver instalado', async () => {
    const orchestrator = makeAgent('agent-orch', {
      agentMeta: { workflowPhase: 'orchestrator', delegatesTo: ['backend'], relatedSkills: [], tools: [], category: 'orchestrator' },
    });
    const delegate = makeAgent('backend');
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [orchestrator, delegate] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    expect(report.missingDependencies).not.toContain('backend');
  });

  it('não emite securityAlert para agent sem ferramentas de risco', async () => {
    const agent = makeAgent('safe-agent', {
      agentMeta: { workflowPhase: 'plan', delegatesTo: [], relatedSkills: [], tools: ['read', 'search'], category: 'planner' },
    });
    const registry: IPackageRepository = { ...emptyRegistry, getAll: async () => [agent] };
    const gen = new InsightsGenerator(registry, alwaysInstalledScanner);
    const report = await gen.generateReport();

    expect(report.securityAlerts).toHaveLength(0);
  });
});

// ─── GitHubMetricsService ────────────────────────────────────────────────────

describe('GitHubMetricsService', () => {
  let logger: AppLogger;

  beforeEach(() => {
    try { AppLogger.getInstance().dispose(); } catch { /* já limpo */ }
    logger = AppLogger.getInstance();
  });

  afterEach(() => {
    logger.dispose();
    setConfigurationValue('descomplicai.metrics.enabled', false);
    setAuthenticationSession(undefined);
  });

  const makePkg = () => Package.create({
    id: 'agent-backend',
    name: 'backend',
    displayName: 'Backend',
    description: 'test',
    type: PackageType.Agent,
    version: '1.0.0',
    tags: [],
    author: 'test',
    files: [],
  });

  it('não faz nada quando metrics.enabled = false (default)', async () => {
    // enabled is false by default — nothing should throw
    const service = new GitHubMetricsService();
    await expect(service.trackInstall(makePkg())).resolves.not.toThrow();
  });

  it('não faz nada quando owner/repo não estão configurados', async () => {
    setConfigurationValue('descomplicai.metrics.enabled', true);
    // owner e repo vazios por padrão
    const service = new GitHubMetricsService();
    await expect(service.trackInstall(makePkg())).resolves.not.toThrow();
  });

  it('não faz nada quando session é nula (não autenticado)', async () => {
    setConfigurationValue('descomplicai.metrics.enabled', true);
    setConfigurationValue('descomplicai.metrics.collectorOwner', 'my-org');
    setConfigurationValue('descomplicai.metrics.collectorRepo', 'metrics');
    setAuthenticationSession(undefined); // sem session

    const service = new GitHubMetricsService();
    await expect(service.trackInstall(makePkg())).resolves.not.toThrow();
  });

  it('captura exceções de rede silenciosamente (swallows errors)', async () => {
    setConfigurationValue('descomplicai.metrics.enabled', true);
    setConfigurationValue('descomplicai.metrics.collectorOwner', 'my-org');
    setConfigurationValue('descomplicai.metrics.collectorRepo', 'metrics');
    setAuthenticationSession('fake-token');

    // fetchJson vai falhar porque não há API real
    const service = new GitHubMetricsService();
    // Não deve lançar — apenas logar o warn
    await expect(service.trackInstall(makePkg())).resolves.not.toThrow();
  });
});
