/**
 * @module domain/entities/Package
 * @description Core entity representing an installable AI infrastructure package.
 * Packages can be agents, skills, MCPs, instructions, or prompts.
 * This is a pure domain entity — no VS Code or infrastructure dependencies.
 */

import { PackageType } from '../value-objects/PackageType';
import { Version } from '../value-objects/Version';
import { AgentCategory } from '../value-objects/AgentCategory';

/** Metadata for a single file that belongs to a package */
export interface PackageFile {
  /** Relative path from workspace root (e.g. ".github/agents/backend-specialist.agent.md") */
  readonly relativePath: string;
  /** File content template. Supports {{variable}} placeholders. */
  readonly content: string;
}

/** Tag for categorization and search */
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

/** Installation status of a package in the workspace */
export enum InstallStatus {
  NotInstalled = 'not-installed',
  Installed = 'installed',
  Outdated = 'outdated',
  Partial = 'partial',
}

/** Agent-specific metadata for workflow positioning */
export interface AgentMeta {
  /** Functional category: orchestrator, planner, specialist, guardian, memory */
  readonly category: AgentCategory;
  /** Tools this agent has access to */
  readonly tools: ReadonlyArray<string>;
  /** Other agents this agent can delegate to */
  readonly delegatesTo: ReadonlyArray<string>;
  /** Phase in the workflow pipeline where this agent operates */
  readonly workflowPhase: string;
  /** Whether the user can invoke this agent directly */
  readonly userInvocable: boolean;
  /** Skills this agent typically uses */
  readonly relatedSkills: ReadonlyArray<string>;
}

/**
 * Package — The core entity of AI Stack Manager.
 *
 * Represents a single installable unit: an agent definition, a skill file,
 * an MCP server configuration, an instruction, or a prompt template.
 *
 * Immutable by design. Use factory methods to create instances.
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
    /** Agent-specific metadata — only present for type=Agent */
    public readonly agentMeta?: AgentMeta,
  ) {}

  /** Factory method to create a Package from raw data */
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

  /** Check if this is an agent package */
  get isAgent(): boolean {
    return this.type.equals(PackageType.Agent);
  }

  /** Get the agent category (only for agents) */
  get category(): AgentCategory | undefined {
    return this.agentMeta?.category;
  }

  /** Get the category emoji (for agents) or type codicon (for others) */
  get categoryEmoji(): string {
    return this.agentMeta?.category.emoji ?? '';
  }

  /** Complexity score based on tools, delegations, and skills */
  get complexityScore(): number {
    if (!this.agentMeta) { return 0; }
    const toolScore = this.agentMeta.tools.length * 10;
    const delegateScore = this.agentMeta.delegatesTo.length * 15;
    const skillScore = this.agentMeta.relatedSkills.length * 8;
    const invocableBonus = this.agentMeta.userInvocable ? 20 : 0;
    return Math.min(100, toolScore + delegateScore + skillScore + invocableBonus);
  }

  /** Check if this package matches a search query */
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

  /** Get the primary file path (first file in the package) */
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
