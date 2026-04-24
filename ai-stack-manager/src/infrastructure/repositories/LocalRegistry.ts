/**
 * @module infrastructure/repositories/LocalRegistry
 * @description Local package registry with full AgentMeta for all agents.
 * Each agent has: category, tools, delegatesTo, workflowPhase, relatedSkills.
 */

import { Package } from '../../domain/entities/Package';
import { Bundle } from '../../domain/entities/Bundle';
import { PackageType } from '../../domain/value-objects/PackageType';
import { AgentCategory } from '../../domain/value-objects/AgentCategory';
import { IPackageRepository } from '../../domain/interfaces';

export class LocalRegistry implements IPackageRepository {
  private readonly packages: Package[];
  private readonly bundles: Bundle[];

  constructor() {
    this.packages = LocalRegistry.buildCatalog();
    this.bundles = LocalRegistry.buildBundles();
  }

  async getAll(): Promise<Package[]> { return [...this.packages]; }
  async findById(id: string): Promise<Package | undefined> { return this.packages.find(p => p.id === id); }
  async search(query: string): Promise<Package[]> { return this.packages.filter(p => p.matchesQuery(query)); }
  async getAllBundles(): Promise<Bundle[]> { return [...this.bundles]; }
  async findBundleById(id: string): Promise<Bundle | undefined> { return this.bundles.find(b => b.id === id); }

  /** Get all agents that a given agent delegates to */
  async getAgentNetwork(agentId: string): Promise<Package[]> {
    const agent = await this.findById(agentId);
    if (!agent?.agentMeta) { return []; }
    const network: Package[] = [];
    for (const delegateId of agent.agentMeta.delegatesTo) {
      const pkg = this.packages.find(p => p.name === delegateId || p.id === `agent-${delegateId}`);
      if (pkg) { network.push(pkg); }
    }
    return network;
  }

  /** Get recommended skills for an agent */
  async getRelatedSkills(agentId: string): Promise<Package[]> {
    const agent = await this.findById(agentId);
    if (!agent?.agentMeta) { return []; }
    const skills: Package[] = [];
    for (const skillRef of agent.agentMeta.relatedSkills) {
      const pkg = this.packages.find(p => p.id === skillRef || p.name === skillRef);
      if (pkg) { skills.push(pkg); }
    }
    return skills;
  }

  private static buildCatalog(): Package[] {
    return [
      ...LocalRegistry.agentPackages(),
      ...LocalRegistry.skillPackages(),
      ...LocalRegistry.mcpPackages(),
      ...LocalRegistry.instructionPackages(),
      ...LocalRegistry.promptPackages(),
    ];
  }

  // ═══════════════════════════════════════════
  // AGENTS — with full AgentMeta
  // ═══════════════════════════════════════════

