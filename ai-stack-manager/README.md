# DescomplicAI / AI Stack Manager

Extensão VS Code para instalar, visualizar e gerenciar pacotes de infraestrutura de AI Agents, Skills, MCPs, Prompts, Instructions e Bundles a partir de um catálogo manifest-driven.

## Estado atual

- Base de hardening P1 implementada
- Compile, lint e testes automatizados verdes localmente
- Pipeline CI versionada em `.github/workflows/ci.yml`
- Operações longas centralizadas via `OperationCoordinator`
- Histórico e métricas operacionais locais disponíveis na UI de Health Check

## Comandos principais

```bash
npm run compile
npm run lint
npm run test
npm run check
npm run configure:origin -- -Owner <owner> -Repo <repo>
npm run check:github-prereqs
npm run apply:branch-protection
```

## Documentação principal

- Plano de execução atual: `docs/implementation/P1-hardening-execution-plan.md`
- Checklist manual de branch protection: `docs/implementation/branch-protection-manual-checklist.md`
- Schema do catálogo público: `docs/catalog-schema/README.md`
- Controle operacional atual: `tasks.md`
- Log resumido do progresso: `TODO.log`

## Observação operacional

A única etapa relevante ainda externa ao repositório é a aplicação da branch protection remota no GitHub, documentada no checklist manual.

Antes disso, valide as pré-condições locais com:

```bash
npm run configure:origin -- -Owner <owner> -Repo <repo>
npm run check:github-prereqs
```