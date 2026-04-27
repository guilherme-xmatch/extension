/**
 * @module infrastructure/ServiceContainer
 * @description Contêiner leve de injeção de dependências.
 *
 * Os serviços são registrados como fábricas preguiçosas e instanciados na primeira resolução.
 * Resoluções subsequentes retornam a instância em cache (singleton).
 * Suporta encadeamento: `container.register(...).register(...)`
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

// ─── Tokens de Serviço ─────────────────────────────────────────────────────────

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

// ─── Contêiner ───────────────────────────────────────────────────────────────

export class ServiceContainer {
  private readonly _factories = new Map<symbol, (c: ServiceContainer) => unknown>();
  private readonly _cache    = new Map<symbol, unknown>();

  /**
   * Registra uma fábrica preguiçosa para um token de serviço.
   * A fábrica recebe o contêiner para que possa resolver suas próprias dependências.
   */
  register<T>(token: symbol, factory: (c: ServiceContainer) => T): this {
    this._factories.set(token, factory as (c: ServiceContainer) => unknown);
    return this;
  }

  /**
   * Resolve um serviço pelo token, instanciando-o na primeira chamada.
   * Lança erro se o token nunca foi registrado.
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

  /** Limpa todas as instâncias em cache (útil em testes para resetar o estado). */
  dispose(): void {
    this._cache.clear();
    this._factories.clear();
  }
}
