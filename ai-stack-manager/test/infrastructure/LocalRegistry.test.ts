import { describe, it, expect } from 'vitest';
import { LocalRegistry } from '../../src/infrastructure/repositories/LocalRegistry';
import { LOCAL_CATALOG_PACKAGES, LOCAL_CATALOG_BUNDLES } from '../../src/infrastructure/repositories/LocalCatalogData';
import { Package } from '../../src/domain/entities/Package';
import { Bundle } from '../../src/domain/entities/Bundle';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { AgentCategory } from '../../src/domain/value-objects/AgentCategory';

// ─── Local Catalog Data ───────────────────────────────────────────────────────

describe('LOCAL_CATALOG_PACKAGES', () => {
  it('exports a non-empty frozen array', () => {
    expect(LOCAL_CATALOG_PACKAGES.length).toBeGreaterThan(0);
    expect(Object.isFrozen(LOCAL_CATALOG_PACKAGES)).toBe(true);
  });

  it('includes all expected agent IDs', () => {
    const ids = LOCAL_CATALOG_PACKAGES.map(p => p.id);
    expect(ids).toContain('agent-orchestrator');
    expect(ids).toContain('agent-planner');
    expect(ids).toContain('agent-backend');
    expect(ids).toContain('agent-code-reviewer');
    expect(ids).toContain('agent-test-engineer');
  });

  it('includes skill packages', () => {
    const ids = LOCAL_CATALOG_PACKAGES.map(p => p.id);
    expect(ids).toContain('skill-api-design');
    expect(ids).toContain('skill-security');
    expect(ids).toContain('skill-testing-strategy');
  });

  it('includes MCP, instruction and prompt packages', () => {
    const ids = LOCAL_CATALOG_PACKAGES.map(p => p.id);
    expect(ids).toContain('mcp-github');
    expect(ids).toContain('instruction-skill-first');
    expect(ids).toContain('prompt-bugfix');
  });

  it('orchestrator has complete agentMeta', () => {
    const orchestrator = LOCAL_CATALOG_PACKAGES.find(p => p.id === 'agent-orchestrator');
    expect(orchestrator?.agentMeta?.category.value).toBe(AgentCategory.Orchestrator.value);
    expect(orchestrator?.agentMeta?.userInvocable).toBe(true);
    expect(orchestrator?.agentMeta?.delegatesTo.length).toBeGreaterThan(0);
  });
});

describe('LOCAL_CATALOG_BUNDLES', () => {
  it('exports a non-empty frozen array', () => {
    expect(LOCAL_CATALOG_BUNDLES.length).toBeGreaterThan(0);
    expect(Object.isFrozen(LOCAL_CATALOG_BUNDLES)).toBe(true);
  });

  it('includes expected bundle IDs', () => {
    const ids = LOCAL_CATALOG_BUNDLES.map(b => b.id);
    expect(ids).toContain('bundle-zm1-full');
    expect(ids).toContain('bundle-backend-starter');
    expect(ids).toContain('bundle-frontend-starter');
    expect(ids).toContain('bundle-devops-starter');
  });

  it('zm1-full bundle references existing package IDs', () => {
    const fullBundle = LOCAL_CATALOG_BUNDLES.find(b => b.id === 'bundle-zm1-full')!;
    const allIds = new Set(LOCAL_CATALOG_PACKAGES.map(p => p.id));
    for (const pkgId of fullBundle.packageIds) {
      expect(allIds.has(pkgId), `Package ${pkgId} not found in catalog`).toBe(true);
    }
  });
});

// ─── LocalRegistry (default data) ────────────────────────────────────────────

