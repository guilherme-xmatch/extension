/**
 * Tests for StatusBarManager and AppLogger services.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { StatusBarManager } from '../../src/infrastructure/services/StatusBarManager';
import { AppLogger } from '../../src/infrastructure/services/AppLogger';
import { getLogs } from '../setup/vscode.mock';
import type { IOperationCoordinator } from '../../src/domain/interfaces';
import type { OperationSnapshot } from '../../src/domain/entities/Operation';

// ─── StatusBarManager ────────────────────────────────────────────────────────

describe('StatusBarManager', () => {
  let manager: StatusBarManager;

  beforeEach(() => {
    // Garante que não há singleton residual de outro teste
    try { StatusBarManager.getInstance().dispose(); } catch { /* já limpo */ }
    manager = StatusBarManager.getInstance();
  });

  afterEach(() => {
    manager.dispose();
  });

  it('getInstance retorna a mesma instância (singleton)', () => {
    const a = StatusBarManager.getInstance();
    const b = StatusBarManager.getInstance();
    expect(a).toBe(b);
  });

  it('dispose destroi a instância e permite criar nova', () => {
    const first = StatusBarManager.getInstance();
    first.dispose();
    const second = StatusBarManager.getInstance();
    expect(second).not.toBe(first);
    manager = second; // para o afterEach
  });

  it('setIdle não lança exceção', () => {
    expect(() => manager.setIdle()).not.toThrow();
  });

  it('setWorking não lança exceção', () => {
    expect(() => manager.setWorking('Syncing catalog')).not.toThrow();
  });

  it('setSuccess não lança exceção', () => {
    expect(() => manager.setSuccess('Installed!')).not.toThrow();
  });

  it('setError não lança exceção', () => {
    expect(() => manager.setError('Network error')).not.toThrow();
  });

  it('bindToCoordinator — recebe snapshot undefined → chama setIdle', () => {
    const setIdleSpy = vi.spyOn(manager, 'setIdle');

    const listeners: Array<(s: OperationSnapshot | undefined) => void> = [];
    const mockCoordinator: IOperationCoordinator = {
      getCurrentOperation: () => undefined,
      getRecentOperations: () => [],
      getMetrics: () => [],
      run: vi.fn(),
      onDidChangeCurrentOperation: (listener) => {
        listeners.push(listener);
        return { dispose: () => {} };
      },
      onDidFinishOperation: vi.fn() as unknown as IOperationCoordinator['onDidFinishOperation'],
    };

    manager.bindToCoordinator(mockCoordinator);
    // dispara undefined → deve chamar setIdle
    listeners.forEach(l => l(undefined));

    expect(setIdleSpy).toHaveBeenCalled();
  });

  it('bindToCoordinator — recebe snapshot → chama setWorking com label', () => {
    const setWorkingSpy = vi.spyOn(manager, 'setWorking');

    const listeners: Array<(s: OperationSnapshot | undefined) => void> = [];
    const mockCoordinator: IOperationCoordinator = {
      getCurrentOperation: () => undefined,
      getRecentOperations: () => [],
      getMetrics: () => [],
      run: vi.fn(),
      onDidChangeCurrentOperation: (listener) => {
        listeners.push(listener);
        return { dispose: () => {} };
      },
      onDidFinishOperation: vi.fn() as unknown as IOperationCoordinator['onDidFinishOperation'],
    };

    manager.bindToCoordinator(mockCoordinator);

    const snapshot: OperationSnapshot = {
      id: 'op-1',
      kind: 'catalog-sync',
      label: 'Syncing catalog',
      status: 'running',
      startedAt: Date.now(),
      refreshTargets: [],
    };
    listeners.forEach(l => l(snapshot));

    expect(setWorkingSpy).toHaveBeenCalled();
  });

  it('bindToCoordinator — snapshot com progress e message → label inclui %', () => {
    const setWorkingSpy = vi.spyOn(manager, 'setWorking');

    const listeners: Array<(s: OperationSnapshot | undefined) => void> = [];
    const mockCoordinator: IOperationCoordinator = {
      getCurrentOperation: () => undefined,
      getRecentOperations: () => [],
      getMetrics: () => [],
      run: vi.fn(),
      onDidChangeCurrentOperation: (listener) => {
        listeners.push(listener);
        return { dispose: () => {} };
      },
      onDidFinishOperation: vi.fn() as unknown as IOperationCoordinator['onDidFinishOperation'],
    };

    manager.bindToCoordinator(mockCoordinator);

    const snapshot: OperationSnapshot = {
      id: 'op-1',
      kind: 'package-install',
      label: 'Installing',
      status: 'running',
      progress: 75,
      message: 'api-design',
      startedAt: Date.now(),
      refreshTargets: [],
    };
    listeners.forEach(l => l(snapshot));

    expect(setWorkingSpy).toHaveBeenCalledWith(expect.stringContaining('75%'));
    expect(setWorkingSpy).toHaveBeenCalledWith(expect.stringContaining('api-design'));
  });

  it('bindToCoordinator substitui subscription anterior ao chamar novamente', () => {
    const listeners1: Array<(s: OperationSnapshot | undefined) => void> = [];
    const listeners2: Array<(s: OperationSnapshot | undefined) => void> = [];

    const makeCoordinator = (listeners: typeof listeners1): IOperationCoordinator => ({
      getCurrentOperation: () => undefined,
      getRecentOperations: () => [],
      getMetrics: () => [],
      run: vi.fn(),
      onDidChangeCurrentOperation: (listener) => {
        listeners.push(listener);
        return { dispose: () => { listeners.splice(0); } };
      },
      onDidFinishOperation: vi.fn() as unknown as IOperationCoordinator['onDidFinishOperation'],
    });

    manager.bindToCoordinator(makeCoordinator(listeners1));
    manager.bindToCoordinator(makeCoordinator(listeners2));

    // O primeiro coordinator foi descartado
    expect(listeners1).toHaveLength(0);
    expect(listeners2).toHaveLength(1);
  });
});

