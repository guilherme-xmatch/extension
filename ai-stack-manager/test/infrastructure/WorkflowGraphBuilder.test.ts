/**
 * Tests for WorkflowGraphBuilder
 *
 * The builder converts a flat list of packages (filtered by installedIds)
 * into a structured, serialisable graph of phases and delegation edges.
 */

import { describe, it, expect } from 'vitest';
import { WorkflowGraphBuilder } from '../../src/infrastructure/services/WorkflowGraphBuilder';
import { Package } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { AgentCategory } from '../../src/domain/value-objects/AgentCategory';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeAgent = (
  id: string,
  workflowPhase: string,
  delegatesTo: string[] = [],
  category: AgentCategory = AgentCategory.Specialist,
  userInvocable = false,
) => Package.create({
  id,
  name: id,
  displayName: id,
  description: 'Test agent',
  type: PackageType.Agent,
  version: '1.0.0',
  tags: [],
  author: 'test',
  files: [],
  agentMeta: {
    category,
    tools: [],
    delegatesTo,
    workflowPhase,
    userInvocable,
    relatedSkills: [],
  },
});

const makeSkill = (id: string) => Package.create({
  id,
  name: id,
  displayName: id,
  description: 'Test skill',
  type: PackageType.Skill,
  version: '1.0.0',
  tags: [],
  author: 'test',
  files: [],
});

const builder = new WorkflowGraphBuilder();

// ─── buildGraph ───────────────────────────────────────────────────────────────

