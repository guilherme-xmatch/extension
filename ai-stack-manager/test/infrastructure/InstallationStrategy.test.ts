/**
 * Tests for FileCopyStrategy and McpMergeStrategy — all filesystem paths are
 * exercised using the real workspace.fs mock that delegates to Node.js `fs`.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { FileCopyStrategy, McpMergeStrategy } from '../../src/infrastructure/services/InstallationStrategy';
import { Package } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { setWorkspaceRoot, queueWarningMessageResponse } from '../setup/vscode.mock';
import { createTempWorkspace } from '../setup/tempWorkspace';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<{ id: string; files: Array<{relativePath: string; content: string}> }> = {}): Package {
  return Package.create({
    id: overrides.id ?? 'agent-test',
    name: 'test-agent',
    displayName: 'Test Agent',
    description: 'test',
    type: PackageType.Agent,
    version: '1.0.0',
    tags: [],
    author: 'test',
    files: overrides.files ?? [{ relativePath: '.github/agents/test.agent.md', content: '# test agent' }],
  });
}

function makeMcp(servers: Record<string, unknown>, inputs: Array<{ id: string; [k: string]: unknown }> = []): Package {
  return Package.create({
    id: 'mcp-test',
    name: 'test-mcp',
    displayName: 'Test MCP',
    description: 'test',
    type: PackageType.MCP,
    version: '1.0.0',
    tags: [],
    author: 'test',
    files: [{ relativePath: '.vscode/mcp.json', content: JSON.stringify({ servers, inputs }) }],
  });
}

// ─── FileCopyStrategy ─────────────────────────────────────────────────────────

describe('FileCopyStrategy', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    await cleanup?.();
    cleanup = undefined;
  });

  describe('install', () => {
    it('creates file when it does not exist', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new FileCopyStrategy();
      const pkg = makeAgent();
      await strategy.install(workspace.root, pkg, 'skip');

      const content = await fs.readFile(path.join(workspace.root, '.github/agents/test.agent.md'), 'utf-8');
      expect(content).toBe('# test agent');
    });

    it('skips existing file when mode is "skip"', async () => {
      const workspace = await createTempWorkspace({ '.github/agents/test.agent.md': '# original' });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new FileCopyStrategy();
      await strategy.install(workspace.root, makeAgent(), 'skip');

      const content = await fs.readFile(path.join(workspace.root, '.github/agents/test.agent.md'), 'utf-8');
      expect(content).toBe('# original'); // untouched
    });

    it('overwrites existing file when mode is "prompt" and user selects Overwrite', async () => {
      const workspace = await createTempWorkspace({ '.github/agents/test.agent.md': '# original' });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);
      queueWarningMessageResponse('Sobrescrever');

      const strategy = new FileCopyStrategy();
      await strategy.install(workspace.root, makeAgent(), 'prompt');

      const content = await fs.readFile(path.join(workspace.root, '.github/agents/test.agent.md'), 'utf-8');
      expect(content).toBe('# test agent'); // overwritten
    });

    it('preserves existing file when mode is "prompt" and user selects Skip', async () => {
      const workspace = await createTempWorkspace({ '.github/agents/test.agent.md': '# original' });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);
      queueWarningMessageResponse('Pular');

      const strategy = new FileCopyStrategy();
      await strategy.install(workspace.root, makeAgent(), 'prompt');

      const content = await fs.readFile(path.join(workspace.root, '.github/agents/test.agent.md'), 'utf-8');
      expect(content).toBe('# original'); // untouched
    });

    it('installs multiple files from a single package', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new FileCopyStrategy();
      const pkg = makeAgent({ files: [
        { relativePath: '.github/agents/a.agent.md', content: '# agent A' },
        { relativePath: '.github/agents/b.agent.md', content: '# agent B' },
      ]});
      await strategy.install(workspace.root, pkg, 'skip');

      expect(await fs.readFile(path.join(workspace.root, '.github/agents/a.agent.md'), 'utf-8')).toBe('# agent A');
      expect(await fs.readFile(path.join(workspace.root, '.github/agents/b.agent.md'), 'utf-8')).toBe('# agent B');
    });
  });

  describe('uninstall', () => {
    it('deletes file that exists', async () => {
      const workspace = await createTempWorkspace({ '.github/agents/test.agent.md': '# test' });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new FileCopyStrategy();
      await strategy.uninstall(workspace.root, makeAgent());

      await expect(fs.access(path.join(workspace.root, '.github/agents/test.agent.md'))).rejects.toThrow();
    });

    it('does not throw when file does not exist', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new FileCopyStrategy();
      await expect(strategy.uninstall(workspace.root, makeAgent())).resolves.not.toThrow();
    });

    it('removes empty parent directories after uninstall', async () => {
      const workspace = await createTempWorkspace({ '.github/agents/test.agent.md': '# test' });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new FileCopyStrategy();
      await strategy.uninstall(workspace.root, makeAgent());

      // The .github/agents directory should be removed (empty after file deletion)
      const agentsDir = path.join(workspace.root, '.github', 'agents');
      await expect(fs.access(agentsDir)).rejects.toThrow();
    });

    it('suprime erro silenciosamente quando workspace.fs.delete falha', async () => {
      const workspace = await createTempWorkspace({ '.github/agents/test.agent.md': '# test' });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      // Força o delete a falhar para acionar o bloco catch
      vi.mocked(vscode.workspace.fs.delete).mockRejectedValueOnce(new Error('Permission denied'));

      const strategy = new FileCopyStrategy();
      // Não deve lançar — o catch swallows a exceção
      await expect(strategy.uninstall(workspace.root, makeAgent())).resolves.not.toThrow();
    });

    it('keeps non-empty parent directories after uninstall', async () => {
      const workspace = await createTempWorkspace({
        '.github/agents/test.agent.md': '# test',
        '.github/agents/other.agent.md': '# other',
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new FileCopyStrategy();
      await strategy.uninstall(workspace.root, makeAgent()); // only removes test.agent.md

      // agents dir should still exist (has other.agent.md)
      const agentsDir = path.join(workspace.root, '.github', 'agents');
      await expect(fs.access(agentsDir)).resolves.not.toThrow();
    });
  });
});

// ─── McpMergeStrategy ─────────────────────────────────────────────────────────

describe('McpMergeStrategy', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    await cleanup?.();
    cleanup = undefined;
  });

  describe('install', () => {
    it('creates mcp.json when it does not exist', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({ github: { type: 'http', url: 'https://api.github.com/mcp' } }));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers.github).toBeDefined();
    });

    it('merges servers into existing mcp.json preserving existing', async () => {
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': JSON.stringify({ servers: { existing: { command: 'node' } } }, null, 2),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({ newServer: { type: 'http', url: 'https://example.com' } }));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers.existing).toBeDefined();
      expect(raw.servers.newServer).toBeDefined();
    });

    it('overwrites existing server config with new one', async () => {
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': JSON.stringify({ servers: { github: { type: 'old', url: 'https://old.url' } } }, null, 2),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({ github: { type: 'http', url: 'https://new.url' } }));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers.github.url).toBe('https://new.url');
    });

    it('deduplicates inputs with the same id', async () => {
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': JSON.stringify({
          servers: {},
          inputs: [{ id: 'MY_TOKEN', type: 'promptString' }],
        }, null, 2),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({}, [{ id: 'MY_TOKEN', type: 'promptString' }]));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.inputs.filter((i: { id: string }) => i.id === 'MY_TOKEN')).toHaveLength(1);
    });

    it('adds new inputs not present in existing file', async () => {
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': JSON.stringify({ servers: {}, inputs: [] }, null, 2),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({}, [{ id: 'NEW_TOKEN', type: 'promptString' }]));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.inputs.some((i: { id: string }) => i.id === 'NEW_TOKEN')).toBe(true);
    });

    it('accepts legacy mcpServers format in package content', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const mcpPackage = Package.create({
        id: 'mcp-legacy', name: 'legacy-mcp', displayName: 'Legacy MCP', description: 'test',
        type: PackageType.MCP, version: '1.0.0', tags: [], author: 'test',
        files: [{ relativePath: '.vscode/mcp.json', content: JSON.stringify({ mcpServers: { legacy: { command: 'node' } } }) }],
      });

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, mcpPackage);

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers.legacy).toBeDefined();
    });
    it('normaliza mcp.json cujo conteúdo é null (JSON "null")', async () => {
      // Cobre normalizeMcpDocument quando value não é um objeto
      const workspace = await createTempWorkspace({ '.vscode/mcp.json': 'null' });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({ github: { type: 'http' } }));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers.github).toBeDefined();
    });

    it('normaliza mcp.json com servers inválido (não-objeto)', async () => {
      // Cobre branch raw.servers && typeof raw.servers === 'object' → false
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': JSON.stringify({ servers: 'invalid', inputs: 'not-array' }),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({ github: { type: 'http' } }));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers.github).toBeDefined();
    });

    it('normaliza mcp.json com apenas comentários (parseJsonWithComments retorna {})', async () => {
      // Cobre: sanitized ? JSON.parse(sanitized) : {} → branch false
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': '// apenas comentários\n/* sem conteúdo JSON */',
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({ github: { type: 'http' } }));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers.github).toBeDefined();
    });

    it('normaliza mcp.json com mcpServers (chave legada) não-objeto', async () => {
      // Cobre branch raw.mcpServers && typeof raw.mcpServers === 'object' → false
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': JSON.stringify({ mcpServers: 42 }),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({ github: { type: 'http' } }));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers.github).toBeDefined();
    });

    it('migra mcp.json legado com mcpServers como objeto', async () => {
      // Cobre branch raw.mcpServers && typeof raw.mcpServers === 'object' → true (em normalizeMcpDocument)
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': JSON.stringify({ mcpServers: { legacy: { command: 'node' } } }),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({ github: { type: 'http' } }));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers.legacy).toBeDefined();
      expect(raw.servers.github).toBeDefined();
    });

    it('usa {} como fallback de servers quando package content não tem chave servers/mcpServers', async () => {
      // Cobre: parsed.servers || parsed.mcpServers || {} → branch final {} (ambos undefined)
      // E: Array.isArray(parsed.inputs) → false → []
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const emptyPkg = Package.create({
        id: 'mcp-empty', name: 'empty-mcp', displayName: 'Empty MCP', description: 'test',
        type: PackageType.MCP, version: '1.0.0', tags: [], author: 'test',
        files: [{ relativePath: '.vscode/mcp.json', content: '{}' }], // sem chaves servers/mcpServers/inputs
      });

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, emptyPkg);

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers).toEqual({});
      expect(raw.inputs).toEqual([]);
    });

    it('usa {} e [] como fallback quando pkg.files está vazio (pkg.files[0] undefined)', async () => {
      // Cobre: pkg.files[0]?.content → undefined → || '{}' em extractMcpConfig (linha 150)
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const noFilesPkg = Package.create({
        id: 'mcp-no-files', name: 'no-files-mcp', displayName: 'No Files MCP', description: 'test',
        type: PackageType.MCP, version: '1.0.0', tags: [], author: 'test',
        files: [], // array de files vazio → pkg.files[0] é undefined
      });

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, noFilesPkg);

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers).toEqual({});
      expect(raw.inputs).toEqual([]);
    });

    it('filtra inputs sem id no conteúdo do pacote (extractMcpConfig)', async () => {
      // Cobre: typeof input?.id === 'string' → false no filtro de extractMcpConfig
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const pkgWithInvalidInputs = Package.create({
        id: 'mcp-invalid-inputs', name: 'invalid-inputs-mcp', displayName: 'Invalid Inputs MCP', description: 'test',
        type: PackageType.MCP, version: '1.0.0', tags: [], author: 'test',
        files: [{ relativePath: '.vscode/mcp.json', content: JSON.stringify({
          servers: { test: { type: 'http' } },
          inputs: [
            { noId: 'this-has-no-id' }, // sem id → filtrado
            { id: 123 },                // id não é string → filtrado
            { id: 'VALID' },            // válido
          ],
        }) }],
      });

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, pkgWithInvalidInputs);

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.inputs).toHaveLength(1);
      expect(raw.inputs[0].id).toBe('VALID');
    });

    it('filtra inputs sem id (normalizeMcpDocument Boolean(input) check)', async () => {
      // Cobre: inputs.filter com input = null ou sem id
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': JSON.stringify({
          servers: {},
          inputs: [null, { notId: 'no-id' }, { id: 'VALID_TOKEN' }],
        }),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.install(workspace.root, makeMcp({}));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      // Apenas VALID_TOKEN deve persistir
      expect(raw.inputs).toHaveLength(1);
      expect(raw.inputs[0].id).toBe('VALID_TOKEN');
    });  });

  describe('uninstall', () => {
    it('removes server from mcp.json leaving others intact', async () => {
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': JSON.stringify({
          servers: { github: { type: 'http' }, context7: { type: 'http' } },
        }, null, 2),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.uninstall(workspace.root, makeMcp({ github: {} }));

      const raw = JSON.parse(await fs.readFile(path.join(workspace.root, '.vscode/mcp.json'), 'utf-8'));
      expect(raw.servers.github).toBeUndefined();
      expect(raw.servers.context7).toBeDefined();
    });

    it('deletes mcp.json when it becomes empty after uninstall', async () => {
      const workspace = await createTempWorkspace({
        '.vscode/mcp.json': JSON.stringify({ servers: { github: { type: 'http' } } }, null, 2),
      });
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await strategy.uninstall(workspace.root, makeMcp({ github: {} }));

      await expect(fs.access(path.join(workspace.root, '.vscode/mcp.json'))).rejects.toThrow();
    });

    it('does not throw when mcp.json does not exist', async () => {
      const workspace = await createTempWorkspace();
      cleanup = workspace.cleanup;
      setWorkspaceRoot(workspace.root);

      const strategy = new McpMergeStrategy();
      await expect(strategy.uninstall(workspace.root, makeMcp({ github: {} }))).resolves.not.toThrow();
    });
  });
});
