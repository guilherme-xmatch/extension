# Branch Protection — Checklist Manual

Este repositório agora possui pipeline CI em `.github/workflows/ci.yml`.

## Passos manuais ainda necessários no GitHub

1. Abrir **Settings → Branches** no repositório.
2. Criar regra para `main`.
3. Exigir status checks antes do merge.
4. Marcar o workflow **CI** como obrigatório.
5. Bloquear merge direto sem checks verdes.
6. Opcional: exigir branch atualizada antes do merge.

## Motivo do checklist

A proteção de branch é uma configuração do repositório remoto e não pode ser aplicada apenas por arquivos locais versionados.