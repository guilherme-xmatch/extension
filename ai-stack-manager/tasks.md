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

### Em andamento

- [x] Revisar e consolidar mudanças locais para commit do ciclo atual no Git root `4. Extensão`

### Bloqueado / externo ao repositório

- [ ] Aplicar branch protection remota no GitHub conforme `docs/implementation/branch-protection-manual-checklist.md` (bloqueado por ausência de `remote origin` e `gh auth`)

## Próxima prioridade

1. Configurar `remote origin` do repositório alvo no Git root correto.
2. Executar `gh auth login` no ambiente local.
3. Rodar `./scripts/apply-branch-protection.ps1`.
4. Reexecutar diagnóstico para decidir entre novo Modo Execução ou entrada em Modo Evolução.