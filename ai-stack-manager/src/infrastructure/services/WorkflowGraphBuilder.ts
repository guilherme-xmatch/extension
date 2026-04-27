/**
 * @module infrastructure/services/WorkflowGraphBuilder
 * @description Builds a serializable workflow graph from the set of packages
 * currently installed in the workspace.
 *
 * The graph is composed of:
 * - **Phases** — canonical pipeline stages (triage → plan → execute → …)
 * - **Agent nodes** — installed agents placed inside their declared phase
 * - **Edges** — delegation links between agents (`agentMeta.delegatesTo`)
 *
 * All output types are plain JSON-serializable objects so they can be
 * embedded directly in a Webview HTML template.
 */

import { Package } from '../../domain/entities/Package';

// ─── Serializable output types ───────────────────────────────────────────────

export interface AgentNodeData {
  id: string;
  displayName: string;
  /** Short description of the agent */
  description: string;
  /** Value string of AgentCategory (e.g. "specialist") */
  categoryValue: string;
  /** Single emoji representing the category */
  categoryEmoji: string;
  /** Human-readable category label in PT-BR */
  categoryLabel: string;
  /** Hex color for the category (from AgentCategory.color) */
  categoryColor: string;
  /** Whether the user can invoke this agent directly via @agent syntax */
  userInvocable: boolean;
  /** The declared workflow phase, normalised to lowercase */
  workflowPhase: string;
  /** IDs of agents this agent delegates to */
  delegatesTo: string[];
  /** Tools this agent uses */
  tools: string[];
}

export interface WorkflowEdgeData {
  /** Source agent ID */
  fromId: string;
  /** Target agent ID */
  toId: string;
}

/** A skill node visible in the workflow visualizer */
export interface SkillNodeData {
  id: string;
  displayName: string;
  /** Whether the skill is currently installed in the workspace */
  installed: boolean;
}

/** A directed edge from an agent to a skill it uses */
export interface SkillEdgeData {
  /** Source agent ID */
  agentId: string;
  /** Target skill ID */
  skillId: string;
}

export interface WorkflowPhaseData {
  /** Canonical phase identifier (e.g. "execute") */
  id: string;
  /** Human-readable phase label in PT-BR */
  label: string;
  /** Phase emoji */
  emoji: string;
  /** Agents placed in this phase */
  agents: AgentNodeData[];
}

export interface WorkflowGraphData {
  phases: WorkflowPhaseData[];
  edges: WorkflowEdgeData[];
  /** Installed skill nodes referenced by at least one installed agent */
  skills: SkillNodeData[];
  /** Edges from agent nodes to skill nodes (dashed lines) */
  skillEdges: SkillEdgeData[];
  /** Total number of installed agents represented in the graph */
  totalAgents: number;
}

// ─── Canonical phase ordering ─────────────────────────────────────────────────

/** Ordered pipeline phases.  Unknown phases are appended at the end. */
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

    // Only installed agents with agent metadata
    const installedAgents = allPackages.filter(
      p => p.type.value === 'agent' && p.agentMeta !== undefined && installedSet.has(p.id),
    );

    // ── Build node map ────────────────────────────────────────────────────────
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

    // ── Build phase list (canonical order first, unknowns appended) ───────────
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

    // ── Build edges (only between installed agents) ───────────────────────────
    const edges: WorkflowEdgeData[] = [];
    for (const node of nodeMap.values()) {
      for (const delegateId of node.delegatesTo) {
        if (nodeMap.has(delegateId) && delegateId !== node.id) {
          edges.push({ fromId: node.id, toId: delegateId });
        }
      }
    }

    // ── Build skill nodes ─────────────────────────────────────────────────────
    // Collect all skill IDs referenced by installed agents
    const referencedSkillIds = new Set<string>();
    for (const agent of installedAgents) {
      for (const skillId of agent.agentMeta!.relatedSkills) {
        referencedSkillIds.add(skillId);
      }
    }

    // Build a map of skill ID → Package for quick lookup
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
    // Sort skills alphabetically for stable rendering
    skills.sort((a, b) => a.displayName.localeCompare(b.displayName));

    // Build skill edges (agent → skill)
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
