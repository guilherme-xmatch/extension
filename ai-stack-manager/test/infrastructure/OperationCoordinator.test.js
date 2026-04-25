"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const OperationCoordinator_1 = require("../../src/infrastructure/services/OperationCoordinator");
(0, vitest_1.describe)('OperationCoordinator', () => {
    (0, vitest_1.it)('serializa operações exclusivas e dispara refresh', async () => {
        const coordinator = new OperationCoordinator_1.OperationCoordinator();
        const refreshHandler = vitest_1.vi.fn(async () => undefined);
        coordinator.setRefreshHandler(refreshHandler);
        const order = [];
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
        (0, vitest_1.expect)(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
        (0, vitest_1.expect)(refreshHandler).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(coordinator.getCurrentOperation()).toBeUndefined();
    });
});
//# sourceMappingURL=OperationCoordinator.test.js.map