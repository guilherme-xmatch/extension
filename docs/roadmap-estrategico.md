# AI Stack Manager — Roadmap Estratégico

## 1. Diagnóstico do Estado Atual

### O que já existe (compilando e funcional)

```
ai-stack-manager/
├── src/                               92.6 KB total
│   ├── domain/           (6 files)    18.1 KB  ← Entidades + Value Objects + Interfaces
│   ├── infrastructure/   (4 files)    38.6 KB  ← Registry, Installer, Scanner, HealthChecker
│   ├── presentation/     (4 files)    28.7 KB  ← 3 WebviewViewProviders + Helper
│   └── extension.ts                    9.1 KB  ← Entry point
├── media/                (3 files)     ← CSS premium (550+ linhas) + ícone SVG
├── package.json                        ← Manifest com 3 views, 6 commands, config
└── ✅ Compila com ZERO erros
```

### Scorecard de Maturidade

| Dimensão | Status | Nota |
|:---------|:-------|:-----|
| Arquitetura DDD | ✅ Implementada | Domain/Infra/Presentation separados |
| Catálogo de Pacotes | ✅ 25+ pacotes | 9 agents, 8 skills, 2 MCPs, 3 instructions, 3 prompts |
| Install/Uninstall | ✅ Funcional | Com merge protection e progress bar |
| Health Check | ✅ Funcional | Agents, skills, MCPs, instructions validados |
| Sidebar UI | ✅ Premium | Glassmorphism, animações, dark/light, Itaú colors |
| Sistema de Tipos (AgentCategory) | ⚠️ Definido, não integrado | Value Object existe, falta conectar ao Registry |
| Chat Participant (@stack) | ❌ Não implementado | Pesquisa feita, API pronta |
| Workflow Visualizer | ❌ Não implementado | Conceito validado |
| Insights Engine | ❌ Não implementado | Conceito definido |
| Smart Workspace Analyzer | ❌ Não implementado | — |
| Remote Registry | ❌ Não implementado | Futuro: Git/Docusaurus |
| Testes automatizados | ❌ Não existem | — |

---

## 2. Como Inserir Novos Agents, Skills e MCPs

### Hoje: LocalRegistry (Hardcoded)

O catálogo está centralizado em **um único arquivo**:

```
src/infrastructure/repositories/LocalRegistry.ts
```

Para adicionar um novo pacote, basta adicionar uma chamada a `Package.create()` na seção correspondente:

#### Exemplo: Adicionar novo Agent

```typescript
// Em LocalRegistry.ts → private static agentPackages()
Package.create({
  id: 'agent-security-specialist',           // ID único
  name: 'security-specialist',               // Nome técnico
  displayName: 'Security Specialist',        // Nome de exibição
  description: 'AppSec expert — SAST, DAST, pen-testing, threat modeling.',
  type: PackageType.Agent,
  version: '1.0.0',
  tags: ['security', 'specialist'],
  author: 'Itaú Engineering',
  files: [{
    relativePath: '.github/agents/security-specialist.agent.md',
    content: '---\nname: security-specialist\n...\n---\n# Security Specialist\n...',
  }],
  dependencies: ['skill-security'],          // Opcional
  agentMeta: {                               // Metadados do agent
    category: AgentCategory.Specialist,      // Tipo funcional
    tools: ['read', 'search', 'web'],        // Ferramentas
    delegatesTo: [],                         // Sub-delegações
    workflowPhase: 'VALIDATION',             // Fase no pipeline
    userInvocable: false,                    // Invocável pelo usuário?
    relatedSkills: ['skill-security'],       // Skills associadas
  },
}),
```

#### Exemplo: Adicionar novo Skill

```typescript
// Em LocalRegistry.ts → private static skillPackages()
Package.create({
  id: 'skill-kubernetes',
  name: 'kubernetes',
  displayName: 'Kubernetes',
  description: 'K8s: pods, deployments, services, ingress, helm, operators.',
  type: PackageType.Skill,
  version: '1.0.0',
  tags: ['devops', 'cloud'],
  author: 'Itaú Engineering',
  files: [{
    relativePath: '.github/skills/kubernetes/SKILL.md',
    content: '---\nname: kubernetes\ndescription: "..."\n---\n# ☸️ Kubernetes Skill\n',
  }],
}),
```

#### Exemplo: Adicionar novo MCP

