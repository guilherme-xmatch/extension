/**
 * @module infrastructure/repositories/GitRegistry
 * @description Orchestrates catalog loading from remote Git repositories, local paths,
 * and JSON endpoints. Delegates network operations to CatalogFetcher and data parsing
 * to CatalogManifestParser, keeping this class focused on coordination and caching.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  Package,
  PackageFile,
  PackageLink,
  PackageStats,
} from '../../domain/entities/Package';
import { Bundle } from '../../domain/entities/Bundle';
import { IPackageRepository } from '../../domain/interfaces';
import { PackageType } from '../../domain/value-objects/PackageType';
import { AgentCategory } from '../../domain/value-objects/AgentCategory';
import { AppLogger } from '../services/AppLogger';
import { CatalogFetcher } from './CatalogFetcher';
import { CatalogManifestParser, CatalogIndex, CatalogPackageManifest, ManifestLinks } from './CatalogManifestParser';

export class GitRegistry implements IPackageRepository {
  private _cache: Package[] = [];
  private _bundlesCache: Bundle[] = [];
  private _initialized = false;
  private _syncPromise?: Promise<void>;
  private readonly _logger = AppLogger.getInstance();
  private readonly _fetcher: CatalogFetcher;

  constructor() {
    const config = vscode.workspace.getConfiguration('descomplicai');
    this._fetcher = new CatalogFetcher(config.get<boolean>('allowUnsafeRegistryUrls', false));
  }

  private get cacheDir(): string {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    return path.join(home, '.descomplicai', 'registry');
  }

  private get repoDir(): string { return path.join(this.cacheDir, 'repo'); }

  private get registryUrl(): string {
    return (vscode.workspace.getConfiguration('descomplicai').get<string>('registryUrl') || '').trim();
  }

  private get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private get workspaceCustomCatalogPath(): string | undefined {
    if (!this.workspaceRoot) { return undefined; }
    return path.join(this.workspaceRoot, '.descomplicai', 'custom-packages.json');
  }

  // ─── Sync ────────────────────────────────────────────────────────────────

  public async sync(): Promise<void> {
    if (this._syncPromise) { return this._syncPromise; }
    this._syncPromise = this.performSync().finally(() => { this._syncPromise = undefined; });
    return this._syncPromise;
  }

  private async performSync(): Promise<void> {
    const url = this.registryUrl;
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });

      if (!url) {
        this._cache = await this.loadWorkspaceCustomPackages();
        this._bundlesCache = [];
        this._initialized = true;
        return;
      }

      if (this._fetcher.isLocalPath(url)) {
        await this.loadFromLocalPath(url);
        this._initialized = true;
        this._logger.info('Catálogo carregado de origem local.', { url });
        return;
      }

      this._fetcher.assertTrustedRegistryUrl(url);

      if (this._fetcher.isJsonEndpoint(url)) {
        await this.loadFromJsonEndpoint(url);
      } else {
        await this._fetcher.ensureLocalClone(url, this.repoDir);
        await this.loadFromDisk(this.repoDir);
      }

      this._initialized = true;
      this._logger.info('Catálogo sincronizado.', { url, packages: this._cache.length, bundles: this._bundlesCache.length });
    } catch (error) {
      this._logger.error('Falha ao sincronizar o catálogo.', { url, error });
      this._cache = await this.loadWorkspaceCustomPackages();
      this._bundlesCache = [];
      this._initialized = true;
      if (url) {
        void vscode.window.showWarningMessage('Falha ao sincronizar o catálogo remoto. Usando apenas pacotes locais/customizados.');
      }
    }
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  public async saveWorkspaceCustomPackage(pkg: Package): Promise<void> {
    const filePath = this.workspaceCustomCatalogPath;
    if (!filePath) { throw new Error('Nenhum workspace aberto para salvar o MCP customizado.'); }

    const existing = await this.readWorkspaceCustomPackageManifests();
    const nextManifest = this.serializePackage(pkg);
    const filtered = existing.filter(item => CatalogManifestParser.asString(item.id) !== pkg.id);
    filtered.push(nextManifest);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), 'utf-8');

    const idx = this._cache.findIndex(item => item.id === pkg.id);
    if (idx >= 0) { this._cache.splice(idx, 1, pkg); } else { this._cache.push(pkg); }
  }

  // ─── Loading ─────────────────────────────────────────────────────────────

  private async loadFromJsonEndpoint(url: string): Promise<void> {
    const payload = await this._fetcher.fetchJson(url);
    const catalog = Array.isArray(payload) ? { packages: payload } : (payload && typeof payload === 'object' ? payload as CatalogIndex : {});
    await this.loadFromCatalogPayload(catalog, undefined);
  }

  private async loadFromDisk(rootDir: string): Promise<void> {
    const indexPath = path.join(rootDir, 'catalog', 'index.json');
    const index = fs.existsSync(indexPath)
      ? CatalogManifestParser.parseJsonWithComments(fs.readFileSync(indexPath, 'utf-8')) as CatalogIndex
      : {};
    await this.loadFromCatalogPayload(index, rootDir);
  }

  private async loadFromLocalPath(rawPath: string): Promise<void> {
    const normalizedPath = this._fetcher.normalizeLocalPath(rawPath);
    const stat = fs.statSync(normalizedPath);
    if (stat.isDirectory()) { await this.loadFromDisk(normalizedPath); return; }
    if (!stat.isFile() || !normalizedPath.toLowerCase().endsWith('.json')) {
      throw new Error('A origem local deve ser uma pasta de repositório ou um arquivo JSON.');
    }
    const payload = CatalogManifestParser.parseJsonWithComments(fs.readFileSync(normalizedPath, 'utf-8'));
    const catalog = Array.isArray(payload) ? { packages: payload } : (payload && typeof payload === 'object' ? payload as CatalogIndex : {});
    await this.loadFromCatalogPayload(catalog, path.dirname(normalizedPath));
  }

  private async loadFromCatalogPayload(payload: CatalogIndex, rootDir?: string): Promise<void> {
    const baseRepoUrl = this._fetcher.normalizeRepoUrl(payload.repoUrl || this.registryUrl);
    const packageRefs = Array.isArray(payload.packages) && payload.packages.length > 0
      ? payload.packages
      : rootDir
        ? this.discoverManifestFiles(rootDir).map(f => CatalogManifestParser.toRelativePath(rootDir, f))
        : [];

    const packages = packageRefs
      .map(ref => typeof ref === 'string'
        ? this.loadPackageFromManifestFile(rootDir, ref, baseRepoUrl, payload)
        : this.packageFromManifestObject(ref, rootDir, baseRepoUrl, payload))
      .filter((pkg): pkg is Package => Boolean(pkg));

    const workspaceCustom = await this.loadWorkspaceCustomPackages();
    const deduped = new Map<string, Package>();
    for (const pkg of [...packages, ...workspaceCustom]) { deduped.set(pkg.id, pkg); }

    this._cache = [...deduped.values()];
    this._bundlesCache = rootDir ? this.loadBundles(rootDir, payload) : this.loadBundlesFromPayload(payload);
  }

  // ─── Package Hydration ───────────────────────────────────────────────────

  private discoverManifestFiles(rootDir: string): string[] {
    return ['agents', 'skills', 'mcps', 'prompts', 'instructions']
      .flatMap(folder => this.collectFiles(path.join(rootDir, folder), f => path.basename(f) === 'manifest.json'));
  }

  private loadPackageFromManifestFile(rootDir: string | undefined, manifestPath: string, baseRepoUrl: string, index: CatalogIndex): Package | undefined {
    if (!rootDir) { return undefined; }
    const abs = path.isAbsolute(manifestPath) ? manifestPath : path.join(rootDir, manifestPath);
    if (!fs.existsSync(abs)) {
      this._logger.warn('Manifest referenciado não encontrado.', { manifestPath, rootDir });
      return undefined;
    }
    const manifest = CatalogManifestParser.parseJsonWithComments(fs.readFileSync(abs, 'utf-8')) as CatalogPackageManifest;
    return this.packageFromManifestObject(manifest, rootDir, baseRepoUrl, index, CatalogManifestParser.toRelativePath(rootDir, abs));
  }

  private packageFromManifestObject(
    manifest: CatalogPackageManifest,
    rootDir: string | undefined,
    baseRepoUrl: string,
    index: CatalogIndex,
    manifestPathHint?: string,
  ): Package | undefined {
    const source = manifestPathHint || CatalogManifestParser.asString(manifest.source?.manifestPath) || '[inline-manifest]';
    const validated = CatalogManifestParser.validateManifest(manifest, source, url => this._fetcher.isSafeRemoteUrl(url), this._logger);
    if (!validated) { return undefined; }
    manifest = validated;

    const typeValue = CatalogManifestParser.asString(manifest.type);
    if (!typeValue) { return undefined; }

    const type = PackageType.fromString(typeValue);
    const manifestPath = manifestPathHint || CatalogManifestParser.asString(manifest.source?.manifestPath);
    const manifestDirRel = manifestPath ? path.posix.dirname(manifestPath) : CatalogManifestParser.asString(manifest.source?.packagePath);
    const manifestDirAbs = rootDir && manifestDirRel ? path.join(rootDir, manifestDirRel) : rootDir;

    const installTargets = CatalogManifestParser.asInstallTargets(manifest.install?.targets);
    const files = this.resolveFiles(manifestDirAbs, installTargets, manifest.files, type);
    const name = CatalogManifestParser.slugify(CatalogManifestParser.asString(manifest.name) || CatalogManifestParser.asString(manifest.displayName) || CatalogManifestParser.asString(manifest.id) || 'package');
    const displayName = CatalogManifestParser.asString(manifest.displayName) || CatalogManifestParser.toDisplayName(name);
    const description = CatalogManifestParser.asString(manifest.description) || displayName;
    const author = CatalogManifestParser.asAuthor(manifest.author);
    const readmePath = CatalogManifestParser.asString(manifest.docs?.readmePath) || CatalogManifestParser.asString(manifest.source?.readmePath);
    const detailsPath = CatalogManifestParser.asString(manifest.docs?.detailsPath) || CatalogManifestParser.asString(manifest.source?.detailsPath);
    const readme = manifest.docs?.readme ?? this.readOptionalText(manifestDirAbs, readmePath);
    const details = manifest.docs?.details ?? this.readOptionalText(manifestDirAbs, detailsPath);
    const stats = this.resolveStats(rootDir, index, manifest.id || `${type.value}-${name}`, manifest.stats);
    const links = this.resolveLinks(manifest.docs?.links, CatalogManifestParser.asString(manifest.source?.homepage), baseRepoUrl, manifestDirRel);
    const inferredCategory = this.inferAgentCategory(name, description);
    const agentMeta = type.equals(PackageType.Agent) ? {
      category: AgentCategory.fromString(CatalogManifestParser.asString(manifest.agentMeta?.category) || inferredCategory.value),
      tools: CatalogManifestParser.asStringArray(manifest.agentMeta?.tools),
      delegatesTo: CatalogManifestParser.asStringArray(manifest.agentMeta?.delegatesTo),
      workflowPhase: CatalogManifestParser.asString(manifest.agentMeta?.workflowPhase) || this.inferWorkflowPhase(inferredCategory, name),
      userInvocable: CatalogManifestParser.asBoolean(manifest.agentMeta?.userInvocable, false),
      relatedSkills: CatalogManifestParser.asStringArray(manifest.agentMeta?.relatedSkills),
    } : undefined;

    return Package.create({
      id: CatalogManifestParser.asString(manifest.id) || `${type.value}-${name}`,
      name,
      displayName,
      description,
      type,
      version: CatalogManifestParser.asString(manifest.version) || '1.0.0',
      tags: CatalogManifestParser.asStringArray(manifest.tags),
      author,
      files,
      dependencies: CatalogManifestParser.asStringArray(manifest.dependencies),
      icon: CatalogManifestParser.asString(manifest.icon) || type.codicon,
      source: {
        repoUrl: CatalogManifestParser.asString(manifest.source?.repoUrl) || baseRepoUrl,
        packagePath: CatalogManifestParser.asString(manifest.source?.packagePath) || manifestDirRel,
        manifestPath,
        readmePath,
        detailsPath,
        homepage: CatalogManifestParser.asString(manifest.source?.homepage),
        official: CatalogManifestParser.asBoolean(manifest.source?.official, true),
      },
      installStrategy: {
        kind: manifest.install?.strategy === 'mcp-merge' || type.equals(PackageType.MCP) ? 'mcp-merge' : 'copy',
        targets: installTargets.map(t => ({ sourcePath: t.sourcePath, targetPath: t.targetPath, mergeStrategy: t.mergeStrategy })),
      },
      ui: {
        longDescription: CatalogManifestParser.asString(manifest.ui?.longDescription) || details || readme || description,
        highlights: CatalogManifestParser.asStringArray(manifest.ui?.highlights),
        installNotes: CatalogManifestParser.asStringArray(manifest.ui?.installNotes),
        badges: CatalogManifestParser.asStringArray(manifest.ui?.badges),
        maturity: CatalogManifestParser.asMaturity(manifest.ui?.maturity),
        icon: CatalogManifestParser.asString(manifest.ui?.icon),
        banner: CatalogManifestParser.asString(manifest.ui?.banner),
      },
      docs: { readme, details, links },
      stats,
      agentMeta,
    });
  }

  // ─── File and Stats Resolution ───────────────────────────────────────────

  private resolveFiles(manifestDirAbs: string | undefined, targets: ReturnType<typeof CatalogManifestParser.asInstallTargets>, inlineFiles: CatalogPackageManifest['files'], type: PackageType): PackageFile[] {
    if (targets.length > 0 && manifestDirAbs) {
      return targets.map(target => {
        const srcPath = target.sourcePath ? path.join(manifestDirAbs, target.sourcePath) : undefined;
        return { relativePath: target.targetPath, content: srcPath && fs.existsSync(srcPath) ? fs.readFileSync(srcPath, 'utf-8') : this.defaultInlineContent(type) };
      });
    }
    if (Array.isArray(inlineFiles) && inlineFiles.length > 0) {
      return inlineFiles.flatMap(f => {
        const rp = CatalogManifestParser.asString(f.relativePath);
        return rp ? [{ relativePath: rp, content: typeof f.content === 'string' ? f.content : '' }] : [];
      });
    }
    if (type.equals(PackageType.MCP)) { return [{ relativePath: '.vscode/mcp.json', content: '{\n  "servers": {}\n}' }]; }
    return [];
  }

  private resolveStats(rootDir: string | undefined, index: CatalogIndex, packageId: string, inlineStats?: PackageStats): PackageStats {
    const basePath = index.stats?.packagesBasePath || 'catalog/stats/packages';
    const def: PackageStats = { installsTotal: inlineStats?.installsTotal ?? 0, uniqueInstallers: inlineStats?.uniqueInstallers, lastInstallAt: inlineStats?.lastInstallAt, trendScore: inlineStats?.trendScore };
    if (!rootDir) { return def; }
    const statsPath = path.join(rootDir, ...basePath.split('/'), `${packageId}.json`);
    if (!fs.existsSync(statsPath)) { return def; }
    try {
      const parsed = CatalogManifestParser.parseJsonWithComments(fs.readFileSync(statsPath, 'utf-8')) as Partial<PackageStats>;
      return {
        installsTotal: typeof parsed.installsTotal === 'number' ? parsed.installsTotal : def.installsTotal,
        uniqueInstallers: typeof parsed.uniqueInstallers === 'number' ? parsed.uniqueInstallers : def.uniqueInstallers,
        lastInstallAt: typeof parsed.lastInstallAt === 'string' ? parsed.lastInstallAt : def.lastInstallAt,
        trendScore: typeof parsed.trendScore === 'number' ? parsed.trendScore : def.trendScore,
      };
    } catch (error) {
      this._logger.warn('Falha ao carregar estatísticas do pacote.', { packageId, error });
      return def;
    }
  }

  private resolveLinks(links: ManifestLinks | undefined, homepage: string | undefined, baseRepoUrl: string, manifestDirRel: string): PackageLink[] {
    const resolved = new Map<string, PackageLink>();
    for (const link of links ?? []) {
      const label = CatalogManifestParser.asString(link.label);
      const url = CatalogManifestParser.asString(link.url);
      if (label && url) { resolved.set(label, { label, url }); }
    }
    if (homepage) { resolved.set('Homepage', { label: 'Homepage', url: homepage }); }
    if (baseRepoUrl && manifestDirRel) {
      resolved.set('Repositório', { label: 'Repositório', url: `${baseRepoUrl.replace(/\.git$/i, '')}/tree/main/${manifestDirRel.replace(/\\/g, '/')}` });
    }
    return [...resolved.values()];
  }

  // ─── Bundle Loading ───────────────────────────────────────────────────────

  private loadBundles(rootDir: string, payload: CatalogIndex): Bundle[] {
    const fromIndex = this.loadBundlesFromPayload(payload);
    if (fromIndex.length > 0) { return fromIndex; }
    const bundlesPath = path.join(rootDir, 'catalog', 'bundles.json');
    if (!fs.existsSync(bundlesPath)) { return []; }
    try {
      const parsed = CatalogManifestParser.parseJsonWithComments(fs.readFileSync(bundlesPath, 'utf-8')) as { bundles?: unknown[] } | unknown[];
      const raw = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { bundles?: unknown[] }).bundles) ? (parsed as { bundles: unknown[] }).bundles : [];
      return raw.map(b => this.bundleFromManifest(b)).filter((b): b is Bundle => Boolean(b));
    } catch (error) {
      this._logger.warn('Falha ao carregar bundles.', { bundlesPath, error });
      return [];
    }
  }

  private loadBundlesFromPayload(payload: CatalogIndex): Bundle[] {
    return (payload.bundles ?? []).map(b => this.bundleFromManifest(b)).filter((b): b is Bundle => Boolean(b));
  }

  private bundleFromManifest(input: unknown): Bundle | undefined {
    if (!input || typeof input !== 'object') { return undefined; }
    const b = input as Record<string, unknown>;
    const packageIds = CatalogManifestParser.asStringArray(b.packageIds);
    if (packageIds.length === 0) { return undefined; }
    const name = CatalogManifestParser.slugify(CatalogManifestParser.asString(b.name) || CatalogManifestParser.asString(b.displayName) || 'bundle');
    return Bundle.create({
      id: CatalogManifestParser.asString(b.id) || `bundle-${name}`,
      name,
      displayName: CatalogManifestParser.asString(b.displayName) || CatalogManifestParser.toDisplayName(name),
      description: CatalogManifestParser.asString(b.description) || 'Bundle do catálogo público',
      version: CatalogManifestParser.asString(b.version) || '1.0.0',
      packageIds,
      icon: CatalogManifestParser.asString(b.icon) || '$(package)',
      color: CatalogManifestParser.asString(b.color) || '#EC7000',
    });
  }

  // ─── Workspace Custom Packages ────────────────────────────────────────────

  private async loadWorkspaceCustomPackages(): Promise<Package[]> {
    const manifests = await this.readWorkspaceCustomPackageManifests();
    return manifests.map(m => this.packageFromManifestObject(m, undefined, '', {})).filter((p): p is Package => Boolean(p));
  }

  private async readWorkspaceCustomPackageManifests(): Promise<CatalogPackageManifest[]> {
    const filePath = this.workspaceCustomCatalogPath;
    if (!filePath || !fs.existsSync(filePath)) { return []; }
    try {
      const parsed = CatalogManifestParser.parseJsonWithComments(fs.readFileSync(filePath, 'utf-8'));
      return Array.isArray(parsed) ? parsed as CatalogPackageManifest[] : [];
    } catch (error) {
      this._logger.warn('Falha ao carregar catálogo customizado.', { filePath, error });
      return [];
    }
  }

  private serializePackage(pkg: Package): CatalogPackageManifest {
    return {
      id: pkg.id, name: pkg.name, displayName: pkg.displayName, description: pkg.description,
      type: pkg.type.value, version: pkg.version.toString(), tags: [...pkg.tags], author: pkg.author,
      dependencies: [...pkg.dependencies], icon: pkg.icon,
      files: pkg.files.map(f => ({ relativePath: f.relativePath, content: f.content })),
      install: { strategy: pkg.installStrategy.kind, targets: pkg.installStrategy.targets.map(t => ({ source: t.sourcePath, target: t.targetPath, mergeStrategy: t.mergeStrategy })) },
      source: { repoUrl: pkg.source.repoUrl, packagePath: pkg.source.packagePath, manifestPath: pkg.source.manifestPath, readmePath: pkg.source.readmePath, detailsPath: pkg.source.detailsPath, homepage: pkg.source.homepage, official: pkg.source.official },
      ui: { longDescription: pkg.ui.longDescription, highlights: [...pkg.ui.highlights], installNotes: [...pkg.ui.installNotes], badges: [...pkg.ui.badges], maturity: pkg.ui.maturity, icon: pkg.ui.icon, banner: pkg.ui.banner },
      docs: { readme: pkg.docs.readme, details: pkg.docs.details, links: pkg.docs.links.map(l => ({ label: l.label, url: l.url })) },
      stats: pkg.stats,
      agentMeta: pkg.agentMeta ? { category: pkg.agentMeta.category.value, tools: [...pkg.agentMeta.tools], delegatesTo: [...pkg.agentMeta.delegatesTo], workflowPhase: pkg.agentMeta.workflowPhase, userInvocable: pkg.agentMeta.userInvocable, relatedSkills: [...pkg.agentMeta.relatedSkills] } : undefined,
    };
  }

  // ─── Inference Helpers ────────────────────────────────────────────────────

  private inferAgentCategory(name: string, description: string): AgentCategory {
    const text = `${name} ${description}`.toLowerCase();
    if (text.includes('orchestr')) { return AgentCategory.Orchestrator; }
    if (text.includes('planner') || text.includes('planej')) { return AgentCategory.Planner; }
    if (text.includes('review') || text.includes('critic') || text.includes('test') || text.includes('guard')) { return AgentCategory.Guardian; }
    if (text.includes('memory') || text.includes('memória') || text.includes('remember')) { return AgentCategory.Memory; }
    return AgentCategory.Specialist;
  }

  private inferWorkflowPhase(category: AgentCategory, name: string): string {
    if (category.equals(AgentCategory.Orchestrator)) { return 'TRIAGE'; }
    if (category.equals(AgentCategory.Planner)) { return 'PLAN'; }
    if (category.equals(AgentCategory.Memory)) { return 'REMEMBER'; }
    const n = name.toLowerCase();
    if (n.includes('architect')) { return 'DESIGN'; }
    if (n.includes('test')) { return 'VALIDATION'; }
    if (n.includes('review') || n.includes('critic')) { return 'CRITIC'; }
    return 'EXECUTION';
  }

  private defaultInlineContent(type: PackageType): string {
    return type.equals(PackageType.MCP) ? '{\n  "servers": {}\n}' : '';
  }

  private readOptionalText(baseDir: string | undefined, relativePath: string): string | undefined {
    if (!baseDir || !relativePath) { return undefined; }
    const abs = path.join(baseDir, relativePath);
    if (!fs.existsSync(abs)) { return undefined; }
    return fs.readFileSync(abs, 'utf-8');
  }

  private collectFiles(baseDir: string, predicate: (f: string) => boolean): string[] {
    if (!fs.existsSync(baseDir)) { return []; }
    const results: string[] = [];
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      const full = path.join(baseDir, entry.name);
      if (entry.isDirectory()) { results.push(...this.collectFiles(full, predicate)); }
      else if (predicate(full)) { results.push(full); }
    }
    return results;
  }

  // ─── IPackageRepository ───────────────────────────────────────────────────

  async getAll(): Promise<Package[]> {
    if (!this._initialized) { await this.sync(); }
    return [...this._cache];
  }

  async findById(id: string): Promise<Package | undefined> {
    return (await this.getAll()).find(pkg => pkg.id === id);
  }

  async search(query: string): Promise<Package[]> {
    return (await this.getAll()).filter(pkg => pkg.matchesQuery(query));
  }

  async getAgentNetwork(agentId: string): Promise<Package[]> {
    const pkg = await this.findById(agentId);
    if (!pkg?.agentMeta) { return []; }
    const all = await this.getAll();
    return pkg.agentMeta.delegatesTo
      .map(d => all.find(item => item.id === d || item.name === d || item.id === `agent-${d}`))
      .filter((item): item is Package => Boolean(item));
  }

  async getRelatedSkills(agentId: string): Promise<Package[]> {
    const pkg = await this.findById(agentId);
    if (!pkg?.agentMeta) { return []; }
    const all = await this.getAll();
    return pkg.agentMeta.relatedSkills
      .map(s => all.find(item => item.id === s || item.name === s || item.id === `skill-${s}`))
      .filter((item): item is Package => Boolean(item));
  }

  async getAllBundles(): Promise<Bundle[]> {
    if (!this._initialized) { await this.sync(); }
    return [...this._bundlesCache];
  }

  async findBundleById(id: string): Promise<Bundle | undefined> {
    return (await this.getAllBundles()).find(b => b.id === id);
  }
}
