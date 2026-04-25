"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Package_1 = require("../../src/domain/entities/Package");
const PackageType_1 = require("../../src/domain/value-objects/PackageType");
const AgentCategory_1 = require("../../src/domain/value-objects/AgentCategory");
(0, vitest_1.describe)('Package', () => {
    (0, vitest_1.it)('aplica defaults derivados corretamente', () => {
        const pkg = Package_1.Package.create({
            id: 'agent-backend-specialist',
            name: 'backend-specialist',
            displayName: 'Backend Specialist',
            description: 'Especialista em backend',
            type: PackageType_1.PackageType.Agent,
            version: '1.0.0',
            tags: ['backend'],
            author: 'Community',
            files: [{ relativePath: '.github/agents/backend-specialist.agent.md', content: '# agent' }],
            agentMeta: {
                category: AgentCategory_1.AgentCategory.Specialist,
                tools: ['read_file', 'grep_search'],
                delegatesTo: ['agent-code-reviewer'],
                workflowPhase: 'EXECUTION',
                userInvocable: true,
                relatedSkills: ['skill-api-design'],
            },
        });
        (0, vitest_1.expect)(pkg.isAgent).toBe(true);
        (0, vitest_1.expect)(pkg.isOfficial).toBe(false);
        (0, vitest_1.expect)(pkg.sourceLabel).toBe('Local / customizado');
        (0, vitest_1.expect)(pkg.maturityLabel).toBe('Stable');
        (0, vitest_1.expect)(pkg.installStrategy.kind).toBe('copy');
        (0, vitest_1.expect)(pkg.complexityScore).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('usa mcp-merge por padrão para pacotes MCP', () => {
        const pkg = Package_1.Package.create({
            id: 'mcp-github',
            name: 'github-mcp',
            displayName: 'GitHub MCP',
            description: 'MCP',
            type: PackageType_1.PackageType.MCP,
            version: '1.0.0',
            tags: ['mcp'],
            author: 'Community',
            files: [{ relativePath: '.vscode/mcp.json', content: '{"servers":{}}' }],
        });
        (0, vitest_1.expect)(pkg.installStrategy.kind).toBe('mcp-merge');
        (0, vitest_1.expect)(pkg.installStrategy.targets[0]?.mergeStrategy).toBe('merge-mcp-servers');
    });
});
//# sourceMappingURL=Package.test.js.map