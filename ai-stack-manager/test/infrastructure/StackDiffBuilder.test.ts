/**
 * Tests for StackDiffBuilder
 *
 * The builder computes the diff between a set of installed packages and a
 * target bundle, producing structured lists: installed, missing, extras.
 */

import { describe, it, expect } from 'vitest';
import { StackDiffBuilder } from '../../src/infrastructure/services/StackDiffBuilder';
import { Bundle } from '../../src/domain/entities/Bundle';
import { Package } from '../../src/domain/entities/Package';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { AgentCategory } from '../../src/domain/value-objects/AgentCategory';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeBundle = (id: string, packageIds: string[]) =>
  Bundle.create({ id, name: id, displayName: `Bundle ${id}`, description: 'Test bundle', version: '1.0.0', packageIds });

const makeAgent = (id: string) =>
  Package.create({
    id, name: id, displayName: `Agent ${id}`, description: 'Test agent',
    type: PackageType.Agent, version: '1.0.0', tags: [], author: 'test', files: [],
    agentMeta: {
      category: AgentCategory.Specialist, tools: [], delegatesTo: [],
      workflowPhase: 'execute', userInvocable: false, relatedSkills: [],
    },
  });

const makeSkill = (id: string) =>
  Package.create({
    id, name: id, displayName: `Skill ${id}`, description: 'Test skill',
    type: PackageType.Skill, version: '1.0.0', tags: [], author: 'test', files: [],
  });

