import { HealthCheckerService } from '../../src/infrastructure/services/HealthChecker';
import { Package, InstallStatus } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { setWorkspaceRoot } from '../setup/vscode.mock';
import { createTempWorkspace } from '../setup/tempWorkspace';

describe('HealthCheckerService', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    await cleanup?.();
    cleanup = undefined;
  });

  it('reporta mcp.json inválido e problemas de metadata do catálogo', async () => {
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
      {
        getAll: async () => [pkg],
        findById: async () => undefined,
        search: async () => [],
        getAllBundles: async () => [],
        findBundleById: async () => undefined,
        getAgentNetwork: async () => [],
        getRelatedSkills: async () => [],
      },
      {
        getInstallStatus: async () => InstallStatus.Installed,
        getInstalledPackageIds: async () => [],
        hasGitHubDirectory: async () => false,
        detectProjectProfile: async () => [],
      },
    );

    const report = await checker.check();

    expect(report.findings.some(finding => finding.id === 'mcp-invalid-json')).toBe(true);
    expect(report.findings.some(finding => finding.id === 'catalog-manifest-missing-mcp-custom')).toBe(true);
    expect(report.findings.some(finding => finding.id === 'install-targets-missing-mcp-custom')).toBe(true);
  });
});