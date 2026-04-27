/**
 * @module domain/entities/Package
 * @description Entidade central que representa um pacote de infraestrutura de AI instalável.
 * Pacotes podem ser agents, skills, MCPs, instructions ou prompts.
 * Entidade de domínio pura — sem dependências de VS Code ou infraestrutura.
 */

import { PackageType } from '../value-objects/PackageType';
import { Version } from '../value-objects/Version';
import { AgentCategory } from '../value-objects/AgentCategory';

/** Metadados de um único arquivo pertencente ao pacote. */
export interface PackageFile {
  /** Caminho relativo a partir da raiz do workspace (ex.: ".github/agents/backend-specialist.agent.md") */
  readonly relativePath: string;
  /** Template do conteúdo do arquivo. Suporta placeholders {{variável}}. */
  readonly content: string;
}

/** Tag para categorização e busca. */
export type PackageTag = string;

export type PackageMaturity = 'stable' | 'beta' | 'experimental';

export interface PackageLink {
  readonly label: string;
  readonly url: string;
}

export interface PackageSource {
  readonly repoUrl?: string;
  readonly packagePath?: string;
  readonly manifestPath?: string;
  readonly readmePath?: string;
  readonly detailsPath?: string;
  readonly homepage?: string;
  readonly official: boolean;
}

export interface PackageInstallTarget {
  readonly sourcePath?: string;
  readonly targetPath: string;
  readonly mergeStrategy?: 'replace' | 'merge-mcp-servers';
}

export interface PackageInstallStrategy {
  readonly kind: 'copy' | 'mcp-merge';
  readonly targets: ReadonlyArray<PackageInstallTarget>;
}

export interface PackageUiMetadata {
  readonly longDescription?: string;
  readonly highlights: ReadonlyArray<string>;
  readonly installNotes: ReadonlyArray<string>;
  readonly badges: ReadonlyArray<string>;
  readonly maturity: PackageMaturity;
  readonly icon?: string;
  readonly banner?: string;
}

export interface PackageDocs {
  readonly readme?: string;
  readonly details?: string;
  readonly links: ReadonlyArray<PackageLink>;
}

export interface PackageStats {
  readonly installsTotal: number;
  readonly uniqueInstallers?: number;
  readonly lastInstallAt?: string;
  readonly trendScore?: number;
}

/** Status de instalação de um pacote no workspace. */
export enum InstallStatus {
  NotInstalled = 'not-installed',
  Installed = 'installed',
  Outdated = 'outdated',
  Partial = 'partial',
}

/** Metadados específicos de agente para posicionamento no workflow. */
export interface AgentMeta {
  /** Categoria funcional: orchestrator, planner, specialist, guardian, memory. */
  readonly category: AgentCategory;
  /** Ferramentas a que este agente tem acesso. */
  readonly tools: ReadonlyArray<string>;
  /** Outros agentes para os quais este agente pode delegar. */
  readonly delegatesTo: ReadonlyArray<string>;
  /** Fase do pipeline de workflow em que este agente opera. */
  readonly workflowPhase: string;
  /** Indica se o usuário pode invocar este agente diretamente. */
  readonly userInvocable: boolean;
  /** Skills que este agente normalmente utiliza. */
  readonly relatedSkills: ReadonlyArray<string>;
}

/**
 * Package — Entidade central do AI Stack Manager.
 *
 * Representa uma unidade instalável: uma definição de agente, um arquivo de skill,
 * uma configuração de servidor MCP, uma instruction ou um template de prompt.
 *
 * Imutável por design. Use métodos de fábrica para criar instâncias.
 */
