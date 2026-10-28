[CmdletBinding()]
param([switch] $InstallMissing)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Resolve-DemoTool([string] $Name, [string] $WingetId) {
    $Command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($Command) { return $Command.Source }
    $Portable = Join-Path $env:LOCALAPPDATA "tcc-defense-demo\tools\$Name.exe"
    if (Test-Path -LiteralPath $Portable) { return $Portable }
    if ($WingetId) {
        $PackageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
        $Candidate = Get-ChildItem $PackageRoot -Filter "$Name.exe" -Recurse -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName
        if ($Candidate) { return $Candidate }
    }
    return $null
}

$CoreTools = @('node', 'npm', 'docker', 'uv')
$MissingCore = @($CoreTools | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) })
$OptionalTools = @(
    @{ Name = 'caddy'; Id = 'CaddyServer.Caddy' },
    @{ Name = 'cloudflared'; Id = 'Cloudflare.cloudflared' }
)
$MissingOptional = @($OptionalTools | Where-Object { -not (Resolve-DemoTool $_.Name $_.Id) })

if ($InstallMissing) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue) -and $MissingOptional.Count -gt 0) {
        throw 'Winget nao encontrado; instale Caddy e cloudflared manualmente.'
    }
    foreach ($Tool in $MissingOptional) {
        & winget install --id $Tool.Id --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
        if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar $($Tool.Name) pelo Winget." }
    }
    $MissingOptional = @($OptionalTools | Where-Object { -not (Resolve-DemoTool $_.Name $_.Id) })
}

$Problems = New-Object System.Collections.ArrayList
foreach ($Name in $MissingCore) { [void] $Problems.Add("dependencia ausente: $Name") }
foreach ($Tool in $MissingOptional) {
    [void] $Problems.Add("dependencia ausente: $($Tool.Name) (use -InstallMissing ou instale $($Tool.Id))")
}
if (-not (Get-Module -ListAvailable Pester | Where-Object { $_.Version -ge [version]'3.4.0' })) {
    [void] $Problems.Add('Pester 3.4 ou superior nao encontrado')
}
$ModelPath = Join-Path $RepoRoot 'gesture-poc\yolo11s-pose.pt'
if (-not (Test-Path -LiteralPath $ModelPath)) { [void] $Problems.Add("modelo ausente: $ModelPath") }
if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { [void] $Problems.Add('nvidia-smi/CUDA nao encontrado') }
if ($Problems.Count -gt 0) { throw ($Problems -join [Environment]::NewLine) }

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop nao esta pronto.' }

Push-Location (Join-Path $RepoRoot 'gesture-server')
try {
    & uv run python -c "import torch; assert torch.cuda.is_available(), 'CUDA indisponivel'; print(torch.cuda.get_device_name(0))" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'O ambiente Python nao confirmou a GPU CUDA.' }
} finally { Pop-Location }

[pscustomobject]@{
    Ready = $true
    RepoRoot = $RepoRoot
    Caddy = Resolve-DemoTool 'caddy' 'CaddyServer.Caddy'
    Cloudflared = Resolve-DemoTool 'cloudflared' 'Cloudflare.cloudflared'
    Model = $ModelPath
}

