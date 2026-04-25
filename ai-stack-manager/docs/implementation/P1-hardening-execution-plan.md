# Plano Executivo de Implementação — P1 Hardening

> Projeto: **DescomplicAI / AI Stack Manager**
> 
> Data: **2026-04-24**
> 
> Escopo: fechamento das lacunas P1 identificadas na auditoria técnica:
> 1. testes automatizados
> 2. CI/CD de qualidade
> 3. propagação completa de logging
> 4. state machine operacional para operações longas

---

## 1. Objetivo executivo

Reduzir o risco estrutural do produto sem frear sua evolução funcional, estabelecendo uma base confiável para:

- refactor seguro
- releases previsíveis
- troubleshooting rápido
- UX consistente em operações longas
- governança mínima de qualidade para crescimento do catálogo e da extensão

### Resultado esperado ao final do plano

Ao concluir este plano, a extensão deverá operar com:

- cobertura automatizada nos fluxos de maior risco
- pipeline obrigatória de qualidade para merge
- observabilidade suficiente para investigar falhas reais
- modelo explícito e reutilizável para operações longas

---

## 2. Princípios de implementação

1. **Blindar primeiro, sofisticar depois**
   - primeiro garantir compile/test/lint/logging
   - depois evoluir arquitetura operacional

2. **Cobrir risco, não perseguir cobertura cosmética**
   - priorizar `GitRegistry`, `FileInstaller`, `WorkspaceScanner`, `HealthChecker`, `PublishService`

3. **Centralizar comportamento repetido**
   - erros, logs, estado operacional, progress reporting e refresh devem convergir para poucos serviços

4. **Projetar para extensibilidade**
   - o que for criado agora deve preparar o terreno para retry, cancelamento, histórico e telemetria futura

5. **Manter rollout incremental**
   - cada onda deve gerar valor independente e reduzido risco de regressão

---

## 3. Escopo P1 consolidado

## 3.1 Frentes de trabalho

### Frente A — Testes Automatizados
**Objetivo:** criar blindagem contra regressões nas regras e fluxos críticos.

### Frente B — CI/CD de Qualidade
**Objetivo:** impedir merge de código quebrado e tornar a qualidade verificável.

### Frente C — Observabilidade / Logging
**Objetivo:** eliminar falhas silenciosas ou opacas nas camadas de serviço e UI.

### Frente D — Estado Operacional / State Machine
**Objetivo:** tornar previsível a execução das operações longas e a sincronização entre backend, status bar e webviews.

---

## 4. Arquitetura-alvo resumida

```text
Commands / Webviews / Chat
        ↓
OperationCoordinator
        ↓
Application Services
  - GitRegistry
  - FileInstaller
  - HealthChecker
  - PublishService
  - Metrics Service
        ↓
AppLogger + Operation Events
        ↓
StatusBar / Views / Logs / CI Assertions
```

### Decisão arquitetural central
Hoje o sistema já possui serviços suficientes para evoluir, mas não possui um **modelo operacional unificado**.

A mudança arquitetural mais importante deste plano é introduzir um **OperationCoordinator** que passe a ser o ponto de entrada para:

- sync de catálogo
- instalação de pacote
- instalação de bundle
- uninstall
- import de MCP
- publish de contribuição
- health check

Esse coordenador não substitui os serviços existentes; ele **orquestra** os serviços existentes.

---

## 5. Roadmap em ondas

# Onda 1 — Blindagem mínima obrigatória
**Horizonte:** 5 a 7 dias úteis
**Prioridade:** máxima
**Dependências:** nenhuma

## Entregas
- infraestrutura de testes
- primeiros testes unitários e de integração
- scripts `test`, `test:unit`, `test:integration`
- workflow CI mínimo
- branch protection recomendada
- logging residual propagado

## Resultado de negócio
Reduzir imediatamente a chance de regressão entrar em `main`.

---

# Onda 2 — Governança operacional explícita
**Horizonte:** 5 a 7 dias úteis
**Dependência:** Onda 1 concluída

## Entregas
- `OperationCoordinator`
- enum/modelo de estado das operações
- eventos de progresso/erro/sucesso
- integração com `StatusBarManager`
- refresh padronizado pós-operação