const makeMcp = (id: string) =>
  Package.create({
    id, name: id, displayName: `MCP ${id}`, description: 'Test MCP',
    type: PackageType.MCP, version: '1.0.0', tags: [], author: 'test', files: [],
  });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StackDiffBuilder', () => {
  const builder = new StackDiffBuilder();

  it('retorna todas as entradas como "installed" quando tudo está instalado', () => {
    const agent = makeAgent('agent-a');
    const skill = makeSkill('skill-b');
    const bundle = makeBundle('my-bundle', ['agent-a', 'skill-b']);

    const diff = builder.build({ targetBundle: bundle, allPackages: [agent, skill], installedIds: ['agent-a', 'skill-b'] });

    expect(diff.installed).toHaveLength(2);
    expect(diff.missing).toHaveLength(0);
    expect(diff.extras).toHaveLength(0);
    expect(diff.coveragePercent).toBe(100);
  });

  it('retorna todas as entradas como "missing" quando nada está instalado', () => {
    const agent = makeAgent('agent-a');
    const bundle = makeBundle('my-bundle', ['agent-a']);

    const diff = builder.build({ targetBundle: bundle, allPackages: [agent], installedIds: [] });

    expect(diff.installed).toHaveLength(0);
    expect(diff.missing).toHaveLength(1);
    expect(diff.missing[0].id).toBe('agent-a');
    expect(diff.missing[0].status).toBe('missing');
    expect(diff.coveragePercent).toBe(0);
  });

  it('separa corretamente installed vs missing', () => {
    const a = makeAgent('a');
    const b = makeAgent('b');
    const c = makeSkill('c');
    const bundle = makeBundle('bundle', ['a', 'b', 'c']);

    const diff = builder.build({ targetBundle: bundle, allPackages: [a, b, c], installedIds: ['a'] });

    expect(diff.installed.map(e => e.id)).toEqual(['a']);
    expect(diff.missing.map(e => e.id).sort()).toEqual(['b', 'c'].sort());
    expect(diff.coveragePercent).toBe(33);
  });

  it('coloca pacotes instalados mas fora do bundle em "extras"', () => {
    const a = makeAgent('a');
    const b = makeSkill('b');
    const extra = makeMcp('extra-mcp');
    const bundle = makeBundle('bundle', ['a']);

    const diff = builder.build({ targetBundle: bundle, allPackages: [a, b, extra], installedIds: ['a', 'extra-mcp'] });

    expect(diff.installed.map(e => e.id)).toEqual(['a']);
    expect(diff.extras.map(e => e.id)).toEqual(['extra-mcp']);
    expect(diff.extras[0].status).toBe('extra');
  });

  it('calcula coveragePercent corretamente para cobertura parcial', () => {
    const pkgs = ['a', 'b', 'c', 'd'].map(id => makeAgent(id));
    const bundle = makeBundle('bundle', ['a', 'b', 'c', 'd']);

    const diff = builder.build({ targetBundle: bundle, allPackages: pkgs, installedIds: ['a', 'b'] });

    expect(diff.coveragePercent).toBe(50);
  });

  it('ignora IDs de pacotes desconhecidos (não no catálogo)', () => {
    const a = makeAgent('a');
    const bundle = makeBundle('bundle', ['a', 'ghost-pkg-not-in-catalog']);

    const diff = builder.build({ targetBundle: bundle, allPackages: [a], installedIds: ['a'] });

    // ghost-pkg-not-in-catalog should be silently skipped
    expect(diff.installed).toHaveLength(1);
    expect(diff.missing).toHaveLength(0);
    expect(diff.coveragePercent).toBe(100);
  });

  it('retorna diff com cobertura 0 para bundle vazio', () => {
    const bundle = makeBundle('empty-bundle', []);
    const diff = builder.build({ targetBundle: bundle, allPackages: [], installedIds: [] });

    expect(diff.installed).toHaveLength(0);
    expect(diff.missing).toHaveLength(0);
    expect(diff.extras).toHaveLength(0);
    expect(diff.coveragePercent).toBe(0);
  });

  it('popula os campos targetBundle corretamente', () => {
    const bundle = makeBundle('test-bundle', []);
    const diff = builder.build({ targetBundle: bundle, allPackages: [], installedIds: [] });

    expect(diff.targetBundle.id).toBe('test-bundle');
    expect(diff.targetBundle.displayName).toBe('Bundle test-bundle');
    expect(diff.targetBundle.packageCount).toBe(0);
  });

  it('popula campos de PackageDiffEntry com metadados do pacote', () => {
    const agent = makeAgent('agent-x');
    const bundle = makeBundle('b', ['agent-x']);
    const diff = builder.build({ targetBundle: bundle, allPackages: [agent], installedIds: [] });

    const entry = diff.missing[0];
    expect(entry.id).toBe('agent-x');
    expect(entry.displayName).toBe('Agent agent-x');
    expect(entry.description).toBe('Test agent');
    expect(entry.typeValue).toBe('agent');
    expect(entry.status).toBe('missing');
  });

  it('ordena entradas por displayName dentro de cada grupo', () => {
    const c = makeAgent('c');
    const a = makeAgent('a');
    const b = makeAgent('b');
    const bundle = makeBundle('bundle', ['c', 'a', 'b']);

    const diff = builder.build({ targetBundle: bundle, allPackages: [c, a, b], installedIds: [] });

    // Display names should be sorted: "Agent a", "Agent b", "Agent c"
    expect(diff.missing.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('aceita installedIds com extras que não estão no catálogo (não falha)', () => {
    const a = makeAgent('a');
    const bundle = makeBundle('bundle', ['a']);

    expect(() =>
      builder.build({ targetBundle: bundle, allPackages: [a], installedIds: ['a', 'unknown-installed-id'] }),
    ).not.toThrow();
  });

  it('resultado é JSON.stringify compatível', () => {
    const agent = makeAgent('a');
    const bundle = makeBundle('b', ['a']);
    const diff = builder.build({ targetBundle: bundle, allPackages: [agent], installedIds: ['a'] });

    expect(() => JSON.stringify(diff)).not.toThrow();
    const reparsed = JSON.parse(JSON.stringify(diff));
    expect(reparsed.installed[0].id).toBe('a');
  });

  it('extras não contém pacotes que também estão no bundle', () => {
    const a = makeAgent('a');
    const b = makeAgent('b');
    const bundle = makeBundle('bundle', ['a', 'b']);

    const diff = builder.build({ targetBundle: bundle, allPackages: [a, b], installedIds: ['a', 'b'] });

    // Both are IN the bundle so no extras
    expect(diff.extras).toHaveLength(0);
  });
});
