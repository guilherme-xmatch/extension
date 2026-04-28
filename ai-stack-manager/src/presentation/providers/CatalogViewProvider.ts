/**
 * @module presentation/providers/CatalogViewProvider
 * @description Barra lateral principal do Catálogo com a marca DescomplicAI.
 * Funcionalidades: logo animado, agrupamento por categoria de agent, cards expansíveis
 * com visualização de rede e resolução de dependências na instalação.
 */

import * as vscode from 'vscode';
import { Package, InstallStatus } from '../../domain/entities/Package';
import {
  IPackageRepository,
  IWorkspaceScanner,
  IInstaller,
  IOperationCoordinator,
} from '../../domain/interfaces';
import { WebviewHelper } from '../webview/WebviewHelper';
import { Bundle } from '../../domain/entities/Bundle';
import { PackageType } from '../../domain/value-objects/PackageType';
import { AgentCategory } from '../../domain/value-objects/AgentCategory';
import { AppLogger } from '../../infrastructure/services/AppLogger';
import { UxDiagnosticsService } from '../../infrastructure/services/UxDiagnosticsService';

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
  if (!value || typeof value !== 'object') {
    return false;
  }
  const msg = value as Record<string, unknown>;
  if (typeof msg.command !== 'string') {
    return false;
  }
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
      if (msg.url === undefined) {
        return true;
      }
      if (typeof msg.url !== 'string') {
        return false;
      }
      try {
        return new URL(msg.url).protocol === 'https:';
      } catch {
        return false;
      }
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
    // Aplica debounce nas atualizacoes do banner de operacao para evitar re-renderizar
    // o catalogo completo a cada tick de progresso (0%->10%->25%->...->100%).
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
      if (!isCatalogMessage(message)) {
        return;
      }

      switch (message.command) {
        case 'install':
          await this.handleInstall(message.packageId);
          break;
        case 'installNetwork':
          await this.handleInstallNetwork(message.packageId);
          break;
        case 'uninstall':
          await this.handleUninstall(message.packageId);
          break;
        case 'installBundle':
          await this.handleInstallBundle(message.bundleId);
          break;
        case 'search':
          await this.updateView(message.query, message.filterType);
          break;
        case 'filter':
          await this.updateView(message.query ?? '', message.type);
          break;
        case 'openExternal':
          if (message.url && this.isSafeExternalUrl(message.url)) {
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
          }
          break;
        case 'refresh':
          await this.updateView(undefined, undefined, { showLoading: true });
          break;
      }
    });

    void this.updateView(undefined, undefined, { showLoading: true });
  }

  public async refresh(): Promise<void> {
    await this.updateView(undefined, undefined, { showLoading: true });
  }

  private async updateView(
    query?: string,
    filterType?: string,
    options: { showLoading?: boolean } = {},
  ): Promise<void> {
    if (!this._view) {
      return;
    }

    const showLoading = options.showLoading === true;
    if (!this._initialized) {
      this._view.webview.html = WebviewHelper.buildStatefulHtml({
        webview: this._view.webview,
        extensionUri: this._extensionUri,
        title: 'DescomplicAI — Catálogo',
        initialState: { html: this.renderLoading() },
        scriptContent: this.getScript(),
      });
      this._initialized = true;
    } else if (showLoading) {
      WebviewHelper.postState(this._view.webview, { html: this.renderLoading() });
    }

    let packages = query ? await this._registry.search(query) : await this._registry.getAll();
    if (filterType) {
      packages = packages.filter((p) => p.type.value === filterType);
    }

    const bundles = await this._registry.getAllBundles();
    const statusMap = new Map<string, InstallStatus>();
    await Promise.all(
      packages.map(async (pkg) => {
        statusMap.set(pkg.id, await this._scanner.getInstallStatus(pkg));
      }),
    );

    // Detecta o Perfil do Projeto para Recomendação Inteligente
    const profiles = await this._scanner.detectProjectProfile();
    let recommendedBundleId: string | undefined;
    let recommendationMsg = '';

    if (profiles.length > 0 && !query && !filterType) {
      // Seleciona o perfil com maior confiança
      const bestProfile = profiles.reduce((prev: any, current: any) =>
        prev.confidence > current.confidence ? prev : current,
      );
      // Verifica se o bundle já está totalmente instalado
      const recommendedBundle = bundles.find((b) => b.id === bestProfile.bundleId);
      if (recommendedBundle) {
        let isFullyInstalled = true;
        for (const pkgId of recommendedBundle.packageIds) {
          if (statusMap.get(pkgId) !== InstallStatus.Installed) {
            isFullyInstalled = false;
            break;
          }
        }
        if (!isFullyInstalled) {
          recommendedBundleId = recommendedBundle.id;
          recommendationMsg = `Detectamos um projeto <b>${this.esc(bestProfile.profile)}</b>. O Bundle <b>${this.esc(recommendedBundle.displayName)}</b> é ideal para você.`;
        }
      }
    }

    const state = {
      html: this.renderCatalog(
        packages,
        bundles,
        statusMap,
        query ?? '',
        filterType,
        recommendedBundleId,
        recommendationMsg,
      ),
      query: query ?? '',
      filterType: filterType ?? '',
      animationsEnabled: !this._initialized,
    };

    WebviewHelper.postState(this._view.webview, state);
  }

  // ═══════════════════════════════════════════
  // RENDERIZAÇÃO
  // ═══════════════════════════════════════════

  private renderCatalog(
    packages: Package[],
    bundles: Bundle[],
    statusMap: Map<string, InstallStatus>,
    query: string,
    filterType?: string,
    recBundleId?: string,
    recMsg?: string,
  ): string {
    const installedCount = Array.from(statusMap.values()).filter(
      (s) => s === InstallStatus.Installed,
    ).length;
    const typeFilters = PackageType.all();

    // Agrupa agents por categoria
    const agents = packages.filter((p) => p.isAgent);
    const nonAgents = packages.filter((p) => !p.isAgent);

    const categoryGroups = new Map<string, Package[]>();
    for (const agent of agents) {
      const catLabel = agent.agentMeta?.category.label ?? 'Specialist';
      if (!categoryGroups.has(catLabel)) {
        categoryGroups.set(catLabel, []);
      }
      categoryGroups.get(catLabel)!.push(agent);
    }

    // Ordena as categorias pela ordem de exibição
    const sortedCategories = [...categoryGroups.entries()].sort((a, b) => {
      const orderA = AgentCategory.all().find((c) => c.label === a[0])?.sortOrder ?? 99;
      const orderB = AgentCategory.all().find((c) => c.label === b[0])?.sortOrder ?? 99;
      return orderA - orderB;
    });

    return /*html*/ `
    <div class="dai-container">
      ${this.renderOperationBanner()}
      <div class="dai-header ${this.animClass('animate-fade-in')}">
        <div class="dai-logo-animated dai-logo-hero">
          <div class="dai-header-mark">
            <div class="dai-stack-icon dai-stack-icon--sidebar dai-logo-idle" role="img" aria-label="DescomplicAI pronta para instalar e monitorar infraestrutura de agentes">
              <div class="dai-stack-layer dai-layer-1"></div>
              <div class="dai-stack-layer dai-layer-2"></div>
              <div class="dai-stack-layer dai-layer-3"></div>
            </div>
            <span class="dai-status-pill dai-status-pill-active">Catalogo online</span>
          </div>
          <div class="dai-logo-text">
            <span class="dai-brand-kicker">Enterprise AI Stack Control</span>
            <span class="dai-brand">Descomplic<span class="dai-brand-ai">AI</span></span>
            <div class="dai-logo-meta">
              <span class="dai-tagline">${packages.length} pacotes mapeados</span>
              <span class="dai-tag">${installedCount} prontos para uso</span>
            </div>
          </div>
        </div>
      </div>

      ${
        recBundleId && recMsg
          ? /*html*/ `
      <div class="dai-recommendation-banner ${this.animClass('animate-slide-in')}" role="note" aria-label="Recomendacao inteligente de bundle">
        <div class="dai-rec-icon" aria-hidden="true">💡</div>
        <div class="dai-rec-content">
          <span class="dai-status-pill dai-status-pill-idle">Recomendacao contextual</span>
          <p class="dai-rec-msg">${recMsg}</p>
        </div>
        <button class="dai-btn dai-btn-primary dai-btn-sm" type="button" data-bundle-id="${recBundleId}" title="Instalar bundle recomendado" aria-label="Instalar bundle recomendado">Instalar bundle</button>
      </div>
      `
          : ''
      }

      <div class="dai-search-container">
        <div class="dai-search-wrapper">
          <span class="dai-search-icon" aria-hidden="true">⌕</span>
          <input type="text" class="dai-search-input" placeholder="Buscar agents, skills, MCPs ou bundles" value="${this.esc(query)}" id="search-input" aria-label="Buscar pacotes no catalogo"/>
          ${query ? '<button class="dai-search-clear" type="button" id="search-clear" title="Limpar busca" aria-label="Limpar busca">✕</button>' : ''}
        </div>
      </div>

      <div class="dai-filters" role="toolbar" aria-label="Filtros de tipo de pacote">
        <button class="dai-filter-chip ${!filterType ? 'active' : ''}" type="button" data-type="" aria-pressed="${!filterType}">Todos</button>
        ${typeFilters.map((t) => `<button class="dai-filter-chip ${filterType === t.value ? 'active' : ''}" type="button" data-type="${t.value}" style="--chip-color: ${t.color}" aria-pressed="${filterType === t.value}" title="Filtrar por ${t.label}">${t.label}</button>`).join('')}
      </div>

      ${!query && !filterType ? this.renderBundles(bundles) : ''}

      ${
        !filterType || filterType === 'agent'
          ? sortedCategories
              .map(([catLabel, catAgents]) => {
                const cat = AgentCategory.all().find((c) => c.label === catLabel);
                return this.renderCategorySection(catLabel, cat, catAgents, statusMap);
              })
              .join('')
          : ''
      }

      ${nonAgents.length > 0 ? this.renderNonAgentSection(nonAgents, statusMap) : ''}

      ${packages.length === 0 ? `<div class="dai-empty ${this.animClass('animate-fade-in')}" role="status" aria-live="polite"><span class="dai-empty-icon">🔍</span><span class="dai-empty-text">Nenhum pacote encontrado</span><span class="dai-empty-hint">Tente ajustar a busca ou limpar os filtros ativos.</span></div>` : ''}
    </div>`;
  }

  private renderLoading(): string {
    return /*html*/ `
    <div class="dai-container" aria-busy="true" aria-live="polite">
      <div class="dai-header animate-fade-in">
        <div class="dai-logo-animated dai-logo-hero">
          <div class="dai-header-mark">
            <div class="dai-stack-icon dai-stack-icon--sidebar dai-logo-loading" role="img" aria-label="Carregando catálogo da DescomplicAI">
              <div class="dai-stack-layer dai-layer-1"></div>
              <div class="dai-stack-layer dai-layer-2"></div>
              <div class="dai-stack-layer dai-layer-3"></div>
            </div>
            <span class="dai-status-pill dai-status-pill-active">Atualizando catálogo</span>
          </div>
          <div class="dai-logo-text" style="width: 100%;">
            <div class="dai-skeleton-line" data-size="sm" style="width: 34%;"></div>
            <div class="dai-skeleton-line" data-size="lg" style="width: 58%;"></div>
            <div class="dai-logo-meta">
              <span class="dai-skeleton-pill"></span>
              <span class="dai-skeleton-pill"></span>
            </div>
          </div>
        </div>
      </div>

      <div class="dai-search-container animate-slide-in" style="--delay: 0.08s;">
        <div class="dai-search-wrapper dai-skeleton-block" style="min-height: 52px;"></div>
      </div>

      <div class="dai-filters animate-slide-in" style="--delay: 0.12s;">
        <span class="dai-skeleton-pill"></span>
        <span class="dai-skeleton-pill"></span>
        <span class="dai-skeleton-pill"></span>
      </div>

      <div class="dai-section animate-slide-in" style="--delay: 0.16s;">
        <div class="dai-section-header">
          <span class="dai-section-title">Preparando recomendações e pacotes</span>
        </div>
        <div class="dai-packages-list" role="list" aria-label="Carregando pacotes do catálogo">
          <div class="dai-skeleton-block" role="listitem"></div>
          <div class="dai-skeleton-block" role="listitem"></div>
          <div class="dai-skeleton-block" role="listitem"></div>
        </div>
      </div>
    </div>`;
  }

  private renderBundles(bundles: Bundle[]): string {
    return /*html*/ `
    <div class="dai-section">
      <div class="dai-section-header"><span class="dai-section-title">Bundles de inicio rapido</span></div>
      <div class="dai-packages-list" role="list" aria-label="Bundles de inicio rápido disponíveis">
      ${bundles
        .map(
          (b, i) => /*html*/ `
        <div class="dai-bundle-card ${this.animClass('animate-slide-in')}" style="--delay: ${i * 0.08}s; --accent: ${b.color}" role="listitem">
          <div class="dai-bundle-glow" style="background: ${b.color}"></div>
          <div class="dai-bundle-content">
            <span class="dai-bundle-name">${b.displayName}</span>
            <span class="dai-bundle-desc">${b.description}</span>
            <div class="dai-bundle-meta">
              <span class="dai-bundle-count">${b.packageCount} pacotes orquestrados</span>
              <button class="dai-btn dai-btn-bundle" type="button" data-bundle-id="${b.id}" title="Instalar ${this.esc(b.displayName)}" aria-label="Instalar ${this.esc(b.displayName)}">Instalar</button>
            </div>
          </div>
        </div>`,
        )
        .join('')}
      </div>
    </div>`;
  }

  private renderCategorySection(
    catLabel: string,
    cat: AgentCategory | undefined,
    agents: Package[],
    statusMap: Map<string, InstallStatus>,
  ): string {
    const emoji = cat?.emoji ?? '⚡';
    const color = cat?.color ?? '#EC7000';

    return /*html*/ `
    <div class="dai-section ${this.animClass('animate-slide-in')}" style="--delay: 0.1s">
      <div class="dai-section-header">
        <span class="dai-section-title" style="color: ${color}">
          <span class="dai-cat-emoji">${emoji}</span> ${catLabel}s
        </span>
        <span class="dai-section-count" style="background: ${color}20; color: ${color}">${agents.length}</span>
      </div>
      ${cat?.description ? `<p class="dai-cat-desc">${cat.description}</p>` : ''}
      <div class="dai-packages-list" role="list" aria-label="Agents da categoria ${this.esc(catLabel)}">
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

    return /*html*/ `
    <div class="dai-card ${this.animClass('animate-slide-in')} ${isInstalledOrOutdated ? 'installed' : ''} ${hasNetwork ? 'has-network' : ''}" style="--delay: ${index * 0.04}s; --cat-color: ${catColor}" data-pkg-id="${pkg.id}" role="listitem" aria-labelledby="card-title-${pkg.id}">
      <div class="dai-card-header">
        <div>
          <div class="dai-card-badge" style="--badge-color: ${catColor}">${catEmoji} ${catLabel.toUpperCase()}</div>
          <span class="dai-card-version">v${pkg.version.toString()}</span>
        </div>
        ${
          isOutdated
            ? '<span class="dai-status-pill dai-status-pill-warning">Atualização disponível</span>'
            : isInstalled
              ? '<span class="dai-status-pill dai-status-pill-ready">Instalado</span>'
              : '<span class="dai-status-pill dai-status-pill-idle">Disponível</span>'
        }
      </div>

      <div class="dai-card-body">
        <span class="dai-card-name" id="card-title-${pkg.id}">${pkg.displayName}</span>
        <span class="dai-card-desc">${pkg.description}</span>
      </div>

      <div class="dai-card-meta">
        <span class="dai-meta-item" title="Ferramentas">🔧 ${toolCount}</span>
        ${hasNetwork ? `<span class="dai-meta-item dai-meta-network" title="Rede de Agents">🔗 ${networkCount} agents</span>` : '<span class="dai-meta-item">📦 Independente</span>'}
        ${skillCount > 0 ? `<span class="dai-meta-item" title="Skills Relacionadas">📚 ${skillCount}</span>` : ''}
        <span class="dai-meta-item" title="Maturidade">🏷️ ${pkg.maturityLabel}</span>
      </div>

      ${isInstalledOrOutdated ? `<div class="dai-installed-indicator">${isOutdated ? '&#8593; Atualização Disponível' : '&#10003; Instalado'}</div>` : ''}

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
        ${pkg.ui.highlights.length > 0 ? `<div class="dai-detail-section"><span class="dai-detail-label">✨ Highlights</span><div class="dai-detail-list">${pkg.ui.highlights.map((item) => `<span class="dai-detail-bullet">• ${this.esc(item)}</span>`).join('')}</div></div>` : ''}
        ${hasNetwork ? this.renderNetworkSection(pkg) : ''}
        ${toolCount > 0 ? `<div class="dai-detail-section"><span class="dai-detail-label">🔧 Ferramentas</span><div class="dai-tool-chips">${meta!.tools.map((t) => `<span class="dai-tool-chip">${t}</span>`).join('')}</div></div>` : ''}
        ${meta?.workflowPhase ? `<div class="dai-detail-section"><span class="dai-detail-label">🔄 Fase no Workflow</span><span class="dai-detail-value">${meta.workflowPhase}</span></div>` : ''}
        <div class="dai-detail-section"><span class="dai-detail-label">📊 Complexidade</span><div class="dai-complexity-bar"><div class="dai-complexity-fill" style="width: ${pkg.complexityScore}%; background: ${catColor}"></div></div><span class="dai-complexity-score">${pkg.complexityScore}/100</span></div>
        ${pkg.ui.installNotes.length > 0 ? `<div class="dai-detail-section"><span class="dai-detail-label">📦 Instalação</span><div class="dai-detail-list">${pkg.ui.installNotes.map((item) => `<span class="dai-detail-bullet">• ${this.esc(item)}</span>`).join('')}</div></div>` : ''}
        ${pkg.docs.links.length > 0 ? `<div class="dai-detail-section"><span class="dai-detail-label">🔗 Links</span><div class="dai-tool-chips">${pkg.docs.links.map((link) => `<a class="dai-tool-chip dai-link-chip" href="${this.esc(link.url)}" target="_blank" rel="noreferrer">${this.esc(link.label)}</a>`).join('')}</div></div>` : ''}
      </div>

      <div class="dai-card-actions">
        <button class="dai-btn dai-btn-ghost dai-btn-sm" type="button" data-toggle-details="${pkg.id}" aria-controls="details-${pkg.id}" aria-expanded="false" aria-label="Mostrar detalhes de ${this.esc(pkg.displayName)}">Detalhes</button>
        ${
          isOutdated
            ? `<button class="dai-btn dai-btn-warning dai-btn-sm" type="button" data-install="${pkg.id}" aria-label="Atualizar ${this.esc(pkg.displayName)}">Atualizar</button>
             <button class="dai-btn dai-btn-danger dai-btn-sm" type="button" data-uninstall="${pkg.id}" aria-label="Desinstalar ${this.esc(pkg.displayName)}">Remover</button>`
            : isInstalled
              ? `<button class="dai-btn dai-btn-danger dai-btn-sm" type="button" data-uninstall="${pkg.id}" aria-label="Desinstalar ${this.esc(pkg.displayName)}">Remover</button>`
              : hasNetwork
                ? `<button class="dai-btn dai-btn-primary dai-btn-sm" type="button" data-install-network="${pkg.id}" aria-label="Instalar rede de ${this.esc(pkg.displayName)}">Instalar rede</button>`
                : `<button class="dai-btn dai-btn-primary dai-btn-sm" type="button" data-install="${pkg.id}" aria-label="Instalar ${this.esc(pkg.displayName)}">Instalar</button>`
        }
      </div>
    </div>`;
  }

  private renderNetworkSection(pkg: Package): string {
    const delegates = pkg.agentMeta?.delegatesTo ?? [];
    if (delegates.length === 0) {
      return '';
    }

    return /*html*/ `
    <div class="dai-detail-section">
      <span class="dai-detail-label">🔗 Rede de Agents (${delegates.length})</span>
      <div class="dai-network-tree">
        ${delegates
          .map((d) => {
            const emoji = d.includes('planner')
              ? '📐'
              : d.includes('architect')
                ? '🏛️'
                : d.includes('reviewer')
                  ? '🛡️'
                  : d.includes('test')
                    ? '🧪'
                    : '⚡';
            return `<div class="dai-network-node"><span class="dai-node-connector">├──</span><span class="dai-node-emoji">${emoji}</span><span class="dai-node-name">${d}</span></div>`;
          })
          .join('')}
      </div>
      <div class="dai-network-hint">
        💡 "Instalar Rede" baixa este agent + todos os ${delegates.length} dependentes
      </div>
    </div>`;
  }

  private renderNonAgentSection(
    packages: Package[],
    statusMap: Map<string, InstallStatus>,
  ): string {
    // Agrupa por tipo
    const groups = new Map<string, Package[]>();
    for (const pkg of packages) {
      const key = pkg.type.label;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(pkg);
    }

    return [...groups.entries()]
      .map(
        ([typeLabel, pkgs]) => /*html*/ `
    <div class="dai-section">
      <div class="dai-section-header">
        <span class="dai-section-title">${pkgs[0].type.codicon.replace('$(', '').replace(')', '')} ${typeLabel}s</span>
        <span class="dai-section-count">${pkgs.length}</span>
      </div>
      <div class="dai-packages-list" role="list" aria-label="Pacotes do tipo ${this.esc(typeLabel)}">
        ${pkgs
          .map((pkg, i) => {
            const pkgStatus = statusMap.get(pkg.id) ?? InstallStatus.NotInstalled;
            const isInstalled = pkgStatus === InstallStatus.Installed;
            const isOutdated = pkgStatus === InstallStatus.Outdated;
            return /*html*/ `
          <div class="dai-card dai-card-compact ${this.animClass('animate-slide-in')} ${isInstalled || isOutdated ? 'installed' : ''}" style="--delay: ${i * 0.04}s; --cat-color: ${pkg.type.color}" role="listitem" aria-label="${this.esc(pkg.displayName)}">
            <div class="dai-card-header">
              <div class="dai-card-badge" style="--badge-color: ${pkg.type.color}">${pkg.typeLabel.toUpperCase()}</div>
              ${
                isOutdated
                  ? '<span class="dai-status-pill dai-status-pill-warning">Atualizar</span>'
                  : isInstalled
                    ? '<span class="dai-status-pill dai-status-pill-ready">Instalado</span>'
                    : '<span class="dai-status-pill dai-status-pill-idle">Disponível</span>'
              }
            </div>
            <div class="dai-card-body">
              <span class="dai-card-name">${pkg.displayName}</span>
              <span class="dai-card-desc">${pkg.description}</span>
              <span class="dai-card-inline-meta">${pkg.sourceLabel} · ${pkg.maturityLabel} · ${pkg.stats.installsTotal} instalações</span>
            </div>
            <div class="dai-card-actions">
              <div class="dai-card-tags">${pkg.tags
                .slice(0, 3)
                .map((t) => `<span class="dai-tag">${t}</span>`)
                .join('')}</div>
              ${
                isOutdated
                  ? `<button class="dai-btn dai-btn-warning dai-btn-sm" type="button" data-install="${pkg.id}" aria-label="Atualizar ${this.esc(pkg.displayName)}">Atualizar</button>
                   <button class="dai-btn dai-btn-danger dai-btn-sm" type="button" data-uninstall="${pkg.id}" aria-label="Desinstalar ${this.esc(pkg.displayName)}">Remover</button>`
                  : isInstalled
                    ? `<button class="dai-btn dai-btn-danger dai-btn-sm" type="button" data-uninstall="${pkg.id}" aria-label="Desinstalar ${this.esc(pkg.displayName)}">Remover</button>`
                    : `<button class="dai-btn dai-btn-primary dai-btn-sm" type="button" data-install="${pkg.id}" aria-label="Instalar ${this.esc(pkg.displayName)}">Instalar</button>`
              }
            </div>
          </div>`;
          })
          .join('')}
      </div>
    </div>`,
      )
      .join('');
  }

  // ═══════════════════════════════════════════
  // MANIPULADORES DE EVENTOS
  // ═══════════════════════════════════════════

  /** Notifica o controlador de logo do webview sobre o resultado de uma operação. */
  private postLogoResult(result: 'success' | 'error' | 'reset'): void {
    if (this._view) {
      void this._view.webview.postMessage({ type: 'logoResult', result });
    }
  }

  private async handleInstall(packageId: string): Promise<void> {
    const pkg = await this._registry.findById(packageId);
    if (!pkg) {
      return;
    }

    const packagesToInstall = await this.resolvePackagesForInstall(pkg);
    if (!packagesToInstall || packagesToInstall.length === 0) {
      this.notifyWebview(
        'info',
        'Instalação cancelada',
        'Nenhuma alteração foi aplicada ao pacote selecionado.',
      );
      this.postLogoResult('reset');
      return;
    }
    try {
      await this._operations.run(
        {
          kind: packagesToInstall.length > 1 ? 'bundle-install' : 'package-install',
          label:
            packagesToInstall.length > 1
              ? `Instalando ${packagesToInstall.length} pacotes`
              : `Instalando ${pkg.displayName}`,
          targetId: pkg.id,
          refreshTargets: ['catalog', 'installed'],
        },
        async (operation) => {
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
        },
      );
      this.notifyWebview(
        'success',
        'Instalação concluída',
        packagesToInstall.length > 1
          ? `${packagesToInstall.length} pacotes foram adicionados à sua stack.`
          : `${pkg.displayName} está pronto para uso.`,
      );
      this.postLogoResult('success');
    } catch (error) {
      this.notifyWebview(
        'error',
        'Falha na instalação',
        error instanceof Error ? error.message : `Não foi possível instalar ${pkg.displayName}.`,
      );
      this.postLogoResult('error');
    }
  }

  private async handleInstallNetwork(packageId: string): Promise<void> {
    const pkg = await this._registry.findById(packageId);
    if (!pkg?.agentMeta) {
      return await this.handleInstall(packageId);
    }

    // Busca a rede completa
    const network = await this._registry.getAgentNetwork(packageId);
    const relatedSkills = await this._registry.getRelatedSkills(packageId);
    const allPackages = [pkg, ...network, ...relatedSkills];

    // Remove duplicatas
    const seen = new Set<string>();
    const unique = allPackages.filter((p) => {
      if (seen.has(p.id)) {
        return false;
      }
      seen.add(p.id);
      return true;
    });

    const choice = await vscode.window.showInformationMessage(
      `"${pkg.displayName}" coordena ${network.length} agent(s). ${this.summarizePackagesForDialog(unique.filter((candidate) => candidate.id !== pkg.id)) ? `Pacotes relacionados: ${this.summarizePackagesForDialog(unique.filter((candidate) => candidate.id !== pkg.id))}. ` : ''}Escolha se deseja instalar apenas o pacote principal ou a rede completa (${unique.length} pacote(s) no total).`,
      { modal: true },
      `Instalar rede completa (${unique.length})`,
      'Instalar apenas este agent',
      'Cancelar',
    );

    if (choice?.startsWith('Instalar rede completa')) {
      try {
        await this._operations.run(
          {
            kind: 'bundle-install',
            label: `Instalando rede ${pkg.displayName}`,
            targetId: pkg.id,
            refreshTargets: ['catalog', 'installed'],
          },
          async (operation) => {
            await this._installer.installMany(unique, {
              onProgress: (progress) => {
                operation.setProgress((progress.current / progress.total) * 100, progress.label);
              },
            });
          },
        );
        this.notifyWebview(
          'success',
          'Rede instalada',
          `${unique.length} pacotes da rede ${pkg.displayName} foram aplicados com sucesso.`,
        );
        this.postLogoResult('success');
      } catch (error) {
        this.notifyWebview(
          'error',
          'Falha ao instalar rede',
          error instanceof Error
            ? error.message
            : `A rede ${pkg.displayName} não pôde ser instalada.`,
        );
        this.postLogoResult('error');
      }
    } else if (choice === 'Instalar apenas este agent') {
      UxDiagnosticsService.getInstance().track('modal.networkInstall.packageOnly', {
        surface: 'modal',
      });
      try {
        await this._operations.run(
          {
            kind: 'package-install',
            label: `Instalando ${pkg.displayName}`,
            targetId: pkg.id,
            refreshTargets: ['catalog', 'installed'],
          },
          async (operation) => {
            operation.setProgress(10, pkg.displayName);
            await this._installer.install(pkg, {
              onProgress: () => operation.setProgress(100, pkg.displayName),
            });
          },
        );
        this.notifyWebview(
          'success',
          'Agent instalado',
          `${pkg.displayName} foi instalado isoladamente.`,
        );
        this.postLogoResult('success');
      } catch (error) {
        this.notifyWebview(
          'error',
          'Falha ao instalar agent',
          error instanceof Error ? error.message : `Não foi possível instalar ${pkg.displayName}.`,
        );
        this.postLogoResult('error');
      }
    } else {
      // Usuário dispensou o diálogo — reseta o logo para o estado ocioso
      UxDiagnosticsService.getInstance().track('modal.networkInstall.cancelled', {
        surface: 'modal',
      });
      this.notifyWebview(
        'info',
        'Instalação cancelada',
        'Nenhuma alteração foi aplicada à rede selecionada.',
      );
      this.postLogoResult('reset');
    }
  }

  private async handleUninstall(packageId: string): Promise<void> {
    const pkg = await this._registry.findById(packageId);
    if (!pkg) {
      return;
    }
    try {
      await this._operations.run(
        {
          kind: 'package-uninstall',
          label: `Removendo ${pkg.displayName}`,
          targetId: pkg.id,
          refreshTargets: ['catalog', 'installed'],
        },
        async (operation) => {
          operation.setProgress(10, pkg.displayName);
          await this._installer.uninstall(pkg, {
            onProgress: () => operation.setProgress(100, pkg.displayName),
          });
        },
      );
      this.notifyWebview(
        'success',
        'Pacote removido',
        `${pkg.displayName} foi removido da sua stack.`,
      );
      this.postLogoResult('success');
    } catch (error) {
      this.notifyWebview(
        'error',
        'Falha ao remover pacote',
        error instanceof Error ? error.message : `Não foi possível remover ${pkg.displayName}.`,
      );
      this.postLogoResult('error');
    }
  }

  private async handleInstallBundle(bundleId: string): Promise<void> {
    const bundle = await this._registry.findBundleById(bundleId);
    if (!bundle) {
      return;
    }
    const packages: Package[] = [];
    for (const pkgId of bundle.packageIds) {
      const pkg = await this._registry.findById(pkgId);
      if (pkg) {
        packages.push(pkg);
      }
    }
    if (packages.length > 0) {
      try {
        await this._operations.run(
          {
            kind: 'bundle-install',
            label: `Instalando bundle ${bundle.displayName}`,
            targetId: bundle.id,
            refreshTargets: ['catalog', 'installed'],
          },
          async (operation) => {
            await this._installer.installMany(packages, {
              onProgress: (progress) => {
                operation.setProgress((progress.current / progress.total) * 100, progress.label);
              },
            });
          },
        );
        this.notifyWebview(
          'success',
          'Bundle instalado',
          `${bundle.displayName} foi aplicado com ${packages.length} pacotes.`,
        );
        this.postLogoResult('success');
      } catch (error) {
        this.notifyWebview(
          'error',
          'Falha ao instalar bundle',
          error instanceof Error
            ? error.message
            : `Não foi possível instalar ${bundle.displayName}.`,
        );
        this.postLogoResult('error');
      }
    }
  }

  private notifyWebview(
    kind: 'success' | 'warning' | 'error' | 'info',
    title: string,
    message: string,
  ): void {
    if (!this._view) {
      return;
    }
    WebviewHelper.postNotification(this._view.webview, { kind, title, message });
  }

  // ═══════════════════════════════════════════
  // SCRIPT DO CLIENTE
  // ═══════════════════════════════════════════

  private getScript(): string {
    return /*js*/ `
    let searchTimeout;
    const render = (state) => state.html || '<div class="dai-container"><div class="dai-empty"><span class="dai-empty-text">Sem dados</span></div></div>';

    // ── Animação do logo: trata mensagens da extensão ──────────────────────
    // A extensão envia { type: 'logoResult', result: 'success'|'error'|'reset' }
      // após uma operação ser concluída. Tratado pelo hook onMessage do framework.
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
      // Restaura a posição de scroll do estado persistido vscode.getState() — desacoplado das re-renderizações.
      // Evita que a posição de scroll seja incluída no estado do lado da extensão,
      // o que causaria o salto da página ao topo a cada atualização de progresso.
      const persistedScrollTop = (vscode.getState() || {}).scrollTop;
      if (scrollingEl && typeof persistedScrollTop === 'number' && persistedScrollTop > 0) {
        requestAnimationFrame(() => { scrollingEl.scrollTop = persistedScrollTop; });
      }

      // Persiste a posição de scroll diretamente em vscode.getState() SEM chamar patchState.
      // patchState dispara uma re-renderização completa do innerHTML, que destrói e recria todos
      // os elementos DOM (incluindo o logo animado) a cada pixel de scroll.
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
        if (toggle) {
          toggle.textContent = 'Ocultar';
          toggle.setAttribute('aria-expanded', 'true');
        }
      });

      app.root.querySelectorAll('[data-toggle-details]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.toggleDetails;
          const details = app.root.querySelector('#details-' + id);
          if (!details || !id) { return; }
          const isOpen = details.classList.toggle('open');
          const current = new Set(Array.isArray(app.state.expandedIds) ? app.state.expandedIds : []);
          if (isOpen) { current.add(id); } else { current.delete(id); }
          btn.textContent = isOpen ? 'Ocultar' : 'Detalhes';
          btn.setAttribute('aria-expanded', String(isOpen));
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

      // ── Controlador de animação do logo ─────────────────────
      // Acionado apenas durante operações reais — nunca em idle ou scroll.
      // Respeita prefers-reduced-motion via a regra CSS global.
      // Todas as classes são removidas após a animação para que re-renderizações
      // não as reproduzam acidentalmente (proteção contra edge cases do dai-hydrated).
      window.__daiLogoAnim = window.__daiLogoAnim || {
        _el: null,
        _workingTimeout: null,

        get el() {
          if (!this._el) { this._el = document.querySelector('.dai-stack-icon'); }
          return this._el;
        },

        /** Chama quando uma operação inicia */
        startWorking() {
          const el = this.el;
          if (!el) { return; }
          el.classList.remove('dai-logo-idle', 'dai-logo-success', 'dai-logo-error', 'dai-logo-inactive');
          el.classList.add('dai-logo-loading');
        },

        /** Chama quando uma operação é concluída com sucesso */
        succeed() {
          const el = this.el;
          if (!el) { return; }
          el.classList.remove('dai-logo-loading', 'dai-logo-working', 'dai-logo-error');
          el.classList.add('dai-logo-success');
          el.addEventListener('animationend', function onEnd() {
            el.classList.remove('dai-logo-success');
            el.classList.add('dai-logo-idle');
            el.removeEventListener('animationend', onEnd);
          }, { once: true });
        },

        /** Chama quando uma operação termina com erro */
        fail() {
          const el = this.el;
          if (!el) { return; }
          el.classList.remove('dai-logo-loading', 'dai-logo-working', 'dai-logo-success');
          el.classList.add('dai-logo-error');
          el.addEventListener('animationend', function onEnd() {
            el.classList.remove('dai-logo-error');
            el.classList.add('dai-logo-idle');
            el.removeEventListener('animationend', onEnd);
          }, { once: true });
        },

        /** Chama quando uma operação é cancelada ou o painel atualiza sem resultado */
        reset() {
          const el = this.el;
          if (!el) { return; }
          el.classList.remove('dai-logo-loading', 'dai-logo-working', 'dai-logo-success', 'dai-logo-error', 'dai-logo-inactive');
          el.classList.add('dai-logo-idle');
        },
      };

      // Conecta os botões de instalar/desinstalar para que o logo responda em tempo real
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

    const progressValue =
      typeof operation.progress === 'number'
        ? Math.max(6, Math.min(100, Math.round(operation.progress)))
        : 24;
    const progressLabel =
      typeof operation.progress === 'number' ? `${progressValue}%` : 'Em andamento';
    const message = operation.message
      ? this.esc(operation.message)
      : 'Processando alterações na sua stack de agentes.';
    return /*html*/ `
    <section class="dai-operation-banner" role="status" aria-live="polite" aria-label="Progresso da operação atual">
      <div class="dai-operation-head">
        <div class="dai-operation-copy">
          <span class="dai-operation-kicker">Execução em andamento</span>
          <p class="dai-operation-label">${this.esc(operation.label)}</p>
          <p class="dai-operation-message">${message}</p>
        </div>
        <span class="dai-status-pill dai-status-pill-active">${progressLabel}</span>
      </div>
      <div class="dai-progress-track" aria-hidden="true">
        <span class="dai-progress-value" style="width: ${progressValue}%"></span>
      </div>
    </section>`;
  }

  private async resolvePackagesForInstall(pkg: Package): Promise<Package[] | undefined> {
    const autoResolve = vscode.workspace
      .getConfiguration('descomplicai')
      .get<boolean>('autoResolveDependencies', true);
    if (!autoResolve || pkg.dependencies.length === 0) {
      return [pkg];
    }

    const resolved = new Map<string, Package>();
    const visited = new Set<string>();

    const visit = async (current: Package): Promise<void> => {
      if (visited.has(current.id)) {
        return;
      }
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

    const dependencies = [...resolved.values()].filter((candidate) => candidate.id !== pkg.id);
    const dependencySummary = this.summarizePackagesForDialog(dependencies);

    const choice = await vscode.window.showInformationMessage(
      `"${pkg.displayName}" possui ${resolved.size - 1} dependência(s). ${dependencySummary ? `Dependências detectadas: ${dependencySummary}. ` : ''}Escolha como deseja continuar.`,
      { modal: true },
      `Instalar pacote completo (${resolved.size})`,
      'Instalar apenas este pacote',
      'Cancelar',
    );

    if (choice?.startsWith('Instalar pacote completo')) {
      return [...resolved.values()];
    }

    if (choice === 'Instalar apenas este pacote') {
      UxDiagnosticsService.getInstance().track('modal.dependencies.packageOnly', {
        surface: 'modal',
      });
      return [pkg];
    }

    UxDiagnosticsService.getInstance().track('modal.dependencies.cancelled', {
      surface: 'modal',
    });

    return undefined;
  }

  private summarizePackagesForDialog(packages: Package[]): string {
    const labels = packages.map((candidate) => candidate.displayName).filter(Boolean);
    if (labels.length === 0) {
      return '';
    }

    const preview = labels.slice(0, 4).join(', ');
    const overflow = labels.length > 4 ? ` e mais ${labels.length - 4}` : '';
    return `${preview}${overflow}`;
  }

  private esc(t: string): string {
    return t
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