  private static agentPackages(): Package[] {
    return [
      // ── ORCHESTRATOR ──
      Package.create({
        id: 'agent-orchestrator',
        name: 'zm1-orchestrator',
        displayName: 'ZM1 Orquestrador',
        description: 'Orquestrador mestre — plano de controle determinístico para triagem, roteamento, qualidade e memória. Coordena a rede de especialistas.',
        type: PackageType.Agent,
        version: '1.0.0',
        tags: ['core', 'workflow', 'ai'],
        author: 'Itaú Engineering',
        files: [{
          relativePath: '.github/agents/zm1-orchestrator.agent.md',
          content: '---\nname: zm1-orchestrator\ndescription: >\n  🧠 Orquestrador Mestre — control plane determinístico.\ntools:\n  - read\n  - search\n  - web\n  - agent\n  - todo\n  - vscode/askQuestions\nagents:\n  - planner\n  - code-architect\n  - backend-specialist\n  - frontend-specialist\n  - database-specialist\n  - devops-specialist\n  - test-engineer\n  - code-reviewer\nuser-invocable: true\n---\n\n# ZM1-Orchestrator\n\nOrquestrador mestre do sistema multi-agent.\n',
        }],
        dependencies: ['agent-planner', 'agent-code-architect', 'agent-backend', 'agent-frontend', 'agent-database', 'agent-devops', 'agent-test-engineer', 'agent-code-reviewer'],
        agentMeta: {
          category: AgentCategory.Orchestrator,
          tools: ['read', 'search', 'web', 'agent', 'todo', 'vscode/askQuestions'],
          delegatesTo: ['planner', 'code-architect', 'backend-specialist', 'frontend-specialist', 'database-specialist', 'devops-specialist', 'test-engineer', 'code-reviewer'],
          workflowPhase: 'ALL (TRIAGE → DELIVER → REMEMBER)',
          userInvocable: true,
          relatedSkills: ['skill-api-design', 'skill-security', 'skill-testing-strategy'],
        },
      }),

      // ── PLANNER ──
      Package.create({
        id: 'agent-planner',
        name: 'planner',
        displayName: 'Planejador Estratégico',
        description: 'Planejador estratégico — decompõe solicitações ambíguas em árvores de tarefas com dependências, prioridades e topologia de execução.',
        type: PackageType.Agent,
        version: '1.0.0',
        tags: ['core', 'workflow', 'architecture'],
        author: 'Itaú Engineering',
        files: [{
          relativePath: '.github/agents/planner.agent.md',
          content: '---\nname: planner\ndescription: >\n  📐 Planejador Estratégico — decompõe pedidos em todo graphs.\ntools:\n  - read\n  - search\n  - web\n  - todo\nagents: []\nuser-invocable: false\n---\n\n# Planner\n\nPlanejador estratégico do sistema multi-agent.\n',
        }],
        agentMeta: {
          category: AgentCategory.Planner,
          tools: ['read', 'search', 'web', 'todo'],
          delegatesTo: [],
          workflowPhase: 'PLAN',
          userInvocable: false,
        },
      }),

      // ── ARCHITECT (Specialist) ──
      Package.create({
        id: 'agent-code-architect',
        name: 'code-architect',
        displayName: 'Arquiteto de Software',
        description: 'Arquiteto de software — define fronteiras, contratos, trade-offs e decisões arquiteturais (ADRs).',
        type: PackageType.Agent,
        version: '1.0.0',
        tags: ['architecture', 'core'],
        author: 'Itaú Engineering',
        files: [{
          relativePath: '.github/agents/code-architect.agent.md',
          content: '---\nname: code-architect\ndescription: >\n  🏛️ Arquiteto de Software.\ntools:\n  - read\n  - search\n  - web\nagents: []\nuser-invocable: false\n---\n\n# Code Architect\n',
        }],
        agentMeta: {
          category: AgentCategory.Specialist,
          tools: ['read', 'search', 'web'],
          delegatesTo: [],
          workflowPhase: 'DESIGN',
          userInvocable: false,
          relatedSkills: ['skill-api-design'],
        },
      }),

      // ── BACKEND ──
      Package.create({
        id: 'agent-backend',
        name: 'backend-specialist',
        displayName: 'Especialista Backend',
        description: 'Especialista Backend — APIs, microsserviços, regras de negócio, integrações, autenticação e caching.',
        type: PackageType.Agent,
        version: '1.0.0',
        tags: ['backend', 'specialist', 'core'],
        author: 'Itaú Engineering',
        files: [{
          relativePath: '.github/agents/backend-specialist.agent.md',
          content: '---\nname: backend-specialist\ndescription: >\n  ⚙️ Especialista Backend.\ntools:\n  - read\n  - editFiles\n  - runInTerminal\n  - search\nagents: []\nuser-invocable: false\n---\n\n# Backend Specialist\n',
        }],
        agentMeta: {
          category: AgentCategory.Specialist,
          tools: ['read', 'editFiles', 'runInTerminal', 'search'],
          delegatesTo: [],
          workflowPhase: 'EXECUTION',
          userInvocable: false,
          relatedSkills: ['skill-api-design', 'skill-security', 'skill-db-core'],
        },
      }),

      // ── FRONTEND ──
      Package.create({
        id: 'agent-frontend',
        name: 'frontend-specialist',
        displayName: 'Especialista Frontend',
        description: 'Especialista Frontend — React, Next.js, CSS, acessibilidade (WCAG) e otimização de performance web.',
        type: PackageType.Agent,
        version: '1.0.0',
        tags: ['frontend', 'specialist'],
        author: 'Itaú Engineering',
        files: [{
          relativePath: '.github/agents/frontend-specialist.agent.md',
          content: '---\nname: frontend-specialist\ndescription: >\n  🎨 Especialista Frontend.\ntools:\n  - read\n  - editFiles\n  - runInTerminal\n  - search\nagents: []\nuser-invocable: false\n---\n\n# Frontend Specialist\n',
        }],
        agentMeta: {
          category: AgentCategory.Specialist,
          tools: ['read', 'editFiles', 'runInTerminal', 'search'],
          delegatesTo: [],
          workflowPhase: 'EXECUTION',
          userInvocable: false,
          relatedSkills: ['skill-frontend-core'],
        },
      }),

      // ── DATABASE ──
      Package.create({
        id: 'agent-database',
        name: 'database-specialist',
        displayName: 'Especialista em Banco de Dados',
        description: 'Especialista DBA — PostgreSQL, DynamoDB, Redis, migrações, índices e otimização de queries.',
        type: PackageType.Agent,
        version: '1.0.0',
        tags: ['database', 'specialist'],
        author: 'Itaú Engineering',
        files: [{
          relativePath: '.github/agents/database-specialist.agent.md',
          content: '---\nname: database-specialist\ndescription: >\n  🗄️ Especialista em Banco de Dados.\ntools:\n  - read\n  - editFiles\n  - search\nagents: []\nuser-invocable: false\n---\n\n# Database Specialist\n',
        }],
        agentMeta: {
          category: AgentCategory.Specialist,
          tools: ['read', 'editFiles', 'search'],
          delegatesTo: [],
          workflowPhase: 'EXECUTION',
          userInvocable: false,
          relatedSkills: ['skill-db-core'],
        },
      }),

      // ── DEVOPS ──
      Package.create({
        id: 'agent-devops',
        name: 'devops-specialist',
        displayName: 'Especialista DevOps',
        description: 'Especialista DevOps — CI/CD, Docker, Kubernetes, Terraform e automação de pipelines.',
        type: PackageType.Agent,
        version: '1.0.0',
        tags: ['devops', 'specialist', 'cloud'],
        author: 'Itaú Engineering',
        files: [{
          relativePath: '.github/agents/devops-specialist.agent.md',
          content: '---\nname: devops-specialist\ndescription: >\n  🔧 Especialista DevOps.\ntools:\n  - read\n  - editFiles\n  - runInTerminal\n  - search\nagents: []\nuser-invocable: false\n---\n\n# DevOps Specialist\n',
        }],
        agentMeta: {
          category: AgentCategory.Specialist,
          tools: ['read', 'editFiles', 'runInTerminal', 'search'],
          delegatesTo: [],
          workflowPhase: 'EXECUTION',
          userInvocable: false,
          relatedSkills: ['skill-aws-core', 'skill-datadog-core'],
        },
      }),

      // ── TEST ENGINEER (Guardian) ──
      Package.create({
        id: 'agent-test-engineer',
        name: 'test-engineer',
        displayName: 'Engenheiro de Testes',
        description: 'Especialista em Testes — TDD, pirâmide de testes, estratégias de cobertura e validação funcional.',
        type: PackageType.Agent,
        version: '1.0.0',
        tags: ['testing', 'specialist'],
        author: 'Itaú Engineering',
        files: [{
          relativePath: '.github/agents/test-engineer.agent.md',
          content: '---\nname: test-engineer\ndescription: >\n  🧪 Engenheiro de Testes.\ntools:\n  - read\n  - editFiles\n  - runInTerminal\n  - search\nagents: []\nuser-invocable: false\n---\n\n# Test Engineer\n',
        }],
        agentMeta: {
          category: AgentCategory.Guardian,
          tools: ['read', 'editFiles', 'runInTerminal', 'search'],
          delegatesTo: [],
          workflowPhase: 'VALIDATION',
          userInvocable: false,
          relatedSkills: ['skill-testing-strategy'],
        },
      }),

      // ── CODE REVIEWER (Guardian) ──
      Package.create({
        id: 'agent-code-reviewer',
        name: 'code-reviewer',
        displayName: 'Revisor de Código',
        description: 'Revisor crítico — análise de segurança, qualidade, performance e manutenibilidade.',
        type: PackageType.Agent,
        version: '1.0.0',
        tags: ['security', 'core'],
        author: 'Itaú Engineering',
        files: [{
          relativePath: '.github/agents/code-reviewer.agent.md',
          content: '---\nname: code-reviewer\ndescription: >\n  🔍 Revisor Crítico.\ntools:\n  - read\n  - search\nagents: []\nuser-invocable: false\n---\n\n# Code Reviewer\n',
        }],
        agentMeta: {
          category: AgentCategory.Guardian,
          tools: ['read', 'search'],
          delegatesTo: [],
          workflowPhase: 'CRITIC',
          userInvocable: false,
          relatedSkills: ['skill-security'],
        },
      }),
    ];
  }

