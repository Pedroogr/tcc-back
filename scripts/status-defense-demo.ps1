[CmdletBinding()]
param([string] $ManifestPath)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Import-Module (Join-Path $RepoRoot 'scripts\demo\DemoRuntime.psm1') -Force

if (-not $ManifestPath) {
    $Pointer = Join-Path ([System.IO.Path]::GetTempPath()) 'tcc-defense-demo\current.txt'
    if (-not (Test-Path $Pointer)) { throw 'Nenhuma demonstracao ativa foi registrada.' }
    $ManifestPath = (Get-Content $Pointer -Raw).Trim()
}
$Manifest = Read-DemoManifest -Path $ManifestPath
$ProcessStatus = @(
    foreach ($Record in @($Manifest.Processes)) {
        $Owned = $false
        try {
            $Process = Get-Process -Id ([int] $Record.Pid) -ErrorAction Stop
            $Owned = $Process.StartTime.ToUniversalTime().Ticks -eq [long] $Record.StartTimeUtcTicks
            if ($Owned -and $Record.Executable -and $Process.Path) {
                $Owned = [string]::Equals($Record.Executable, $Process.Path, [System.StringComparison]::OrdinalIgnoreCase)
            }
        } catch { $Owned = $false }
        [pscustomobject]@{ Name = $Record.Name; Pid = $Record.Pid; Running = $Owned }
    }
)

[pscustomobject]@{
    RunId = $Manifest.RunId
    State = $Manifest.State
    PublicUrl = $Manifest.PublicUrl
    Processes = $ProcessStatus
    ManifestPath = $ManifestPath
}