## Resultado de negócio
Operações longas deixam de ser implícitas e passam a ser gerenciáveis, previsíveis e observáveis.

---

# Onda 3 — Maturidade operacional
**Horizonte:** 1 a 2 semanas
**Dependência:** Onda 2 concluída

## Entregas
- retries controlados
- histórico de operações
- cancelamento seletivo
- testes de fluxo operacional
- métricas internas de falha/duração por operação

## Resultado de negócio
Base pronta para escalar UX, suporte e release com menos risco.

---

## 6. Backlog técnico detalhado

# Épico A — Testes Automatizados

## Objetivo
Estabelecer uma suíte mínima confiável, priorizando fluxos de maior risco arquitetural e de produto.

## Causas-raiz da lacuna
- ausência de framework de testes desde o bootstrap
- acoplamento com APIs do VS Code levando a postergação
- foco inicial em entrega funcional
- inexistência de convenções de teste por camada

## Impactos se nada for feito
- regressões em instalação e catálogo
- medo de refatorar
- bugs reincidentes em MCP merge e carregamento remoto/local
- alto custo de validação manual

## Responsável sugerido
- **Owner:** Extension Engineer / Platform Engineer
- **Apoio:** Tech Lead
- **Aprovação:** responsável técnico do produto

## Recursos requeridos
- Vitest
- utilitário de mocks para `vscode`
- fixtures reais de catálogo e workspace
- ambiente Node/TS já existente

## Viabilidade
**Alta**

## Stories técnicas

### A.1 — Definir stack e convenções de testes
**Descrição:** adicionar framework de testes e convenções de organização.

**Ações técnicas**
- adicionar dependências de teste
- criar `vitest.config.ts`
- criar `test/setup/` com mocks reutilizáveis
- definir nomenclatura `.test.ts`

**Arquivos-alvo esperados**
- `package.json`
- `vitest.config.ts`
- `test/setup/vscode.mock.ts`
- `test/setup/fs.fixture.ts`

**Critérios de sucesso**
- `npm run test` executa com sucesso
- ambiente consegue mockar `vscode.workspace`, `vscode.window` e `vscode.authentication`

---

### A.2 — Cobertura unitária do domínio
**Descrição:** blindar regras puras do domínio.

**Escopo inicial**
- `Package.create`
- labels derivados (`sourceLabel`, `maturityLabel`)
- defaults de `installStrategy`
- comportamento de flags por tipo

**Critérios de sucesso**
- cobertura >= 90% em `src/domain/**`
- testes rápidos (< 2s) e determinísticos

---

### A.3 — Cobertura de integração do GitRegistry
**Descrição:** validar parsing, trust boundary e carregamento de catálogo.

**Casos obrigatórios**
- carregar catálogo local por diretório
- carregar catálogo por JSON local
- rejeitar URL remota insegura
- aceitar URL remota confiável
- ignorar manifest inválido por tipo/id/path/url
- resolver bundles do índice
- mesclar pacotes locais customizados

**Critérios de sucesso**
- regras de validação passam a ser blindadas por testes
- alteração em trust boundary gera falha automática em suite

---

### A.4 — Cobertura de integração do FileInstaller
**Descrição:** validar escrita, merge e uninstall.

**Casos obrigatórios**
- instalar pacote comum em disco
- pular overwrite quando configurado
- instalar bundle deduplicado
- mesclar `mcp.json` preservando servidores preexistentes
- remover apenas servidores do pacote durante uninstall

**Critérios de sucesso**
- nenhuma mudança em merge MCP passa sem detecção

---

### A.5 — Cobertura do WorkspaceScanner e HealthChecker
**Descrição:** blindar heurísticas e checks operacionais.

**Casos obrigatórios**
- detectar perfis de projeto coerentes
- mapear bundles reais
- identificar status de instalação
- health check acusando metadata ausente, targets ausentes e strategy MCP incorreta

**Critérios de sucesso**
- recomendação de bundle inexistente volta a ser detectada automaticamente se reaparecer

---

### A.6 — Smoke tests de ativação da extensão
**Descrição:** validar ativação sem crash e registro básico de comandos.

**Casos obrigatórios**
- ativação da extensão
- comandos principais registrados
- views principais resolvidas sem erro fatal

