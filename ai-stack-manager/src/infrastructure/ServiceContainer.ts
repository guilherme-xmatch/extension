/**
 * @module infrastructure/ServiceContainer
 * @description Lightweight dependency injection container.
 *
 * Services are registered as lazy factories and instantiated on first resolve.
 * Subsequent resolves return the cached (singleton) instance.
 * Supports chaining: `container.register(...).register(...)`
 *
 * @example
 * ```ts
 * const container = new ServiceContainer()
 *   .register(TOKENS.Registry, () => new GitRegistry())
 *   .register(TOKENS.Installer, c => new FileInstaller(c.resolve(TOKENS.Metrics)));
 *
 * const registry = container.resolve<IPackageRepository>(TOKENS.Registry);
 * ```
 */

// ─── Service Tokens ─────────────────────────────────────────────────────────

export const TOKENS = {
  Registry:     Symbol('IPackageRepository'),
  Scanner:      Symbol('IWorkspaceScanner'),
  Installer:    Symbol('IInstaller'),
  HealthChecker: Symbol('IHealthChecker'),
  Operations:   Symbol('IOperationCoordinator'),
  Metrics:      Symbol('GitHubMetricsService'),
  Publish:      Symbol('PublishService'),
  Insights:     Symbol('InsightsGenerator'),
} as const;

// ─── Container ───────────────────────────────────────────────────────────────

export class ServiceContainer {
  private readonly _factories = new Map<symbol, (c: ServiceContainer) => unknown>();
  private readonly _cache    = new Map<symbol, unknown>();

  /**
   * Registers a lazy factory for a service token.
   * The factory receives the container so it can resolve its own dependencies.
   */
  register<T>(token: symbol, factory: (c: ServiceContainer) => T): this {
    this._factories.set(token, factory as (c: ServiceContainer) => unknown);
    return this;
  }

  /**
   * Resolves a service by token, instantiating it on first call.
   * Throws if the token was never registered.
   */
  resolve<T>(token: symbol): T {
    if (!this._cache.has(token)) {
      const factory = this._factories.get(token);
      if (!factory) {
        throw new Error(`ServiceContainer: no registration for token "${String(token)}".`);
      }
      this._cache.set(token, factory(this));
    }
    return this._cache.get(token) as T;
  }

  /** Clears all cached instances (useful in tests to reset state). */
  dispose(): void {
    this._cache.clear();
    this._factories.clear();
  }
}
