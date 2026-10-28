Set-StrictMode -Version 2.0

function Get-QuickTunnelUrl {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]] $Lines)

    $Urls = @(@(
        foreach ($Line in $Lines) {
            foreach ($Match in [regex]::Matches($Line, 'https://[a-z0-9-]+\.trycloudflare\.com(?:/)?', 'IgnoreCase')) {
                $Match.Value.TrimEnd('/')
            }
        }
    ) | Sort-Object -Unique)

    if ($Urls.Count -ne 1) {
        throw "Era esperada exatamente uma URL trycloudflare.com; encontradas: $($Urls.Count)."
    }
    return [uri] $Urls[0]
}

function Assert-DemoPortsAvailable {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][int[]] $Ports)

    foreach ($Port in $Ports) {
        $Listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
        $Listener.ExclusiveAddressUse = $true
        try {
            $Listener.Start()
        } catch {
            throw "A porta local $Port ja esta ocupada. Encerre o servico existente antes de iniciar a demonstracao."
        } finally {
            $Listener.Stop()
        }
    }
}

function New-DemoRunDirectory {
    [CmdletBinding()]
    param([string] $BasePath = (Join-Path ([System.IO.Path]::GetTempPath()) 'tcc-defense-demo'))

    $RunId = '{0}-{1}' -f ([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')), ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $Directory = Join-Path $BasePath $RunId
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    return [pscustomobject]@{
        RunId = $RunId
        Directory = $Directory
        ManifestPath = Join-Path $Directory 'manifest.json'
    }
}

function Write-DemoManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][hashtable] $Manifest
    )

    $Json = $Manifest | ConvertTo-Json -Depth 8
    if ($Json -match '(?i)GESTURE_TOKEN|DEMO_PASSWORD|JWT_SECRET') {
        throw 'O manifesto contem um nome de campo secreto proibido.'
    }
    $Parent = Split-Path -Parent $Path
    if ($Parent) { New-Item -ItemType Directory -Path $Parent -Force | Out-Null }
    $TemporaryPath = "$Path.tmp"
    Set-Content -LiteralPath $TemporaryPath -Value $Json -Encoding UTF8
    Move-Item -LiteralPath $TemporaryPath -Destination $Path -Force
}

function Read-DemoManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) { throw "Manifesto nao encontrado: $Path" }
    try {
        $Manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        throw "Manifesto JSON invalido: $Path"
    }
    if (-not $Manifest) { throw "Manifesto vazio: $Path" }
    return $Manifest
}

function Start-DemoProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][string] $StdoutPath,
        [Parameter(Mandatory = $true)][string] $StderrPath
    )

    foreach ($LogPath in @($StdoutPath, $StderrPath)) {
        $Parent = Split-Path -Parent $LogPath
        if ($Parent) { New-Item -ItemType Directory -Path $Parent -Force | Out-Null }
    }
    $Process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -WindowStyle Hidden -PassThru
    $Process.Refresh()
    return [pscustomobject]@{
        Name = $Name
        Pid = $Process.Id
        StartTimeUtcTicks = $Process.StartTime.ToUniversalTime().Ticks
        Executable = $Process.Path
        StdoutPath = $StdoutPath
        StderrPath = $StderrPath
    }
}

function Stop-OwnedDemoProcess {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] $Record)

    try {
        $Process = Get-Process -Id ([int] $Record.Pid) -ErrorAction Stop
    } catch {
        return $false
    }
    if ($Process.StartTime.ToUniversalTime().Ticks -ne [long] $Record.StartTimeUtcTicks) {
        return $false
    }
    if ($Record.Executable -and $Process.Path -and
        -not [string]::Equals($Record.Executable, $Process.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $false
    }
    Stop-Process -Id ([int] $Record.Pid) -Force -ErrorAction Stop
    return $true
}

Export-ModuleMember -Function @(
    'Get-QuickTunnelUrl',
    'Assert-DemoPortsAvailable',
    'New-DemoRunDirectory',
    'Write-DemoManifest',
    'Read-DemoManifest',
    'Start-DemoProcess',
    'Stop-OwnedDemoProcess'
)