**Critérios de sucesso**
- regressões grosseiras de ativação passam a ser barradas antes do merge

---

## Métricas de sucesso do épico A
- script `test` ativo
- cobertura global inicial >= 70%
- cobertura `domain` >= 90%
- cobertura forte em `GitRegistry` e `FileInstaller`
- tempo de execução aceitável (< 60–90s local na fase inicial)

---

# Épico B — CI/CD de Qualidade

## Objetivo
Transformar qualidade em requisito de merge, não em disciplina opcional.

## Causas-raiz da lacuna
- inexistência de pipeline definida
- ausência de testes inviabilizando gates mais fortes
- validação atualmente manual

## Impactos se nada for feito
- build quebrado entra em `main`
- falta de previsibilidade de release
- divergência entre ambiente local e branch principal

## Responsável sugerido
- **Owner:** DevEx / Platform Engineer
- **Apoio:** Maintainer da extensão
- **Aprovação:** Tech Lead

## Recursos requeridos
- GitHub Actions ou pipeline equivalente
- configuração de branch protection
- scripts de teste consolidados

## Viabilidade
**Alta**

## Stories técnicas

### B.1 — Consolidar scripts de qualidade
**Ações técnicas**
- adicionar em `package.json`:
  - `test`
  - `test:unit`
  - `test:integration`
  - eventualmente `check` = compile + lint + test

**Critérios de sucesso**
- um comando único consegue validar o projeto completo localmente

---

### B.2 — Criar workflow CI mínimo
**Pipeline mínima**
1. checkout
2. setup node
3. `npm ci`
4. `npm run compile`
5. `npm run lint`
6. `npm run test`

**Ambientes recomendados**
- `windows-latest`
- `ubuntu-latest`

**Critérios de sucesso**
- toda PR recebe status automático de qualidade

---

### B.3 — Definir branch protection
**Política recomendada**
- merge bloqueado sem checks verdes
- proibir bypass fora de administradores
- exigir branch atualizada antes do merge, se necessário

**Critérios de sucesso**
- `main` não recebe código sem compile/lint/test

---

### B.4 — Pipeline de release gradual
**Fase posterior**
- empacotamento da extensão
- validação de manifesto
- sanity check do artefato
- publicação controlada

**Critérios de sucesso**
- release reproduzível e com menor risco operacional

---

## Métricas de sucesso do épico B
- 100% das PRs com gate automático
- taxa de falha por compile/lint/test visível na CI
- tempo médio de pipeline principal < 10 min
- redução de bugs triviais que chegam à branch principal

---

# Épico C — Logging e Observabilidade Completa

## Objetivo
Eliminar inconsistências de troubleshooting e garantir rastreabilidade mínima dos fluxos críticos.

## Causas-raiz da lacuna
- adoção recente do `AppLogger`
- código legado com `catch {}` residuais
- ausência de padrão unificado de severidade e contexto

## Evidências atuais
Ainda há `catch {}` ou tratamento pouco observável em pontos como:
- `WorkspaceScanner.ts`
- `HealthChecker.ts`
- `CatalogViewProvider.ts`
- `InstalledViewProvider.ts`
- `GitRegistry.ts`

## Impactos se nada for feito
- troubleshooting parcial
- falhas intermitentes continuam caras
- diagnóstico depende de reprodução manual ou adivinhação

## Responsável sugerido
- **Owner:** Extension Engineer
- **Apoio:** Tech Lead

## Recursos requeridos
- `AppLogger` já criado
- convenção de eventos de log
- revisão transversal nos serviços

## Viabilidade
**Alta**

## Stories técnicas

### C.1 — Classificar todos os catches remanescentes
**Categorias**
- silencioso justificado
- debug
- warn
- error

**Critério**
- nenhum `catch {}` sem justificativa explícita

---

### C.2 — Padronizar taxonomia de eventos
**Exemplos recomendados**
- `CATALOG_SYNC_FAILED`
- `MANIFEST_INVALID`
- `INSTALL_FAILED`
- `MCP_MERGE_FAILED`
- `HEALTH_SCAN_FAILED`
- `OPEN_FILE_FAILED`
- `WEBVIEW_MESSAGE_INVALID`

