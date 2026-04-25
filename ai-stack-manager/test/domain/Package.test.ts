import { Package } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { AgentCategory } from '../../src/domain/value-objects/AgentCategory';

describe('Package', () => {
  it('aplica defaults derivados corretamente', () => {
    const pkg = Package.create({
      id: 'agent-backend-specialist',
      name: 'backend-specialist',
      displayName: 'Backend Specialist',
      description: 'Especialista em backend',
      type: PackageType.Agent,
      version: '1.0.0',
      tags: ['backend'],
      author: 'Community',
      files: [{ relativePath: '.github/agents/backend-specialist.agent.md', content: '# agent' }],
      agentMeta: {
        category: AgentCategory.Specialist,
        tools: ['read_file', 'grep_search'],
        delegatesTo: ['agent-code-reviewer'],
        workflowPhase: 'EXECUTION',
        userInvocable: true,
        relatedSkills: ['skill-api-design'],
      },
    });

    expect(pkg.isAgent).toBe(true);
    expect(pkg.isOfficial).toBe(false);
    expect(pkg.sourceLabel).toBe('Local / customizado');
    expect(pkg.maturityLabel).toBe('Stable');
    expect(pkg.installStrategy.kind).toBe('copy');
    expect(pkg.complexityScore).toBeGreaterThan(0);
  });

  it('usa mcp-merge por padrão para pacotes MCP', () => {
    const pkg = Package.create({
      id: 'mcp-github',
      name: 'github-mcp',
      displayName: 'GitHub MCP',
      description: 'MCP',
      type: PackageType.MCP,
      version: '1.0.0',
      tags: ['mcp'],
      author: 'Community',
      files: [{ relativePath: '.vscode/mcp.json', content: '{"servers":{}}' }],
    });

    expect(pkg.installStrategy.kind).toBe('mcp-merge');
    expect(pkg.installStrategy.targets[0]?.mergeStrategy).toBe('merge-mcp-servers');
  });
});