# Branch Protection — Checklist Manual

Este repositório agora possui pipeline CI em `.github/workflows/ci.yml`.

## Pré-condições observadas no ambiente atual

- o Git root atual não possui `remote origin` configurado;
- o GitHub CLI (`gh`) está instalado;
- o GitHub CLI **não está autenticado** no ambiente atual.

Enquanto essas pré-condições não forem resolvidas, a branch protection não pode ser aplicada automaticamente a partir deste workspace.

## Automação disponível

Foi adicionado o script:

```powershell
./scripts/configure-git-origin.ps1 -Owner <owner> -Repo <repo>
```

Depois disso:

```powershell
./scripts/apply-branch-protection.ps1 -Owner <owner> -Repo <repo> -Branch main
```

Ou, se o `origin` estiver configurado para GitHub e o `gh` autenticado:

```powershell
./scripts/apply-branch-protection.ps1
```

Para validar previamente o ambiente:

```powershell
./scripts/check-github-prereqs.ps1
```

Ou via npm:

```bash
npm run configure:origin -- -Owner <owner> -Repo <repo>
npm run check:github-prereqs
npm run apply:branch-protection
```

## Passos manuais ainda necessários no GitHub

1. Abrir **Settings → Branches** no repositório.
2. Criar regra para `main`.
3. Exigir status checks antes do merge.
4. Marcar o workflow **CI** como obrigatório.
5. Bloquear merge direto sem checks verdes.
6. Opcional: exigir branch atualizada antes do merge.

## Motivo do checklist

A proteção de branch é uma configuração do repositório remoto e não pode ser aplicada apenas por arquivos locais versionados.