describe('WorkflowGraphBuilder.buildGraph', () => {

  it('retorna grafo vazio quando nenhum agent está instalado', () => {
    const pkg = makeAgent('agent-a', 'execute');
    const graph = builder.buildGraph([pkg], []); // installedIds = []

    expect(graph.totalAgents).toBe(0);
    expect(graph.phases).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('exclui packages que não são agents', () => {
    const skill = makeSkill('skill-api');
    const graph = builder.buildGraph([skill], ['skill-api']);

    expect(graph.totalAgents).toBe(0);
    expect(graph.phases).toHaveLength(0);
  });

  it('inclui apenas agents presentes em installedIds', () => {
    const a = makeAgent('agent-a', 'execute');
    const b = makeAgent('agent-b', 'validate');
    const graph = builder.buildGraph([a, b], ['agent-a']); // b not installed

    expect(graph.totalAgents).toBe(1);
    expect(graph.phases).toHaveLength(1);
    expect(graph.phases[0].id).toBe('execute');
    expect(graph.phases[0].agents[0].id).toBe('agent-a');
  });

  it('agrupa agents na fase correta', () => {
    const a = makeAgent('agent-a', 'execute');
    const b = makeAgent('agent-b', 'execute');
    const c = makeAgent('agent-c', 'validate');
    const graph = builder.buildGraph([a, b, c], ['agent-a', 'agent-b', 'agent-c']);

    expect(graph.totalAgents).toBe(3);
    expect(graph.phases).toHaveLength(2);

    const execPhase = graph.phases.find(p => p.id === 'execute');
    expect(execPhase?.agents).toHaveLength(2);

    const valPhase = graph.phases.find(p => p.id === 'validate');
    expect(valPhase?.agents).toHaveLength(1);
  });

  it('ordena fases canonicamente (execute antes de validate antes de deliver)', () => {
    const a = makeAgent('agent-deliver', 'deliver');
    const b = makeAgent('agent-execute', 'execute');
    const c = makeAgent('agent-validate', 'validate');
    const graph = builder.buildGraph([a, b, c], ['agent-deliver', 'agent-execute', 'agent-validate']);

    const phaseIds = graph.phases.map(p => p.id);
    expect(phaseIds.indexOf('execute')).toBeLessThan(phaseIds.indexOf('validate'));
    expect(phaseIds.indexOf('validate')).toBeLessThan(phaseIds.indexOf('deliver'));
  });

  it('adiciona fases desconhecidas ao final, após as canônicas', () => {
    const a = makeAgent('agent-custom', 'custom-phase');
    const b = makeAgent('agent-execute', 'execute');
    const graph = builder.buildGraph([a, b], ['agent-custom', 'agent-execute']);

    const phaseIds = graph.phases.map(p => p.id);
    expect(phaseIds[0]).toBe('execute');
    expect(phaseIds[phaseIds.length - 1]).toBe('custom-phase');
  });

  it('cria edges apenas entre agents instalados', () => {
    // a delegates to b (installed) and c (NOT installed)
    const a = makeAgent('agent-a', 'execute', ['agent-b', 'agent-c']);
    const b = makeAgent('agent-b', 'validate');
    const c = makeAgent('agent-c', 'deliver');

    const graph = builder.buildGraph([a, b, c], ['agent-a', 'agent-b']); // c not installed

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ fromId: 'agent-a', toId: 'agent-b' });
  });

  it('não cria auto-edges (agent não pode delegar para si mesmo)', () => {
    const a = makeAgent('agent-a', 'execute', ['agent-a']);
    const graph = builder.buildGraph([a], ['agent-a']);

    expect(graph.edges).toHaveLength(0);
  });

  it('serializa category corretamente (não inclui instância de AgentCategory, apenas dados planos)', () => {
    const a = makeAgent('agent-a', 'execute', [], AgentCategory.Orchestrator, true);
    const graph = builder.buildGraph([a], ['agent-a']);

    const node = graph.phases[0].agents[0];
    expect(typeof node.categoryValue).toBe('string');
    expect(typeof node.categoryColor).toBe('string');
    expect(typeof node.categoryEmoji).toBe('string');
    expect(typeof node.categoryLabel).toBe('string');
    expect(node.categoryValue).toBe('orchestrator');
    expect(node.userInvocable).toBe(true);
  });

  it('normaliza workflowPhase para minúsculas', () => {
    const a = makeAgent('agent-a', 'EXECUTE'); // uppercase input
    const graph = builder.buildGraph([a], ['agent-a']);

    expect(graph.phases[0].id).toBe('execute');
    expect(graph.phases[0].agents[0].workflowPhase).toBe('execute');
  });

  it('retorna grafo serializável por JSON.stringify (sem circular references ou Sets)', () => {
    const a = makeAgent('agent-a', 'execute', ['agent-b'], AgentCategory.Planner);
    const b = makeAgent('agent-b', 'validate');
    const graph = builder.buildGraph([a, b], ['agent-a', 'agent-b']);

    expect(() => JSON.stringify(graph)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(graph));
    expect(parsed.totalAgents).toBe(2);
    expect(parsed.phases).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
  });

  it('inclui label e emoji corretos para fases canônicas', () => {
    const a = makeAgent('agent-triage', 'triage');
    const b = makeAgent('agent-memory', 'memory');
    const graph = builder.buildGraph([a, b], ['agent-triage', 'agent-memory']);

    const triage = graph.phases.find(p => p.id === 'triage');
    const memory = graph.phases.find(p => p.id === 'memory');

    expect(triage?.emoji).toBe('🔀');
    expect(triage?.label).toBe('Triagem');
    expect(memory?.emoji).toBe('💾');
    expect(memory?.label).toBe('Memória');
  });

  it('funciona com catálogo misto de agents e non-agents', () => {
    const agent  = makeAgent('agent-a', 'execute');
    const skill  = makeSkill('skill-b');
    const graph  = builder.buildGraph([agent, skill], ['agent-a', 'skill-b']);

    // skill-b is installed but should not appear in the graph
    expect(graph.totalAgents).toBe(1);
    expect(graph.phases[0].agents.every(n => n.id !== 'skill-b')).toBe(true);
  });

  // ─── Skill node tests ────────────────────────────────────────────────────────

  it('retorna skills array vazio quando nenhum agent tem relatedSkills', () => {
    const a = makeAgent('agent-a', 'execute'); // no relatedSkills by default
    const graph = builder.buildGraph([a], ['agent-a']);

    expect(graph.skills).toEqual([]);
    expect(graph.skillEdges).toEqual([]);
  });

  it('inclui skill como installed quando está em installedIds', () => {
    const skill  = makeSkill('skill-api');
    const agent  = Package.create({
      id: 'agent-a', name: 'agent-a', displayName: 'Agent A',
      description: 'Test', type: PackageType.Agent, version: '1.0.0',
      tags: [], author: 'test', files: [],
      agentMeta: {
        category: AgentCategory.Specialist, tools: [], delegatesTo: [],
        workflowPhase: 'execute', userInvocable: false,
        relatedSkills: ['skill-api'],
      },
    });

    const graph = builder.buildGraph([agent, skill], ['agent-a', 'skill-api']);

    expect(graph.skills).toHaveLength(1);
    expect(graph.skills[0].id).toBe('skill-api');
    expect(graph.skills[0].installed).toBe(true);
    expect(graph.skills[0].displayName).toBe('skill-api');
  });

  it('inclui skill como NOT installed quando não está em installedIds', () => {
    const skill = makeSkill('skill-sec');
    const agent = Package.create({
      id: 'agent-a', name: 'agent-a', displayName: 'Agent A',
      description: 'Test', type: PackageType.Agent, version: '1.0.0',
      tags: [], author: 'test', files: [],
      agentMeta: {
        category: AgentCategory.Specialist, tools: [], delegatesTo: [],
        workflowPhase: 'execute', userInvocable: false,
        relatedSkills: ['skill-sec'],
      },
    });

    const graph = builder.buildGraph([agent, skill], ['agent-a']); // skill NOT installed

    expect(graph.skills).toHaveLength(1);
    expect(graph.skills[0].installed).toBe(false);
  });

  it('cria skillEdges corretas entre agent e skill', () => {
    const skill = makeSkill('skill-api');
    const agent = Package.create({
      id: 'agent-a', name: 'agent-a', displayName: 'Agent A',
      description: 'Test', type: PackageType.Agent, version: '1.0.0',
      tags: [], author: 'test', files: [],
      agentMeta: {
        category: AgentCategory.Specialist, tools: [], delegatesTo: [],
        workflowPhase: 'execute', userInvocable: false,
        relatedSkills: ['skill-api'],
      },
    });

    const graph = builder.buildGraph([agent, skill], ['agent-a']);

    expect(graph.skillEdges).toHaveLength(1);
    expect(graph.skillEdges[0]).toEqual({ agentId: 'agent-a', skillId: 'skill-api' });
  });

  it('deduplica skills referenciados por múltiplos agents', () => {
    const skillA = makeSkill('skill-api');
    const agentX = Package.create({
      id: 'agent-x', name: 'agent-x', displayName: 'Agent X',
      description: 'Test', type: PackageType.Agent, version: '1.0.0',
      tags: [], author: 'test', files: [],
      agentMeta: { category: AgentCategory.Specialist, tools: [], delegatesTo: [],
        workflowPhase: 'execute', userInvocable: false, relatedSkills: ['skill-api'] },
    });
    const agentY = Package.create({
      id: 'agent-y', name: 'agent-y', displayName: 'Agent Y',
      description: 'Test', type: PackageType.Agent, version: '1.0.0',
      tags: [], author: 'test', files: [],
      agentMeta: { category: AgentCategory.Specialist, tools: [], delegatesTo: [],
        workflowPhase: 'validate', userInvocable: false, relatedSkills: ['skill-api'] },
    });

    const graph = builder.buildGraph([skillA, agentX, agentY], ['agent-x', 'agent-y']);

    // skill-api should appear only once even though 2 agents reference it
    expect(graph.skills).toHaveLength(1);
    expect(graph.skills[0].id).toBe('skill-api');

    // But there should be 2 skill edges (one per agent)
    expect(graph.skillEdges).toHaveLength(2);
  });

  it('ordena skills alfabeticamente por displayName', () => {
    const sZ = makeSkill('skill-z');
    const sA = makeSkill('skill-a');
    const sM = makeSkill('skill-m');
    const agent = Package.create({
      id: 'agent-a', name: 'agent-a', displayName: 'Agent A',
      description: 'Test', type: PackageType.Agent, version: '1.0.0',
      tags: [], author: 'test', files: [],
      agentMeta: { category: AgentCategory.Specialist, tools: [], delegatesTo: [],
        workflowPhase: 'execute', userInvocable: false,
        relatedSkills: ['skill-z', 'skill-a', 'skill-m'] },
    });

    const graph = builder.buildGraph([sZ, sA, sM, agent], ['agent-a']);
    expect(graph.skills.map(s => s.id)).toEqual(['skill-a', 'skill-m', 'skill-z']);
  });

  it('lida com skill IDs desconhecidos (não no catálogo) sem falhar', () => {
    const agent = Package.create({
      id: 'agent-a', name: 'agent-a', displayName: 'Agent A',
      description: 'Test', type: PackageType.Agent, version: '1.0.0',
      tags: [], author: 'test', files: [],
      agentMeta: { category: AgentCategory.Specialist, tools: [], delegatesTo: [],
        workflowPhase: 'execute', userInvocable: false,
        relatedSkills: ['skill-unknown'] }, // not in allPackages
    });

    expect(() => builder.buildGraph([agent], ['agent-a'])).not.toThrow();
    const graph = builder.buildGraph([agent], ['agent-a']);
    // Still included with id as fallback displayName, installed: false
    expect(graph.skills).toHaveLength(1);
    expect(graph.skills[0].id).toBe('skill-unknown');
    expect(graph.skills[0].displayName).toBe('skill-unknown');
    expect(graph.skills[0].installed).toBe(false);
  });

  it('retorna grafo com skills serializável por JSON.stringify', () => {
    const skill = makeSkill('skill-api');
    const agent = Package.create({
      id: 'agent-a', name: 'agent-a', displayName: 'Agent A',
      description: 'Test', type: PackageType.Agent, version: '1.0.0',
      tags: [], author: 'test', files: [],
      agentMeta: { category: AgentCategory.Specialist, tools: [], delegatesTo: [],
        workflowPhase: 'execute', userInvocable: false, relatedSkills: ['skill-api'] },
    });

    const graph = builder.buildGraph([agent, skill], ['agent-a', 'skill-api']);
    expect(() => JSON.stringify(graph)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(graph));
    expect(parsed.skills[0].id).toBe('skill-api');
    expect(parsed.skillEdges[0]).toEqual({ agentId: 'agent-a', skillId: 'skill-api' });
  });
});

