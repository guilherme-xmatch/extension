# Tasks

## Estado do ciclo atual

**Modo operacional:** Execução

### Concluído

- [x] Implementar hardening P1 (testes, CI, logging, coordenação operacional)
- [x] Adicionar histórico operacional
- [x] Adicionar métricas locais por operação
- [x] Expor estado operacional na UI de Health Check
- [x] Ampliar testes operacionais
- [x] Revalidar qualidade local (`compile`, `lint`, `test`)
- [x] Sincronizar controle documental com o estado real do repositório
- [x] Ignorar artefatos gerados locais (`coverage/`, `vitest.config.*` gerados)
- [x] Isolar o repositório irmão `DescomplicAI/` no Git root real para evitar commits acidentais cruzados
- [x] Preparar automação local para aplicar branch protection via GitHub CLI quando houver remote e autenticação
- [x] Validar a automação local de branch protection até o ponto de bloqueio externo (`gh auth` ausente)
- [x] Adicionar preflight automatizado para validar `gh`, `origin` e autenticação antes da branch protection remota
- [x] Corrigir interferência de artefatos `vitest.config.*` gerados e revalidar `compile`, `lint` e `test`
- [x] Adicionar automação local para configurar `remote origin` no Git root correto
- [x] Corrigir e validar o `DryRun` de `configure-git-origin.ps1`
- [x] P5 — Import MCP Multi-Formato: `McpDocumentAdapter` (Copilot, Claude Desktop, Cursor), atualização de `PublishService`, 23 testes unitários verdes
- [x] BUG FIX — `CatalogManifestParser.toDisplayName`: preserva acrônimos ALL_CAPS (API, AWS, MCP); 44/44 testes passando
- [x] P6 — Persistência do Histórico de Operações via `ExtensionContext.globalState` em `OperationCoordinator`
- [x] P13 — Deep Link `vscode://itau-engineering.descomplicai/install?packageId=<id>&bundleId=<id>` com `registerUriHandler` e `activationEvents: onUri`

### Em andamento

- [x] Revisar e consolidar mudanças locais para commit do ciclo atual no Git root `4. Extensão`

### Bloqueado / externo ao repositório

- [ ] Aplicar branch protection remota no GitHub conforme `docs/implementation/branch-protection-manual-checklist.md` (bloqueado principalmente por ausência de `remote origin` e, em seguida, `gh auth`)

## Próxima prioridade

1. Rodar `npm run configure:origin -- -Owner <owner> -Repo <repo>` no Git root correto.
2. Executar `gh auth login` no ambiente local.
3. Rodar `npm run check:github-prereqs`.
4. Rodar `npm run apply:branch-protection`.
5. Reexecutar diagnóstico para decidir entre novo Modo Execução ou entrada em Modo Evolução.