// ─── AppLogger ────────────────────────────────────────────────────────────────

describe('AppLogger', () => {
  let logger: AppLogger;

  beforeEach(() => {
    try { AppLogger.getInstance().dispose(); } catch { /* já limpo */ }
    logger = AppLogger.getInstance();
  });

  afterEach(() => {
    logger.dispose();
  });

  it('getInstance retorna singleton', () => {
    const a = AppLogger.getInstance();
    const b = AppLogger.getInstance();
    expect(a).toBe(b);
  });

  it('dispose destrói a instância e permite criar nova', () => {
    const first = AppLogger.getInstance();
    first.dispose();
    const second = AppLogger.getInstance();
    expect(second).not.toBe(first);
    logger = second;
  });

  it('debug registra mensagem sem dados', () => {
    expect(() => logger.debug('DEBUG_EVENT')).not.toThrow();
    const logs = getLogs();
    expect(logs.some(l => l.message.includes('DEBUG_EVENT'))).toBe(true);
  });

  it('info registra mensagem com dados', () => {
    expect(() => logger.info('INFO_EVENT', { key: 'value' })).not.toThrow();
    const logs = getLogs();
    expect(logs.some(l => l.message.includes('INFO_EVENT') && l.message.includes('value'))).toBe(true);
  });

  it('warn registra warning', () => {
    expect(() => logger.warn('WARN_EVENT', { reason: 'test' })).not.toThrow();
    const logs = getLogs();
    expect(logs.some(l => l.message.includes('WARN_EVENT'))).toBe(true);
  });

  it('error registra erro', () => {
    expect(() => logger.error('ERROR_EVENT', new Error('boom'))).not.toThrow();
    const logs = getLogs();
    expect(logs.some(l => l.message.includes('ERROR_EVENT'))).toBe(true);
  });

  it('error serializa Error com name, message e stack', () => {
    const err = new Error('test error');
    logger.error('SERIALIZE_TEST', err);
    const logs = getLogs();
    const entry = logs.find(l => l.message.includes('SERIALIZE_TEST'));
    expect(entry?.message).toContain('test error');
  });

  it('show não lança exceção', () => {
    expect(() => logger.show()).not.toThrow();
    expect(() => logger.show(false)).not.toThrow();
  });

  it('safeSerialize: usa String() quando JSON.stringify falha (circular)', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular; // referência circular → JSON.stringify vai lançar
    expect(() => logger.debug('CIRCULAR_TEST', circular)).not.toThrow();
  });

  it('formatMessage: sem data retorna apenas a mensagem', () => {
    logger.info('BARE_MESSAGE');
    const logs = getLogs();
    const entry = logs.find(l => l.message === 'BARE_MESSAGE');
    expect(entry).toBeDefined();
  });
});
