# DescomplicAI Public Catalog Schema

Este documento descreve o schema público esperado pela extensão `DescomplicAI` após a migração para o catálogo manifest-driven.

## Estrutura esperada

```text
catalog/
  index.json
  bundles.json
  stats/
    packages/
agents/
  <slug>/
    manifest.json
    source.agent.md
    README.md
    details.md
skills/
  <slug>/
    manifest.json
    SKILL.md
    README.md
    details.md
mcps/
  <slug>/
    manifest.json
    mcp.json
    README.md
    details.md
prompts/
  <slug>/
    manifest.json
    source.prompt.md
    README.md
    details.md
instructions/
  <slug>/
    manifest.json
    source.instructions.md
    README.md
    details.md
```

## `catalog/index.json`

- `schemaVersion`: versão do schema do catálogo
- `repoUrl`: URL base do repositório público
- `packages`: array de caminhos relativos para `manifest.json`
- `bundles`: opcional; pode ser embutido aqui ou em `catalog/bundles.json`
- `stats.packagesBasePath`: base para os arquivos públicos de estatísticas por pacote

## Campos principais de `manifest.json`

```json
{
  "id": "mcp-example-custom",
  "name": "example-custom-mcp",
  "displayName": "Example Custom MCP",
  "description": "Servidor MCP customizado",
  "type": "mcp",
  "version": "1.0.0",
  "tags": ["mcp", "community", "custom"],
  "author": "DescomplicAI Community",
  "install": {
    "strategy": "mcp-merge",
    "targets": [
      {
        "source": "mcp.json",
        "target": ".vscode/mcp.json",
        "mergeStrategy": "merge-mcp-servers"
      }
    ]
  },
  "source": {
    "official": true,
    "packagePath": "mcps/example-custom-mcp",
    "readmePath": "README.md",
    "detailsPath": "details.md"
  },
  "ui": {
    "longDescription": "Descrição longa renderizada pela UI pública da extensão.",
    "highlights": ["Catálogo público", "Instalação com merge", "Suporte a métricas"],
    "installNotes": ["Será mesclado em .vscode/mcp.json"],
    "badges": ["Official"],
    "maturity": "stable"
  },
  "docs": {
    "readmePath": "README.md",
    "detailsPath": "details.md",
    "links": [
      {
        "label": "Repositório",
        "url": "https://github.com/guilherme-xmatch/DescomplicAI"
      }
    ]
  },
  "stats": {
    "installsTotal": 0
  }
}
```

## Estatísticas públicas

A extensão espera arquivos em `catalog/stats/packages/<packageId>.json`, por exemplo:

```json
{
  "installsTotal": 128,
  "uniqueInstallers": 83,
  "lastInstallAt": "2026-04-24T20:00:00.000Z",
  "trendScore": 0.91
}
```

## MCP customizado

A extensão agora consegue:

1. importar um `mcp.json` local
2. instalar o MCP no workspace via merge em `.vscode/mcp.json`
3. persistir esse item como pacote local/customizado
4. gerar um artefato pronto para contribuição pública no schema acima

Veja `examples/` para um exemplo completo.