**Critério**
- logs importantes passam a ser filtráveis por evento

---

### C.3 — Adicionar contexto operacional mínimo
**Campos recomendados**
- `operationId`
- `packageId`
- `bundleId`
- `registryUrl`
- `workspaceRoot`
- `filePath`
- `command`

**Critério**
- todo log relevante carrega contexto para diagnóstico real

---

### C.4 — Separar logging de UX notification
**Regra operacional**
- `debug/info`: sem popup
- `warn`: popup apenas quando houver impacto perceptível ao usuário
- `error`: popup quando a ação falhar ou deixar estado degradado

**Critério**
- menos ruído ao usuário, mais precisão operacional

---

### C.5 — Tornar logs verificáveis por teste
**Descrição**
Criar testes simples para garantir que falhas críticas registram eventos.

**Critério**
- cenários críticos não podem falhar silenciosamente sem que a suite perceba

---

## Métricas de sucesso do épico C
- zero `catch {}` sem comentário ou log
- incidentes reprodutíveis via `LogOutputChannel`
- redução do tempo de investigação de bugs operacionais

---

# Épico D — State Machine Operacional / OperationCoordinator

## Objetivo
Centralizar o ciclo de vida das operações longas e sincronizar backend, status bar e UI.

## Causas-raiz da lacuna
- crescimento orgânico da extensão
- fluxo operacional espalhado entre `extension.ts`, providers e serviços
- refresh, feedback e erros tratados de forma distribuída

## Impactos se nada for feito
- UX inconsistente
- refresh redundante
- baixa previsibilidade em falhas parciais
- dificuldade de adicionar retry, cancelamento e histórico

## Responsável sugerido
- **Owner:** Tech Lead + Extension Engineer principal
- **Apoio:** responsável por UX do produto, se houver

## Recursos requeridos
- modelagem de estado
- service de coordenação
- eventos observáveis
- adaptação de `StatusBarManager` e commands

## Viabilidade
**Média**

## Modelo-alvo recomendado

```ts
export type OperationKind =
  | 'catalog-sync'
  | 'package-install'
  | 'bundle-install'
  | 'package-uninstall'
  | 'health-check'
  | 'custom-mcp-import'
  | 'package-publish';

export type OperationStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'refreshing'
  | 'completed'
  | 'failed'
  | 'cancelled';
```

### Payload mínimo sugerido
- `id`
- `kind`
- `status`
- `targetId?`
- `label`
- `progress?`
- `startedAt`
- `finishedAt?`
- `error?`
- `refreshTargets: ('catalog' | 'installed' | 'health' | 'none')[]`

---

## Stories técnicas

### D.1 — Criar `OperationCoordinator`
**Responsabilidades**
- iniciar operação
- aplicar transições válidas
- emitir progresso
- publicar sucesso/falha
- centralizar refresh pós-operação

**Critérios de sucesso**
- operações principais passam a usar uma mesma API de coordenação

---

### D.2 — Padronizar wrappers operacionais
**Exemplo de uso esperado**
- `runCatalogSync(...)`
- `runPackageInstall(...)`
- `runBundleInstall(...)`
- `runHealthCheck(...)`

**Critérios de sucesso**
- `extension.ts` deixa de concentrar lógica operacional detalhada

---

### D.3 — Integrar ao `StatusBarManager`
**Objetivo**
A status bar deve refletir o estado central, e não chamadas ad hoc.

**Critérios de sucesso**
- status bar sincronizada com operação em andamento
- sucesso/falha refletidos por evento, não por chamadas dispersas

---

### D.4 — Integrar às webviews principais
**Objetivo**
As views devem poder observar estado operacional compartilhado.

**Critérios de sucesso**
- menos refresh redundante
- UI consistente após install/sync/uninstall

---

### D.5 — Preparar extensão futura para retry/cancelamento
**Objetivo**
Sem implementar tudo de imediato, deixar a modelagem pronta.

**Critérios de sucesso**
- `OperationCoordinator` aceita extensão sem quebra de contrato

---

## Métricas de sucesso do épico D
- toda operação longa passa a ter estado observável
- redução de refresh duplicado
- redução de inconsistência entre status bar e views
- base pronta para retry/cancelamento sem retrabalho estrutural alto

---

