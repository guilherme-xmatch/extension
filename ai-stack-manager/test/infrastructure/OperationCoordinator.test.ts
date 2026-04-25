import { OperationCoordinator } from '../../src/infrastructure/services/OperationCoordinator';

describe('OperationCoordinator', () => {
  it('serializa operações exclusivas e dispara refresh', async () => {
    const coordinator = new OperationCoordinator();
    const refreshHandler = vi.fn(async () => undefined);
    coordinator.setRefreshHandler(refreshHandler);

    const order: string[] = [];
    const first = coordinator.run({ kind: 'catalog-sync', label: 'Sync', refreshTargets: ['catalog'] }, async () => {
      order.push('first-start');
      await new Promise(resolve => setTimeout(resolve, 5));
      order.push('first-end');
    });

    const second = coordinator.run({ kind: 'package-install', label: 'Install', refreshTargets: ['installed'] }, async () => {
      order.push('second-start');
      order.push('second-end');
    });

    await Promise.all([first, second]);

    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
    expect(refreshHandler).toHaveBeenCalledTimes(2);
    expect(coordinator.getCurrentOperation()).toBeUndefined();
  });

  it('mantém histórico recente e métricas por tipo de operação', async () => {
    const coordinator = new OperationCoordinator();

    await coordinator.run({ kind: 'catalog-sync', label: 'Sync catálogo' }, async () => undefined);

    await expect(coordinator.run({ kind: 'catalog-sync', label: 'Sync catálogo' }, async () => {
      throw new Error('falha simulada');
    })).rejects.toThrow('falha simulada');

    const history = coordinator.getRecentOperations();
    const metrics = coordinator.getMetrics();
    const syncMetric = metrics.find(metric => metric.kind === 'catalog-sync');

    expect(history).toHaveLength(2);
    expect(history[0]?.status).toBe('failed');
    expect(history[1]?.status).toBe('completed');
    expect(syncMetric).toMatchObject({
      totalRuns: 2,
      completedRuns: 1,
      failedRuns: 1,
    });
    expect(syncMetric?.averageDurationMs).toBeGreaterThanOrEqual(0);
  });
});