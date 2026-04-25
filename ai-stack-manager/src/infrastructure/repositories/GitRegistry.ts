import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  Package,
  PackageFile,
  PackageInstallTarget,
  PackageLink,
  PackageMaturity,
  PackageStats,
} from '../../domain/entities/Package';
import { Bundle } from '../../domain/entities/Bundle';
import { IPackageRepository } from '../../domain/interfaces';
import { PackageType } from '../../domain/value-objects/PackageType';
import { AgentCategory } from '../../domain/value-objects/AgentCategory';
import { AppLogger } from '../services/AppLogger';

const execAsync = promisify(exec);

interface CatalogIndex {
  schemaVersion?: string;
  repoUrl?: string;
  packages?: Array<string | CatalogPackageManifest>;
  bundles?: unknown[];
  stats?: {
    packagesBasePath?: string;
  };
}

interface CatalogPackageManifest {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  type?: string;
  version?: string;
  tags?: string[];
  author?: string | { name?: string };
  dependencies?: string[];
  icon?: string;
  files?: Array<{ relativePath?: string; content?: string }>;
  install?: {
    strategy?: 'copy' | 'mcp-merge';
    targets?: Array<{
      source?: string;
      target?: string;
      mergeStrategy?: 'replace' | 'merge-mcp-servers';
    }>;
  };
  source?: {
    repoUrl?: string;
    packagePath?: string;
    manifestPath?: string;
    readmePath?: string;
    detailsPath?: string;
    homepage?: string;
    official?: boolean;
  };
  ui?: {
    longDescription?: string;
    highlights?: string[];
    installNotes?: string[];
    badges?: string[];
    maturity?: PackageMaturity;
    icon?: string;
    banner?: string;
  };
  docs?: {
    readmePath?: string;
    detailsPath?: string;
    readme?: string;
    details?: string;
    links?: Array<{ label?: string; url?: string }>;
  };
  stats?: PackageStats;
  agentMeta?: {
    category?: string;
    tools?: string[];
    delegatesTo?: string[];
    workflowPhase?: string;
    userInvocable?: boolean;
    relatedSkills?: string[];
  };
}

type ManifestInstallTargets = Array<{
  source?: string;
  target?: string;
  mergeStrategy?: 'replace' | 'merge-mcp-servers';
}>;

type ManifestLinks = Array<{ label?: string; url?: string }>;

export class GitRegistry implements IPackageRepository {
  private _cache: Package[] = [];
  private _bundlesCache: Bundle[] = [];
  private _initialized = false;
  private _syncPromise?: Promise<void>;
  private readonly _logger = AppLogger.getInstance();

  private static readonly TRUSTED_REGISTRY_PREFIXES = [
    'https://github.com/guilherme-xmatch/DescomplicAI',
    'https://raw.githubusercontent.com/guilherme-xmatch/DescomplicAI',
  ];

  private get cacheDir(): string {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    return path.join(home, '.descomplicai', 'registry');
  }

  private get repoDir(): string {
    return path.join(this.cacheDir, 'repo');
  }

  private get registryUrl(): string {
    const config = vscode.workspace.getConfiguration('descomplicai');
    return (config.get<string>('registryUrl') || '').trim();
  }

  private get allowUnsafeRegistryUrls(): boolean {
    const config = vscode.workspace.getConfiguration('descomplicai');
    return config.get<boolean>('allowUnsafeRegistryUrls', false);
  }

  private get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private get workspaceCustomCatalogPath(): string | undefined {
    if (!this.workspaceRoot) { return undefined; }
    return path.join(this.workspaceRoot, '.descomplicai', 'custom-packages.json');
  }

