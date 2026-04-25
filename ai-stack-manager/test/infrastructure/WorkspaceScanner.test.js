"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const WorkspaceScanner_1 = require("../../src/infrastructure/services/WorkspaceScanner");
const Package_1 = require("../../src/domain/entities/Package");
const PackageType_1 = require("../../src/domain/value-objects/PackageType");
const vscode_mock_1 = require("../setup/vscode.mock");
const tempWorkspace_1 = require("../setup/tempWorkspace");
(0, vitest_1.describe)('WorkspaceScanner', () => {
    let cleanup;
    (0, vitest_1.afterEach)(async () => {
        (0, vscode_mock_1.setWorkspaceRoot)(undefined);
        await cleanup?.();
        cleanup = undefined;
    });
    (0, vitest_1.it)('detecta status de instalação de pacote comum', async () => {
        const workspace = await (0, tempWorkspace_1.createTempWorkspace)({
            '.github/agents/backend-specialist.agent.md': '# agent',
        });
        cleanup = workspace.cleanup;
        (0, vscode_mock_1.setWorkspaceRoot)(workspace.root);
        const scanner = new WorkspaceScanner_1.WorkspaceScanner();
        const pkg = Package_1.Package.create({
            id: 'agent-backend-specialist',
            name: 'backend-specialist',
            displayName: 'Backend Specialist',
            description: 'Backend',
            type: PackageType_1.PackageType.Agent,
            version: '1.0.0',
            tags: ['backend'],
            author: 'Community',
            files: [{ relativePath: '.github/agents/backend-specialist.agent.md', content: '# agent' }],
        });
        await (0, vitest_1.expect)(scanner.getInstallStatus(pkg)).resolves.toBe('installed');
    });
    (0, vitest_1.it)('mapeia bundles reais na detecção de perfil', async () => {
        const workspace = await (0, tempWorkspace_1.createTempWorkspace)({
            'package.json': JSON.stringify({ dependencies: { express: '^5.0.0', react: '^19.0.0' } }),
            'Dockerfile': 'FROM node:20',
        });
        cleanup = workspace.cleanup;
        (0, vscode_mock_1.setWorkspaceRoot)(workspace.root);
        const scanner = new WorkspaceScanner_1.WorkspaceScanner();
        const profiles = await scanner.detectProjectProfile();
        (0, vitest_1.expect)(profiles.some(profile => profile.bundleId === 'bundle-architecture-backend')).toBe(true);
        (0, vitest_1.expect)(profiles.some(profile => profile.bundleId === 'bundle-aws-platform')).toBe(true);
    });
});
//# sourceMappingURL=WorkspaceScanner.test.js.map