  // ═══════════════════════════════════════════
  // SKILLS
  // ═══════════════════════════════════════════

  private static skillPackages(): Package[] {
    return [
      Package.create({ id: 'skill-api-design', name: 'api-design', displayName: 'API Design', description: 'REST, GraphQL, gRPC: design patterns, naming conventions, versioning, error handling.', type: PackageType.Skill, version: '1.0.0', tags: ['backend', 'architecture'], author: 'Itaú Engineering', files: [{ relativePath: '.github/skills/api-design/SKILL.md', content: '---\nname: api-design\ndescription: "REST, GraphQL, gRPC patterns."\n---\n\n# 🔌 API Design Skill\n' }] }),
      Package.create({ id: 'skill-aws-core', name: 'aws-core', displayName: 'AWS Core', description: 'AWS infrastructure: EC2, Lambda, S3, RDS, VPC, IAM, Well-Architected Framework.', type: PackageType.Skill, version: '1.0.0', tags: ['cloud', 'devops'], author: 'Itaú Engineering', files: [{ relativePath: '.github/skills/aws-core/SKILL.md', content: '---\nname: aws-core\ndescription: "AWS infrastructure."\n---\n\n# ☁️ AWS Core Skill\n' }] }),
      Package.create({ id: 'skill-security', name: 'security', displayName: 'Security', description: 'OWASP Top 10, authentication, authorization, encryption, security best practices.', type: PackageType.Skill, version: '1.0.0', tags: ['security', 'core'], author: 'Itaú Engineering', files: [{ relativePath: '.github/skills/security/SKILL.md', content: '---\nname: security\ndescription: "OWASP, auth, crypto."\n---\n\n# 🔒 Security Skill\n' }] }),
      Package.create({ id: 'skill-testing-strategy', name: 'testing-strategy', displayName: 'Testing Strategy', description: 'Test pyramid, TDD workflow, coverage strategies, testing patterns.', type: PackageType.Skill, version: '1.0.0', tags: ['testing'], author: 'Itaú Engineering', files: [{ relativePath: '.github/skills/testing-strategy/SKILL.md', content: '---\nname: testing-strategy\ndescription: "Test pyramid, TDD."\n---\n\n# 🧪 Testing Strategy Skill\n' }] }),
      Package.create({ id: 'skill-db-core', name: 'db-core', displayName: 'Database Core', description: 'PostgreSQL, DynamoDB, Redis: query optimization, indexing, migrations.', type: PackageType.Skill, version: '1.0.0', tags: ['database'], author: 'Itaú Engineering', files: [{ relativePath: '.github/skills/db-core/SKILL.md', content: '---\nname: db-core\ndescription: "Database optimization."\n---\n\n# 🗃️ Database Core Skill\n' }] }),
      Package.create({ id: 'skill-datadog-core', name: 'datadog-core', displayName: 'Datadog Observability', description: 'APM, logs, metrics, dashboards, SLOs, alerting, Datadog instrumentation.', type: PackageType.Skill, version: '1.0.0', tags: ['observability', 'devops'], author: 'Itaú Engineering', files: [{ relativePath: '.github/skills/datadog-core/SKILL.md', content: '---\nname: datadog-core\ndescription: "Observability with Datadog."\n---\n\n# 📊 Datadog Core Skill\n' }] }),
      Package.create({ id: 'skill-frontend-core', name: 'frontend-core', displayName: 'Frontend Core', description: 'React, Next.js, CSS architecture, accessibility (WCAG), web performance.', type: PackageType.Skill, version: '1.0.0', tags: ['frontend'], author: 'Itaú Engineering', files: [{ relativePath: '.github/skills/frontend-core/SKILL.md', content: '---\nname: frontend-core\ndescription: "React, Next.js, CSS."\n---\n\n# 🎨 Frontend Core Skill\n' }] }),
      Package.create({ id: 'skill-dotnet-best-practices', name: 'dotnet-best-practices', displayName: '.NET Best Practices', description: 'C# and .NET best practices, patterns, async/await, dependency injection.', type: PackageType.Skill, version: '1.0.0', tags: ['backend'], author: 'Itaú Engineering', files: [{ relativePath: '.github/skills/dotnet-best-practices/SKILL.md', content: '---\nname: dotnet-best-practices\ndescription: "C# .NET patterns."\n---\n\n# 💜 .NET Best Practices Skill\n' }] }),
    ];
  }

