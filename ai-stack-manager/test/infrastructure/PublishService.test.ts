// ─── Mock fs — vi.mock() é içado pelo Vitest antes dos imports ───────────
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
  rmSync: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { PublishService } from '../../src/infrastructure/services/PublishService';
import { StatusBarManager } from '../../src/infrastructure/services/StatusBarManager';
import { AppLogger } from '../../src/infrastructure/services/AppLogger';
import { queueInformationMessageResponse } from '../setup/vscode.mock';
import type { GitRegistry } from '../../src/infrastructure/repositories/GitRegistry';

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeMcpContent(
  servers: Record<string, unknown>,
  inputs: unknown[] = [],
): string {
  return JSON.stringify({ servers, inputs });
}

const SINGLE_SERVER = {
  'my-mcp': { type: 'sse', url: 'https://api.example.com/sse' },
};

const TWO_SERVERS = {
  'server-one': { type: 'sse', url: 'https://api.example.com/sse' },
  'server-two': { command: 'node', args: ['server.js'] },
};

// ─── Suite ────────────────────────────────────────────────────────────────

describe('PublishService', () => {
  let mockRegistry: Pick<GitRegistry, 'saveWorkspaceCustomPackage'>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USERPROFILE = '/fake/home';

    // Garante instâncias singleton limpas
    try { StatusBarManager.getInstance().dispose(); } catch { /* já limpo */ }
    StatusBarManager.getInstance();
    try { AppLogger.getInstance().dispose(); } catch { /* já limpo */ }
    AppLogger.getInstance();

    mockRegistry = { saveWorkspaceCustomPackage: vi.fn(async () => {}) };
  });

  afterEach(() => {
    try { StatusBarManager.getInstance().dispose(); } catch { /* já limpo */ }
    try { AppLogger.getInstance().dispose(); } catch { /* já limpo */ }
  });

  // ── importCustomMcp ──────────────────────────────────────────────────────

  describe('importCustomMcp', () => {
    it('importa 1 server com sucesso, retorna 1 Package e salva no registry', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeMcpContent(SINGLE_SERVER));

      const service = new PublishService();
      const packages = await service.importCustomMcp(
        vscode.Uri.file('/workspace/mcp.json'),
        mockRegistry as unknown as GitRegistry,
      );

      expect(packages).toHaveLength(1);
      expect(mockRegistry.saveWorkspaceCustomPackage).toHaveBeenCalledTimes(1);
    });

    it('parseia JSON com comentários de linha corretamente, sem lançar erro', async () => {
      const contentWithComments = `{
  // Meu servidor MCP customizado
  "servers": {
    "my-server": { "type": "sse", "url": "https://api.example.com/sse" }
  },
  "inputs": []
}`;
      vi.mocked(fs.readFileSync).mockReturnValue(contentWithComments);

      const service = new PublishService();
      const packages = await service.importCustomMcp(
        vscode.Uri.file('/workspace/mcp.json'),
        mockRegistry as unknown as GitRegistry,
      );

      expect(packages).toHaveLength(1);
      expect(mockRegistry.saveWorkspaceCustomPackage).toHaveBeenCalledTimes(1);
    });

    it('importa 2 servers e chama saveWorkspaceCustomPackage 2 vezes', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeMcpContent(TWO_SERVERS));

      const service = new PublishService();
      const packages = await service.importCustomMcp(
        vscode.Uri.file('/workspace/mcp.json'),
        mockRegistry as unknown as GitRegistry,
      );

      expect(packages).toHaveLength(2);
      expect(mockRegistry.saveWorkspaceCustomPackage).toHaveBeenCalledTimes(2);
    });

    it('JSON com campo mcpServers (alternativo a servers) → importa normalmente', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ mcpServers: { 'my-mcp': { type: 'sse', url: 'https://api.example.com/sse' } } }),
      );

      const service = new PublishService();
      const packages = await service.importCustomMcp(
        vscode.Uri.file('/workspace/mcp.json'),
        mockRegistry as unknown as GitRegistry,
      );

      expect(packages).toHaveLength(1);
      expect(mockRegistry.saveWorkspaceCustomPackage).toHaveBeenCalledTimes(1);
    });

    it('JSON com servers vazio → throw com mensagem de validação (linhas 222-223)', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ servers: {}, inputs: [] }));

      const service = new PublishService();
      await expect(
        service.importCustomMcp(
          vscode.Uri.file('/workspace/mcp.json'),
          mockRegistry as unknown as GitRegistry,
        ),
      ).rejects.toThrow('Nenhum servidor MCP encontrado no documento');
    });

    it('JSON sem campo inputs → normalizado como array vazio (linha 229)', async () => {
      // inputs ausente → Array.isArray(undefined) === false → cobre o branch `: []`
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ servers: { 'my-mcp': { type: 'sse', url: 'https://api.example.com/sse' } } }),
      );

      const service = new PublishService();
      const packages = await service.importCustomMcp(
        vscode.Uri.file('/workspace/mcp.json'),
        mockRegistry as unknown as GitRegistry,
      );

      expect(packages).toHaveLength(1);
    });

    it('server sem url nem command → descrição fallback genérica (linha 252)', async () => {
      // config sem url e sem command → describeServer cai na linha 252
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          servers: { 'plain-mcp': { type: 'sse' } },
          inputs: [],
        }),
      );

      const service = new PublishService();
      const packages = await service.importCustomMcp(
        vscode.Uri.file('/workspace/mcp.json'),
        mockRegistry as unknown as GitRegistry,
      );

      expect(packages).toHaveLength(1);
      expect(packages[0].description).toContain('MCP customizado importado pelo usuário');
    });

    it('fs.readFileSync lança erro → setError chamado com mensagem correta e erro relançado', async () => {
      const boom = new Error('ENOENT: no such file or directory');
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw boom; });

      const setErrorSpy = vi.spyOn(StatusBarManager.getInstance(), 'setError');

      const service = new PublishService();
      await expect(
        service.importCustomMcp(
          vscode.Uri.file('/workspace/mcp.json'),
          mockRegistry as unknown as GitRegistry,
        ),
      ).rejects.toThrow('ENOENT: no such file or directory');

      expect(setErrorSpy).toHaveBeenCalledWith('Falha ao importar MCP');
    });
  });

  // ── publishPackage ───────────────────────────────────────────────────────

  describe('publishPackage', () => {
    it('server válido → mkdirSync chamado 2x e writeFileSync chamado 4x', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeMcpContent(SINGLE_SERVER));

      const service = new PublishService();
      await service.publishPackage(vscode.Uri.file('/workspace/mcp.json'));

      // artifactRoot + packageRoot (1 servidor)
      expect(fs.mkdirSync).toHaveBeenCalledTimes(2);
      // manifest.json + mcp.json + README.md + details.md (1 servidor)
      expect(fs.writeFileSync).toHaveBeenCalledTimes(4);
    });

    it('choice → Abrir pasta: revealFileInOS executado (branch linha 222)', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeMcpContent(SINGLE_SERVER));
      queueInformationMessageResponse('Abrir pasta');

      const service = new PublishService();
      await service.publishPackage(vscode.Uri.file('/workspace/mcp.json'));

      expect(vi.mocked(vscode.commands.executeCommand)).toHaveBeenCalledWith(
        'revealFileInOS',
        expect.objectContaining({ fsPath: expect.any(String) }),
      );
    });

    it('choice → Abrir repositório oficial: openExternal chamado (branch linha 229)', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeMcpContent(SINGLE_SERVER));
      queueInformationMessageResponse('Abrir repositório oficial');

      const service = new PublishService();
      await service.publishPackage(vscode.Uri.file('/workspace/mcp.json'));

      expect(vi.mocked(vscode.env.openExternal)).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: expect.stringContaining('DescomplicAI') }),
      );
    });

    it('fs.mkdirSync lança erro → setError chamado, erro NÃO relançado pela função', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeMcpContent(SINGLE_SERVER));
      vi.mocked(fs.mkdirSync).mockImplementation(() => { throw new Error('EACCES: permission denied'); });

      const setErrorSpy = vi.spyOn(StatusBarManager.getInstance(), 'setError');

      const service = new PublishService();
      // publishPackage captura o erro internamente e NÃO relança
      await expect(
        service.publishPackage(vscode.Uri.file('/workspace/mcp.json')),
      ).resolves.toBeUndefined();

      expect(setErrorSpy).toHaveBeenCalledWith('Falha ao publicar');
    });
  });
});
