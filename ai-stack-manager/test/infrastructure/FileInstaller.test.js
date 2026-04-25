"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const FileInstaller_1 = require("../../src/infrastructure/services/FileInstaller");
const Package_1 = require("../../src/domain/entities/Package");
const PackageType_1 = require("../../src/domain/value-objects/PackageType");
const vscode_mock_1 = require("../setup/vscode.mock");
const tempWorkspace_1 = require("../setup/tempWorkspace");
(0, vitest_1.describe)('FileInstaller', () => {
    let cleanup;
    (0, vitest_1.afterEach)(async () => {
        (0, vscode_mock_1.setWorkspaceRoot)(undefined);
        await cleanup?.();
        cleanup = undefined;
    });
    (0, vitest_1.it)('mescla servidores MCP preservando o conteúdo existente', async () => {
        const workspace = await (0, tempWorkspace_1.createTempWorkspace)({
            '.vscode/mcp.json': JSON.stringify({ servers: { existing: { command: 'node' } } }, null, 2),
        });
        cleanup = workspace.cleanup;
        (0, vscode_mock_1.setWorkspaceRoot)(workspace.root);
        const installer = new FileInstaller_1.FileInstaller();
        const pkg = Package_1.Package.create({
            id: 'mcp-github',
            name: 'github-mcp',
            displayName: 'GitHub MCP',
            description: 'MCP',
            type: PackageType_1.PackageType.MCP,
            version: '1.0.0',
            tags: ['mcp'],
            author: 'Community',
            files: [{ relativePath: '.vscode/mcp.json', content: JSON.stringify({ servers: { github: { command: 'npx' } } }) }],
        });
        await installer.install(pkg);
        const content = JSON.parse(await fs_1.promises.readFile(path.join(workspace.root, '.vscode', 'mcp.json'), 'utf-8'));
        (0, vitest_1.expect)(content.servers.existing).toBeTruthy();
        (0, vitest_1.expect)(content.servers.github).toBeTruthy();
    });
    (0, vitest_1.it)('deduplica pacotes em installMany', async () => {
        const workspace = await (0, tempWorkspace_1.createTempWorkspace)();
        cleanup = workspace.cleanup;
        (0, vscode_mock_1.setWorkspaceRoot)(workspace.root);
        (0, vscode_mock_1.queueWarningMessageResponse)('Overwrite');
        const installer = new FileInstaller_1.FileInstaller();
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
        await installer.installMany([pkg, pkg]);
        const content = await fs_1.promises.readFile(path.join(workspace.root, '.github', 'agents', 'backend-specialist.agent.md'), 'utf-8');
        (0, vitest_1.expect)(content).toContain('# agent');
    });
});
//# sourceMappingURL=FileInstaller.test.js.map