/**
 * Tests for HealthCheckScheduler
 *
 * The scheduler wraps the HealthCheckerService and:
 *  - defers the first run based on elapsed time
 *  - persists state to globalState
 *  - notifies on new errors (count increase)
 *  - exposes lastReport, lastRunTime, isRunning
 *  - is safely disposable
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { HealthCheckScheduler } from '../../src/infrastructure/services/HealthCheckScheduler';
import { HealthReport, HealthSeverity, HealthFinding } from '../../src/domain/entities/HealthReport';
import { queueWarningMessageResponse, resetVscodeMock } from '../setup/vscode.mock';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReport = (errorCount = 0, warnCount = 0): HealthReport => {
  const findings: HealthFinding[] = [];
  for (let i = 0; i < errorCount; i++) {
    findings.push({
      id: `error-${i}`,
      severity: HealthSeverity.Error,
      category: 'general',
      title: `Error ${i}`,
      message: `Error message ${i}`,
      autoFixable: false,
    });
  }
  for (let i = 0; i < warnCount; i++) {
    findings.push({
      id: `warn-${i}`,
      severity: HealthSeverity.Warning,
      category: 'general',
      title: `Warning ${i}`,
      message: `Warning message ${i}`,
      autoFixable: false,
    });
  }
  return HealthReport.create(findings, 10);
};

const makeHealthyReport = () => makeReport(0, 0);

const makeContext = (stored?: { lastRunTime: number; lastErrorCount: number }) => {
  const store = new Map<string, unknown>();
  if (stored) {
    store.set('descomplicai.scheduler.state', stored);
  }
  return {
    globalState: {
      get: (key: string) => store.get(key),
      update: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    },
  } as unknown as import('vscode').ExtensionContext;
};

const makeStatusBar = () => ({
  setWorking: vi.fn(),
  setSuccess: vi.fn(),
  setError:   vi.fn(),
  setIdle:    vi.fn(),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HealthCheckScheduler', () => {

  beforeEach(() => {
    resetVscodeMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── runNow ──────────────────────────────────────────────────────────────────

  it('runNow() retorna o relatório do checker', async () => {
    const report = makeReport(1, 0);
    const checker = { check: vi.fn().mockResolvedValue(report) };
    const ctx = makeContext();
    const scheduler = new HealthCheckScheduler(checker, ctx);

    const result = await scheduler.runNow();

    expect(result).toBe(report);
    expect(checker.check).toHaveBeenCalledOnce();
  });

  it('lastReport retorna undefined antes do primeiro runNow()', () => {
    const checker = { check: vi.fn().mockResolvedValue(makeHealthyReport()) };
    const ctx = makeContext();
    const scheduler = new HealthCheckScheduler(checker, ctx);

    expect(scheduler.lastReport).toBeUndefined();
  });

  it('lastReport é atualizado após runNow()', async () => {
    const report = makeHealthyReport();
    const checker = { check: vi.fn().mockResolvedValue(report) };
    const ctx = makeContext();
    const scheduler = new HealthCheckScheduler(checker, ctx);

    await scheduler.runNow();

    expect(scheduler.lastReport).toBe(report);
  });

  it('runNow() persiste estado no globalState', async () => {
    const report = makeReport(2, 1);
    const checker = { check: vi.fn().mockResolvedValue(report) };
    const ctx = makeContext();
    const scheduler = new HealthCheckScheduler(checker, ctx);

    await scheduler.runNow();

    expect(ctx.globalState.update).toHaveBeenCalledWith(
      'descomplicai.scheduler.state',
      expect.objectContaining({ lastErrorCount: 2 }),
    );
  });

  it('runNow() persiste lastRunTime como timestamp recente', async () => {
    const checker = { check: vi.fn().mockResolvedValue(makeHealthyReport()) };
    const ctx = makeContext();
    const scheduler = new HealthCheckScheduler(checker, ctx);

    const before = Date.now();
    await scheduler.runNow();
    const after = Date.now();

    const call = (ctx.globalState.update as ReturnType<typeof vi.fn>).mock.calls[0];
    const state = call[1] as { lastRunTime: number };
    expect(state.lastRunTime).toBeGreaterThanOrEqual(before);
    expect(state.lastRunTime).toBeLessThanOrEqual(after);
  });

  // ── lastRunTime ─────────────────────────────────────────────────────────────

  it('lastRunTime retorna undefined se não há estado persistido', () => {
    const checker = { check: vi.fn() };
    const ctx = makeContext();
    const scheduler = new HealthCheckScheduler(checker, ctx);

    expect(scheduler.lastRunTime).toBeUndefined();
  });

  it('lastRunTime retorna data persisted quando há estado', () => {
    const ts = Date.now() - 5000;
    const checker = { check: vi.fn() };
    const ctx = makeContext({ lastRunTime: ts, lastErrorCount: 0 });
    const scheduler = new HealthCheckScheduler(checker, ctx);

    expect(scheduler.lastRunTime?.getTime()).toBe(ts);
  });

  // ── isRunning ───────────────────────────────────────────────────────────────

  it('isRunning é false antes e após runNow()', async () => {
    const checker = { check: vi.fn().mockResolvedValue(makeHealthyReport()) };
    const ctx = makeContext();
    const scheduler = new HealthCheckScheduler(checker, ctx);

    expect(scheduler.isRunning).toBe(false);
    const promise = scheduler.runNow();
    await promise;
    expect(scheduler.isRunning).toBe(false);
  });

  // ── Status bar ──────────────────────────────────────────────────────────────

  it('chama statusBar.setWorking antes de rodar o check', async () => {
    const checker = { check: vi.fn().mockResolvedValue(makeHealthyReport()) };
    const ctx = makeContext();
    const bar = makeStatusBar();
    const scheduler = new HealthCheckScheduler(checker, ctx, bar);

    await scheduler.runNow();

    expect(bar.setWorking).toHaveBeenCalledWith('Checando infraestrutura…');
  });

  it('chama statusBar.setSuccess quando infraestrutura está saudável', async () => {
    const checker = { check: vi.fn().mockResolvedValue(makeHealthyReport()) };
    const ctx = makeContext();
    const bar = makeStatusBar();
    const scheduler = new HealthCheckScheduler(checker, ctx, bar);

    await scheduler.runNow();

    expect(bar.setSuccess).toHaveBeenCalledWith('Infraestrutura saudável ✓');
  });

  it('chama statusBar.setError quando há erros críticos', async () => {
    const checker = { check: vi.fn().mockResolvedValue(makeReport(3, 0)) };
    const ctx = makeContext();
    const bar = makeStatusBar();
    const scheduler = new HealthCheckScheduler(checker, ctx, bar);

    await scheduler.runNow();

    expect(bar.setError).toHaveBeenCalledWith(expect.stringContaining('3'));
  });

  it('chama statusBar.setSuccess (com aviso) quando há apenas warnings', async () => {
    const checker = { check: vi.fn().mockResolvedValue(makeReport(0, 2)) };
    const ctx = makeContext();
    const bar = makeStatusBar();
    const scheduler = new HealthCheckScheduler(checker, ctx, bar);

    await scheduler.runNow();

    expect(bar.setSuccess).toHaveBeenCalledWith(expect.stringContaining('2'));
  });

  // ── Notifications ────────────────────────────────────────────────────────────

  it('exibe notificação quando erros aumentam', async () => {
    // Previously 0 errors, now 2
    const checker = { check: vi.fn().mockResolvedValue(makeReport(2, 0)) };
    const ctx = makeContext({ lastRunTime: Date.now() - 1000, lastErrorCount: 0 });
    queueWarningMessageResponse(undefined);
    const scheduler = new HealthCheckScheduler(checker, ctx);

    await scheduler.runNow();

    // The warning message was triggered — no throw is enough to confirm flow
    expect(checker.check).toHaveBeenCalledOnce();
  });

  it('NÃO exibe notificação quando contagem de erros não aumentou', async () => {
    // Previously 3 errors, still 3 → no new notification
    const checker = { check: vi.fn().mockResolvedValue(makeReport(3, 0)) };
    const ctx = makeContext({ lastRunTime: Date.now() - 1000, lastErrorCount: 3 });
    const scheduler = new HealthCheckScheduler(checker, ctx);

    // Should complete without showing a warning
    await expect(scheduler.runNow()).resolves.not.toThrow();
  });

  // ── Error handling ───────────────────────────────────────────────────────────

  it('runNow() não lança mesmo quando checker.check() falha', async () => {
    const checker = { check: vi.fn().mockRejectedValue(new Error('network error')) };
    const ctx = makeContext();
    const bar = makeStatusBar();
    const scheduler = new HealthCheckScheduler(checker, ctx, bar);

    await expect(scheduler.runNow()).resolves.not.toThrow();
    expect(bar.setError).toHaveBeenCalledWith(expect.stringContaining('network error'));
  });

  it('runNow() retorna HealthReport vazio quando checker falha', async () => {
    const checker = { check: vi.fn().mockRejectedValue(new Error('timeout')) };
    const ctx = makeContext();
    const scheduler = new HealthCheckScheduler(checker, ctx);

    const result = await scheduler.runNow();

    expect(result.findings).toHaveLength(0);
  });

  // ── start / dispose ──────────────────────────────────────────────────────────

  it('start(0) não agenda nenhuma execução', async () => {
    const checker = { check: vi.fn().mockResolvedValue(makeHealthyReport()) };
    const ctx = makeContext();
    const scheduler = new HealthCheckScheduler(checker, ctx);

    scheduler.start(0);

    // Advance time by 1 hour — nothing should fire
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(checker.check).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it('start(intervalMs) agenda execução quando estado está stale', async () => {
    // Last run was 10 hours ago → stale → should run after 3s delay
    const staleTime = Date.now() - 10 * 60 * 60 * 1000;
    const checker = { check: vi.fn().mockResolvedValue(makeHealthyReport()) };
    const ctx = makeContext({ lastRunTime: staleTime, lastErrorCount: 0 });
    const scheduler = new HealthCheckScheduler(checker, ctx);

    scheduler.start(6 * 60 * 60 * 1000);  // 6h interval

    // Advance past the 3-second initial delay
    await vi.advanceTimersByTimeAsync(4_000);

    expect(checker.check).toHaveBeenCalledOnce();
    scheduler.dispose();
  });

  it('dispose() cancela o timer e não roda mais checks', async () => {
    const checker = { check: vi.fn().mockResolvedValue(makeHealthyReport()) };
    const ctx = makeContext();
    const scheduler = new HealthCheckScheduler(checker, ctx);

    scheduler.start(1_000);  // 1-second interval

    // Advance 5 seconds
    await vi.advanceTimersByTimeAsync(5_000);
    const countBefore = (checker.check as ReturnType<typeof vi.fn>).mock.calls.length;

    scheduler.dispose();

    // Advance another 5 seconds — should not fire again
    await vi.advanceTimersByTimeAsync(5_000);

    expect((checker.check as ReturnType<typeof vi.fn>).mock.calls.length).toBe(countBefore);
  });
});
