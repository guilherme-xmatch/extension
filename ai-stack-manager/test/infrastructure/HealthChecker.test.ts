import { HealthCheckerService } from '../../src/infrastructure/services/HealthChecker';
import { Package, InstallStatus } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { HealthSeverity } from '../../src/domain/entities/HealthReport';
import { IPackageRepository, IWorkspaceScanner } from '../../src/domain/interfaces';
import { setWorkspaceRoot } from '../setup/vscode.mock';
import { createTempWorkspace } from '../setup/tempWorkspace';

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const emptyRegistry: IPackageRepository = {
  getAll: async () => [],
  findById: async () => undefined,
  search: async () => [],
  getAllBundles: async () => [],
  findBundleById: async () => undefined,
  getAgentNetwork: async () => [],
  getRelatedSkills: async () => [],
};

const notInstalledScanner: IWorkspaceScanner = {
  getInstallStatus: async () => InstallStatus.NotInstalled,
  getInstalledPackageIds: async () => [],
  hasGitHubDirectory: async () => false,
  detectProjectProfile: async () => [],
};

const installedScanner: IWorkspaceScanner = {
  ...notInstalledScanner,
  getInstallStatus: async () => InstallStatus.Installed,
};

const makeMcpPkg = (overrides?: Partial<Parameters<typeof Package.create>[0]>) =>
  Package.create({
    id: 'mcp-custom',
    name: 'custom-mcp',
    displayName: 'Custom MCP',
    description: 'Custom',
    type: PackageType.MCP,
    version: '1.0.0',
    tags: ['mcp'],
    author: 'Community',
    files: [{ relativePath: '.vscode/mcp.json', content: '{"servers":{}}' }],
    source: { official: true, manifestPath: 'mcps/custom-mcp/manifest.json' },
    installStrategy: { kind: 'mcp-merge', targets: [{ path: '.vscode/mcp.json', mergeStrategy: 'merge-servers' }] },
    ui: { longDescription: 'A real description', highlights: [], installNotes: [], badges: [], maturity: 'stable' },
    ...overrides,
  });

