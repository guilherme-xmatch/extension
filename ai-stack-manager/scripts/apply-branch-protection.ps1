param(
  [string]$Owner,
  [string]$Repo,
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

function Assert-GitHubCli {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) {
    throw 'GitHub CLI (gh) não encontrado. Instale o gh antes de aplicar branch protection.'
  }
}

function Assert-GitHubAuth {
  $null = gh auth status 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI não autenticado. Execute "gh auth login" antes de aplicar branch protection.'
  }
}

function Resolve-Repository {
  param(
    [string]$RemoteOwner,
    [string]$RemoteRepo
  )

  if ($RemoteOwner -and $RemoteRepo) {
    return @{ owner = $RemoteOwner; repo = $RemoteRepo }
  }

  $remoteUrl = git remote get-url origin 2>$null
  if (-not $remoteUrl -or $LASTEXITCODE -ne 0) {
    throw 'Não foi possível resolver o remote origin. Informe -Owner e -Repo ou configure o remote origin.'
  }

  if ($remoteUrl -match 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)(\.git)?$') {
    return @{ owner = $Matches.owner; repo = $Matches.repo }
  }

  throw "Remote origin não aponta para um repositório GitHub suportado: $remoteUrl"
}

Assert-GitHubCli
Assert-GitHubAuth

$repository = Resolve-Repository -RemoteOwner $Owner -RemoteRepo $Repo

$payload = @{
  required_status_checks = @{
    strict = $true
    contexts = @('CI / quality')
  }
  enforce_admins = $true
  required_pull_request_reviews = $null
  restrictions = $null
  required_conversation_resolution = $true
  allow_force_pushes = $false
  allow_deletions = $false
  block_creations = $false
  required_linear_history = $false
  lock_branch = $false
  allow_fork_syncing = $true
} | ConvertTo-Json -Depth 10

Write-Host "Aplicando branch protection em $($repository.owner)/$($repository.repo) na branch '$Branch'..."

$payload | gh api \
  --method PUT \
  -H 'Accept: application/vnd.github+json' \
  "/repos/$($repository.owner)/$($repository.repo)/branches/$Branch/protection" \
  --input - | Out-Null

if ($LASTEXITCODE -ne 0) {
  throw 'Falha ao aplicar branch protection via GitHub API.'
}

Write-Host 'Branch protection aplicada com sucesso.'