/**
 * @module domain/value-objects/AgentCategory
 * @description Value object representing the functional category of an agent.
 * Agents are NOT all the same — they have fundamentally different roles
 * in the multi-agent workflow.
 * 
 * Categories:
 * - Orchestrator: Hub/control plane, routes work to specialists
 * - Planner: Strategy, decomposition, DAG generation
 * - Specialist: Domain-specific execution (backend, frontend, etc.)
 * - Guardian: Quality gates, validation, security review
 * - Memory: Knowledge persistence, recall, episodic memory
 */

export class AgentCategory {
  static readonly Orchestrator = new AgentCategory(
    'orchestrator', '🧠', 'Orchestrator', 'Control plane — routes, coordinates, delivers',
    '#FFB800', 'linear-gradient(135deg, #FFB800, #FF8C00)', 0,
  );
  static readonly Planner = new AgentCategory(
    'planner', '📐', 'Planner', 'Strategy — decomposes into actionable plans',
    '#7C4DFF', 'linear-gradient(135deg, #7C4DFF, #B388FF)', 1,
  );
  static readonly Specialist = new AgentCategory(
    'specialist', '⚡', 'Specialist', 'Execution — implements in a specific domain',
    '#448AFF', 'linear-gradient(135deg, #448AFF, #82B1FF)', 2,
  );
  static readonly Guardian = new AgentCategory(
    'guardian', '🛡️', 'Guardian', 'Quality gate — validates, reviews, blocks',
    '#FF5252', 'linear-gradient(135deg, #FF5252, #FF8A80)', 3,
  );
  static readonly Memory = new AgentCategory(
    'memory', '💾', 'Memory', 'Persistence — records decisions and episodes',
    '#00E676', 'linear-gradient(135deg, #00E676, #69F0AE)', 4,
  );

  private constructor(
    public readonly value: string,
    public readonly emoji: string,
    public readonly label: string,
    public readonly description: string,
    public readonly color: string,
    public readonly gradient: string,
    public readonly sortOrder: number,
  ) {}

  static fromString(value: string): AgentCategory {
    const map: Record<string, AgentCategory> = {
      'orchestrator': AgentCategory.Orchestrator,
      'planner': AgentCategory.Planner,
      'specialist': AgentCategory.Specialist,
      'guardian': AgentCategory.Guardian,
      'memory': AgentCategory.Memory,
    };
    return map[value.toLowerCase()] ?? AgentCategory.Specialist;
  }

  static all(): AgentCategory[] {
    return [
      AgentCategory.Orchestrator,
      AgentCategory.Planner,
      AgentCategory.Specialist,
      AgentCategory.Guardian,
      AgentCategory.Memory,
    ];
  }

  /** CSS class for styling */
  get cssClass(): string {
    return `category-${this.value}`;
  }

  equals(other: AgentCategory): boolean {
    return this.value === other.value;
  }
}