export class Package {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly displayName: string,
    public readonly description: string,
    public readonly type: PackageType,
    public readonly version: Version,
    public readonly tags: ReadonlyArray<PackageTag>,
    public readonly author: string,
    public readonly files: ReadonlyArray<PackageFile>,
    public readonly dependencies: ReadonlyArray<string>,
    public readonly icon: string,
    public readonly source: PackageSource,
    public readonly installStrategy: PackageInstallStrategy,
    public readonly ui: PackageUiMetadata,
    public readonly docs: PackageDocs,
    public readonly stats: PackageStats,
    /** Metadados específicos de agente — presente somente para type=Agent. */
    public readonly agentMeta?: AgentMeta,
  ) {}

  /** Método de fábrica para criar um Package a partir de dados brutos. */
  static create(props: {
    id: string;
    name: string;
    displayName: string;
    description: string;
    type: PackageType;
    version: string;
    tags: PackageTag[];
    author: string;
    files: PackageFile[];
    dependencies?: string[];
    icon?: string;
    source?: Partial<PackageSource>;
    installStrategy?: Partial<PackageInstallStrategy>;
    ui?: Partial<PackageUiMetadata>;
    docs?: Partial<PackageDocs>;
    stats?: Partial<PackageStats>;
    agentMeta?: {
      category: AgentCategory;
      tools: string[];
      delegatesTo?: string[];
      workflowPhase: string;
      userInvocable?: boolean;
      relatedSkills?: string[];
    };
  }): Package {
    let meta: AgentMeta | undefined;
    if (props.agentMeta) {
      meta = {
        category: props.agentMeta.category,
        tools: Object.freeze([...props.agentMeta.tools]),
        delegatesTo: Object.freeze([...(props.agentMeta.delegatesTo ?? [])]),
        workflowPhase: props.agentMeta.workflowPhase,
        userInvocable: props.agentMeta.userInvocable ?? false,
        relatedSkills: Object.freeze([...(props.agentMeta.relatedSkills ?? [])]),
      };
    }

    return new Package(
      props.id,
      props.name,
      props.displayName,
      props.description,
      props.type,
      Version.parse(props.version),
      Object.freeze([...props.tags]),
      props.author,
      Object.freeze([...props.files]),
      Object.freeze([...(props.dependencies ?? [])]),
      props.icon ?? Package.defaultIconForType(props.type),
      {
        repoUrl: props.source?.repoUrl,
        packagePath: props.source?.packagePath,
        manifestPath: props.source?.manifestPath,
        readmePath: props.source?.readmePath,
        detailsPath: props.source?.detailsPath,
        homepage: props.source?.homepage,
        official: props.source?.official ?? false,
      },
      {
        kind: props.installStrategy?.kind ?? (props.type.equals(PackageType.MCP) ? 'mcp-merge' : 'copy'),
        targets: Object.freeze([
          ...((props.installStrategy?.targets ?? props.files.map(file => ({
            targetPath: file.relativePath,
            mergeStrategy: props.type.equals(PackageType.MCP) ? 'merge-mcp-servers' : 'replace',
          }))) as PackageInstallTarget[]),
        ]),
      },
      {
        longDescription: props.ui?.longDescription ?? props.description,
        highlights: Object.freeze([...(props.ui?.highlights ?? [])]),
        installNotes: Object.freeze([...(props.ui?.installNotes ?? [])]),
        badges: Object.freeze([...(props.ui?.badges ?? [])]),
        maturity: props.ui?.maturity ?? 'stable',
        icon: props.ui?.icon,
        banner: props.ui?.banner,
      },
      {
        readme: props.docs?.readme,
        details: props.docs?.details,
        links: Object.freeze([...(props.docs?.links ?? [])]),
      },
      {
        installsTotal: props.stats?.installsTotal ?? 0,
        uniqueInstallers: props.stats?.uniqueInstallers,
        lastInstallAt: props.stats?.lastInstallAt,
        trendScore: props.stats?.trendScore,
      },
      meta,
    );
  }

  /** Verifica se este é um pacote do tipo agent. */
  get isAgent(): boolean {
    return this.type.equals(PackageType.Agent);
  }

  /** Retorna a categoria do agente (somente para agents). */
  get category(): AgentCategory | undefined {
    return this.agentMeta?.category;
  }

  /** Retorna o emoji de categoria (para agents) ou o codicon do tipo (para outros). */
  get categoryEmoji(): string {
    return this.agentMeta?.category.emoji ?? '';
  }

  /** Pontuação de complexidade baseada em ferramentas, delegações e skills. */
  get complexityScore(): number {
    if (!this.agentMeta) { return 0; }
    const toolScore = this.agentMeta.tools.length * 10;
    const delegateScore = this.agentMeta.delegatesTo.length * 15;
    const skillScore = this.agentMeta.relatedSkills.length * 8;
    const invocableBonus = this.agentMeta.userInvocable ? 20 : 0;
    return Math.min(100, toolScore + delegateScore + skillScore + invocableBonus);
  }

  /** Verifica se o pacote corresponde a uma query de busca. */
  matchesQuery(query: string): boolean {
    const q = query.toLowerCase().trim();
    if (q === '') { return true; }
    return (
      this.name.toLowerCase().includes(q) ||
      this.displayName.toLowerCase().includes(q) ||
      this.description.toLowerCase().includes(q) ||
      this.tags.some(t => t.toLowerCase().includes(q)) ||
      this.type.value.toLowerCase().includes(q) ||
      (this.agentMeta?.category.label.toLowerCase().includes(q) ?? false)
    );
  }

  /** Retorna o caminho do arquivo principal (primeiro arquivo do pacote). */
  get primaryFilePath(): string {
    return this.files[0]?.relativePath ?? '';
  }

  /** Human-readable type label */
  get typeLabel(): string {
    return this.type.label;
  }

  get isOfficial(): boolean {
    return this.source.official;
  }

  get sourceLabel(): string {
    return this.source.official ? 'Oficial do catálogo' : 'Local / customizado';
  }

  get maturityLabel(): string {
    const labels: Record<PackageMaturity, string> = {
      stable: 'Stable',
      beta: 'Beta',
      experimental: 'Experimental',
    };
    return labels[this.ui.maturity];
  }

  /** Codicon identifier for VS Code */
  get typeIcon(): string {
    return this.type.codicon;
  }

  /** Default icon based on package type */
  private static defaultIconForType(type: PackageType): string {
    return type.codicon;
  }
}
