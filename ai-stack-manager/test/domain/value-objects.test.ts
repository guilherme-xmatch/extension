/**
 * Tests for domain value-objects: Version, PackageType, AgentCategory
 */

import { describe, it, expect } from 'vitest';
import { Version } from '../../src/domain/value-objects/Version';
import { PackageType } from '../../src/domain/value-objects/PackageType';
import { AgentCategory } from '../../src/domain/value-objects/AgentCategory';

// ─── Version ─────────────────────────────────────────────────────────────────

describe('Version', () => {
  describe('parse()', () => {
    it('parseia string "1.2.3" corretamente', () => {
      const v = Version.parse('1.2.3');
      expect(v.major).toBe(1);
      expect(v.minor).toBe(2);
      expect(v.patch).toBe(3);
    });

    it('remove prefixo "v"', () => {
      const v = Version.parse('v2.0.1');
      expect(v.major).toBe(2);
      expect(v.minor).toBe(0);
      expect(v.patch).toBe(1);
    });

    it('usa 0 como default para partes ausentes', () => {
      const v = Version.parse('3');
      expect(v.major).toBe(3);
      expect(v.minor).toBe(0);
      expect(v.patch).toBe(0);
    });

    it('parseia "1.0" (sem patch)', () => {
      const v = Version.parse('1.0');
      expect(v.patch).toBe(0);
    });
  });

  describe('of()', () => {
    it('cria version a partir de componentes', () => {
      const v = Version.of(4, 5, 6);
      expect(v.major).toBe(4);
      expect(v.minor).toBe(5);
      expect(v.patch).toBe(6);
    });
  });

  describe('toString()', () => {
    it('retorna string no formato major.minor.patch', () => {
      expect(Version.parse('1.2.3').toString()).toBe('1.2.3');
      expect(Version.of(0, 0, 0).toString()).toBe('0.0.0');
    });
  });

  describe('compareTo()', () => {
    it('retorna 0 para versões iguais', () => {
      expect(Version.parse('1.2.3').compareTo(Version.parse('1.2.3'))).toBe(0);
    });

    it('retorna 1 quando major é maior', () => {
      expect(Version.parse('2.0.0').compareTo(Version.parse('1.9.9'))).toBe(1);
    });

    it('retorna -1 quando major é menor', () => {
      expect(Version.parse('1.0.0').compareTo(Version.parse('2.0.0'))).toBe(-1);
    });

    it('retorna 1 quando minor é maior (major igual)', () => {
      expect(Version.parse('1.3.0').compareTo(Version.parse('1.2.9'))).toBe(1);
    });

    it('retorna -1 quando minor é menor (major igual)', () => {
      expect(Version.parse('1.1.0').compareTo(Version.parse('1.2.0'))).toBe(-1);
    });

    it('retorna 1 quando patch é maior (major e minor iguais)', () => {
      expect(Version.parse('1.2.5').compareTo(Version.parse('1.2.4'))).toBe(1);
    });

    it('retorna -1 quando patch é menor (major e minor iguais)', () => {
      expect(Version.parse('1.2.3').compareTo(Version.parse('1.2.4'))).toBe(-1);
    });
  });

  describe('isNewerThan()', () => {
    it('retorna true quando this é mais novo', () => {
      expect(Version.parse('2.0.0').isNewerThan(Version.parse('1.9.9'))).toBe(true);
    });

    it('retorna false quando this é igual ou mais antigo', () => {
      expect(Version.parse('1.0.0').isNewerThan(Version.parse('1.0.0'))).toBe(false);
      expect(Version.parse('0.9.9').isNewerThan(Version.parse('1.0.0'))).toBe(false);
    });
  });

  describe('equals()', () => {
    it('retorna true para mesma versão', () => {
      expect(Version.parse('1.2.3').equals(Version.parse('1.2.3'))).toBe(true);
    });

    it('retorna false para versões diferentes', () => {
      expect(Version.parse('1.2.3').equals(Version.parse('1.2.4'))).toBe(false);
    });
  });
});

// ─── PackageType ─────────────────────────────────────────────────────────────

