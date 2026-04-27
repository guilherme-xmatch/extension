/**
 * @module domain/value-objects/AgentCategory
 * @description Value object que representa a categoria funcional de um agente.
 * Agents NÃO são todos iguais — têm papéis fundamentalmente diferentes
 * no workflow multi-agente.
 *
 * Categorias:
 * - Orchestrator: Hub/plano de controle, roteia trabalho para especialistas
 * - Planner: Estratégia, decomposição, geração de DAG
 * - Specialist: Execução domínio-específica (backend, frontend, etc.)
 * - Guardian: Gates de qualidade, validação, revisão de segurança
 * - Memory: Persistência de conhecimento, recall, memória episódica
 */

export class AgentCategory {
  static readonly Orchestrator = new AgentCategory(
    'orchestrator', '🧠', 'Orquestrador', 'Plano de controle — roteia, coordena e entrega',
    '#FFB800', 'linear-gradient(135deg, #FFB800, #FF8C00)', 0,
  );
  static readonly Planner = new AgentCategory(
    'planner', '📐', 'Planejador', 'Estratégia — decompõe tarefas em planos acionáveis',
    '#7C4DFF', 'linear-gradient(135deg, #7C4DFF, #B388FF)', 1,
  );
  static readonly Specialist = new AgentCategory(
    'specialist', '⚡', 'Especialista', 'Execução — atua em um domínio específico',
    '#448AFF', 'linear-gradient(135deg, #448AFF, #82B1FF)', 2,
  );
  static readonly Guardian = new AgentCategory(
    'guardian', '🛡️', 'Guardião', 'Qualidade — valida, revisa e bloqueia',
    '#FF5252', 'linear-gradient(135deg, #FF5252, #FF8A80)', 3,
  );
  static readonly Memory = new AgentCategory(
    'memory', '💾', 'Memória', 'Persistência — grava decisões e episódios',
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

  /** Classe CSS para estilização. */
  get cssClass(): string {
    return `category-${this.value}`;
  }

  equals(other: AgentCategory): boolean {
    return this.value === other.value;
  }
}
