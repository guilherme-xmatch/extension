param(
  [Parameter(Mandatory = $true)]
  [string]$Owner,

  [Parameter(Mandatory = $true)]
  [string]$Repo,

  [string]$RemoteName = 'origin',

  [ValidateSet('https', 'ssh')]
  [string]$Protocol = 'https',

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Assert-GitRepository {
  $null = git rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'O diretório atual não está dentro de um repositório Git.'
  }
}

function Build-RemoteUrl {
  param(
    [string]$RemoteOwner,
    [string]$RemoteRepo,
    [string]$RemoteProtocol
  )

  if ($RemoteProtocol -eq 'ssh') {
    return "git@github.com:$RemoteOwner/$RemoteRepo.git"
  }

  return "https://github.com/$RemoteOwner/$RemoteRepo.git"
}

function Get-RemoteUrl {
  param(
    [string]$TargetRemoteName
  )

  $remoteUrl = git config --get "remote.$TargetRemoteName.url" 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  return $remoteUrl
}

Assert-GitRepository

$remoteUrl = Build-RemoteUrl -RemoteOwner $Owner -RemoteRepo $Repo -RemoteProtocol $Protocol
$existingRemoteUrl = Get-RemoteUrl -TargetRemoteName $RemoteName
$remoteExists = $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingRemoteUrl)

if ($remoteExists -and $existingRemoteUrl -eq $remoteUrl) {
  Write-Host "Remote '$RemoteName' já configurado corretamente: $remoteUrl"
  exit 0
}

if ($DryRun) {
  if ($remoteExists) {
    Write-Host "[DRY-RUN] git remote set-url $RemoteName $remoteUrl"
  } else {
    Write-Host "[DRY-RUN] git remote add $RemoteName $remoteUrl"
  }
  exit 0
}

if ($remoteExists) {
  git remote set-url $RemoteName $remoteUrl
} else {
  git remote add $RemoteName $remoteUrl
}

if ($LASTEXITCODE -ne 0) {
  throw "Falha ao configurar o remote '$RemoteName'."
}

Write-Host "Remote '$RemoteName' configurado com sucesso: $remoteUrl"