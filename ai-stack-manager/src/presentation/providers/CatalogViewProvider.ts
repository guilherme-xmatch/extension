/**
 * @module presentation/providers/CatalogViewProvider
 * @description Main Catalog sidebar with DescomplicAI branding.
 * Features: animated logo, grouping by agent category, expandable cards
 * with network visualization, dependency resolution on install.
 */

import * as vscode from 'vscode';
import { Package, InstallStatus } from '../../domain/entities/Package';
import { IPackageRepository, IWorkspaceScanner, IInstaller, IOperationCoordinator } from '../../domain/interfaces';
import { WebviewHelper } from '../webview/WebviewHelper';
import { Bundle } from '../../domain/entities/Bundle';
import { PackageType } from '../../domain/value-objects/PackageType';
import { AgentCategory } from '../../domain/value-objects/AgentCategory';
import { AppLogger } from '../../infrastructure/services/AppLogger';

type CatalogMessage =
  | { command: 'install'; packageId: string }
  | { command: 'installNetwork'; packageId: string }
  | { command: 'uninstall'; packageId: string }
  | { command: 'installBundle'; bundleId: string }
  | { command: 'search'; query?: string; filterType?: string }
  | { command: 'filter'; query?: string; type?: string }
  | { command: 'openExternal'; url?: string }
  | { command: 'refresh' };

function isCatalogMessage(value: unknown): value is CatalogMessage {
  if (!value || typeof value !== 'object') { return false; }
  const msg = value as Record<string, unknown>;
  if (typeof msg.command !== 'string') { return false; }
  switch (msg.command) {
    case 'install':
    case 'uninstall':
    case 'installNetwork':
      return typeof msg.packageId === 'string' && msg.packageId.length > 0;
    case 'installBundle':
      return typeof msg.bundleId === 'string' && msg.bundleId.length > 0;
    case 'search':
    case 'filter':
      return msg.query === undefined || (typeof msg.query === 'string' && msg.query.length <= 500);
    case 'openExternal': {
      if (msg.url === undefined) { return true; }
      if (typeof msg.url !== 'string') { return false; }
      try { return new URL(msg.url).protocol === 'https:'; } catch { return false; }
    }
    case 'refresh':
      return true;
    default:
      return false;
  }
}