describe('PackageType', () => {
  describe('singletons', () => {
    it('Agent, Skill, MCP, Instruction, Prompt existem como singletons', () => {
      expect(PackageType.Agent.value).toBe('agent');
      expect(PackageType.Skill.value).toBe('skill');
      expect(PackageType.MCP.value).toBe('mcp');
      expect(PackageType.Instruction.value).toBe('instruction');
      expect(PackageType.Prompt.value).toBe('prompt');
    });
  });

  describe('fromString()', () => {
    it('retorna Agent para "agent"', () => {
      expect(PackageType.fromString('agent')).toBe(PackageType.Agent);
    });

    it('retorna Skill para "skill"', () => {
      expect(PackageType.fromString('skill')).toBe(PackageType.Skill);
    });

    it('retorna MCP para "mcp"', () => {
      expect(PackageType.fromString('mcp')).toBe(PackageType.MCP);
    });

    it('retorna Instruction para "instruction"', () => {
      expect(PackageType.fromString('instruction')).toBe(PackageType.Instruction);
    });

    it('retorna Prompt para "prompt"', () => {
      expect(PackageType.fromString('prompt')).toBe(PackageType.Prompt);
    });

    it('é case-insensitive', () => {
      expect(PackageType.fromString('AGENT')).toBe(PackageType.Agent);
      expect(PackageType.fromString('MCP')).toBe(PackageType.MCP);
    });

    it('lança Error para tipo desconhecido', () => {
      expect(() => PackageType.fromString('unknown')).toThrow('Tipo de pacote desconhecido: "unknown"');
    });
  });

  describe('all()', () => {
    it('retorna todos os 5 tipos', () => {
      const all = PackageType.all();
      expect(all).toHaveLength(5);
      const values = all.map(t => t.value);
      expect(values).toContain('agent');
      expect(values).toContain('skill');
      expect(values).toContain('mcp');
      expect(values).toContain('instruction');
      expect(values).toContain('prompt');
    });
  });

  describe('cssClass getter', () => {
    it('retorna "type-<value>" para cada tipo', () => {
      expect(PackageType.Agent.cssClass).toBe('type-agent');
      expect(PackageType.MCP.cssClass).toBe('type-mcp');
    });
  });

  describe('color getter', () => {
    it('retorna cor correta para cada tipo', () => {
      expect(PackageType.Agent.color).toBe('#EC7000');
      expect(PackageType.Skill.color).toBe('#448AFF');
      expect(PackageType.MCP.color).toBe('#00C853');
      expect(PackageType.Instruction.color).toBe('#AB47BC');
      expect(PackageType.Prompt.color).toBe('#FFB300');
    });
  });

  describe('equals()', () => {
    it('retorna true para mesmo tipo', () => {
      expect(PackageType.Agent.equals(PackageType.Agent)).toBe(true);
    });

    it('retorna false para tipos diferentes', () => {
      expect(PackageType.Agent.equals(PackageType.Skill)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('retorna o value do tipo', () => {
      expect(PackageType.MCP.toString()).toBe('mcp');
    });
  });

  describe('propriedades', () => {
    it('Agent tem label e icon corretos', () => {
      expect(PackageType.Agent.label).toBe('Agent');
      expect(PackageType.Agent.codicon).toBe('$(hubot)');
      expect(PackageType.Agent.defaultDirectory).toBe('.github/agents');
    });

    it('MCP tem defaultDirectory correto', () => {
      expect(PackageType.MCP.defaultDirectory).toBe('.vscode');
    });
  });
});

// ─── AgentCategory ───────────────────────────────────────────────────────────

describe('AgentCategory', () => {
  describe('singletons', () => {
    it('Orchestrator, Planner, Memory existem como singletons', () => {
      expect(AgentCategory.Orchestrator.value).toBe('orchestrator');
      expect(AgentCategory.Planner.value).toBe('planner');
      expect(AgentCategory.Memory.value).toBe('memory');
    });

    it('Specialist e Guardian existem', () => {
      expect(AgentCategory.Specialist).toBeDefined();
      expect(AgentCategory.Guardian).toBeDefined();
    });
  });

  describe('fromString()', () => {
    it('retorna Orchestrator para "orchestrator"', () => {
      expect(AgentCategory.fromString('orchestrator')).toBe(AgentCategory.Orchestrator);
    });

    it('retorna Planner para "planner"', () => {
      expect(AgentCategory.fromString('planner')).toBe(AgentCategory.Planner);
    });

    it('retorna Specialist para "specialist"', () => {
      expect(AgentCategory.fromString('specialist')).toBe(AgentCategory.Specialist);
    });

    it('retorna Guardian para "guardian"', () => {
      expect(AgentCategory.fromString('guardian')).toBe(AgentCategory.Guardian);
    });

    it('retorna Memory para "memory"', () => {
      expect(AgentCategory.fromString('memory')).toBe(AgentCategory.Memory);
    });

    it('é case-insensitive', () => {
      expect(AgentCategory.fromString('ORCHESTRATOR')).toBe(AgentCategory.Orchestrator);
    });

    it('retorna Specialist para categoria desconhecida (default)', () => {
      expect(AgentCategory.fromString('unknown-category')).toBe(AgentCategory.Specialist);
    });
  });

  describe('all()', () => {
    it('retorna 5 categorias', () => {
      const all = AgentCategory.all();
      expect(all).toHaveLength(5);
    });
  });

  describe('cssClass getter', () => {
    it('retorna "category-<value>"', () => {
      expect(AgentCategory.Orchestrator.cssClass).toBe('category-orchestrator');
      expect(AgentCategory.Memory.cssClass).toBe('category-memory');
    });
  });

  describe('equals()', () => {
    it('retorna true para mesma categoria', () => {
      expect(AgentCategory.Orchestrator.equals(AgentCategory.Orchestrator)).toBe(true);
    });

    it('retorna false para categorias diferentes', () => {
      expect(AgentCategory.Orchestrator.equals(AgentCategory.Memory)).toBe(false);
    });
  });

  describe('propriedades', () => {
    it('Orchestrator tem sortOrder 0', () => {
      expect(AgentCategory.Orchestrator.sortOrder).toBe(0);
    });

    it('Memory tem emoji e label corretos', () => {
      expect(AgentCategory.Memory.label).toBe('Memória');
    });
  });
});