  public async sync(): Promise<void> {
    if (this._syncPromise) {
      return this._syncPromise;
    }

    this._syncPromise = this.performSync().finally(() => {
      this._syncPromise = undefined;
    });

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

      if (this.isLocalPath(url)) {
        await this.loadFromLocalPath(url);
        this._initialized = true;
        this._logger.info('Catálogo carregado de origem local.', { url });
        return;
      }

      this.assertTrustedRegistryUrl(url);

      if (this.isJsonEndpoint(url)) {
        await this.loadFromJsonEndpoint(url);
      } else {
        await this.ensureLocalClone(url);
        await this.loadFromDisk(this.repoDir);
      }

      this._initialized = true;
      this._logger.info('Catálogo sincronizado com sucesso.', { url, packages: this._cache.length, bundles: this._bundlesCache.length });
    } catch (error) {
      this._logger.error('Falha ao sincronizar o catálogo manifest-driven.', { url, error });
      this._cache = await this.loadWorkspaceCustomPackages();
      this._bundlesCache = [];
      this._initialized = true;
      if (url) {
        void vscode.window.showWarningMessage('Falha ao sincronizar o catálogo remoto. Usando apenas pacotes locais/customizados.');
      }
    }
  }

  public async saveWorkspaceCustomPackage(pkg: Package): Promise<void> {
    const filePath = this.workspaceCustomCatalogPath;
    if (!filePath) {
      throw new Error('Nenhum workspace aberto para salvar o MCP customizado.');
    }

    const existing = await this.readWorkspaceCustomPackageManifests();
    const nextManifest = this.serializePackage(pkg);
    const filtered = existing.filter(item => this.asString(item.id) !== pkg.id);
    filtered.push(nextManifest);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), 'utf-8');

    const existingPackageIndex = this._cache.findIndex(item => item.id === pkg.id);
    if (existingPackageIndex >= 0) {
      this._cache.splice(existingPackageIndex, 1, pkg);
    } else {
      this._cache.push(pkg);
    }
  }

  private async loadFromJsonEndpoint(url: string): Promise<void> {
    const payload = await this.fetchJson(url);
    const catalog = Array.isArray(payload)
      ? { packages: payload }
      : (payload && typeof payload === 'object' ? payload as CatalogIndex : {});

    await this.loadFromCatalogPayload(catalog, undefined);
  }

  private async loadFromDisk(rootDir: string): Promise<void> {
    const indexPath = path.join(rootDir, 'catalog', 'index.json');
    const index = fs.existsSync(indexPath)
      ? this.parseJsonWithComments(fs.readFileSync(indexPath, 'utf-8')) as CatalogIndex
      : {};

    await this.loadFromCatalogPayload(index, rootDir);
  }

  private async loadFromLocalPath(rawPath: string): Promise<void> {
    const normalizedPath = this.normalizeLocalPath(rawPath);
    const stat = fs.statSync(normalizedPath);

    if (stat.isDirectory()) {
      await this.loadFromDisk(normalizedPath);
      return;
    }

    if (!stat.isFile() || !normalizedPath.toLowerCase().endsWith('.json')) {
      throw new Error('A origem local do catálogo deve ser uma pasta do repositório ou um arquivo JSON.');
    }

    const payload = this.parseJsonWithComments(fs.readFileSync(normalizedPath, 'utf-8'));
    const catalog = Array.isArray(payload)
      ? { packages: payload }
      : (payload && typeof payload === 'object' ? payload as CatalogIndex : {});

    await this.loadFromCatalogPayload(catalog, path.dirname(normalizedPath));
  }

  private async loadFromCatalogPayload(payload: CatalogIndex, rootDir?: string): Promise<void> {
    const baseRepoUrl = this.normalizeRepoUrl(payload.repoUrl || this.registryUrl);
    const packageRefs = Array.isArray(payload.packages) && payload.packages.length > 0
      ? payload.packages
      : rootDir
        ? this.discoverManifestFiles(rootDir).map(filePath => this.toRelativePath(rootDir, filePath))
        : [];

    const packages = packageRefs
      .map(ref => typeof ref === 'string'
        ? this.loadPackageFromManifestFile(rootDir, ref, baseRepoUrl, payload)
        : this.packageFromManifestObject(ref, rootDir, baseRepoUrl, payload))
      .filter((pkg): pkg is Package => Boolean(pkg));

    const workspaceCustomPackages = await this.loadWorkspaceCustomPackages();
    const deduped = new Map<string, Package>();
    for (const pkg of [...packages, ...workspaceCustomPackages]) {
      deduped.set(pkg.id, pkg);
    }

    this._cache = [...deduped.values()];
    this._bundlesCache = rootDir ? this.loadBundles(rootDir, payload) : this.loadBundlesFromPayload(payload);
  }

  private discoverManifestFiles(rootDir: string): string[] {
    const roots = ['agents', 'skills', 'mcps', 'prompts', 'instructions'];
    return roots.flatMap(folder => this.collectFiles(path.join(rootDir, folder), filePath => path.basename(filePath) === 'manifest.json'));
  }

  private loadPackageFromManifestFile(rootDir: string | undefined, manifestPath: string, baseRepoUrl: string, index: CatalogIndex): Package | undefined {
    if (!rootDir) { return undefined; }
    const absoluteManifestPath = path.isAbsolute(manifestPath) ? manifestPath : path.join(rootDir, manifestPath);
    if (!fs.existsSync(absoluteManifestPath)) {
      this._logger.warn('Manifest referenciado não foi encontrado.', { manifestPath, rootDir });
      return undefined;
    }

    const manifest = this.parseJsonWithComments(fs.readFileSync(absoluteManifestPath, 'utf-8')) as CatalogPackageManifest;
    return this.packageFromManifestObject(
      manifest,
      rootDir,
      baseRepoUrl,
      index,
      this.toRelativePath(rootDir, absoluteManifestPath),
    );
  }

  private packageFromManifestObject(
    manifest: CatalogPackageManifest,
    rootDir: string | undefined,
    baseRepoUrl: string,
    index: CatalogIndex,
    manifestPathHint?: string,
  ): Package | undefined {
    const manifestSource = manifestPathHint || this.asString(manifest.source?.manifestPath) || '[inline-manifest]';
    const validatedManifest = this.validateManifest(manifest, manifestSource);
    if (!validatedManifest) {
      return undefined;
    }

    manifest = validatedManifest;
    const typeValue = this.asString(manifest.type);
    if (!typeValue) { return undefined; }

    const type = PackageType.fromString(typeValue);
    const manifestPath = manifestPathHint || this.asString(manifest.source?.manifestPath);
    const manifestDirRel = manifestPath ? path.posix.dirname(manifestPath) : this.asString(manifest.source?.packagePath);
    const manifestDirAbs = rootDir && manifestDirRel ? path.join(rootDir, manifestDirRel) : rootDir;

    const installTargets = this.asInstallTargets(manifest.install?.targets);
    const files = this.resolveFiles(rootDir, manifestDirAbs, installTargets, manifest.files, type);
    const name = this.slugify(this.asString(manifest.name) || this.asString(manifest.displayName) || this.asString(manifest.id) || 'package');
    const displayName = this.asString(manifest.displayName) || this.toDisplayName(name);
    const description = this.asString(manifest.description) || displayName;
    const author = this.asAuthor(manifest.author);
    const readmePath = this.asString(manifest.docs?.readmePath) || this.asString(manifest.source?.readmePath);
    const detailsPath = this.asString(manifest.docs?.detailsPath) || this.asString(manifest.source?.detailsPath);
    const readme = manifest.docs?.readme ?? this.readOptionalText(manifestDirAbs, readmePath);
    const details = manifest.docs?.details ?? this.readOptionalText(manifestDirAbs, detailsPath);
    const stats = this.resolveStats(rootDir, index, manifest.id || `${type.value}-${name}`, manifest.stats);
    const links = this.resolveLinks(manifest.docs?.links, manifest.source?.homepage, baseRepoUrl, manifestDirRel);
    const inferredCategory = this.inferAgentCategory(name, description);
    const agentMeta = type.equals(PackageType.Agent)
      ? {
          category: AgentCategory.fromString(this.asString(manifest.agentMeta?.category) || inferredCategory.value),
          tools: this.asStringArray(manifest.agentMeta?.tools),
          delegatesTo: this.asStringArray(manifest.agentMeta?.delegatesTo),
          workflowPhase: this.asString(manifest.agentMeta?.workflowPhase) || this.inferWorkflowPhase(inferredCategory, name),
          userInvocable: this.asBoolean(manifest.agentMeta?.userInvocable, false),
          relatedSkills: this.asStringArray(manifest.agentMeta?.relatedSkills),
        }
      : undefined;

    return Package.create({
      id: this.asString(manifest.id) || `${type.value}-${name}`,
      name,
      displayName,
      description,
      type,
      version: this.asString(manifest.version) || '1.0.0',
      tags: this.asStringArray(manifest.tags),
      author,
      files,
      dependencies: this.asStringArray(manifest.dependencies),
      icon: this.asString(manifest.icon) || type.codicon,
      source: {
        repoUrl: this.asString(manifest.source?.repoUrl) || baseRepoUrl,
        packagePath: this.asString(manifest.source?.packagePath) || manifestDirRel,
        manifestPath,
        readmePath,
        detailsPath,
        homepage: this.asString(manifest.source?.homepage),
        official: this.asBoolean(manifest.source?.official, true),
      },
      installStrategy: {
        kind: manifest.install?.strategy === 'mcp-merge' || type.equals(PackageType.MCP) ? 'mcp-merge' : 'copy',
        targets: installTargets.map(target => ({
          sourcePath: target.sourcePath,
          targetPath: target.targetPath,
          mergeStrategy: target.mergeStrategy,
        })),
      },
      ui: {
        longDescription: this.asString(manifest.ui?.longDescription) || details || readme || description,
        highlights: this.asStringArray(manifest.ui?.highlights),
        installNotes: this.asStringArray(manifest.ui?.installNotes),
        badges: this.asStringArray(manifest.ui?.badges),
        maturity: this.asMaturity(manifest.ui?.maturity),
        icon: this.asString(manifest.ui?.icon),
        banner: this.asString(manifest.ui?.banner),
      },
      docs: {
        readme,
        details,
        links,
      },
      stats,
      agentMeta,
    });
  }

  private resolveFiles(
    _rootDir: string | undefined,
    manifestDirAbs: string | undefined,
    targets: PackageInstallTarget[],
    inlineFiles: CatalogPackageManifest['files'],
    type: PackageType,
  ): PackageFile[] {
    if (targets.length > 0 && manifestDirAbs) {
      return targets.map(target => {
        const sourcePath = target.sourcePath ? path.join(manifestDirAbs, target.sourcePath) : undefined;
        const content = sourcePath && fs.existsSync(sourcePath)
          ? fs.readFileSync(sourcePath, 'utf-8')
          : this.defaultInlineContent(type);

        return {
          relativePath: target.targetPath,
          content,
        };
      });
    }

    if (Array.isArray(inlineFiles) && inlineFiles.length > 0) {
      return inlineFiles.flatMap(file => {
        const relativePath = this.asString(file.relativePath);
        const content = typeof file.content === 'string' ? file.content : '';
        return relativePath ? [{ relativePath, content }] : [];
      });
    }

    if (type.equals(PackageType.MCP)) {
      return [{ relativePath: '.vscode/mcp.json', content: '{\n  "servers": {}\n}' }];
    }

    return [];
  }

  private resolveStats(rootDir: string | undefined, index: CatalogIndex, packageId: string, inlineStats?: PackageStats): PackageStats {
    const basePath = index.stats?.packagesBasePath || 'catalog/stats/packages';
    const defaultStats: PackageStats = {
      installsTotal: inlineStats?.installsTotal ?? 0,
      uniqueInstallers: inlineStats?.uniqueInstallers,
      lastInstallAt: inlineStats?.lastInstallAt,
      trendScore: inlineStats?.trendScore,
    };

    if (!rootDir) { return defaultStats; }
    const statsPath = path.join(rootDir, ...basePath.split('/'), `${packageId}.json`);
    if (!fs.existsSync(statsPath)) { return defaultStats; }

    try {
      const parsed = this.parseJsonWithComments(fs.readFileSync(statsPath, 'utf-8')) as Partial<PackageStats>;
      return {
        installsTotal: typeof parsed.installsTotal === 'number' ? parsed.installsTotal : defaultStats.installsTotal,
        uniqueInstallers: typeof parsed.uniqueInstallers === 'number' ? parsed.uniqueInstallers : defaultStats.uniqueInstallers,
        lastInstallAt: typeof parsed.lastInstallAt === 'string' ? parsed.lastInstallAt : defaultStats.lastInstallAt,
        trendScore: typeof parsed.trendScore === 'number' ? parsed.trendScore : defaultStats.trendScore,
      };
    } catch (error) {
      this._logger.warn('Falha ao carregar estatísticas públicas do pacote.', { packageId, error });
      return defaultStats;
    }
  }

  private resolveLinks(
    links: ManifestLinks | undefined,
    homepage: string | undefined,
    baseRepoUrl: string,
    manifestDirRel: string,
  ): PackageLink[] {
    const resolved = new Map<string, PackageLink>();
    for (const link of links ?? []) {
      const label = this.asString(link.label);
      const url = this.asString(link.url);
      if (label && url) {
        resolved.set(label, { label, url });
      }
    }

    if (homepage) {
      resolved.set('Homepage', { label: 'Homepage', url: homepage });
    }

    if (baseRepoUrl && manifestDirRel) {
      resolved.set('Repositório', {
        label: 'Repositório',
        url: `${baseRepoUrl.replace(/\.git$/i, '')}/tree/main/${manifestDirRel.replace(/\\/g, '/')}`,
      });
    }

    return [...resolved.values()];
  }

  private loadBundles(rootDir: string, payload: CatalogIndex): Bundle[] {
    const fromIndex = this.loadBundlesFromPayload(payload);
    if (fromIndex.length > 0) { return fromIndex; }

    const bundlesPath = path.join(rootDir, 'catalog', 'bundles.json');
    if (!fs.existsSync(bundlesPath)) { return []; }

    try {
      const parsed = this.parseJsonWithComments(fs.readFileSync(bundlesPath, 'utf-8')) as { bundles?: unknown[] } | unknown[];
      const rawBundles = Array.isArray(parsed) ? parsed : Array.isArray(parsed.bundles) ? parsed.bundles : [];
      return rawBundles
        .map(bundle => this.bundleFromManifest(bundle))
        .filter((bundle): bundle is Bundle => Boolean(bundle));
    } catch (error) {
      this._logger.warn('Falha ao carregar bundles do catálogo.', { bundlesPath, error });
      return [];
    }
  }

  private loadBundlesFromPayload(payload: CatalogIndex): Bundle[] {
    return (payload.bundles ?? [])
      .map(bundle => this.bundleFromManifest(bundle))
      .filter((bundle): bundle is Bundle => Boolean(bundle));
  }

  private bundleFromManifest(input: unknown): Bundle | undefined {
    if (!input || typeof input !== 'object') { return undefined; }
    const bundle = input as Record<string, unknown>;
    const packageIds = this.asStringArray(bundle.packageIds);
    if (packageIds.length === 0) { return undefined; }

    return Bundle.create({
      id: this.asString(bundle.id) || `bundle-${this.slugify(this.asString(bundle.name) || this.asString(bundle.displayName) || 'bundle')}`,
      name: this.slugify(this.asString(bundle.name) || this.asString(bundle.displayName) || 'bundle'),
      displayName: this.asString(bundle.displayName) || this.toDisplayName(this.asString(bundle.name) || 'bundle'),
      description: this.asString(bundle.description) || 'Bundle do catálogo público',
      version: this.asString(bundle.version) || '1.0.0',
      packageIds,
      icon: this.asString(bundle.icon) || '$(package)',
      color: this.asString(bundle.color) || '#EC7000',
    });
  }

  private async loadWorkspaceCustomPackages(): Promise<Package[]> {
    const manifests = await this.readWorkspaceCustomPackageManifests();
    return manifests
      .map(manifest => this.packageFromManifestObject(manifest, undefined, '', {}))
      .filter((pkg): pkg is Package => Boolean(pkg));
  }

  private async readWorkspaceCustomPackageManifests(): Promise<CatalogPackageManifest[]> {
    const filePath = this.workspaceCustomCatalogPath;
    if (!filePath || !fs.existsSync(filePath)) { return []; }

    try {
      const parsed = this.parseJsonWithComments(fs.readFileSync(filePath, 'utf-8'));
      return Array.isArray(parsed) ? parsed as CatalogPackageManifest[] : [];
    } catch (error) {
      this._logger.warn('Falha ao carregar catálogo local customizado.', { filePath, error });
      return [];
    }
  }

  private serializePackage(pkg: Package): CatalogPackageManifest {
    return {
      id: pkg.id,
      name: pkg.name,
      displayName: pkg.displayName,
      description: pkg.description,
      type: pkg.type.value,
      version: pkg.version.toString(),
      tags: [...pkg.tags],
      author: pkg.author,
      dependencies: [...pkg.dependencies],
      icon: pkg.icon,
      files: pkg.files.map(file => ({ relativePath: file.relativePath, content: file.content })),
      install: {
        strategy: pkg.installStrategy.kind,
        targets: pkg.installStrategy.targets.map(target => ({
          source: target.sourcePath,
          target: target.targetPath,
          mergeStrategy: target.mergeStrategy,
        })),
      },
      source: {
        repoUrl: pkg.source.repoUrl,
        packagePath: pkg.source.packagePath,
        manifestPath: pkg.source.manifestPath,
        readmePath: pkg.source.readmePath,
        detailsPath: pkg.source.detailsPath,
        homepage: pkg.source.homepage,
        official: pkg.source.official,
      },
      ui: {
        longDescription: pkg.ui.longDescription,
        highlights: [...pkg.ui.highlights],
        installNotes: [...pkg.ui.installNotes],
        badges: [...pkg.ui.badges],
        maturity: pkg.ui.maturity,
        icon: pkg.ui.icon,
        banner: pkg.ui.banner,
      },
      docs: {
        readme: pkg.docs.readme,
        details: pkg.docs.details,
        links: pkg.docs.links.map(link => ({ label: link.label, url: link.url })),
      },
      stats: pkg.stats,
      agentMeta: pkg.agentMeta ? {
        category: pkg.agentMeta.category.value,
        tools: [...pkg.agentMeta.tools],
        delegatesTo: [...pkg.agentMeta.delegatesTo],
        workflowPhase: pkg.agentMeta.workflowPhase,
        userInvocable: pkg.agentMeta.userInvocable,
        relatedSkills: [...pkg.agentMeta.relatedSkills],
      } : undefined,
    };
  }

  private readOptionalText(baseDir: string | undefined, relativePath: string): string | undefined {
    if (!baseDir || !relativePath) { return undefined; }
    const absolutePath = path.join(baseDir, relativePath);
    if (!fs.existsSync(absolutePath)) { return undefined; }
    return fs.readFileSync(absolutePath, 'utf-8');
  }

  private asInstallTargets(value: ManifestInstallTargets | undefined): PackageInstallTarget[] {
    if (!Array.isArray(value)) { return []; }
    return value.flatMap(item => {
      const targetPath = this.asString(item?.target);
      if (!targetPath) { return []; }
      return [{
        sourcePath: this.asString(item?.source) || undefined,
        targetPath,
        mergeStrategy: item?.mergeStrategy === 'merge-mcp-servers' ? 'merge-mcp-servers' : 'replace',
      }];
    });
  }

  private collectFiles(baseDir: string, predicate: (filePath: string) => boolean): string[] {
    if (!fs.existsSync(baseDir)) { return []; }
    const results: string[] = [];
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      const fullPath = path.join(baseDir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.collectFiles(fullPath, predicate));
      } else if (predicate(fullPath)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  private parseJsonWithComments(content: string): unknown {
    const sanitized = content
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    return sanitized ? JSON.parse(sanitized) : {};
  }

  private async fetchJson(url: string): Promise<unknown> {
    if (!this.isSafeRemoteUrl(url)) {
      throw new Error(`URL remota não confiável ou sem HTTPS: ${url}`);
    }

    return new Promise((resolve, reject) => {
      https.get(url, response => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`Falha ao buscar catálogo remoto (${response.statusCode ?? 'sem status'}).`));
          response.resume();
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
          try {
            resolve(this.parseJsonWithComments(body));
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', reject);
    });
  }

  private async ensureLocalClone(url: string): Promise<void> {
    if (!fs.existsSync(this.repoDir) || !fs.existsSync(path.join(this.repoDir, '.git'))) {
      fs.rmSync(this.repoDir, { recursive: true, force: true });
      await execAsync(`git clone --depth 1 ${this.quote(url)} ${this.quote(this.repoDir)}`);
      return;
    }

    try {
      const { stdout } = await execAsync('git config --get remote.origin.url', { cwd: this.repoDir });
      if (stdout.trim() !== url.trim()) {
        fs.rmSync(this.repoDir, { recursive: true, force: true });
        await execAsync(`git clone --depth 1 ${this.quote(url)} ${this.quote(this.repoDir)}`);
        return;
      }
      await execAsync('git pull --ff-only', { cwd: this.repoDir });
    } catch (error) {
      this._logger.warn('Falha ao atualizar clone local do catálogo. Recriando cache local.', { url, error });
      fs.rmSync(this.repoDir, { recursive: true, force: true });
      await execAsync(`git clone --depth 1 ${this.quote(url)} ${this.quote(this.repoDir)}`);
    }
  }

  private validateManifest(manifest: CatalogPackageManifest, source: string): CatalogPackageManifest | undefined {
    const type = this.asString(manifest.type);
    const id = this.asString(manifest.id);

    if (!type || !['agent', 'skill', 'mcp', 'instruction', 'prompt'].includes(type)) {
      this._logger.warn('Manifest ignorado por tipo inválido.', { source, type });
      return undefined;
    }

    if (id && !/^[a-z0-9-]+$/.test(id)) {
      this._logger.warn('Manifest ignorado por ID inválido.', { source, id });
      return undefined;
    }

    const safePaths = [
      this.asString(manifest.source?.packagePath),
      this.asString(manifest.source?.manifestPath),
      this.asString(manifest.source?.readmePath),
      this.asString(manifest.source?.detailsPath),
      this.asString(manifest.docs?.readmePath),
      this.asString(manifest.docs?.detailsPath),
      ...((manifest.install?.targets ?? []).flatMap(target => [this.asString(target.source), this.asString(target.target)])),
      ...((manifest.files ?? []).map(file => this.asString(file.relativePath))),
    ].filter(Boolean);

    for (const candidatePath of safePaths) {
      if (!this.isSafeRelativePath(candidatePath)) {
        this._logger.warn('Manifest ignorado por caminho potencialmente inseguro.', { source, candidatePath });
        return undefined;
      }
    }

    const candidateUrls = [
      this.asString(manifest.source?.repoUrl),
      this.asString(manifest.source?.homepage),
      ...((manifest.docs?.links ?? []).map(link => this.asString(link.url))),
    ].filter(Boolean);

    for (const candidateUrl of candidateUrls) {
      if (!this.isSafeRemoteUrl(candidateUrl)) {
        this._logger.warn('Manifest ignorado por URL insegura.', { source, candidateUrl });
        return undefined;
      }
    }

    return manifest;
  }

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
    const lowered = name.toLowerCase();
    if (lowered.includes('architect')) { return 'DESIGN'; }
    if (lowered.includes('test')) { return 'VALIDATION'; }
    if (lowered.includes('review') || lowered.includes('critic')) { return 'CRITIC'; }
    return 'EXECUTION';
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map(item => this.asString(item)).filter(Boolean);
    }
    if (typeof value === 'string') {
      return [value.trim()].filter(Boolean);
    }
    return [];
  }

  private asAuthor(value: CatalogPackageManifest['author']): string {
    if (typeof value === 'string') { return value.trim(); }
    if (value && typeof value === 'object' && typeof value.name === 'string') {
      return value.name.trim();
    }
    return 'DescomplicAI Community';
  }

  private asBoolean(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  private asMaturity(value: unknown): PackageMaturity {
    return value === 'beta' || value === 'experimental' ? value : 'stable';
  }

  private toRelativePath(rootDir: string, filePath: string): string {
    return path.relative(rootDir, filePath).replace(/\\/g, '/');
  }

  private toDisplayName(value: string): string {
    return value
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-') || 'package';
  }

  private defaultInlineContent(type: PackageType): string {
    if (type.equals(PackageType.MCP)) {
      return '{\n  "servers": {}\n}';
    }
    return '';
  }

  private normalizeRepoUrl(value: string): string {
    return value.replace(/\.git$/i, '');
  }

  private normalizeLocalPath(value: string): string {
    if (value.startsWith('file://')) {
      return decodeURIComponent(new URL(value).pathname).replace(/^\//, process.platform === 'win32' ? '' : '/');
    }

    return value;
  }

  private isLocalPath(value: string): boolean {
    if (!value) { return false; }
    if (value.startsWith('file://')) { return true; }
    return path.isAbsolute(value) || fs.existsSync(value);
  }

  private isSafeRelativePath(value: string): boolean {
    const normalized = value.replace(/\\/g, '/').trim();
    if (!normalized) { return false; }
    if (path.posix.isAbsolute(normalized)) { return false; }
    if (normalized.includes('\0')) { return false; }
    return !normalized.split('/').some(segment => segment === '..');
  }

  private isSafeRemoteUrl(value: string): boolean {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') {
        return false;
      }

      if (this.allowUnsafeRegistryUrls) {
        return true;
      }

      const normalized = this.normalizeRepoUrl(`${url.origin}${url.pathname}`);
      return GitRegistry.TRUSTED_REGISTRY_PREFIXES.some(prefix => normalized.startsWith(this.normalizeRepoUrl(prefix)));
    } catch {
      return false;
    }
  }

  private assertTrustedRegistryUrl(url: string): void {
    if (!this.isSafeRemoteUrl(url)) {
      throw new Error('A URL do catálogo não é confiável. Ative "descomplicai.allowUnsafeRegistryUrls" apenas se souber o que está fazendo.');
    }
  }

  private isJsonEndpoint(url: string): boolean {
    return /\.json(\?|$)/i.test(url) || /raw\.githubusercontent\.com/i.test(url);
  }

  private quote(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  async getAll(): Promise<Package[]> {
    if (!this._initialized) {
      await this.sync();
    }
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
      .map(delegate => all.find(item => item.id === delegate || item.name === delegate || item.id === `agent-${delegate}`))
      .filter((item): item is Package => Boolean(item));
  }

  async getRelatedSkills(agentId: string): Promise<Package[]> {
    const pkg = await this.findById(agentId);
    if (!pkg?.agentMeta) { return []; }
    const all = await this.getAll();
    return pkg.agentMeta.relatedSkills
      .map(skill => all.find(item => item.id === skill || item.name === skill || item.id === `skill-${skill}`))
      .filter((item): item is Package => Boolean(item));
  }

  async getAllBundles(): Promise<Bundle[]> {
    if (!this._initialized) {
      await this.sync();
    }
    return [...this._bundlesCache];
  }

  async findBundleById(id: string): Promise<Bundle | undefined> {
    return (await this.getAllBundles()).find(bundle => bundle.id === id);
  }
}