```typescript
// Em LocalRegistry.ts → private static mcpPackages()
Package.create({
  id: 'mcp-mempalace',
  name: 'mempalace-mcp',
  displayName: 'MemPalace MCP',
  description: 'Episodic memory server — persistent knowledge across sessions.',
  type: PackageType.MCP,
  version: '1.0.0',
  tags: ['memory', 'ai'],
  author: 'Itaú Engineering',
  files: [{
    relativePath: '.vscode/mcp.json',
    content: '// MemPalace MCP configuration',
  }],
}),
```

#### Exemplo: Adicionar novo Bundle

```typescript
// Em LocalRegistry.ts → private static buildBundles()
Bundle.create({
  id: 'bundle-security-pack',
  name: 'security-pack',
  displayName: 'Security Pack',
  description: 'Full security setup: security agent + OWASP skill + guard instruction.',
  version: '1.0.0',
  packageIds: [
    'agent-security-specialist',
    'skill-security',
    'instruction-destructive-ops',
  ],
  color: '#FF5252',
}),
```

> [!IMPORTANT]
> **Regra de ouro**: Cada pacote precisa de um `id` único, um `type` válido, e pelo menos um arquivo em `files[]`. O restante é enriquecimento.

### Futuro: Remote Registry (Git/Docusaurus)

O plano de evolução move os dados de `LocalRegistry` para um **repositório Git externo** que serve como "npm registry" para agents:

```
Fase 1 (agora):    LocalRegistry.ts → dados hardcoded
Fase 2 (próxima):  JSON/YAML files  → carregados de /catalog/*.json 
Fase 3 (médio):    Git Registry     → fetch de repo Git (sua Docusaurus)
Fase 4 (futuro):   API Registry     → REST API com cache local
```

---

## 3. Roadmap de Evolução

### Fase 1 — Alicerce Inteligente (🔥 PRÓXIMA — 1 a 2 semanas)

**Objetivo**: Transformar o instalador em um sistema que ENTENDE os agents.

| Item | Descrição | Prioridade | Esforço |
|:-----|:----------|:-----------|:--------|
| **1.1** Integrar `AgentMeta` ao Registry | Adicionar category, tools, delegatesTo, workflowPhase, relatedSkills a todos os agents | P0 | 2h |
| **1.2** Atualizar Catalog UI por tipo | Agrupar agents por categoria (Orchestrator/Planner/Specialist/Guardian/Memory) na sidebar | P0 | 3h |
| **1.3** Chat Participant `@stack` | Registrar `@stack` no Copilot Chat com `/recommend`, `/explain`, `/workflow`, `/health`, `/install` | P0 | 4h |
| **1.4** Workflow Visualizer (Webview Panel) | Pipeline interativo com Mermaid.js: TRIAGE → PLAN → DESIGN → EXECUTE → VALIDATE → CRITIC → DELIVER → REMEMBER | P0 | 5h |
| **1.5** Externalizar catálogo para JSON | Mover dados de `LocalRegistry.ts` para arquivos `catalog/agents.json`, `catalog/skills.json`, etc. | P1 | 2h |

**Entregáveis da Fase 1:**
- `@stack recommend` funciona no Copilot Chat
- Sidebar agrupa agents por tipo funcional (não mais lista flat)
- Workflow pipeline visual aparece em um editor tab
- Adicionar novo agent = editar um JSON, não TypeScript

**Riscos:**
- Chat Participant API pode ter restrições de publisher. Mitigação: testar em Extension Development Host (não precisa publicar para funcionar localmente).

---

### Fase 2 — Inteligência e Insights (2 a 4 semanas)

**Objetivo**: A extensão ANALISA seu ecossistema e gera valor analítico.

| Item | Descrição | Prioridade | Esforço |
|:-----|:----------|:-----------|:--------|
| **2.1** Insights Engine | Coverage Map, Tool Inventory, Complexity Score, Dependency Health | P0 | 6h |
| **2.2** Smart Workspace Analyzer | Escanear package.json/Dockerfile/etc para auto-recomendar pacotes | P0 | 4h |
| **2.3** Agent Profile Cards | View detalhada com métricas, posição no workflow, contrato de retorno | P1 | 3h |
| **2.4** Agent Relationship Graph | Grafo interativo (Mermaid) de delegações entre agents | P1 | 4h |
| **2.5** Onboarding Wizard | First-time experience: detecta projeto → sugere bundle → instala | P1 | 3h |