  // ═══════════════════════════════════════════
  // MCPs
  // ═══════════════════════════════════════════

  private static mcpPackages(): Package[] {
    return [
      Package.create({ id: 'mcp-github', name: 'github-mcp', displayName: 'GitHub MCP', description: 'GitHub MCP server — issues, PRs, repos, code search, repository management.', type: PackageType.MCP, version: '1.0.0', tags: ['core', 'workflow'], author: 'GitHub', files: [{ relativePath: '.vscode/mcp.json', content: '// GitHub MCP' }] }),
      Package.create({ id: 'mcp-context7', name: 'context7-mcp', displayName: 'Context7 MCP', description: 'Context7 MCP server — up-to-date library documentation for AI agents.', type: PackageType.MCP, version: '1.0.0', tags: ['core', 'ai'], author: 'Context7', files: [{ relativePath: '.vscode/mcp.json', content: '// Context7 MCP' }] }),
    ];
  }

  // ═══════════════════════════════════════════
  // INSTRUCTIONS
  // ═══════════════════════════════════════════

  private static instructionPackages(): Package[] {
    return [
      Package.create({ id: 'instruction-skill-first', name: 'skill-first', displayName: 'Skill-First Rule', description: 'Always consult relevant skills before implementing in specialized domains.', type: PackageType.Instruction, version: '1.0.0', tags: ['core', 'workflow'], author: 'Itaú Engineering', files: [{ relativePath: '.github/instructions/skill-first.instructions.md', content: '---\napplyTo: "*"\n---\n# Skill-First Rule\n' }] }),
      Package.create({ id: 'instruction-destructive-ops', name: 'destructive-ops', displayName: 'Destructive Ops Guard', description: 'Block destructive operations without explicit confirmation.', type: PackageType.Instruction, version: '1.0.0', tags: ['security', 'core'], author: 'Itaú Engineering', files: [{ relativePath: '.github/instructions/destructive-ops.instructions.md', content: '---\napplyTo: "*"\n---\n# Destructive Ops Guard\n' }] }),
      Package.create({ id: 'instruction-confidence-scoring', name: 'confidence-scoring', displayName: 'Confidence Scoring', description: 'Always declare confidence level (🟢🟡🔴) in every response.', type: PackageType.Instruction, version: '1.0.0', tags: ['core', 'workflow'], author: 'Itaú Engineering', files: [{ relativePath: '.github/instructions/confidence-scoring.instructions.md', content: '---\napplyTo: "*"\n---\n# Confidence Scoring\n' }] }),
    ];
  }

