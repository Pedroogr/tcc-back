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

function Test-DemoStatusEndpoint([string] $Url) {
    try {
        $Response = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 5
        return $Response.StatusCode -ge 200 -and $Response.StatusCode -lt 400
    } catch { return $false }
}

$AllProcessesRunning = $ProcessStatus.Count -gt 0 -and @($ProcessStatus | Where-Object { -not $_.Running }).Count -eq 0
$Health = [ordered]@{
    NestApi = $false
    Gateway = $false
    Worker = $false
    PublicSite = $false
}
if ($AllProcessesRunning) {
    $Health.NestApi = Test-DemoStatusEndpoint 'http://127.0.0.1:3000/auctions/public'
    $Health.Gateway = Test-DemoStatusEndpoint 'http://127.0.0.1:8080/'
    $Health.Worker = Test-DemoStatusEndpoint 'http://127.0.0.1:8765/health'
    if ($Manifest.PublicUrl) { $Health.PublicSite = Test-DemoStatusEndpoint ([string] $Manifest.PublicUrl) }
}
$CurrentlyReady = $Manifest.State -eq 'ready' -and $AllProcessesRunning -and
    @($Health.Values | Where-Object { -not $_ }).Count -eq 0

[pscustomobject]@{
    RunId = $Manifest.RunId
    State = $(if ($CurrentlyReady) { 'ready' } else { 'degraded' })
    StartupState = $Manifest.State
    PublicUrl = $Manifest.PublicUrl
    Processes = $ProcessStatus
    Health = [pscustomobject] $Health
    ManifestPath = $ManifestPath
}

