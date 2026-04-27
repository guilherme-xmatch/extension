/**
 * @module infrastructure/services/WorkflowGraphBuilder
 * @description Constrói um grafo de workflow serializável a partir do conjunto de pacotes
 * instalados no workspace.
 *
 * O grafo é composto por:
 * - **Phases** — estágios canônicos do pipeline (triagem → planejamento → execução → …)
 * - **Agent nodes** — agents instalados posicionados na fase declarada
 * - **Edges** — links de delegação entre agents (`agentMeta.delegatesTo`)
 *
 * Todos os tipos de saída são objetos JSON-serializáveis para que possam ser
 * embutidos diretamente em um template HTML de Webview.
 */

import { Package } from '../../domain/entities/Package';

// ─── Serializable output types ───────────────────────────────────────────────

export interface AgentNodeData {
  id: string;
  displayName: string;
  /** Descrição curta do agente. */
  description: string;
  /** String de valor do AgentCategory (ex.: "specialist"). */
  categoryValue: string;
  /** Emoji único representando a categoria. */
  categoryEmoji: string;
  /** Rótulo legível da categoria em PT-BR. */
  categoryLabel: string;
  /** Cor hexadecimal da categoria (de AgentCategory.color). */
  categoryColor: string;
  /** Indica se o usuário pode invocar este agente diretamente via sintaxe @agent. */
  userInvocable: boolean;
  /** A fase do workflow declarada, normalizada para minúsculas. */
  workflowPhase: string;
  /** IDs dos agents para os quais este agente delega. */
  delegatesTo: string[];
  /** Ferramentas que este agente utiliza. */
  tools: string[];
}

export interface WorkflowEdgeData {
  /** ID do agente de origem. */
  fromId: string;
  /** ID do agente de destino. */
  toId: string;
}

/** Nó de skill visível no visualizador de workflow. */
export interface SkillNodeData {
  id: string;
  displayName: string;
  /** Indica se a skill está instalada no workspace. */
  installed: boolean;
}

/** Aresta direcionada de um agente para uma skill que ele utiliza. */
export interface SkillEdgeData {
  /** ID do agente de origem. */
  agentId: string;
  /** ID da skill de destino. */
  skillId: string;
}

export interface WorkflowPhaseData {
  /** Identificador canônico da fase (ex.: "execute"). */
  id: string;
  /** Rótulo legível da fase em PT-BR. */
  label: string;
  /** Emoji da fase. */
  emoji: string;
  /** Agents posicionados nesta fase. */
  agents: AgentNodeData[];
}

export interface WorkflowGraphData {
  phases: WorkflowPhaseData[];
  edges: WorkflowEdgeData[];
  /** Nós de skill instalados referenciados por pelo menos um agente instalado. */
  skills: SkillNodeData[];
  /** Arestas dos nós de agente para os nós de skill (linhas tracejadas). */
  skillEdges: SkillEdgeData[];
  /** Total de agents instalados representados no grafo. */
  totalAgents: number;
}

// ─── Canonical phase ordering ─────────────────────────────────────────────────

/** Fases do pipeline na ordem canônica. Fases desconhecidas são acrescentadas ao final. */
const CANONICAL_PHASES: ReadonlyArray<{ id: string; label: string; emoji: string }> = [
  { id: 'triage',   label: 'Triagem',          emoji: '🔀' },
  { id: 'plan',     label: 'Planejamento',      emoji: '📐' },
  { id: 'design',   label: 'Design',            emoji: '🎨' },
  { id: 'execute',  label: 'Execução',          emoji: '⚡' },
  { id: 'validate', label: 'Validação',         emoji: '✅' },
  { id: 'critic',   label: 'Revisão Crítica',   emoji: '🛡️' },
  { id: 'deliver',  label: 'Entrega',           emoji: '📦' },
  { id: 'memory',   label: 'Memória',           emoji: '💾' },
];

const CANONICAL_PHASE_IDS = new Set(CANONICAL_PHASES.map(p => p.id));

// ─── Builder ─────────────────────────────────────────────────────────────────

