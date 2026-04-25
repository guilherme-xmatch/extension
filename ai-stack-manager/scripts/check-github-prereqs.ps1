param(
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

function Test-GitHubCli {
  return [bool](Get-Command gh -ErrorAction SilentlyContinue)
}

function Get-RemoteOriginUrl {
  $remoteUrl = git remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  return $remoteUrl
}

function Test-GitHubAuth {
  $null = gh auth status 2>$null
  return $LASTEXITCODE -eq 0
}

$hasGh = Test-GitHubCli
$remoteOrigin = if ($hasGh) { Get-RemoteOriginUrl } else { $null }
$isAuthenticated = if ($hasGh) { Test-GitHubAuth } else { $false }

$status = [ordered]@{
  branch = $Branch
  ghInstalled = $hasGh
  remoteOriginConfigured = [bool]$remoteOrigin
  remoteOriginUrl = $remoteOrigin
  ghAuthenticated = $isAuthenticated
  readyToApply = ($hasGh -and $remoteOrigin -and $isAuthenticated)
}

$status | ConvertTo-Json -Depth 5

if (-not $status.readyToApply) {
  if (-not $hasGh) {
    Write-Error 'GitHub CLI (gh) não encontrado.'
    exit 1
  }

  if (-not $remoteOrigin) {
    Write-Error 'Remote origin não configurado no Git root atual.'
    exit 2
  }

  if (-not $isAuthenticated) {
    Write-Error 'GitHub CLI não autenticado. Execute gh auth login.'
    exit 3
  }
}

Write-Host 'Pré-condições validadas: pronto para aplicar branch protection.'