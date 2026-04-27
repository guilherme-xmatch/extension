/**
 * @module infrastructure/repositories/LocalRegistry
 * @description Involuçro leve em torno dos dados do catálogo local implementando IPackageRepository.
 * Usado como fallback interno quando o registry remoto está indisponível.
 * Aceita dados opcionais de pacotes/bundles para injeção de dependências em testes.
 */

import { Package } from '../../domain/entities/Package';
import { Bundle } from '../../domain/entities/Bundle';
import { IPackageRepository } from '../../domain/interfaces';
import { LOCAL_CATALOG_PACKAGES, LOCAL_CATALOG_BUNDLES } from './LocalCatalogData';

export class LocalRegistry implements IPackageRepository {
  private readonly _packages: readonly Package[];
  private readonly _bundles: readonly Bundle[];

  constructor(packages?: readonly Package[], bundles?: readonly Bundle[]) {
    this._packages = packages ?? LOCAL_CATALOG_PACKAGES;
    this._bundles  = bundles  ?? LOCAL_CATALOG_BUNDLES;
  }

  async getAll(): Promise<Package[]> { return [...this._packages]; }

  async findById(id: string): Promise<Package | undefined> {
    return this._packages.find(p => p.id === id);
  }

  async search(query: string): Promise<Package[]> {
    return this._packages.filter(p => p.matchesQuery(query));
  }

  async getAllBundles(): Promise<Bundle[]> { return [...this._bundles]; }

  async findBundleById(id: string): Promise<Bundle | undefined> {
    return this._bundles.find(b => b.id === id);
  }

  async getAgentNetwork(agentId: string): Promise<Package[]> {
    const agent = await this.findById(agentId);
    if (!agent?.agentMeta) { return []; }
    return agent.agentMeta.delegatesTo
      .map(d => this._packages.find(p => p.name === d || p.id === `agent-${d}`))
      .filter((p): p is Package => Boolean(p));
  }

  async getRelatedSkills(agentId: string): Promise<Package[]> {
    const agent = await this.findById(agentId);
    if (!agent?.agentMeta) { return []; }
    return agent.agentMeta.relatedSkills
      .map(s => this._packages.find(p => p.id === s || p.name === s))
      .filter((p): p is Package => Boolean(p));
  }
}