describe('LocalRegistry — default constructor', () => {
  it('returns all catalog packages', async () => {
    const registry = new LocalRegistry();
    const all = await registry.getAll();
    expect(all.length).toBe(LOCAL_CATALOG_PACKAGES.length);
  });

  it('returns a copy (not the internal array)', async () => {
    const registry = new LocalRegistry();
    const a = await registry.getAll();
    const b = await registry.getAll();
    expect(a).not.toBe(b);
  });

  it('findById returns correct package', async () => {
    const registry = new LocalRegistry();
    const pkg = await registry.findById('agent-orchestrator');
    expect(pkg?.id).toBe('agent-orchestrator');
    expect(pkg?.displayName).toBe('ZM1 Orquestrador');
  });

  it('findById returns undefined for unknown id', async () => {
    const registry = new LocalRegistry();
    expect(await registry.findById('non-existent-id')).toBeUndefined();
  });

  it('search matches by name/description', async () => {
    const registry = new LocalRegistry();
    const results = await registry.search('backend');
    expect(results.some(p => p.id === 'agent-backend')).toBe(true);
  });

  it('search returns empty array for no matches', async () => {
    const registry = new LocalRegistry();
    const results = await registry.search('xxxxnonexistentxxxx');
    expect(results).toEqual([]);
  });

  it('getAllBundles returns all bundles', async () => {
    const registry = new LocalRegistry();
    const bundles = await registry.getAllBundles();
    expect(bundles.length).toBe(LOCAL_CATALOG_BUNDLES.length);
  });

  it('findBundleById returns correct bundle', async () => {
    const registry = new LocalRegistry();
    const bundle = await registry.findBundleById('bundle-backend-starter');
    expect(bundle?.id).toBe('bundle-backend-starter');
  });

  it('getAgentNetwork returns delegated agents for orchestrator', async () => {
    const registry = new LocalRegistry();
    const network = await registry.getAgentNetwork('agent-orchestrator');
    expect(network.length).toBeGreaterThan(0);
    expect(network.every(p => p.type.equals(PackageType.Agent))).toBe(true);
  });

  it('getAgentNetwork returns empty for non-agent package', async () => {
    const registry = new LocalRegistry();
    const network = await registry.getAgentNetwork('skill-api-design');
    expect(network).toEqual([]);
  });

  it('getRelatedSkills returns skills for backend agent', async () => {
    const registry = new LocalRegistry();
    const skills = await registry.getRelatedSkills('agent-backend');
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.every(p => p.type.equals(PackageType.Skill))).toBe(true);
  });
});

// ─── LocalRegistry (custom data injection) ───────────────────────────────────

describe('LocalRegistry — custom data injection', () => {
  const fakePackage = Package.create({
    id: 'test-agent',
    name: 'test-agent',
    displayName: 'Test Agent',
    description: 'A test agent',
    type: PackageType.Agent,
    version: '1.0.0',
    tags: ['test'],
    author: 'Test',
    files: [],
    agentMeta: {
      category: AgentCategory.Specialist,
      tools: ['read'],
      delegatesTo: [],
      workflowPhase: 'EXECUTION',
      userInvocable: false,
      relatedSkills: [],
    },
  });

  const fakeBundle = Bundle.create({
    id: 'test-bundle',
    name: 'test-bundle',
    displayName: 'Test Bundle',
    description: 'A test bundle',
    version: '1.0.0',
    packageIds: ['test-agent'],
    icon: '$(package)',
    color: '#000000',
  });

  it('uses injected packages instead of defaults', async () => {
    const registry = new LocalRegistry([fakePackage], [fakeBundle]);
    const all = await registry.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('test-agent');
  });

  it('uses injected bundles instead of defaults', async () => {
    const registry = new LocalRegistry([fakePackage], [fakeBundle]);
    const bundles = await registry.getAllBundles();
    expect(bundles).toHaveLength(1);
    expect(bundles[0].id).toBe('test-bundle');
  });

  it('empty arrays produce empty results', async () => {
    const registry = new LocalRegistry([], []);
    expect(await registry.getAll()).toEqual([]);
    expect(await registry.getAllBundles()).toEqual([]);
  });

  it('getAgentNetwork returns empty for agent with no delegatesTo', async () => {
    const registry = new LocalRegistry([fakePackage], []);
    const network = await registry.getAgentNetwork('test-agent');
    expect(network).toEqual([]);
  });
});