## 7. Sequenciamento recomendado por sprint

# Sprint 1
## Meta
Blindar qualidade mínima.

## Entregas
- A.1, A.2, A.3, A.4
- B.1, B.2
- C.1, C.2

## Saída esperada
- testes críticos já rodando
- pipeline funcional
- logging residual reduzido

---

# Sprint 2
## Meta
Fechar governança operacional básica.

## Entregas
- A.5, A.6
- B.3
- C.3, C.4, C.5
- D.1

## Saída esperada
- cobertura mais ampla
- logs consistentes
- coordenador operacional introduzido

---

# Sprint 3
## Meta
Centralizar operações longas e alinhar UI.

## Entregas
- D.2, D.3, D.4, D.5
- B.4

## Saída esperada
- operação longa deixa de ser implícita
- UX operacional previsível

---

## 8. Matriz de responsabilidade sugerida

| Frente | Owner | Apoio | Aprovação |
|---|---|---|---|
| Testes | Extension Engineer | Tech Lead | Responsável técnico |
| CI/CD | DevEx / Platform | Maintainer | Tech Lead |
| Logging | Extension Engineer | Tech Lead | Reviewer técnico |
| State Machine | Tech Lead + Engineer principal | Product/UX | Responsável técnico |

---

## 9. Recursos e esforço estimado

| Item | Esforço estimado | Complexidade |
|---|---:|---:|
| Infra de testes | 2–4 dias | Média |
| Suite crítica inicial | 3–5 dias | Média |
| CI mínima | 1–2 dias | Baixa-Média |
| Logging residual | 0,5–1,5 dia | Baixa |
| OperationCoordinator fase 1 | 2–4 dias | Média |
| Integração UI/status bar | 2–3 dias | Média |

### Observação
Se houver apenas 1 engenheiro dedicado, a execução ideal é em **2 a 3 semanas**.

---

## 10. Dependências e riscos

## Dependências principais
- testes antes de CI forte
- logging antes de métricas operacionais mais avançadas
- OperationCoordinator antes de retry/cancelamento

## Riscos de implementação

### Risco 1 — tentar cobrir testes demais cedo
**Mitigação:** começar por serviços críticos e domínio

### Risco 2 — pipeline lenta demais
**Mitigação:** dividir unit/integration e otimizar fixtures

### Risco 3 — state machine virar overengineering
**Mitigação:** iniciar com coordenador leve e enum de estados, sem framework pesado

### Risco 4 — logging gerar ruído excessivo
**Mitigação:** convenção clara de severidade e contexto

---

## 11. Definition of Done por frente

## Testes
- scripts oficiais presentes
- testes críticos rodando no CI
- documentação mínima de execução local

## CI/CD
- workflow ativo
- PRs bloqueadas sem checks
- logs claros de falha

## Logging
- todos os catches classificados
- eventos de log padronizados
- falhas relevantes observáveis no output

## State Machine
- operações críticas usando coordenador
- status bar e UI sincronizadas
- refresh pós-operação centralizado

---

## 12. Critérios executivos de sucesso

Este plano será considerado bem-sucedido quando:

1. uma regressão relevante em catálogo/instalação for detectada automaticamente antes do merge
2. falhas operacionais puderem ser diagnosticadas por logs com contexto suficiente
3. a branch principal estiver protegida por pipeline obrigatória
4. operações longas tiverem ciclo de vida explícito, observável e consistente para o usuário

---

## 13. Recomendação final de execução

### Ordem mandatória recomendada
1. **Infraestrutura de testes + suíte crítica inicial**
2. **CI mínima com gate obrigatório**
3. **Propagação total de logging**
4. **OperationCoordinator / state machine fase 1**

### Justificativa
Essa ordem entrega o melhor equilíbrio entre:
- redução de risco
- velocidade de implementação
- ganho arquitetural
- preparação para evolução futura

---

## 14. Próximo artefato recomendado

Após este plano, o próximo artefato ideal é um **backlog tático executável**, contendo:

- épicos em formato de sprint
- histórias técnicas quebradas por arquivo
- estimativas por item
- critérios de aceite operacionais
- ordem de implementação

Esse backlog pode ser gerado diretamente a partir deste documento sem retrabalho conceitual.