  // ═══════════════════════════════════════════
  // PROMPTS
  // ═══════════════════════════════════════════

  private static promptPackages(): Package[] {
    return [
      Package.create({ id: 'prompt-bugfix', name: 'bugfix', displayName: 'Bugfix Prompt', description: 'Structured prompt for debugging and fixing bugs systematically.', type: PackageType.Prompt, version: '1.0.0', tags: ['workflow'], author: 'Itaú Engineering', files: [{ relativePath: '.github/prompts/bugfix.prompt.md', content: '---\nmode: agent\n---\n# 🐛 Bugfix\n' }] }),
      Package.create({ id: 'prompt-new-feature', name: 'new-feature', displayName: 'New Feature Prompt', description: 'Structured prompt for planning and implementing new features.', type: PackageType.Prompt, version: '1.0.0', tags: ['workflow'], author: 'Itaú Engineering', files: [{ relativePath: '.github/prompts/new-feature.prompt.md', content: '---\nmode: agent\n---\n# ✨ New Feature\n' }] }),
      Package.create({ id: 'prompt-health-check', name: 'health-check-prompt', displayName: 'Health Check Prompt', description: 'Structured prompt for comprehensive project health check.', type: PackageType.Prompt, version: '1.0.0', tags: ['workflow'], author: 'Itaú Engineering', files: [{ relativePath: '.github/prompts/health-check.prompt.md', content: '---\nmode: agent\n---\n# 🏥 Health Check\n' }] }),
    ];
  }

