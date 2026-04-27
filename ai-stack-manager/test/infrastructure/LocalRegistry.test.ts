import { describe, it, expect } from 'vitest';
import { LocalRegistry } from '../../src/infrastructure/repositories/LocalRegistry';
import { LOCAL_CATALOG_PACKAGES, LOCAL_CATALOG_BUNDLES } from '../../src/infrastructure/repositories/LocalCatalogData';
import { Package } from '../../src/domain/entities/Package';
import { Bundle } from '../../src/domain/entities/Bundle';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { AgentCategory } from '../../src/domain/value-objects/AgentCategory';

// ─── Local Catalog Data ───────────────────────────────────────────────────────
// Catalog is intentionally empty — data is loaded at runtime from the remote
// DescomplicAI registry. LocalRegistry accepts injected data for testing.

describe('LOCAL_CATALOG_PACKAGES', () => {
  it('exports an empty frozen array', () => {
    expect(LOCAL_CATALOG_PACKAGES.length).toBe(0);
    expect(Object.isFrozen(LOCAL_CATALOG_PACKAGES)).toBe(true);
  });
});

describe('LOCAL_CATALOG_BUNDLES', () => {
  it('exports an empty frozen array', () => {
    expect(LOCAL_CATALOG_BUNDLES.length).toBe(0);
    expect(Object.isFrozen(LOCAL_CATALOG_BUNDLES)).toBe(true);
  });
});

// ─── LocalRegistry (default data — now empty) ──────────────────────────────────

// Fixtures used by the default-constructor tests below
const orchestratorFixture = Package.create({
  id: 'agent-orchestrator',
  name: 'zm1-orchestrator',
  displayName: 'ZM1 Orquestrador',
  description: 'Orquestrador mestre.',
  type: PackageType.Agent,
  version: '1.0.0',
  tags: ['core'],
  author: 'test',
  files: [],
  agentMeta: {
    category: AgentCategory.Orchestrator,
    tools: ['read'],
    delegatesTo: ['backend-specialist'],
    workflowPhase: 'TRIAGE',
    userInvocable: true,
    relatedSkills: ['skill-api-design'],
  },
});

const backendAgentFixture = Package.create({
  id: 'agent-backend',
  name: 'backend-specialist',
  displayName: 'Especialista Backend',
  description: 'Backend specialist.',
  type: PackageType.Agent,
  version: '1.0.0',
  tags: ['backend'],
  author: 'test',
  files: [],
  agentMeta: {
    category: AgentCategory.Specialist,
    tools: ['read', 'edit'],
    delegatesTo: [],
    workflowPhase: 'EXECUTION',
    userInvocable: false,
    relatedSkills: ['skill-api-design'],
  },
});

const skillFixture = Package.create({
  id: 'skill-api-design',
  name: 'api-design',
  displayName: 'API Design',
  description: 'API design patterns.',
  type: PackageType.Skill,
  version: '1.0.0',
  tags: ['backend'],
  author: 'test',
  files: [],
});

const bundleFixture = Bundle.create({
  id: 'bundle-backend-starter',
  name: 'backend-starter',
  displayName: 'Backend Starter',
  description: 'Backend bundle.',
  version: '1.0.0',
  packageIds: ['agent-backend', 'skill-api-design'],
  icon: '$(package)',
  color: '#448AFF',
});

describe('LocalRegistry — default constructor (empty catalog)', () => {
  it('returns empty array by default', async () => {
    const registry = new LocalRegistry();
    const all = await registry.getAll();
    expect(all.length).toBe(0);
  });

  it('returns a copy (not the internal array)', async () => {
    const registry = new LocalRegistry([orchestratorFixture], []);
    const a = await registry.getAll();
    const b = await registry.getAll();
    expect(a).not.toBe(b);
  });

  it('findById returns correct injected package', async () => {
    const registry = new LocalRegistry([orchestratorFixture], []);
    const pkg = await registry.findById('agent-orchestrator');
    expect(pkg?.id).toBe('agent-orchestrator');
    expect(pkg?.displayName).toBe('ZM1 Orquestrador');
  });

  it('findById returns undefined for unknown id', async () => {
    const registry = new LocalRegistry();
    expect(await registry.findById('non-existent-id')).toBeUndefined();
  });

  it('search matches by name/description in injected packages', async () => {
    const registry = new LocalRegistry([backendAgentFixture, skillFixture], []);
    const results = await registry.search('backend');
    expect(results.some(p => p.id === 'agent-backend')).toBe(true);
  });

  it('search returns empty array for no matches', async () => {
    const registry = new LocalRegistry([backendAgentFixture], []);
    const results = await registry.search('xxxxnonexistentxxxx');
    expect(results).toEqual([]);
  });

  it('getAllBundles returns empty by default', async () => {
    const registry = new LocalRegistry();
    const bundles = await registry.getAllBundles();
    expect(bundles.length).toBe(0);
  });

  it('findBundleById returns correct injected bundle', async () => {
    const registry = new LocalRegistry([backendAgentFixture, skillFixture], [bundleFixture]);
    const bundle = await registry.findBundleById('bundle-backend-starter');
    expect(bundle?.id).toBe('bundle-backend-starter');
  });

  it('getAgentNetwork returns delegated agents from injected data', async () => {
    const registry = new LocalRegistry([orchestratorFixture, backendAgentFixture], []);
    const network = await registry.getAgentNetwork('agent-orchestrator');
    expect(network.length).toBeGreaterThan(0);
    expect(network.every(p => p.type.equals(PackageType.Agent))).toBe(true);
  });

  it('getAgentNetwork returns empty for non-agent package', async () => {
    const registry = new LocalRegistry([skillFixture], []);
    const network = await registry.getAgentNetwork('skill-api-design');
    expect(network).toEqual([]);
  });

  it('getRelatedSkills returns skills for injected agent', async () => {
    const registry = new LocalRegistry([backendAgentFixture, skillFixture], []);
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
