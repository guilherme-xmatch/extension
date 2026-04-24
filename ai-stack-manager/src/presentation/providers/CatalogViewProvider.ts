/**
 * @module presentation/providers/CatalogViewProvider
 * @description Main Catalog sidebar with DescomplicAI branding.
 * Features: animated logo, grouping by agent category, expandable cards
 * with network visualization, dependency resolution on install.
 */

import * as vscode from 'vscode';
import { WebviewHelper } from '../webview/WebviewHelper';
import { LocalRegistry } from '../../infrastructure/repositories/LocalRegistry';
import { WorkspaceScanner } from '../../infrastructure/services/WorkspaceScanner';
import { FileInstaller } from '../../infrastructure/services/FileInstaller';
import { Package, InstallStatus } from '../../domain/entities/Package';
import { Bundle } from '../../domain/entities/Bundle';
import { PackageType } from '../../domain/value-objects/PackageType';
import { AgentCategory } from '../../domain/value-objects/AgentCategory';

export class CatalogViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dai-catalog';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _registry: LocalRegistry,
    private readonly _scanner: WorkspaceScanner,
    private readonly _installer: FileInstaller,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'install': await this.handleInstall(message.packageId); break;
        case 'installNetwork': await this.handleInstallNetwork(message.packageId); break;
        case 'uninstall': await this.handleUninstall(message.packageId); break;
        case 'installBundle': await this.handleInstallBundle(message.bundleId); break;
        case 'search': await this.updateView(message.query); break;
        case 'filter': await this.updateView('', message.type); break;
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
      const bestProfile = profiles.reduce((prev, current) => (prev.confidence > current.confidence) ? prev : current);
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
          recommendationMsg = `Detectamos um projeto <b>${bestProfile.profile}</b>. O Bundle <b>${recommendedBundle.displayName}</b> é ideal para você.`;
        }
      }
    }

    this._view.webview.html = WebviewHelper.buildHtml({
      webview: this._view.webview,
      extensionUri: this._extensionUri,
      title: 'DescomplicAI — Catálogo',
      bodyContent: this.renderCatalog(packages, bundles, statusMap, query ?? '', filterType, recommendedBundleId, recommendationMsg),
      scriptContent: this.getScript(),
    });
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
      <!-- Animated Logo Header -->
      <div class="dai-header animate-fade-in">
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
      <div class="dai-recommendation-banner animate-slide-in">
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
      ${nonAgents.length > 0 ? this.renderNonAgentSection(nonAgents, statusMap, filterType) : ''}

      ${packages.length === 0 ? '<div class="dai-empty animate-fade-in"><span class="dai-empty-icon">🔍</span><span class="dai-empty-text">Nenhum pacote encontrado</span></div>' : ''}
    </div>`;
  }

  private renderBundles(bundles: Bundle[]): string {
    return /*html*/`
    <div class="dai-section">
      <div class="dai-section-header"><span class="dai-section-title">⚡ Bundles de Início Rápido</span></div>
      ${bundles.map((b, i) => /*html*/`
        <div class="dai-bundle-card animate-slide-in" style="--delay: ${i * 0.08}s; --accent: ${b.color}">
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
    <div class="dai-section animate-slide-in" style="--delay: 0.1s">
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
    const meta = pkg.agentMeta;
    const catColor = meta?.category.color ?? '#EC7000';
    const catEmoji = meta?.category.emoji ?? '⚡';
    const catLabel = meta?.category.label ?? 'Agent';
    const hasNetwork = (meta?.delegatesTo.length ?? 0) > 0;
    const toolCount = meta?.tools.length ?? 0;
    const networkCount = meta?.delegatesTo.length ?? 0;
    const skillCount = meta?.relatedSkills.length ?? 0;

    return /*html*/`
    <div class="dai-card animate-slide-in ${isInstalled ? 'installed' : ''} ${hasNetwork ? 'has-network' : ''}" style="--delay: ${index * 0.04}s; --cat-color: ${catColor}" data-pkg-id="${pkg.id}">
      <!-- Card Header -->
      <div class="dai-card-header">
        <div class="dai-card-badge" style="--badge-color: ${catColor}">${catEmoji} ${catLabel.toUpperCase()}</div>
        <span class="dai-card-version">v${pkg.version.toString()}</span>
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
      </div>

      ${isInstalled ? '<div class="dai-installed-indicator">✓ Instalado</div>' : ''}

      <!-- Expandable Detalhes (toggled via JS) -->
      <div class="dai-card-details" id="details-${pkg.id}">
        ${hasNetwork ? this.renderNetworkSection(pkg) : ''}
        ${toolCount > 0 ? `<div class="dai-detail-section"><span class="dai-detail-label">🔧 Ferramentas</span><div class="dai-tool-chips">${meta!.tools.map(t => `<span class="dai-tool-chip">${t}</span>`).join('')}</div></div>` : ''}
        ${meta?.workflowPhase ? `<div class="dai-detail-section"><span class="dai-detail-label">🔄 Fase no Workflow</span><span class="dai-detail-value">${meta.workflowPhase}</span></div>` : ''}
        <div class="dai-detail-section"><span class="dai-detail-label">📊 Complexidade</span><div class="dai-complexity-bar"><div class="dai-complexity-fill" style="width: ${pkg.complexityScore}%; background: ${catColor}"></div></div><span class="dai-complexity-score">${pkg.complexityScore}/100</span></div>
      </div>

      <!-- Actions -->
      <div class="dai-card-actions">
        <button class="dai-btn dai-btn-ghost dai-btn-sm" data-toggle-details="${pkg.id}">▼ Detalhes</button>
        ${isInstalled
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

  private renderNonAgentSection(packages: Package[], statusMap: Map<string, InstallStatus>, filterType?: string): string {
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
          const isInstalled = (statusMap.get(pkg.id) ?? InstallStatus.NotInstalled) === InstallStatus.Installed;
          return /*html*/`
          <div class="dai-card dai-card-compact animate-slide-in ${isInstalled ? 'installed' : ''}" style="--delay: ${i * 0.04}s; --cat-color: ${pkg.type.color}">
            <div class="dai-card-header">
              <div class="dai-card-badge" style="--badge-color: ${pkg.type.color}">${pkg.typeLabel.toUpperCase()}</div>
              ${isInstalled ? '<span class="dai-installed-indicator-sm">✓</span>' : ''}
            </div>
            <div class="dai-card-body">
              <span class="dai-card-name">${pkg.displayName}</span>
              <span class="dai-card-desc">${pkg.description}</span>
            </div>
            <div class="dai-card-actions">
              <div class="dai-card-tags">${pkg.tags.slice(0, 3).map(t => `<span class="dai-tag">${t}</span>`).join('')}</div>
              ${isInstalled
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

  private async handleInstall(packageId: string): Promise<void> {
    const pkg = await this._registry.findById(packageId);
    if (!pkg) { return; }
    await this._installer.install(pkg);
    await this.updateView();
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
      await this._installer.installMany(unique);
    } else if (choice === 'Apenas este Agent') {
      await this._installer.install(pkg);
    }

    await this.updateView();
  }

  private async handleUninstall(packageId: string): Promise<void> {
    const pkg = await this._registry.findById(packageId);
    if (!pkg) { return; }
    await this._installer.uninstall(pkg);
    await this.updateView();
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
      await this._installer.installMany(packages);
      await this.updateView();
    }
  }

  // ═══════════════════════════════════════════
  // CLIENT SCRIPT
  // ═══════════════════════════════════════════

  private getScript(): string {
    return /*js*/`
    // Search with debounce
    let searchTimeout;
    const si = document.getElementById('search-input');
    if (si) { si.addEventListener('input', (e) => { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { vscode.postMessage({ command: 'search', query: e.target.value }); }, 300); }); }

    document.getElementById('search-clear')?.addEventListener('click', () => vscode.postMessage({ command: 'search', query: '' }));

    // Filter chips
    document.querySelectorAll('.dai-filter-chip').forEach(c => {
      c.addEventListener('click', () => {
        const t = c.dataset.type;
        vscode.postMessage(t === '' ? { command: 'refresh' } : { command: 'filter', type: t });
      });
    });

    // Toggle card Detalhes
    document.querySelectorAll('[data-toggle-details]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.toggleDetails;
        const details = document.getElementById('details-' + id);
        if (details) {
          const isOpen = details.classList.toggle('open');
          e.currentTarget.textContent = isOpen ? '▲ Menos' : '▼ Detalhes';
        }
      });
    });

    // Install buttons
    document.querySelectorAll('[data-install]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.currentTarget.innerHTML = '<span class="dai-spinner"></span>';
        vscode.postMessage({ command: 'install', packageId: e.currentTarget.dataset.install });
      });
    });

    // Install Network buttons
    document.querySelectorAll('[data-install-network]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.currentTarget.innerHTML = '<span class="dai-spinner"></span>';
        vscode.postMessage({ command: 'installNetwork', packageId: e.currentTarget.dataset.installNetwork });
      });
    });

    // Uninstall
    document.querySelectorAll('[data-uninstall]').forEach(btn => {
      btn.addEventListener('click', (e) => vscode.postMessage({ command: 'uninstall', packageId: e.currentTarget.dataset.uninstall }));
    });

    // Bundle Install
    document.querySelectorAll('[data-bundle-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.currentTarget.innerHTML = '<span class="dai-spinner"></span> Instalando...';
        vscode.postMessage({ command: 'installBundle', bundleId: e.currentTarget.dataset.bundleId });
      });
    });
    `;
  }

  private esc(t: string): string { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
}
