import { describe, it, expect, afterEach } from 'vitest';
import { LockFileService } from '../../src/infrastructure/services/LockFileService';
import { createTempWorkspace } from '../setup/tempWorkspace';

describe('LockFileService', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  // ─── read() ──────────────────────────────────────────────────────────────────

  it('read() retorna lock vazio se o arquivo não existir', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;

    const service = new LockFileService(workspace.root);
    const lock = service.read();

    expect(lock.schemaVersion).toBe('1.0.0');
    expect(lock.packages).toEqual([]);
    expect(typeof lock.updatedAt).toBe('string');
  });

  // ─── addOrUpdate() ────────────────────────────────────────────────────────────

  it('addOrUpdate() cria o arquivo e adiciona uma entrada corretamente', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;

    const service = new LockFileService(workspace.root);
    service.addOrUpdate({ id: 'agent-code-architect', version: '1.0.0', sourceOfficial: true });

    const lock = service.read();
    expect(lock.packages).toHaveLength(1);
    expect(lock.packages[0].id).toBe('agent-code-architect');
    expect(lock.packages[0].version).toBe('1.0.0');
    expect(lock.packages[0].sourceOfficial).toBe(true);
    expect(typeof lock.packages[0].installedAt).toBe('string');
  });

  it('addOrUpdate() atualiza a versão se o pacote já existir', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;

    const service = new LockFileService(workspace.root);
    service.addOrUpdate({ id: 'skill-api-design', version: '1.0.0', sourceOfficial: false });
    service.addOrUpdate({ id: 'skill-api-design', version: '2.0.0', sourceOfficial: false });

    const lock = service.read();
    // Should still be a single entry (no duplicates)
    expect(lock.packages.filter(p => p.id === 'skill-api-design')).toHaveLength(1);
    expect(lock.packages[0].version).toBe('2.0.0');
  });

  // ─── remove() ────────────────────────────────────────────────────────────────

  it('remove() remove uma entrada existente', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;

    const service = new LockFileService(workspace.root);
    service.addOrUpdate({ id: 'mcp-github', version: '1.0.0', sourceOfficial: true });
    service.addOrUpdate({ id: 'mcp-mempalace', version: '1.0.0', sourceOfficial: true });

    service.remove('mcp-github');

    const lock = service.read();
    expect(lock.packages.find(p => p.id === 'mcp-github')).toBeUndefined();
    expect(lock.packages.find(p => p.id === 'mcp-mempalace')).toBeDefined();
  });

  it('remove() é no-op se o pacote não estiver no lock', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;

    const service = new LockFileService(workspace.root);
    service.addOrUpdate({ id: 'skill-aws-core', version: '1.0.0', sourceOfficial: true });

    expect(() => service.remove('pacote-inexistente')).not.toThrow();
    expect(service.read().packages).toHaveLength(1);
  });

  // ─── findById() ───────────────────────────────────────────────────────────────

  it('findById() retorna a entrada correta quando o pacote existe', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;

    const service = new LockFileService(workspace.root);
    service.addOrUpdate({ id: 'agent-aws-specialist', version: '3.1.0', sourceOfficial: true });

    const entry = service.findById('agent-aws-specialist');
    expect(entry).toBeDefined();
    expect(entry!.version).toBe('3.1.0');
    expect(entry!.sourceOfficial).toBe(true);
  });

  it('findById() retorna undefined quando o pacote não existe', async () => {
    const workspace = await createTempWorkspace();
    cleanup = workspace.cleanup;

    const service = new LockFileService(workspace.root);
    const entry = service.findById('pacote-inexistente');
    expect(entry).toBeUndefined();
  });
});
