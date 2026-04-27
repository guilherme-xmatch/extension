import { describe, it, expect } from 'vitest';
import { ServiceContainer, TOKENS } from '../../src/infrastructure/ServiceContainer';

describe('ServiceContainer', () => {
  it('resolves a registered service', () => {
    const container = new ServiceContainer();
    container.register(TOKENS.Operations, () => ({ run: () => Promise.resolve() }));

    const svc = container.resolve(TOKENS.Operations);
    expect(svc).toBeDefined();
  });

  it('returns the same instance on subsequent resolves (singleton)', () => {
    const container = new ServiceContainer();
    container.register(TOKENS.Scanner, () => ({ id: Math.random() }));

    const first  = container.resolve(TOKENS.Scanner);
    const second = container.resolve(TOKENS.Scanner);
    expect(first).toBe(second);
  });

  it('supports chained register calls', () => {
    const result = new ServiceContainer()
      .register(TOKENS.Metrics,  () => ({ metrics: true }))
      .register(TOKENS.Registry, () => ({ registry: true }));

    expect(result.resolve(TOKENS.Metrics)).toEqual({ metrics: true });
    expect(result.resolve(TOKENS.Registry)).toEqual({ registry: true });
  });

  it('injects resolved dependencies into factory', () => {
    const container = new ServiceContainer()
      .register(TOKENS.Metrics,   () => ({ value: 42 }))
      .register(TOKENS.Installer, c => ({
        metricsValue: (c.resolve<{ value: number }>(TOKENS.Metrics)).value,
      }));

    const installer = container.resolve<{ metricsValue: number }>(TOKENS.Installer);
    expect(installer.metricsValue).toBe(42);
  });

  it('throws when resolving an unregistered token', () => {
    const container = new ServiceContainer();
    expect(() => container.resolve(TOKENS.Registry)).toThrow(/no registration/i);
  });

  it('clears all instances after dispose', () => {
    let callCount = 0;
    const container = new ServiceContainer()
      .register(TOKENS.Scanner, () => { callCount++; return {}; });

    container.resolve(TOKENS.Scanner); // first call → creates instance
    expect(callCount).toBe(1);

    container.dispose();

    // After dispose the factory is also cleared, so resolve should throw
    expect(() => container.resolve(TOKENS.Scanner)).toThrow();
  });

  it('supports custom symbols outside TOKENS', () => {
    const MY_TOKEN = Symbol('MyService');
    const container = new ServiceContainer();
    container.register(MY_TOKEN, () => 'custom-value');

    expect(container.resolve(MY_TOKEN)).toBe('custom-value');
  });
});