// â”€â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('HealthCheckerService', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    await cleanup?.();
    cleanup = undefined;
  });

  // â”€â”€â”€ No workspace â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('retorna finding no-workspace quando nÃ£o hÃ¡ workspace aberto', async () => {
    setWorkspaceRoot(undefined);
    const checker = new HealthCheckerService();
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'no-workspace')).toBe(true);
    expect(report.findings[0].severity).toBe(HealthSeverity.Error);
  });

  // â”€â”€â”€ all-good â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('retorna finding all-good quando workspace estÃ¡ vazio e saudÃ¡vel', async () => {
    const workspace = await createTempWorkspace({
      '.github/.keep': '',
      '.vscode/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'all-good')).toBe(true);
  });

  // â”€â”€â”€ checkGitHubDir â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('emite warning no-github-dir quando .github nÃ£o existe', async () => {
    const workspace = await createTempWorkspace({});
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'no-github-dir')).toBe(true);
  });

  it('emite info no-vscode-dir quando .vscode nÃ£o existe mas .github existe', async () => {
    const workspace = await createTempWorkspace({
      '.github/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'no-vscode-dir')).toBe(true);
    expect(report.findings.find(f => f.id === 'no-vscode-dir')?.severity).toBe(HealthSeverity.Info);
  });

  it('nÃ£o emite warnings de diretÃ³rio quando ambos existem', async () => {
    const workspace = await createTempWorkspace({
      '.github/.keep': '',
      '.vscode/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'no-github-dir')).toBe(false);
    expect(report.findings.some(f => f.id === 'no-vscode-dir')).toBe(false);
  });

  // â”€â”€â”€ checkAgents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('emite warning empty-agents-dir quando .github/agents existe mas estÃ¡ vazio', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'empty-agents-dir')).toBe(true);
  });

  it('emite error quando agent .agent.md nÃ£o tem frontmatter "---"', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/bad-agent.agent.md': 'name: bad\nNo frontmatter here',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id.startsWith('agent-no-frontmatter'))).toBe(true);
  });

  it('emite warning quando agent tem frontmatter mas nÃ£o tem "name:"', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/no-name.agent.md': '---\ndescription: Missing name\n---\n# Agent',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id.startsWith('agent-no-name'))).toBe(true);
  });

  it('nÃ£o emite erros para agent corretamente estruturado', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/good-agent.agent.md': '---\nname: good-agent\ndescription: A good agent\n---\n# Agent',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id.startsWith('agent-no-frontmatter'))).toBe(false);
    expect(report.findings.some(f => f.id.startsWith('agent-no-name'))).toBe(false);
  });

  // â”€â”€â”€ checkSkills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('nÃ£o emite findings quando .github/skills nÃ£o existe', async () => {
    const workspace = await createTempWorkspace({
      '.github/.keep': '',
      '.vscode/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.category === 'skill')).toBe(false);
  });

  it('emite error quando diretÃ³rio de skill nÃ£o contÃ©m SKILL.md', async () => {
    const workspace = await createTempWorkspace({
      '.github/skills/api-design/README.md': '# API Design',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id.startsWith('skill-no-skillmd'))).toBe(true);
    expect(report.findings.find(f => f.id.startsWith('skill-no-skillmd'))?.severity).toBe(HealthSeverity.Error);
  });

  it('nÃ£o emite error quando SKILL.md existe no diretÃ³rio da skill', async () => {
    const workspace = await createTempWorkspace({
      '.github/skills/api-design/SKILL.md': '# API Design Skill',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id.startsWith('skill-no-skillmd'))).toBe(false);
  });

  // â”€â”€â”€ checkMCPConfig â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('nÃ£o emite finding de MCP quando .vscode/mcp.json nÃ£o existe e nÃ£o hÃ¡ agents', async () => {
    const workspace = await createTempWorkspace({
      '.github/.keep': '',
      '.vscode/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'no-mcp-config')).toBe(false);
  });

  it('emite info no-mcp-config quando hÃ¡ agents mas nÃ£o hÃ¡ mcp.json', async () => {
    const workspace = await createTempWorkspace({
      '.github/agents/good-agent.agent.md': '---\nname: good\n---',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'no-mcp-config')).toBe(true);
    expect(report.findings.find(f => f.id === 'no-mcp-config')?.severity).toBe(HealthSeverity.Info);
  });

  it('emite error mcp-invalid-json quando mcp.json tem JSON invÃ¡lido', async () => {
    const workspace = await createTempWorkspace({
      '.vscode/mcp.json': '{ invalid json }',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'mcp-invalid-json')).toBe(true);
    expect(report.findings.find(f => f.id === 'mcp-invalid-json')?.severity).toBe(HealthSeverity.Error);
  });

  it('nÃ£o emite error para mcp.json vÃ¡lido', async () => {
    const workspace = await createTempWorkspace({
      '.vscode/mcp.json': '{"servers": {}, "inputs": []}',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'mcp-invalid-json')).toBe(false);
  });

  it('nÃ£o emite error para mcp.json com comentÃ¡rios de linha', async () => {
    const workspace = await createTempWorkspace({
      '.vscode/mcp.json': '// comment\n{"servers": {}}',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'mcp-invalid-json')).toBe(false);
  });

  // â”€â”€â”€ checkInstructions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('nÃ£o emite findings quando .github/instructions nÃ£o existe', async () => {
    const workspace = await createTempWorkspace({
      '.github/.keep': '',
      '.vscode/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.category === 'instruction')).toBe(false);
  });

  it('emite warning quando .instructions.md nÃ£o tem applyTo', async () => {
    const workspace = await createTempWorkspace({
      '.github/instructions/test.instructions.md': '# No applyTo header here',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id.startsWith('instruction-no-applyto'))).toBe(true);
    expect(report.findings.find(f => f.id.startsWith('instruction-no-applyto'))?.severity).toBe(HealthSeverity.Warning);
  });

  it('nÃ£o emite warning quando .instructions.md tem applyTo', async () => {
    const workspace = await createTempWorkspace({
      '.github/instructions/good.instructions.md': '---\napplyTo: "**/*.ts"\n---\n# Instruction',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(emptyRegistry, notInstalledScanner);
    const report = await checker.check();
    expect(report.findings.some(f => f.id.startsWith('instruction-no-applyto'))).toBe(false);
  });

  // â”€â”€â”€ checkCatalogMetadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('reporta todos os problemas de metadata do catÃ¡logo no pacote MCP invÃ¡lido', async () => {
    const workspace = await createTempWorkspace({
      '.vscode/mcp.json': '{ invalid json }',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const pkg = Package.create({
      id: 'mcp-custom',
      name: 'custom-mcp',
      displayName: 'Custom MCP',
      description: 'Custom',
      type: PackageType.MCP,
      version: '1.0.0',
      tags: ['mcp'],
      author: 'Community',
      files: [{ relativePath: '.vscode/mcp.json', content: '{"servers":{}}' }],
      source: { official: true },
      installStrategy: { kind: 'copy', targets: [] },
      ui: { longDescription: '', highlights: [], installNotes: [], badges: [], maturity: 'stable' },
    });

    const checker = new HealthCheckerService(
      { ...emptyRegistry, getAll: async () => [pkg] },
      installedScanner,
    );

    const report = await checker.check();
    expect(report.findings.some(f => f.id === 'mcp-invalid-json')).toBe(true);
    expect(report.findings.some(f => f.id === 'catalog-manifest-missing-mcp-custom')).toBe(true);
    expect(report.findings.some(f => f.id === 'install-targets-missing-mcp-custom')).toBe(true);
  });

  it('emite warning mcp-merge-strategy quando MCP usa estratÃ©gia copy', async () => {
    const workspace = await createTempWorkspace({
      '.vscode/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const pkg = makeMcpPkg({
      installStrategy: { kind: 'copy', targets: [{ path: '.vscode/mcp.json', mergeStrategy: 'merge-servers' }] },
    });

    const checker = new HealthCheckerService(
      { ...emptyRegistry, getAll: async () => [pkg] },
      installedScanner,
    );
    const report = await checker.check();
    expect(report.findings.some(f => f.id.startsWith('mcp-merge-strategy'))).toBe(true);
  });

  it('nÃ£o emite warnings para pacote MCP bem configurado', async () => {
    const workspace = await createTempWorkspace({
      '.vscode/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const pkg = makeMcpPkg();

    const checker = new HealthCheckerService(
      { ...emptyRegistry, getAll: async () => [pkg] },
      installedScanner,
    );
    const report = await checker.check();
    // nenhum finding de catalog, merge-strategy ou ui-details
    expect(report.findings.some(f => f.id.startsWith('catalog-manifest-missing'))).toBe(false);
    expect(report.findings.some(f => f.id.startsWith('mcp-merge-strategy'))).toBe(false);
    expect(report.findings.some(f => f.id.startsWith('ui-details-missing'))).toBe(false);
  });

  it('emite info ui-details-missing quando longDescription estÃ¡ vazio', async () => {
    const workspace = await createTempWorkspace({
      '.vscode/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const pkg = makeMcpPkg({
      ui: { longDescription: '', highlights: [], installNotes: [], badges: [], maturity: 'stable' },
    });

    const checker = new HealthCheckerService(
      { ...emptyRegistry, getAll: async () => [pkg] },
      installedScanner,
    );
    const report = await checker.check();
    expect(report.findings.some(f => f.id.startsWith('ui-details-missing'))).toBe(true);
  });

  it('nÃ£o verifica pacotes nÃ£o instalados no checkCatalogMetadata', async () => {
    const workspace = await createTempWorkspace({});
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const pkg = makeMcpPkg({
      ui: { longDescription: '', highlights: [], installNotes: [], badges: [], maturity: 'stable' },
    });

    const checker = new HealthCheckerService(
      { ...emptyRegistry, getAll: async () => [pkg] },
      notInstalledScanner, // package NOT installed
    );
    const report = await checker.check();
    // NÃ£o deve emitir ui-details-missing porque o pacote nÃ£o estÃ¡ instalado
    expect(report.findings.some(f => f.id.startsWith('ui-details-missing'))).toBe(false);
  });

  it('nÃ£o executa checkCatalogMetadata quando registry/scanner sÃ£o undefined', async () => {
    const workspace = await createTempWorkspace({
      '.github/.keep': '',
      '.vscode/.keep': '',
    });
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);

    const checker = new HealthCheckerService(); // sem registry nem scanner
    const report = await checker.check();
    // Apenas deve ter all-good ou findings de diretÃ³rio, nunca de catalog
    expect(report.findings.some(f => f.id.startsWith('catalog-manifest-missing'))).toBe(false);
  });
});
