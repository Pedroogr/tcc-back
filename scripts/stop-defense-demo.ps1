[CmdletBinding()]
param([string] $ManifestPath)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Import-Module (Join-Path $RepoRoot 'scripts\demo\DemoRuntime.psm1') -Force
$Pointer = Join-Path ([System.IO.Path]::GetTempPath()) 'tcc-defense-demo\current.txt'
if (-not $ManifestPath) {
    if (-not (Test-Path $Pointer)) { throw 'Nenhuma demonstracao ativa foi registrada.' }
    $ManifestPath = (Get-Content $Pointer -Raw).Trim()
}
$Manifest = Read-DemoManifest -Path $ManifestPath
$Records = @($Manifest.Processes)
[array]::Reverse($Records)
foreach ($Record in $Records) {
    if (Stop-OwnedDemoProcess -Record $Record) {
        Write-Output "Encerrado: $($Record.Name) (PID $($Record.Pid))"
    } else {
        Write-Output "Ignorado por seguranca (inexistente ou stale): $($Record.Name) (PID $($Record.Pid))"
    }
}

$DatabaseRoot = if ($Manifest.RepoRoot) { [string] $Manifest.RepoRoot } else { $RepoRoot }
Push-Location $DatabaseRoot
try {
    & docker compose stop postgres-demo
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao parar o PostgreSQL demo.' }
} finally { Pop-Location }

if (Test-Path $Pointer) {
    $Current = (Get-Content $Pointer -Raw).Trim()
    if ([string]::Equals($Current, $ManifestPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $Pointer -Force
    }
}
Write-Output 'PostgreSQL demo parado; o volume pgdata-demo foi preservado.'