export class CatalogViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dai-catalog';
  private _view?: vscode.WebviewView;
  private _initialized = false;
  private _operationUpdateTimer?: ReturnType<typeof setTimeout>;
  private readonly _logger = AppLogger.getInstance();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _registry: IPackageRepository,
    private readonly _scanner: IWorkspaceScanner,
    private readonly _installer: IInstaller,
    private readonly _operations: IOperationCoordinator,
  ) {
    // Debounce operation banner updates to avoid re-rendering the full catalog
    // on every single progress tick (0%→10%→25%→...→100%) during installs/syncs.
    this._operations.onDidChangeCurrentOperation(() => {
      if (this._view) {
        clearTimeout(this._operationUpdateTimer);
        this._operationUpdateTimer = setTimeout(() => {
          void this.updateView();
        }, 80);
      }
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };

    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isCatalogMessage(message)) { return; }

      switch (message.command) {
        case 'install': await this.handleInstall(message.packageId); break;
        case 'installNetwork': await this.handleInstallNetwork(message.packageId); break;
        case 'uninstall': await this.handleUninstall(message.packageId); break;
        case 'installBundle': await this.handleInstallBundle(message.bundleId); break;
        case 'search': await this.updateView(message.query, message.filterType); break;
        case 'filter': await this.updateView(message.query ?? '', message.type); break;
        case 'openExternal':
          if (message.url && this.isSafeExternalUrl(message.url)) {
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
          }
          break;
        case 'refresh': await this.updateView(); break;
      }
    });

    this.updateView();
  }

  public async refresh(): Promise<void> { await this.updateView(); }

  private async updateView(query?: string, filterType?: string): Promise<void> {
    if (!this._view) { return; }

    let packages = query ? await this._registry.search(query) : await this._registry.getAll();
    if (filterType) { packages = packages.filter(p => p.type.value === filterType); }

    const bundles = await this._registry.getAllBundles();
    const statusMap = new Map<string, InstallStatus>();
    await Promise.all(packages.map(async (pkg) => {
      statusMap.set(pkg.id, await this._scanner.getInstallStatus(pkg));
    }));

    // Detect Project Profile for Smart Recommendation
    const profiles = await this._scanner.detectProjectProfile();
    let recommendedBundleId: string | undefined;
    let recommendationMsg = '';

    if (profiles.length > 0 && !query && !filterType) {
      // Pick the most confident profile
      const bestProfile = profiles.reduce((prev: any, current: any) => (prev.confidence > current.confidence) ? prev : current);
      // Check if bundle is already fully installed
      const recommendedBundle = bundles.find(b => b.id === bestProfile.bundleId);
      if (recommendedBundle) {
        let isFullyInstalled = true;
        for (const pkgId of recommendedBundle.packageIds) {
          if (statusMap.get(pkgId) !== InstallStatus.Installed) {
            isFullyInstalled = false; break;
          }
        }
        if (!isFullyInstalled) {
          recommendedBundleId = recommendedBundle.id;
          recommendationMsg = `Detectamos um projeto <b>${this.esc(bestProfile.profile)}</b>. O Bundle <b>${this.esc(recommendedBundle.displayName)}</b> é ideal para você.`;
        }
      }
    }

    const state = {
      html: this.renderCatalog(packages, bundles, statusMap, query ?? '', filterType, recommendedBundleId, recommendationMsg),
      query: query ?? '',
      filterType: filterType ?? '',
      animationsEnabled: !this._initialized,
    };

    if (!this._initialized) {
      this._view.webview.html = WebviewHelper.buildStatefulHtml({
        webview: this._view.webview,
        extensionUri: this._extensionUri,
        title: 'DescomplicAI — Catálogo',
        initialState: state,
        scriptContent: this.getScript(),
      });
      this._initialized = true;
      return;
    }

    WebviewHelper.postState(this._view.webview, state);
  }

  // ═══════════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════════

  private renderCatalog(packages: Package[], bundles: Bundle[], statusMap: Map<string, InstallStatus>, query: string, filterType?: string, recBundleId?: string, recMsg?: string): string {
    const installedCount = Array.from(statusMap.values()).filter(s => s === InstallStatus.Installed).length;
    const typeFilters = PackageType.all();

    // Group agents by category
    const agents = packages.filter(p => p.isAgent);
    const nonAgents = packages.filter(p => !p.isAgent);

    const categoryGroups = new Map<string, Package[]>();
    for (const agent of agents) {
      const catLabel = agent.agentMeta?.category.label ?? 'Specialist';
      if (!categoryGroups.has(catLabel)) { categoryGroups.set(catLabel, []); }
      categoryGroups.get(catLabel)!.push(agent);
    }

    // Sort categories by their sort order
    const sortedCategories = [...categoryGroups.entries()].sort((a, b) => {
      const orderA = AgentCategory.all().find(c => c.label === a[0])?.sortOrder ?? 99;
      const orderB = AgentCategory.all().find(c => c.label === b[0])?.sortOrder ?? 99;
      return orderA - orderB;
    });

    return /*html*/`
    <div class="dai-container">
      ${this.renderOperationBanner()}
      <!-- Animated Logo Header -->
      <div class="dai-header ${this.animClass('animate-fade-in')}">
        <div class="dai-logo-animated">
          <div class="dai-stack-icon">
            <div class="dai-stack-layer dai-layer-1"></div>
            <div class="dai-stack-layer dai-layer-2"></div>
            <div class="dai-stack-layer dai-layer-3"></div>
          </div>
          <div class="dai-logo-text">
            <span class="dai-brand">Descomplica<span class="dai-brand-ai">AI</span></span>
            <span class="dai-tagline">${packages.length} pacotes · ${installedCount} instalados</span>
          </div>
        </div>
      </div>

      <!-- Smart Recommendation Banner -->
      ${recBundleId && recMsg ? /*html*/`
      <div class="dai-recommendation-banner ${this.animClass('animate-slide-in')}">
        <div class="dai-rec-icon">💡</div>
        <div class="dai-rec-content">
          <p class="dai-rec-msg">${recMsg}</p>
          <button class="dai-btn dai-btn-primary dai-btn-sm" data-bundle-id="${recBundleId}">Instalar Bundle Recomendado</button>
        </div>
      </div>
      ` : ''}

      <!-- Search -->
      <div class="dai-search-container">
        <div class="dai-search-wrapper">
          <span class="dai-search-icon">⌕</span>
          <input type="text" class="dai-search-input" placeholder="Buscar pacotes..." value="${this.esc(query)}" id="search-input"/>
          ${query ? '<button class="dai-search-clear" id="search-clear">✕</button>' : ''}
        </div>
      </div>

      <!-- Type Filters -->
      <div class="dai-filters">
        <button class="dai-filter-chip ${!filterType ? 'active' : ''}" data-type="">Todos</button>
        ${typeFilters.map(t => `<button class="dai-filter-chip ${filterType === t.value ? 'active' : ''}" data-type="${t.value}" style="--chip-color: ${t.color}">${t.label}</button>`).join('')}
      </div>

      <!-- Bundles (only if no filter/search) -->
      ${!query && !filterType ? this.renderBundles(bundles) : ''}

      <!-- Agent Categories -->
      ${(!filterType || filterType === 'agent') ? sortedCategories.map(([catLabel, catAgents]) => {
        const cat = AgentCategory.all().find(c => c.label === catLabel);
        return this.renderCategorySection(catLabel, cat, catAgents, statusMap);
      }).join('') : ''}

      <!-- Non-Agent pacotes -->
      ${nonAgents.length > 0 ? this.renderNonAgentSection(nonAgents, statusMap) : ''}

      ${packages.length === 0 ? `<div class="dai-empty ${this.animClass('animate-fade-in')}"><span class="dai-empty-icon">🔍</span><span class="dai-empty-text">Nenhum pacote encontrado</span></div>` : ''}
    </div>`;
  }

  private renderBundles(bundles: Bundle[]): string {
    return /*html*/`
    <div class="dai-section">
      <div class="dai-section-header"><span class="dai-section-title">⚡ Bundles de Início Rápido</span></div>
      ${bundles.map((b, i) => /*html*/`
        <div class="dai-bundle-card ${this.animClass('animate-slide-in')}" style="--delay: ${i * 0.08}s; --accent: ${b.color}">
          <div class="dai-bundle-glow" style="background: ${b.color}"></div>
          <div class="dai-bundle-content">
            <span class="dai-bundle-name">${b.displayName}</span>
            <span class="dai-bundle-desc">${b.description}</span>
            <div class="dai-bundle-meta">
              <span class="dai-bundle-count">${b.packageCount} pacotes</span>
              <button class="dai-btn dai-btn-bundle" data-bundle-id="${b.id}">⬇ Instalar</button>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  private renderCategorySection(catLabel: string, cat: AgentCategory | undefined, agents: Package[], statusMap: Map<string, InstallStatus>): string {
    const emoji = cat?.emoji ?? '⚡';
    const color = cat?.color ?? '#EC7000';

    return /*html*/`
    <div class="dai-section ${this.animClass('animate-slide-in')}" style="--delay: 0.1s">
      <div class="dai-section-header">
        <span class="dai-section-title" style="color: ${color}">
          <span class="dai-cat-emoji">${emoji}</span> ${catLabel}s
        </span>
        <span class="dai-section-count" style="background: ${color}20; color: ${color}">${agents.length}</span>
      </div>
      ${cat?.description ? `<p class="dai-cat-desc">${cat.description}</p>` : ''}
      <div class="dai-packages-list">
        ${agents.map((pkg, i) => this.renderAgentCard(pkg, statusMap.get(pkg.id) ?? InstallStatus.NotInstalled, i)).join('')}
      </div>
    </div>`;
  }

  private renderAgentCard(pkg: Package, status: InstallStatus, index: number): string {
    const isInstalled = status === InstallStatus.Installed;
    const isOutdated = status === InstallStatus.Outdated;
    const isInstalledOrOutdated = isInstalled || isOutdated;
    const meta = pkg.agentMeta;
    const catColor = meta?.category.color ?? '#EC7000';
    const catEmoji = meta?.category.emoji ?? '⚡';
    const catLabel = meta?.category.label ?? 'Agent';
    const hasNetwork = (meta?.delegatesTo.length ?? 0) > 0;
    const toolCount = meta?.tools.length ?? 0;
    const networkCount = meta?.delegatesTo.length ?? 0;
    const skillCount = meta?.relatedSkills.length ?? 0;

    return /*html*/`
    <div class="dai-card ${this.animClass('animate-slide-in')} ${isInstalledOrOutdated ? 'installed' : ''} ${hasNetwork ? 'has-network' : ''}" style="--delay: ${index * 0.04}s; --cat-color: ${catColor}" data-pkg-id="${pkg.id}">
      <!-- Card Header -->
      <div class="dai-card-header">
        <div class="dai-card-badge" style="--badge-color: ${catColor}">${catEmoji} ${catLabel.toUpperCase()}</div>
        <span class="dai-card-version">v${pkg.version.toString()}</span>
        ${isOutdated ? '<span class="dai-outdated-badge">&#8593; Atualizar</span>' : ''}
      </div>

      <!-- Card Body -->
      <div class="dai-card-body">
        <span class="dai-card-name">${pkg.displayName}</span>
        <span class="dai-card-desc">${pkg.description}</span>
      </div>

      <!-- Meta Bar (always visible) -->
      <div class="dai-card-meta">
        <span class="dai-meta-item" title="Ferramentas">🔧 ${toolCount}</span>
        ${hasNetwork ? `<span class="dai-meta-item dai-meta-network" title="Rede de Agents">🔗 ${networkCount} agents</span>` : '<span class="dai-meta-item">📦 Independente</span>'}
        ${skillCount > 0 ? `<span class="dai-meta-item" title="Skills Relacionadas">📚 ${skillCount}</span>` : ''}
        <span class="dai-meta-item" title="Maturidade">🏷️ ${pkg.maturityLabel}</span>
      </div>

      ${isInstalledOrOutdated ? `<div class="dai-installed-indicator">${isOutdated ? '&#8593; Atualização Disponível' : '&#10003; Instalado'}</div>` : ''}

      <!-- Expandable Detalhes (toggled via JS) -->
      <div class="dai-card-details" id="details-${pkg.id}">
        <div class="dai-detail-section">
          <span class="dai-detail-label">🌐 Origem</span>
          <span class="dai-detail-value">${pkg.sourceLabel}</span>
        </div>
        <div class="dai-detail-section">
          <span class="dai-detail-label">👤 Autor</span>
          <span class="dai-detail-value">${this.esc(pkg.author)}</span>
        </div>
        <div class="dai-detail-section">
          <span class="dai-detail-label">📈 Instalações</span>
          <span class="dai-detail-value">${pkg.stats.installsTotal}</span>
        </div>
        ${pkg.ui.longDescription && pkg.ui.longDescription !== pkg.description ? `<div class="dai-detail-section"><span class="dai-detail-label">📝 Sobre</span><span class="dai-detail-value dai-detail-text">${this.esc(pkg.ui.longDescription)}</span></div>` : ''}
        ${pkg.ui.highlights.length > 0 ? `<div class="dai-detail-section"><span class="dai-detail-label">✨ Highlights</span><div class="dai-detail-list">${pkg.ui.highlights.map(item => `<span class="dai-detail-bullet">• ${this.esc(item)}</span>`).join('')}</div></div>` : ''}
        ${hasNetwork ? this.renderNetworkSection(pkg) : ''}
        ${toolCount > 0 ? `<div class="dai-detail-section"><span class="dai-detail-label">🔧 Ferramentas</span><div class="dai-tool-chips">${meta!.tools.map(t => `<span class="dai-tool-chip">${t}</span>`).join('')}</div></div>` : ''}
        ${meta?.workflowPhase ? `<div class="dai-detail-section"><span class="dai-detail-label">🔄 Fase no Workflow</span><span class="dai-detail-value">${meta.workflowPhase}</span></div>` : ''}
        <div class="dai-detail-section"><span class="dai-detail-label">📊 Complexidade</span><div class="dai-complexity-bar"><div class="dai-complexity-fill" style="width: ${pkg.complexityScore}%; background: ${catColor}"></div></div><span class="dai-complexity-score">${pkg.complexityScore}/100</span></div>
        ${pkg.ui.installNotes.length > 0 ? `<div class="dai-detail-section"><span class="dai-detail-label">📦 Instalação</span><div class="dai-detail-list">${pkg.ui.installNotes.map(item => `<span class="dai-detail-bullet">• ${this.esc(item)}</span>`).join('')}</div></div>` : ''}
        ${pkg.docs.links.length > 0 ? `<div class="dai-detail-section"><span class="dai-detail-label">🔗 Links</span><div class="dai-tool-chips">${pkg.docs.links.map(link => `<a class="dai-tool-chip dai-link-chip" href="${this.esc(link.url)}" target="_blank" rel="noreferrer">${this.esc(link.label)}</a>`).join('')}</div></div>` : ''}
      </div>

      <!-- Actions -->
      <div class="dai-card-actions">
        <button class="dai-btn dai-btn-ghost dai-btn-sm" data-toggle-details="${pkg.id}">▼ Detalhes</button>
        ${isOutdated
          ? `<button class="dai-btn dai-btn-warning dai-btn-sm" data-install="${pkg.id}">↑ Atualizar</button>
             <button class="dai-btn dai-btn-danger dai-btn-sm" data-uninstall="${pkg.id}">✕</button>`
          : isInstalled
            ? `<button class="dai-btn dai-btn-danger dai-btn-sm" data-uninstall="${pkg.id}">✕</button>`
          : hasNetwork
            ? `<button class="dai-btn dai-btn-primary dai-btn-sm" data-install-network="${pkg.id}">⬇ Instalar Rede</button>`
            : `<button class="dai-btn dai-btn-primary dai-btn-sm" data-install="${pkg.id}">⬇ Instalar</button>`
        }
      </div>
    </div>`;
  }

  private renderNetworkSection(pkg: Package): string {
    const delegates = pkg.agentMeta?.delegatesTo ?? [];
    if (delegates.length === 0) { return ''; }

    return /*html*/`
    <div class="dai-detail-section">
      <span class="dai-detail-label">🔗 Rede de Agents (${delegates.length})</span>
      <div class="dai-network-tree">
        ${delegates.map(d => {
          const emoji = d.includes('planner') ? '📐'
            : d.includes('architect') ? '🏛️'
            : d.includes('reviewer') ? '🛡️'
            : d.includes('test') ? '🧪'
            : '⚡';
          return `<div class="dai-network-node"><span class="dai-node-connector">├──</span><span class="dai-node-emoji">${emoji}</span><span class="dai-node-name">${d}</span></div>`;
        }).join('')}
      </div>
      <div class="dai-network-hint">
        💡 "Instalar Rede" baixa este agent + todos os ${delegates.length} dependentes
      </div>
    </div>`;
  }

  private renderNonAgentSection(packages: Package[], statusMap: Map<string, InstallStatus>): string {
    // Group by type
    const groups = new Map<string, Package[]>();
    for (const pkg of packages) {
      const key = pkg.type.label;
      if (!groups.has(key)) { groups.set(key, []); }
      groups.get(key)!.push(pkg);
    }

    return [...groups.entries()].map(([typeLabel, pkgs]) => /*html*/`
    <div class="dai-section">
      <div class="dai-section-header">
        <span class="dai-section-title">${pkgs[0].type.codicon.replace('$(', '').replace(')', '')} ${typeLabel}s</span>
        <span class="dai-section-count">${pkgs.length}</span>
      </div>
      <div class="dai-packages-list">
        ${pkgs.map((pkg, i) => {
          const pkgStatus = statusMap.get(pkg.id) ?? InstallStatus.NotInstalled;
          const isInstalled = pkgStatus === InstallStatus.Installed;
          const isOutdated = pkgStatus === InstallStatus.Outdated;
          return /*html*/`
          <div class="dai-card dai-card-compact ${this.animClass('animate-slide-in')} ${isInstalled || isOutdated ? 'installed' : ''}" style="--delay: ${i * 0.04}s; --cat-color: ${pkg.type.color}">
            <div class="dai-card-header">
              <div class="dai-card-badge" style="--badge-color: ${pkg.type.color}">${pkg.typeLabel.toUpperCase()}</div>
              ${isOutdated ? '<span class="dai-outdated-badge">↑ Atualizar</span>' : isInstalled ? '<span class="dai-installed-indicator-sm">✓</span>' : ''}
            </div>
            <div class="dai-card-body">
              <span class="dai-card-name">${pkg.displayName}</span>
              <span class="dai-card-desc">${pkg.description}</span>
              <span class="dai-card-inline-meta">${pkg.sourceLabel} · ${pkg.maturityLabel} · ${pkg.stats.installsTotal} installs</span>
            </div>
            <div class="dai-card-actions">
              <div class="dai-card-tags">${pkg.tags.slice(0, 3).map(t => `<span class="dai-tag">${t}</span>`).join('')}</div>
              ${isOutdated
                ? `<button class="dai-btn dai-btn-warning dai-btn-sm" data-install="${pkg.id}">↑ Atualizar</button>
                   <button class="dai-btn dai-btn-danger dai-btn-sm" data-uninstall="${pkg.id}">✕</button>`
                : isInstalled
                  ? `<button class="dai-btn dai-btn-danger dai-btn-sm" data-uninstall="${pkg.id}">✕</button>`
                  : `<button class="dai-btn dai-btn-primary dai-btn-sm" data-install="${pkg.id}">⬇</button>`}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
  }

  // ═══════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════

  /** Notify the webview logo controller of an operation result. */
  private postLogoResult(result: 'success' | 'error' | 'reset'): void {
    if (this._view) {
      void this._view.webview.postMessage({ type: 'logoResult', result });
    }
  }

  private async handleInstall(packageId: string): Promise<void> {
    const pkg = await this._registry.findById(packageId);
    if (!pkg) { return; }

    const packagesToInstall = await this.resolvePackagesForInstall(pkg);
    try {
      await this._operations.run({
        kind: packagesToInstall.length > 1 ? 'bundle-install' : 'package-install',
        label: packagesToInstall.length > 1 ? `Instalando ${packagesToInstall.length} pacotes` : `Instalando ${pkg.displayName}`,
        targetId: pkg.id,
        refreshTargets: ['catalog', 'installed'],
      }, async (operation) => {
        if (packagesToInstall.length > 1) {
          await this._installer.installMany(packagesToInstall, {
            onProgress: (progress) => {
              operation.setProgress((progress.current / progress.total) * 100, progress.label);
            },
          });
        } else {
          operation.setProgress(10, pkg.displayName);
          await this._installer.install(pkg, {
            onProgress: () => operation.setProgress(100, pkg.displayName),
          });
        }
      });
      this.postLogoResult('success');
    } catch {
      this.postLogoResult('error');
    }
  }

  private async handleInstallNetwork(packageId: string): Promise<void> {
    const pkg = await this._registry.findById(packageId);
    if (!pkg?.agentMeta) { return await this.handleInstall(packageId); }

    // Get full network
    const network = await this._registry.getAgentNetwork(packageId);
    const relatedSkills = await this._registry.getRelatedSkills(packageId);
    const allPackages = [pkg, ...network, ...relatedSkills];

    // Deduplicate
    const seen = new Set<string>();
    const unique = allPackages.filter(p => { if (seen.has(p.id)) { return false; } seen.add(p.id); return true; });

    const choice = await vscode.window.showInformationMessage(
      `📦 "${pkg.displayName}" coordena ${network.length} agents. Instalar a rede completa? (${unique.length} pacotes no total)`,
      { modal: true },
      `Instalar Rede Completa (${unique.length})`,
      'Apenas este Agent',
      'Cancelar',
    );

    if (choice?.startsWith('Instalar Rede')) {
      try {
        await this._operations.run({
          kind: 'bundle-install',
          label: `Instalando rede ${pkg.displayName}`,
          targetId: pkg.id,
          refreshTargets: ['catalog', 'installed'],
        }, async (operation) => {
          await this._installer.installMany(unique, {
            onProgress: (progress) => {
              operation.setProgress((progress.current / progress.total) * 100, progress.label);
            },
          });
        });
        this.postLogoResult('success');
      } catch {
        this.postLogoResult('error');
      }
    } else if (choice === 'Apenas este Agent') {
      try {
        await this._operations.run({
          kind: 'package-install',
          label: `Instalando ${pkg.displayName}`,
          targetId: pkg.id,
          refreshTargets: ['catalog', 'installed'],
        }, async (operation) => {
          operation.setProgress(10, pkg.displayName);
          await this._installer.install(pkg, {
            onProgress: () => operation.setProgress(100, pkg.displayName),
          });
        });
        this.postLogoResult('success');
      } catch {
        this.postLogoResult('error');
      }
    } else {
      // User dismissed dialog — reset logo to idle state
      this.postLogoResult('reset');
    }
  }

  private async handleUninstall(packageId: string): Promise<void> {
    const pkg = await this._registry.findById(packageId);
    if (!pkg) { return; }
    try {
      await this._operations.run({
        kind: 'package-uninstall',
        label: `Removendo ${pkg.displayName}`,
        targetId: pkg.id,
        refreshTargets: ['catalog', 'installed'],
      }, async (operation) => {
        operation.setProgress(10, pkg.displayName);
        await this._installer.uninstall(pkg, {
          onProgress: () => operation.setProgress(100, pkg.displayName),
        });
      });
      this.postLogoResult('success');
    } catch {
      this.postLogoResult('error');
    }
  }

  private async handleInstallBundle(bundleId: string): Promise<void> {
    const bundle = await this._registry.findBundleById(bundleId);
    if (!bundle) { return; }
    const packages: Package[] = [];
    for (const pkgId of bundle.packageIds) {
      const pkg = await this._registry.findById(pkgId);
      if (pkg) { packages.push(pkg); }
    }
    if (packages.length > 0) {
      try {
        await this._operations.run({
          kind: 'bundle-install',
          label: `Instalando bundle ${bundle.displayName}`,
          targetId: bundle.id,
          refreshTargets: ['catalog', 'installed'],
        }, async (operation) => {
          await this._installer.installMany(packages, {
            onProgress: (progress) => {
              operation.setProgress((progress.current / progress.total) * 100, progress.label);
            },
          });
        });
        this.postLogoResult('success');
      } catch {
        this.postLogoResult('error');
      }
    }
  }

  // ═══════════════════════════════════════════
  // CLIENT SCRIPT
  // ═══════════════════════════════════════════

  private getScript(): string {
    return /*js*/`
    let searchTimeout;
    const render = (state) => state.html || '<div class="dai-container"><div class="dai-empty"><span class="dai-empty-text">Sem dados</span></div></div>';

    // ── Logo animation: handle messages from extension ────────────────────────
    // The extension sends { type: 'logoResult', result: 'success'|'error'|'reset' }
    // after an operation completes. Handled via the framework's onMessage hook.
    function onMessage(message) {
      if (message.type === 'logoResult') {
        const anim = window.__daiLogoAnim;
        if (!anim) { return; }
        if (message.result === 'success') { anim.succeed(); }
        else if (message.result === 'error')   { anim.fail();    }
        else                                   { anim.reset();   }
      }
    }

    const bind = (state, app) => {
      const scrollingEl = document.scrollingElement;
      // Restore scroll from the persisted vscode.getState() entry — decoupled from app re-renders.
      // This prevents the scroll position from being included in the extension-side state,
      // which would cause the page to jump to the top on every operation progress update.
      const persistedScrollTop = (vscode.getState() || {}).scrollTop;
      if (scrollingEl && typeof persistedScrollTop === 'number' && persistedScrollTop > 0) {
        requestAnimationFrame(() => { scrollingEl.scrollTop = persistedScrollTop; });
      }

      // Persist scroll position directly to vscode.getState() WITHOUT calling patchState.
      // patchState triggers a full innerHTML re-render, which destroys and recreates all
      // DOM elements (including the animated logo) on every single pixel of scroll.
      window.onscroll = () => {
        const el = document.scrollingElement;
        const scrollTop = el ? el.scrollTop : 0;
        const vs = vscode.getState() || {};
        vscode.setState({ ...vs, scrollTop });
        app.state.scrollTop = scrollTop;
      };

      const searchInput = app.root.querySelector('#search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (event) => {
          const value = event.target.value;
          app.patchState({ query: value });
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            app.postMessage({ command: 'search', query: value, filterType: state.filterType || '' });
          }, 250);
        });
      }

      app.root.querySelector('#search-clear')?.addEventListener('click', () => {
        app.patchState({ query: '' });
        app.postMessage({ command: 'search', query: '', filterType: state.filterType || '' });
      });

      app.root.querySelectorAll('.dai-filter-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const type = chip.dataset.type || '';
          app.patchState({ filterType: type });
          if (type === '') {
            app.postMessage({ command: 'search', query: state.query || '', filterType: '' });
            return;
          }
          app.postMessage({ command: 'filter', type, query: state.query || '' });
        });
      });

      const expandedIds = Array.isArray(state.expandedIds) ? state.expandedIds : [];
      expandedIds.forEach((id) => {
        const details = app.root.querySelector('#details-' + id);
        const toggle = app.root.querySelector('[data-toggle-details="' + id + '"]');
        if (details) { details.classList.add('open'); }
        if (toggle) { toggle.textContent = '▲ Menos'; }
      });

      app.root.querySelectorAll('[data-toggle-details]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.toggleDetails;
          const details = app.root.querySelector('#details-' + id);
          if (!details || !id) { return; }
          const isOpen = details.classList.toggle('open');
          const current = new Set(Array.isArray(app.state.expandedIds) ? app.state.expandedIds : []);
          if (isOpen) { current.add(id); } else { current.delete(id); }
          btn.textContent = isOpen ? '▲ Menos' : '▼ Detalhes';
          app.patchState({ expandedIds: [...current] });
        });
      });

      app.root.querySelectorAll('[data-install]').forEach((btn) => {
        btn.addEventListener('click', () => app.postMessage({ command: 'install', packageId: btn.dataset.install }));
      });
      app.root.querySelectorAll('[data-install-network]').forEach((btn) => {
        btn.addEventListener('click', () => app.postMessage({ command: 'installNetwork', packageId: btn.dataset.installNetwork }));
      });
      app.root.querySelectorAll('[data-uninstall]').forEach((btn) => {
        btn.addEventListener('click', () => app.postMessage({ command: 'uninstall', packageId: btn.dataset.uninstall }));
      });
      app.root.querySelectorAll('[data-bundle-id]').forEach((btn) => {
        btn.addEventListener('click', () => app.postMessage({ command: 'installBundle', bundleId: btn.dataset.bundleId }));
      });
      app.root.querySelectorAll('a[target="_blank"]').forEach((link) => {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          app.postMessage({ command: 'openExternal', url: link.getAttribute('href') });
        });
      });

      // ── Logo animation controller ─────────────────────────
      // Triggered only during real operations — never on idle or scroll.
      // Respects prefers-reduced-motion via the global CSS rule.
      // All classes are removed after the animation ends so re-renders
      // don't accidentally replay them (guards against dai-hydrated edge cases).
      window.__daiLogoAnim = window.__daiLogoAnim || {
        _el: null,
        _workingTimeout: null,

        get el() {
          if (!this._el) { this._el = document.querySelector('.dai-stack-icon'); }
          return this._el;
        },

        /** Call when an operation starts */
        startWorking() {
          const el = this.el;
          if (!el) { return; }
          el.classList.remove('dai-logo-success', 'dai-logo-error');
          el.classList.add('dai-logo-working');
        },

        /** Call when an operation finishes successfully */
        succeed() {
          const el = this.el;
          if (!el) { return; }
          el.classList.remove('dai-logo-working', 'dai-logo-error');
          el.classList.add('dai-logo-success');
          el.addEventListener('animationend', function onEnd() {
            el.classList.remove('dai-logo-success');
            el.removeEventListener('animationend', onEnd);
          }, { once: true });
        },

        /** Call when an operation finishes with an error */
        fail() {
          const el = this.el;
          if (!el) { return; }
          el.classList.remove('dai-logo-working', 'dai-logo-success');
          el.classList.add('dai-logo-error');
          el.addEventListener('animationend', function onEnd() {
            el.classList.remove('dai-logo-error');
            el.removeEventListener('animationend', onEnd);
          }, { once: true });
        },

        /** Call when an operation is cancelled or the panel refreshes without result */
        reset() {
          const el = this.el;
          if (!el) { return; }
          el.classList.remove('dai-logo-working', 'dai-logo-success', 'dai-logo-error');
        },
      };

      // Hook install/uninstall buttons so the logo responds in real time
      app.root.querySelectorAll('[data-install], [data-install-network], [data-uninstall], [data-bundle-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          window.__daiLogoAnim.startWorking();
        });
      });
    };
    `;
  }

  private animClass(className: string): string {
    return this._initialized ? '' : className;
  }

  private isSafeExternalUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'https:';
    } catch (error) {
      this._logger.debug('CATALOG_EXTERNAL_URL_REJECTED', { value, error });
      return false;
    }
  }

  private renderOperationBanner(): string {
    const operation = this._operations.getCurrentOperation();
    if (!operation) {
      return '';
    }

    const message = operation.message ? ` — ${this.esc(operation.message)}` : '';
    const progress = typeof operation.progress === 'number' ? `${operation.progress}%` : 'Em andamento';
    return /*html*/`
    <div class="dai-recommendation-banner">
      <div class="dai-rec-icon">⏳</div>
      <div class="dai-rec-content">
        <p class="dai-rec-msg"><b>${this.esc(operation.label)}</b>${message}</p>
        <span class="dai-tag">${progress}</span>
      </div>
    </div>`;
  }

  private async resolvePackagesForInstall(pkg: Package): Promise<Package[]> {
    const autoResolve = vscode.workspace.getConfiguration('descomplicai').get<boolean>('autoResolveDependencies', true);
    if (!autoResolve || pkg.dependencies.length === 0) {
      return [pkg];
    }

    const resolved = new Map<string, Package>();
    const visited = new Set<string>();

    const visit = async (current: Package): Promise<void> => {
      if (visited.has(current.id)) { return; }
      visited.add(current.id);
      resolved.set(current.id, current);

      for (const dependencyId of current.dependencies) {
        const dependency = await this._registry.findById(dependencyId);
        if (dependency) {
          await visit(dependency);
        }
      }
    };

    await visit(pkg);
    if (resolved.size <= 1) {
      return [pkg];
    }

    const choice = await vscode.window.showInformationMessage(
      `"${pkg.displayName}" possui ${resolved.size - 1} dependência(s). Deseja instalar junto?`,
      { modal: true },
      `Instalar com dependências (${resolved.size})`,
      'Apenas este pacote',
    );

    if (choice?.startsWith('Instalar com dependências')) {
      return [...resolved.values()];
    }

    return [pkg];
  }

  private esc(t: string): string { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
}
