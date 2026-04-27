/**
 * Tests for GitRegistry — catalog loading from local paths, custom workspace
 * packages, bundle loading, package hydration and IPackageRepository queries.
 *
 * Network / git-clone paths are intentionally excluded (require I/O mocks).
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { GitRegistry } from '../../src/infrastructure/repositories/GitRegistry';
import { setWorkspaceRoot, setConfigurationValue, resetVscodeMock } from '../setup/vscode.mock';
import { createTempWorkspace } from '../setup/tempWorkspace';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const agentManifest = {
  id: 'agent-backend',
  name: 'backend',
  displayName: 'Backend Specialist',
  description: 'Backend agent',
  type: 'agent',
  version: '1.0.0',
  tags: ['backend'],
  author: 'Test Author',
  files: [{ relativePath: '.github/agents/backend.agent.md', content: '# backend agent' }],
};

const mcpManifest = {
  id: 'mcp-github',
  name: 'github',
  displayName: 'GitHub MCP',
  description: 'GitHub tools',
  type: 'mcp',
  version: '1.0.0',
  tags: ['mcp'],
  author: 'Test',
  files: [{ relativePath: '.vscode/mcp.json', content: '{"servers":{"github":{"command":"npx"}}}' }],
};

const bundleManifest = {
  id: 'bundle-starter',
  name: 'starter',
  displayName: 'Starter Pack',
  description: 'A starter bundle',
  version: '1.0.0',
  packageIds: ['agent-backend', 'mcp-github'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GitRegistry', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    resetVscodeMock();
    await cleanup?.();
    cleanup = undefined;
  });

  // ─── Sync sem URL ────────────────────────────────────────────────────────────

  describe('sync() sem registryUrl', () => {
    it('retorna lista vazia quando não há workspace nem URL', async () => {
      setConfigurationValue('descomplicai.registryUrl', '');
      const registry = new GitRegistry();
      await registry.sync();
      expect(await registry.getAll()).toEqual([]);
    });

    it('carrega pacotes customizados do workspace quando URL é vazia', async () => {
      const workspace = await createTempWorkspace({
        '.descomplicai/custom-packages.json': JSON.stringify([agentManifest]),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);
      setConfigurationValue('descomplicai.registryUrl', '');

      const registry = new GitRegistry();
      await registry.sync();

      const pkgs = await registry.getAll();
      expect(pkgs.some(p => p.id === 'agent-backend')).toBe(true);
    });

    it('retorna [] quando custom-packages.json contém JSON inválido', async () => {
      const workspace = await createTempWorkspace({
        '.descomplicai/custom-packages.json': '{ invalid json }',
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);
      setConfigurationValue('descomplicai.registryUrl', '');

      const registry = new GitRegistry();
      await registry.sync();
      expect(await registry.getAll()).toEqual([]);
    });
  });

  // ─── Sync com diretório local ─────────────────────────────────────────────

  describe('sync() com diretório local', () => {
    it('carrega pacotes inline no catalog/index.json', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: [agentManifest, mcpManifest],
      });

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkgs = await registry.getAll();
      expect(pkgs.some(p => p.id === 'agent-backend')).toBe(true);
      expect(pkgs.some(p => p.id === 'mcp-github')).toBe(true);
    });

    it('carrega pacotes via refs de string no index.json', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: ['agents/backend/manifest.json'],
      });
      writeJsonFile(path.join(workspace.root, 'agents', 'backend', 'manifest.json'), agentManifest);

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      expect((await registry.getAll()).some(p => p.id === 'agent-backend')).toBe(true);
    });

    it('descobre manifest.json recursivamente quando index.json sem packages', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {});
      writeJsonFile(path.join(workspace.root, 'agents', 'backend', 'manifest.json'), agentManifest);

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      expect((await registry.getAll()).some(p => p.id === 'agent-backend')).toBe(true);
    });

    it('funciona sem catalog/index.json (busca direta)', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'agents', 'backend', 'manifest.json'), agentManifest);

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      expect((await registry.getAll()).some(p => p.id === 'agent-backend')).toBe(true);
    });

    it('carrega pacote com install.targets lendo arquivo fonte do disco', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      const manifestWithTargets = {
        id: 'agent-target',
        name: 'target-agent',
        displayName: 'Target Agent',
        description: 'Agent with install targets',
        type: 'agent',
        version: '1.0.0',
        tags: [],
        author: 'Test',
        install: {
          strategy: 'copy',
          targets: [{ source: 'source.agent.md', target: '.github/agents/target.agent.md', mergeStrategy: 'replace' }],
        },
        source: { packagePath: 'agents/target-agent' },
      };

      writeJsonFile(path.join(workspace.root, 'agents', 'target-agent', 'manifest.json'), manifestWithTargets);
      fs.writeFileSync(path.join(workspace.root, 'agents', 'target-agent', 'source.agent.md'), '# target agent');

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('agent-target');
      expect(pkg).toBeDefined();
      expect(pkg?.files[0]?.content).toBe('# target agent');
    });

    it('usa defaultInlineContent quando arquivo fonte de MCP não existe', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'mcps', 'missing', 'manifest.json'), {
        id: 'mcp-missing-src',
        name: 'missing-src',
        displayName: 'Missing Source',
        description: 'MCP with missing source file',
        type: 'mcp',
        version: '1.0.0',
        tags: [],
        author: 'Test',
        install: { targets: [{ source: 'nonexistent.json', target: '.vscode/mcp.json' }] },
        source: { packagePath: 'mcps/missing' },
      });

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('mcp-missing-src');
      expect(pkg?.files[0]?.content).toContain('"servers"');
    });

    it('deduplica pacotes: customizado tem precedência sobre catálogo', async () => {
      const workspace = await createTempWorkspace({
        '.descomplicai/custom-packages.json': JSON.stringify([{
          ...agentManifest, description: 'Custom version',
        }]),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), { packages: [agentManifest] });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const matches = (await registry.getAll()).filter(p => p.id === 'agent-backend');
      expect(matches).toHaveLength(1);
      expect(matches[0].description).toBe('Custom version');
    });

    it('ignora manifest ref inexistente silenciosamente', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: ['agents/nonexistent/manifest.json', agentManifest],
      });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkgs = await registry.getAll();
      expect(pkgs.some(p => p.id === 'agent-backend')).toBe(true);
    });
  });

  // ─── Sync com arquivo JSON local ──────────────────────────────────────────

  describe('sync() com arquivo JSON local', () => {
    it('carrega de array JSON inline', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      const jsonPath = path.join(workspace.root, 'catalog.json');
      writeJsonFile(jsonPath, [agentManifest]);

      setConfigurationValue('descomplicai.registryUrl', jsonPath);
      const registry = new GitRegistry();
      await registry.sync();

      expect((await registry.getAll()).some(p => p.id === 'agent-backend')).toBe(true);
    });

    it('carrega de objeto { packages: [...] }', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      const jsonPath = path.join(workspace.root, 'catalog.json');
      writeJsonFile(jsonPath, { packages: [mcpManifest] });

      setConfigurationValue('descomplicai.registryUrl', jsonPath);
      const registry = new GitRegistry();
      await registry.sync();

      expect((await registry.getAll()).some(p => p.id === 'mcp-github')).toBe(true);
    });

    it('usa fallback quando arquivo local não é JSON nem diretório', async () => {
      const workspace = await createTempWorkspace({ 'catalog.xml': '<catalog />' });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const xmlPath = path.join(workspace.root, 'catalog.xml');
      setConfigurationValue('descomplicai.registryUrl', xmlPath);
      const registry = new GitRegistry();
      await registry.sync();

      expect(await registry.getAll()).toEqual([]);
    });
  });

  // ─── Sync fallback com URL remota ────────────────────────────────────────

  it('usa fallback vazio quando URL remota não é confiável', async () => {
    setConfigurationValue('descomplicai.registryUrl', 'https://evil.example.com/catalog.json');
    const registry = new GitRegistry();
    await registry.sync();
    expect(await registry.getAll()).toEqual([]);
  });

  it('bloqueia registry remoto inseguro e faz fallback local', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);
    setConfigurationValue('descomplicai.registryUrl', 'http://malicious.example.com/catalog.json');

    const registry = new GitRegistry();
    const packages = await registry.getAll();
    expect(packages).toEqual([]);
  });

  it('sync() concorrente executa apenas uma vez', async () => {
    setConfigurationValue('descomplicai.registryUrl', '');
    const registry = new GitRegistry();

    await Promise.all([registry.sync(), registry.sync(), registry.sync()]);
    expect(await registry.getAll()).toEqual([]);
  });

  // ─── Carregamento do catálogo de fixture existente ───────────────────────

  it('carrega catálogo local manifest-driven (fixture completo)', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;
    setWorkspaceRoot(workspace.root);
    setConfigurationValue('descomplicai.registryUrl', path.join(process.cwd(), 'test', 'fixtures', 'catalog'));

    const registry = new GitRegistry();
    const packages = await registry.getAll();
    const bundles = await registry.getAllBundles();

    expect(packages.some(pkg => pkg.id === 'agent-backend-specialist')).toBe(true);
    expect(packages.some(pkg => pkg.id === 'mcp-github')).toBe(true);
    expect(bundles.some(bundle => bundle.id === 'bundle-architecture-backend')).toBe(true);
  });

  // ─── Bundles ─────────────────────────────────────────────────────────────

  describe('Bundles', () => {
    it('carrega bundles do index.json', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: [agentManifest],
        bundles: [bundleManifest],
      });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();

      const bundles = await registry.getAllBundles();
      expect(bundles.some(b => b.id === 'bundle-starter')).toBe(true);
    });

    it('carrega bundles de catalog/bundles.json quando não estão no index', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), { packages: [] });
      writeJsonFile(path.join(workspace.root, 'catalog', 'bundles.json'), [bundleManifest]);

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();

      const bundles = await registry.getAllBundles();
      expect(bundles.some(b => b.id === 'bundle-starter')).toBe(true);
    });

    it('carrega bundles.json no formato { bundles: [...] }', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), { packages: [] });
      writeJsonFile(path.join(workspace.root, 'catalog', 'bundles.json'), { bundles: [bundleManifest] });

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();

      const bundles = await registry.getAllBundles();
      expect(bundles.some(b => b.id === 'bundle-starter')).toBe(true);
    });

    it('ignora bundles inválidos (null, packageIds vazio)', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        bundles: [
          null,
          { id: 'bad', packageIds: [] },
          { id: 'bad2' },
          bundleManifest,
        ],
      });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();

      const bundles = await registry.getAllBundles();
      expect(bundles).toHaveLength(1);
      expect(bundles[0].id).toBe('bundle-starter');
    });

    it('findBundleById retorna bundle correto e undefined para desconhecido', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), { bundles: [bundleManifest] });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();

      expect(await registry.findBundleById('bundle-starter')).toBeDefined();
      expect(await registry.findBundleById('no-such')).toBeUndefined();
    });
  });

  // ─── Stats ───────────────────────────────────────────────────────────────

  describe('Stats', () => {
    it('carrega stats do arquivo quando presente', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: [agentManifest],
        stats: { packagesBasePath: 'catalog/stats/packages' },
      });
      writeJsonFile(path.join(workspace.root, 'catalog', 'stats', 'packages', 'agent-backend.json'), {
        installsTotal: 42, uniqueInstallers: 10, trendScore: 99,
      });

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('agent-backend');
      expect(pkg?.stats.installsTotal).toBe(42);
      expect(pkg?.stats.trendScore).toBe(99);
    });

    it('usa defaults quando arquivo de stats não existe', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), { packages: [agentManifest] });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('agent-backend');
      expect(pkg?.stats.installsTotal).toBe(0);
    });

    it('usa stats inline do manifest quando arquivo não existe', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: [{ ...agentManifest, id: 'agent-with-stats', stats: { installsTotal: 5 } }],
      });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('agent-with-stats');
      expect(pkg?.stats.installsTotal).toBe(5);
    });
  });

  // ─── saveWorkspaceCustomPackage ─────────────────────────────────────────

  describe('saveWorkspaceCustomPackage', () => {
    it('lança erro quando não há workspace aberto', async () => {
      setWorkspaceRoot(undefined);
      setConfigurationValue('descomplicai.registryUrl', '');
      const registry = new GitRegistry();
      await registry.sync();

      await expect(registry.saveWorkspaceCustomPackage({} as never)).rejects.toThrow(/Nenhum workspace/i);
    });

    it('salva pacote e cria o arquivo custom-packages.json', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), { packages: [agentManifest] });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('agent-backend');
      expect(pkg).toBeDefined();

      await registry.saveWorkspaceCustomPackage(pkg!);

      const customPath = path.join(workspace.root, '.descomplicai', 'custom-packages.json');
      expect(fs.existsSync(customPath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(customPath, 'utf-8'));
      expect(saved.some((p: { id: string }) => p.id === 'agent-backend')).toBe(true);
    });

    it('substitui pacote existente sem duplicar', async () => {
      const workspace = await createTempWorkspace({
        '.descomplicai/custom-packages.json': JSON.stringify([agentManifest]),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), { packages: [agentManifest] });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('agent-backend');
      expect(pkg).toBeDefined();

      await registry.saveWorkspaceCustomPackage(pkg!);
      await registry.saveWorkspaceCustomPackage(pkg!);

      const saved = JSON.parse(fs.readFileSync(
        path.join(workspace.root, '.descomplicai', 'custom-packages.json'), 'utf-8'
      ));
      expect(saved.filter((p: { id: string }) => p.id === 'agent-backend')).toHaveLength(1);
    });
  });

  // ─── IPackageRepository queries ─────────────────────────────────────────

  describe('IPackageRepository', () => {
    it('getAll() aciona sync automático se não inicializado', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), { packages: [agentManifest] });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry(); // sem chamar sync()

      const pkgs = await registry.getAll();
      expect(pkgs.some(p => p.id === 'agent-backend')).toBe(true);
    });

    it('findById() retorna correto e undefined para desconhecido', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), { packages: [agentManifest] });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();

      expect(await registry.findById('agent-backend')).toBeDefined();
      expect(await registry.findById('no-such-id')).toBeUndefined();
    });

    it('search() filtra por query', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: [agentManifest, mcpManifest],
      });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();

      const results = await registry.search('backend');
      expect(results.some(p => p.id === 'agent-backend')).toBe(true);
      expect(results.some(p => p.id === 'mcp-github')).toBe(false);
    });

    it('getAgentNetwork() resolve delegatesTo', async () => {
      const orchestrator = {
        ...agentManifest,
        id: 'agent-orchestrator',
        name: 'orchestrator',
        displayName: 'Orchestrator',
        description: 'orchestrates all',
        agentMeta: { delegatesTo: ['agent-backend'] },
      };

      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: [orchestrator, agentManifest],
      });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();

      const network = await registry.getAgentNetwork('agent-orchestrator');
      expect(network.some(p => p.id === 'agent-backend')).toBe(true);
    });

    it('getAgentNetwork() retorna [] para pacote desconhecido', async () => {
      setConfigurationValue('descomplicai.registryUrl', '');
      const registry = new GitRegistry();
      await registry.sync();
      expect(await registry.getAgentNetwork('no-such-id')).toEqual([]);
    });

    it('getRelatedSkills() resolve skills relacionadas', async () => {
      const agentWithSkills = {
        ...agentManifest,
        id: 'agent-with-skills',
        name: 'with-skills',
        agentMeta: { relatedSkills: ['skill-api-design'] },
      };
      const skill = {
        id: 'skill-api-design',
        name: 'api-design',
        displayName: 'API Design',
        description: 'API design skill',
        type: 'skill',
        version: '1.0.0',
        tags: [],
        author: 'Test',
        files: [{ relativePath: '.github/skills/api-design.md', content: '# API Design' }],
      };

      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: [agentWithSkills, skill],
      });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();

      const skills = await registry.getRelatedSkills('agent-with-skills');
      expect(skills.some(s => s.id === 'skill-api-design')).toBe(true);
    });

    it('getRelatedSkills() retorna [] para pacote desconhecido', async () => {
      setConfigurationValue('descomplicai.registryUrl', '');
      const registry = new GitRegistry();
      await registry.sync();
      expect(await registry.getRelatedSkills('no-such-id')).toEqual([]);
    });
  });

  // ─── Hydration edge cases ────────────────────────────────────────────────

  describe('Hydration de pacotes', () => {
    it('MCP sem install.targets recebe arquivo .vscode/mcp.json padrão', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: [{ id: 'mcp-minimal', name: 'minimal', displayName: 'Minimal MCP', description: 'Minimal', type: 'mcp', version: '1.0.0', tags: [], author: 'Test' }],
      });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('mcp-minimal');
      expect(pkg?.files[0]?.relativePath).toBe('.vscode/mcp.json');
      expect(pkg?.files[0]?.content).toContain('"servers"');
    });

    it('agente com agentMeta é hidratado corretamente', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: [{
          ...agentManifest, id: 'agent-with-meta',
          agentMeta: {
            category: 'specialist', tools: ['read_file'],
            delegatesTo: [], workflowPhase: 'EXECUTION',
            userInvocable: true, relatedSkills: ['skill-api'],
          },
        }],
      });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('agent-with-meta');
      expect(pkg?.agentMeta?.tools).toContain('read_file');
      expect(pkg?.agentMeta?.userInvocable).toBe(true);
    });

    it('pacote com readme e details lê textos do disco', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: ['agents/backend/manifest.json'],
      });
      writeJsonFile(path.join(workspace.root, 'agents', 'backend', 'manifest.json'), {
        ...agentManifest, id: 'agent-with-docs',
        source: { packagePath: 'agents/backend', readmePath: 'README.md', detailsPath: 'details.md' },
      });
      fs.writeFileSync(path.join(workspace.root, 'agents', 'backend', 'README.md'), '# README content');
      fs.writeFileSync(path.join(workspace.root, 'agents', 'backend', 'details.md'), '# Details content');

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('agent-with-docs');
      expect(pkg?.docs.readme).toContain('README content');
      expect(pkg?.docs.details).toContain('Details content');
    });

    it('resolveLinks gera link "Homepage" quando homepage está presente', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      const trustedHomepage = 'https://github.com/guilherme-xmatch/DescomplicAI/tree/main/agents/backend';
      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: [{ ...agentManifest, id: 'agent-hp', source: { packagePath: 'agents/backend', homepage: trustedHomepage } }],
      });
      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const pkg = await registry.findById('agent-hp');
      expect(pkg?.docs.links.some(l => l.label === 'Homepage')).toBe(true);
    });

    it('inferAgentCategory infere Orchestrator, Planner, Guardian, Memory e Specialist', async () => {
      const agentTypes = [
        { name: 'orchestrator', desc: 'orchestrates all' },
        { name: 'planner', desc: 'planning strategy' },
        { name: 'review-guard', desc: 'code review' },
        { name: 'memory-store', desc: 'remembers context' },
        { name: 'specialist', desc: 'backend engineering' },
      ];

      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;

      writeJsonFile(path.join(workspace.root, 'catalog', 'index.json'), {
        packages: agentTypes.map(a => ({
          ...agentManifest, id: `agent-${a.name}`, name: a.name,
          displayName: a.name, description: a.desc,
        })),
      });

      setConfigurationValue('descomplicai.registryUrl', workspace.root);
      const registry = new GitRegistry();
      await registry.sync();

      const expectedCategories: Record<string, string> = {
        orchestrator: 'orchestrator', planner: 'planner',
        'review-guard': 'guardian', 'memory-store': 'memory', specialist: 'specialist',
      };

      for (const [name, category] of Object.entries(expectedCategories)) {
        const pkg = await registry.findById(`agent-${name}`);
        expect(pkg?.agentMeta?.category.value).toBe(category);
      }
    });
  });
});