**Entregáveis da Fase 2:**
- `@stack coverage` mostra mapa de domínios cobertos
- `@stack explain backend-specialist` retorna perfil completo com métricas
- Dev abre projeto novo → extensão automaticamente sugere o bundle ideal
- Grafo visual de "quem delega para quem"

**Riscos:**
- Workspace Analyzer depende de heurísticas que podem dar false positives. Mitigação: mostrar como "sugestões" com confidence score, nunca instalar automaticamente.

---

### Fase 3 — Visualização e UX Avançada (1 a 2 meses)

**Objetivo**: Experiência visual de nível enterprise que impressiona em demos.

| Item | Descrição | Prioridade | Esforço |
|:-----|:----------|:-----------|:--------|
| **3.1** Editor Visual de Workflow | Drag-and-drop para rearranjar a pipeline de agents | P1 | 8h |
| **3.2** Live Agent Status | Indicador de quais agents estão "ativos" na sessão Copilot | P2 | 6h |
| **3.3** Diff/Compare de Configs | Comparar .agent.md entre versões ou entre repos | P2 | 4h |
| **3.4** Agent Templates Gallery | Galeria visual de templates de agents com preview | P2 | 4h |
| **3.5** Dashboard Analytics | Métricas de uso: quais agents são mais chamados, tempo de resposta | P2 | 6h |

**Riscos:**
- Live Agent Status depende de APIs internas do Copilot que podem não estar expostas. Mitigação: começar com "status manual" via marcação no chat.

---

### Fase 4 — Ecossistema Conectado (2 a 3 meses)

**Objetivo**: Conectar com a Docusaurus do Itaú e criar o marketplace interno.

| Item | Descrição | Prioridade | Esforço |
|:-----|:----------|:-----------|:--------|
| **4.1** Remote Registry (Git) | Fetch de pacotes de um repo Git (onde está a Docusaurus) | P0 | 6h |
| **4.2** Formato `.aiconfig` | Manifesto YAML/JSON que descreve toda a infra de agents de um repo | P1 | 4h |
| **4.3** Sync/Update Check | Detectar quando há updates disponíveis nos pacotes remotos | P1 | 4h |
| **4.4** Export/Share | Exportar configuração do workspace como bundle shareable | P2 | 3h |
| **4.5** Team Sync | Sincronizar configurações entre membros da equipe | P2 | 6h |

**Dependências:**
- Precisa de um repositório Git central do Itaú com o catálogo em formato JSON/YAML
- Autenticação: GitHub token ou PAT para repos privados

---

### Fase 5 — Plataforma e Scale (3 a 6 meses)

**Objetivo**: De extensão individual para plataforma organizacional.

| Item | Descrição | Prioridade | Esforço |
|:-----|:----------|:-----------|:--------|
| **5.1** Self-service submission | Portal para contribuir novos agents ao catálogo | P1 | 2w |
| **5.2** Governance/Approval | Workflow de aprovação para agents submetidos | P1 | 2w |
| **5.3** CLI companion | `aism install backend-starter` via terminal | P2 | 1w |
| **5.4** Telemetry dashboard | Painel admin com adoção, packages populares, gaps | P2 | 2w |
| **5.5** Enterprise SSO | Integração com autenticação corporativa Itaú | P2 | 1w |

---

## 4. Matriz de Riscos

| # | Risco | Probabilidade | Impacto | Mitigação |
|:--|:------|:-------------|:--------|:----------|
| R1 | **Chat Participant API instável** | 🟡 Média | 🔴 Alto | Manter funcionalidade duplicada nos commands tradicionais. @stack é complemento, não dependência. |
| R2 | **Catálogo hardcoded não escala** | 🔴 Alta | 🟡 Médio | Fase 1.5 resolve: externalizar para JSON. Fase 4.1: remote registry. |
| R3 | **Sobrescrever configs do dev** | 🟡 Média | 🔴 Alto | Já mitigado: merge protection com confirmação modal antes de overwrite. |
| R4 | **Mermaid.js pesado no webview** | 🟢 Baixa | 🟡 Médio | Lazy load. Mermaid só carrega quando o Workflow Visualizer é aberto. |
| R5 | **Baixa adesão inicial** | 🟡 Média | 🔴 Alto | Onboarding wizard + @stack recommend tornam a extensão útil do primeiro minuto. Bundle install é o gancho. |
| R6 | **Manutenção do catálogo** | 🔴 Alta | 🟡 Médio | Fase 4: remote registry auto-sync. Curto prazo: documentar processo claro de adição (seção 2 deste doc). |
| R7 | **Conflito com extensões existentes** | 🟢 Baixa | 🟢 Baixo | Activity bar icon é único. View IDs são namespaced (`aism-*`). |