  // ═══════════════════════════════════════════
  // BUNDLES
  // ═══════════════════════════════════════════

  private static buildBundles(): Bundle[] {
    return [
      Bundle.create({ id: 'bundle-zm1-full', name: 'zm1-full-stack', displayName: 'ZM1 Full Stack', description: 'Complete multi-agent system: 1 orchestrator + 8 agents + 8 skills + 3 instructions + 3 prompts.', version: '1.0.0', packageIds: ['agent-orchestrator','agent-planner','agent-code-architect','agent-backend','agent-frontend','agent-database','agent-devops','agent-test-engineer','agent-code-reviewer','skill-api-design','skill-aws-core','skill-security','skill-testing-strategy','skill-db-core','skill-datadog-core','skill-frontend-core','instruction-skill-first','instruction-destructive-ops','instruction-confidence-scoring','prompt-bugfix','prompt-new-feature','prompt-health-check'], color: '#EC7000' }),
      Bundle.create({ id: 'bundle-backend-starter', name: 'backend-starter', displayName: 'Backend Starter', description: 'Backend setup: backend agent + API design + security + testing + database skills.', version: '1.0.0', packageIds: ['agent-backend','agent-code-reviewer','agent-test-engineer','skill-api-design','skill-security','skill-testing-strategy','skill-db-core','instruction-destructive-ops'], color: '#448AFF' }),
      Bundle.create({ id: 'bundle-frontend-starter', name: 'frontend-starter', displayName: 'Frontend Starter', description: 'Frontend setup: frontend agent + core skills + testing.', version: '1.0.0', packageIds: ['agent-frontend','agent-code-reviewer','skill-frontend-core','skill-testing-strategy'], color: '#AB47BC' }),
      Bundle.create({ id: 'bundle-devops-starter', name: 'devops-starter', displayName: 'DevOps & Cloud Starter', description: 'DevOps setup: DevOps agent + AWS + Datadog skills.', version: '1.0.0', packageIds: ['agent-devops','skill-aws-core','skill-datadog-core','instruction-destructive-ops'], color: '#00C853' }),
    ];
  }
}
