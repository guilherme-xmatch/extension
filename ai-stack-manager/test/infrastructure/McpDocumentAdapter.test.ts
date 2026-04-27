import { describe, it, expect } from 'vitest';
import { McpDocumentAdapter } from '../../src/infrastructure/services/McpDocumentAdapter';

describe('McpDocumentAdapter', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // detectFormat
  // ──────────────────────────────────────────────────────────────────────────
  describe('detectFormat', () => {
    it('detecta formato Copilot (servers)', () => {
      const raw = { servers: { 'my-server': { command: 'npx' } } };
      expect(McpDocumentAdapter.detectFormat(raw)).toBe('copilot');
    });

    it('detecta formato Copilot (servers + inputs)', () => {
      const raw = {
        servers: { 'my-server': { command: 'npx', args: [] } },
        inputs: [{ id: 'TOKEN', type: 'promptString', description: 'Token' }],
      };
      expect(McpDocumentAdapter.detectFormat(raw)).toBe('copilot');
    });

    it('detecta formato Claude Desktop (mcpServers)', () => {
      const raw = { mcpServers: { 'my-server': { command: 'npx', args: ['-y', 'pkg'] } } };
      expect(McpDocumentAdapter.detectFormat(raw)).toBe('claude-desktop');
    });

    it('detecta formato Cursor (mcpServers sem inputs)', () => {
      const raw = { mcpServers: { 'cursor-server': { command: 'node', args: ['server.js'] } } };
      expect(McpDocumentAdapter.detectFormat(raw)).toBe('claude-desktop');
    });

    it('retorna unknown para objeto vazio', () => {
      expect(McpDocumentAdapter.detectFormat({})).toBe('unknown');
    });

    it('retorna unknown para null', () => {
      expect(McpDocumentAdapter.detectFormat(null)).toBe('unknown');
    });

    it('retorna unknown para string', () => {
      expect(McpDocumentAdapter.detectFormat('not an object')).toBe('unknown');
    });

    it('retorna unknown para documento sem chave de servidores reconhecida', () => {
      expect(McpDocumentAdapter.detectFormat({ tools: {} })).toBe('unknown');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // normalize
  // ──────────────────────────────────────────────────────────────────────────
  describe('normalize', () => {
    it('normaliza formato Copilot sem alterações (servers + inputs)', () => {
      const raw = {
        servers: { 'my-server': { command: 'npx', args: [] } },
        inputs: [{ id: 'TOKEN', description: 'API Token' }],
      };
      const result = McpDocumentAdapter.normalize(raw);
      expect(result.format).toBe('copilot');
      expect(result.servers['my-server']).toBeDefined();
      expect(result.inputs).toHaveLength(1);
      expect(result.inputs[0]!.id).toBe('TOKEN');
    });

    it('normaliza formato Copilot sem campo inputs', () => {
      const raw = { servers: { 'my-server': { command: 'npx', args: [] } } };
      const result = McpDocumentAdapter.normalize(raw);
      expect(result.format).toBe('copilot');
      expect(result.inputs).toEqual([]);
    });

    it('filtra inputs inválidos (sem campo id)', () => {
      const raw = {
        servers: { 'srv': { command: 'npx' } },
        inputs: [
          { id: 'VALID', description: 'ok' },
          { description: 'sem id' },  // deve ser filtrado
          null,                        // deve ser filtrado
        ],
      };
      const result = McpDocumentAdapter.normalize(raw);
      expect(result.inputs).toHaveLength(1);
      expect(result.inputs[0]!.id).toBe('VALID');
    });

    it('normaliza formato Claude Desktop (mcpServers → servers)', () => {
      const raw = { mcpServers: { 'my-server': { command: 'npx', args: ['-y', 'pkg'] } } };
      const result = McpDocumentAdapter.normalize(raw);
      expect(result.format).toBe('claude-desktop');
      expect(result.servers['my-server']).toBeDefined();
      expect(result.inputs).toEqual([]);
    });

    it('normaliza formato Cursor (mcpServers → servers, sem inputs)', () => {
      const raw = {
        mcpServers: {
          'cursor-srv': { command: 'node', args: ['server.js'], env: { DEBUG: '1' } },
        },
      };
      const result = McpDocumentAdapter.normalize(raw);
      expect(result.format).toBe('claude-desktop');
      expect(result.servers['cursor-srv']).toEqual({
        command: 'node',
        args: ['server.js'],
        env: { DEBUG: '1' },
      });
    });

    it('lança erro para formato Copilot com servers vazio', () => {
      expect(() => McpDocumentAdapter.normalize({ servers: {}, inputs: [] })).toThrow(
        'Nenhum servidor MCP encontrado no documento (formato Copilot).'
      );
    });

    it('lança erro para formato Claude Desktop com mcpServers vazio', () => {
      expect(() => McpDocumentAdapter.normalize({ mcpServers: {} })).toThrow(
        'Nenhum servidor MCP encontrado no documento (formato Claude Desktop/Cursor).'
      );
    });

    it('lança erro para formato desconhecido', () => {
      expect(() => McpDocumentAdapter.normalize({ unknown: true })).toThrow(
        'Formato de documento MCP não reconhecido.'
      );
    });

    it('lança erro para null', () => {
      expect(() => McpDocumentAdapter.normalize(null)).toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // parseJsonFile
  // ──────────────────────────────────────────────────────────────────────────
  describe('parseJsonFile', () => {
    it('faz parse de JSON normal', () => {
      expect(McpDocumentAdapter.parseJsonFile('{"a": 1}')).toEqual({ a: 1 });
    });

    it('strip de comentários de linha (//) antes do parse', () => {
      const json = '{\n  // comment\n  "a": 1\n}';
      expect(McpDocumentAdapter.parseJsonFile(json)).toEqual({ a: 1 });
    });

    it('strip de comentários de bloco (/* */) antes do parse', () => {
      const json = '{ /* block comment */ "a": 1 }';
      expect(McpDocumentAdapter.parseJsonFile(json)).toEqual({ a: 1 });
    });

    it('strip de comentários de bloco multi-linha', () => {
      const json = '{\n  /*\n   * multi-line\n   */\n  "a": 1\n}';
      expect(McpDocumentAdapter.parseJsonFile(json)).toEqual({ a: 1 });
    });

    it('lança SyntaxError para JSON inválido após strip', () => {
      expect(() => McpDocumentAdapter.parseJsonFile('{invalid}')).toThrow(SyntaxError);
    });

    it('retorna objeto vazio para conteúdo vazio após strip', () => {
      expect(McpDocumentAdapter.parseJsonFile('  // only comments\n  ')).toEqual({});
    });
  });
});