---

## 5. Mapa de Dependências Técnicas

```
Fase 1                    Fase 2                  Fase 3              Fase 4
─────────────────────────────────────────────────────────────────────────────

AgentMeta ──────┐
                ├──▶ Insights Engine ──▶ Dashboard Analytics
Catalog by Type ┘         │
                          ├──▶ Agent Profiles
Chat Participant ─────────┤
                          └──▶ Smart Analyzer ──▶ Onboarding Wizard
Workflow Visualizer ──────────▶ Editor Visual ──▶ Live Status

Externalizar JSON ─────────────────────────────▶ Remote Registry ──▶ Team Sync
                                                      │
                                                      └──▶ .aiconfig ──▶ Export
```

> [!TIP]
> **Caminho crítico**: AgentMeta → Catalog by Type → Chat Participant → Workflow Visualizer. Estas 4 tarefas desbloqueiam TUDO que vem depois.

---

## 6. Oportunidades de Melhoria Identificadas

### Arquitetura

| # | Oportunidade | Impacto | Detalhe |
|:--|:-------------|:--------|:--------|
| **A1** | Externalizar dados do Registry | 🔴 Alto | Mover de TypeScript hardcoded para JSON files. Permite edição sem recompilação. |
| **A2** | Adicionar testes unitários | 🟡 Médio | Domain layer é pura — facilmente testável com Vitest/Jest. Começar por Package, Version, HealthReport. |
| **A3** | Event Bus interno | 🟡 Médio | Desacoplar providers com EventEmitter: `onPackageInstalled`, `onHealthCheckCompleted`. |
| **A4** | Cache de scan results | 🟢 Baixo | WorkspaceScanner roda em cada refresh. Cache de 30s evitaria rechecks. |

### UX/Design

| # | Oportunidade | Impacto | Detalhe |
|:--|:-------------|:--------|:--------|
| **U1** | Skeleton loading | 🟡 Médio | Shimmer placeholders enquanto carrega, em vez de flash de conteúdo. |
| **U2** | Keyboard navigation | 🟡 Médio | Tab/Enter/Escape para navegar cards sem mouse. Acessibilidade. |
| **U3** | Notification badges | 🟢 Baixo | Badge na activity bar quando há updates ou health issues. |
| **U4** | Context menus | 🟢 Baixo | Right-click em .agent.md → "Manage with AI Stack Manager". |

### Produto

| # | Oportunidade | Impacto | Detalhe |
|:--|:-------------|:--------|:--------|
| **P1** | Agent Marketplace interno | 🔴 Alto | Times publicam agents que criaram para outros times usarem. Network effect. |
| **P2** | Compliance checker | 🔴 Alto | Validar se todos os agents seguem o padrão do Itaú (frontmatter, naming, tools permitidos). |
| **P3** | Migration tool | 🟡 Médio | Importar agents de outros formatos (Cursor rules, Windsurf rules) para o formato .agent.md. |
| **P4** | AI-powered search | 🟡 Médio | Busca semântica no catálogo: "need help with API authentication" → sugere security skill + backend agent. |

---

## 7. Próximo Passo Recomendado

> [!IMPORTANT]
> **Ação imediata**: Executar os itens **1.1 a 1.4 da Fase 1** (Alicerce Inteligente).
> Isso transforma o produto de "instalador de arquivos" para "Command Center inteligente" em ~14 horas de trabalho.

### Ordem de execução:

```
1. Integrar AgentMeta ao Registry         (2h)  ← dados enriquecidos
2. Atualizar Catalog UI por tipo          (3h)  ← visual por categoria
3. Implementar Chat Participant @stack    (4h)  ← killer feature
4. Implementar Workflow Visualizer        (5h)  ← wow factor
```

Quer que eu comece a executar a Fase 1 agora?