export class WorkflowGraphBuilder {
  /**
   * Builds the workflow graph from the full package catalog and the list of
   * package IDs that are currently installed in the workspace.
   *
   * Only **agent** packages that:
   * 1. Have `agentMeta` (i.e. `type === 'agent'`)
   * 2. Are present in `installedIds`
   *
   * …are included in the graph.
   *
   * @param allPackages - Lista completa de pacotes do registro
   * @param installedIds - IDs instalados no workspace atual
   */
  buildGraph(allPackages: Package[], installedIds: string[]): WorkflowGraphData {
    const installedSet = new Set(installedIds);

    // Somente agents instalados com metadados de agente
    const installedAgents = allPackages.filter(
      p => p.type.value === 'agent' && p.agentMeta !== undefined && installedSet.has(p.id),
    );

    // ── Constrói o mapa de nós ────────────────────────────────────────────────────────
    const nodeMap = new Map<string, AgentNodeData>();
    const phaseMap = new Map<string, AgentNodeData[]>();

    for (const pkg of installedAgents) {
      const meta = pkg.agentMeta!;
      const cat  = meta.category;

      const node: AgentNodeData = {
        id:             pkg.id,
        displayName:    pkg.displayName,
        description:    pkg.description,
        categoryValue:  cat.value,
        categoryEmoji:  cat.emoji,
        categoryLabel:  cat.label,
        categoryColor:  cat.color,
        userInvocable:  meta.userInvocable,
        workflowPhase:  meta.workflowPhase.toLowerCase(),
        delegatesTo:    [...meta.delegatesTo],
        tools:          [...meta.tools],
      };

      nodeMap.set(pkg.id, node);

      const phase = node.workflowPhase;
      if (!phaseMap.has(phase)) {
        phaseMap.set(phase, []);
      }
      phaseMap.get(phase)!.push(node);
    }

    // ── Constrói a lista de fases (ordem canônica primeiro, desconhecidas ao final) ───────────
    const phases: WorkflowPhaseData[] = [];

    for (const phaseDef of CANONICAL_PHASES) {
      if (phaseMap.has(phaseDef.id)) {
        phases.push({ ...phaseDef, agents: phaseMap.get(phaseDef.id)! });
      }
    }

    for (const [phaseId, agents] of phaseMap) {
      if (!CANONICAL_PHASE_IDS.has(phaseId)) {
        phases.push({
          id:     phaseId,
          label:  phaseId.charAt(0).toUpperCase() + phaseId.slice(1),
          emoji:  '🔷',
          agents,
        });
      }
    }

    // ── Constrói as arestas (somente entre agents instalados) ───────────────────────────
    const edges: WorkflowEdgeData[] = [];
    for (const node of nodeMap.values()) {
      for (const delegateId of node.delegatesTo) {
        if (nodeMap.has(delegateId) && delegateId !== node.id) {
          edges.push({ fromId: node.id, toId: delegateId });
        }
      }
    }

    // ── Constrói os nós de skill ─────────────────────────────────────────────────────
    // Coleta todos os IDs de skill referenciados pelos agents instalados
    const referencedSkillIds = new Set<string>();
    for (const agent of installedAgents) {
      for (const skillId of agent.agentMeta!.relatedSkills) {
        referencedSkillIds.add(skillId);
      }
    }

    // Constrói um mapa de skill ID → Package para busca rápida
    const skillPkgMap = new Map<string, Package>();
    for (const pkg of allPackages) {
      if (pkg.type.value === 'skill') {
        skillPkgMap.set(pkg.id, pkg);
      }
    }

    const skills: SkillNodeData[] = [];
    for (const skillId of referencedSkillIds) {
      const pkg = skillPkgMap.get(skillId);
      skills.push({
        id:          skillId,
        displayName: pkg?.displayName ?? skillId,
        installed:   installedSet.has(skillId),
      });
    }
    // Ordena as skills alfabeticamente para renderização estável
    skills.sort((a, b) => a.displayName.localeCompare(b.displayName));

    // Constrói as arestas de skill (agente → skill)
    const skillEdges: SkillEdgeData[] = [];
    for (const agent of installedAgents) {
      for (const skillId of agent.agentMeta!.relatedSkills) {
        if (referencedSkillIds.has(skillId)) {
          skillEdges.push({ agentId: agent.id, skillId });
        }
      }
    }

    return { phases, edges, skills, skillEdges, totalAgents: installedAgents.length };
  }
}
