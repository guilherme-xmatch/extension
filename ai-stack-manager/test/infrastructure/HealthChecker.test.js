"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const HealthChecker_1 = require("../../src/infrastructure/services/HealthChecker");
const Package_1 = require("../../src/domain/entities/Package");
const vscode_mock_1 = require("../setup/vscode.mock");
const tempWorkspace_1 = require("../setup/tempWorkspace");
(0, vitest_1.describe)('HealthCheckerService', () => {
    let cleanup;
    (0, vitest_1.afterEach)(async () => {
        (0, vscode_mock_1.setWorkspaceRoot)(undefined);
        await cleanup?.();
        cleanup = undefined;
    });
    (0, vitest_1.it)('reporta mcp.json inválido e problemas de metadata do catálogo', async () => {
        const workspace = await (0, tempWorkspace_1.createTempWorkspace)({
            '.vscode/mcp.json': '{ invalid json }',
        });
        cleanup = workspace.cleanup;
        (0, vscode_mock_1.setWorkspaceRoot)(workspace.root);
        const pkg = Package_1.Package.create({
            id: 'mcp-custom',
            name: 'custom-mcp',
            displayName: 'Custom MCP',
            description: 'Custom',
            type: Package_1.PackageType.MCP,
            version: '1.0.0',
            tags: ['mcp'],
            author: 'Community',
            files: [{ relativePath: '.vscode/mcp.json', content: '{"servers":{}}' }],
            source: { official: true },
            installStrategy: { kind: 'copy', targets: [] },
            ui: { longDescription: '', highlights: [], installNotes: [], badges: [], maturity: 'stable' },
        });
        const checker = new HealthChecker_1.HealthCheckerService({
            getAll: async () => [pkg],
            findById: async () => undefined,
            search: async () => [],
            getAllBundles: async () => [],
            findBundleById: async () => undefined,
            getAgentNetwork: async () => [],
            getRelatedSkills: async () => [],
        }, {
            getInstallStatus: async () => Package_1.InstallStatus.Installed,
            getInstalledPackageIds: async () => [],
            hasGitHubDirectory: async () => false,
            detectProjectProfile: async () => [],
        });
        const report = await checker.check();
        (0, vitest_1.expect)(report.findings.some(finding => finding.id === 'mcp-invalid-json')).toBe(true);
        (0, vitest_1.expect)(report.findings.some(finding => finding.id === 'catalog-manifest-missing-mcp-custom')).toBe(true);
        (0, vitest_1.expect)(report.findings.some(finding => finding.id === 'install-targets-missing-mcp-custom')).toBe(true);
    });
});
//# sourceMappingURL=HealthChecker.test.js.map