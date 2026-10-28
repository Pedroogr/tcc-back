[CmdletBinding()]
param([switch] $EnableMonitor)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$FrontRoot = (Resolve-Path (Join-Path $RepoRoot '..\tcc-front')).Path
$WorkerRoot = Join-Path $RepoRoot 'gesture-server'
$RuntimeModule = Join-Path $RepoRoot 'scripts\demo\DemoRuntime.psm1'
Import-Module $RuntimeModule -Force

function Resolve-InstalledDemoTool([string] $Name) {
    $Command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($Command) { return $Command.Source }
    $Portable = Join-Path $env:LOCALAPPDATA "tcc-defense-demo\tools\$Name.exe"
    if (Test-Path -LiteralPath $Portable) { return $Portable }
    $PackageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $Candidate = Get-ChildItem $PackageRoot -Filter "$Name.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $Candidate) { throw "$Name nao encontrado; execute npm run demo:prepare -- --InstallMissing." }
    return $Candidate
}

function Invoke-DemoPortPreflight([int[]] $Ports = @(3000, 5435, 8080, 8765)) {
    Assert-DemoPortsAvailable -Ports $Ports
}

function Complete-DemoStartup {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Smoke,
        [Parameter(Mandatory = $true)][scriptblock] $Publish,
        [Parameter(Mandatory = $true)][scriptblock] $Cleanup
    )
    try {
        & $Smoke
        & $Publish
    } catch {
        & $Cleanup
        throw
    }
}

function Wait-DemoHttp([string] $Url, [int] $TimeoutSeconds = 120) {
    $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try { return Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 10 }
        catch { Start-Sleep -Milliseconds 500 }
    } while ([DateTime]::UtcNow -lt $Deadline)
    throw "Timeout aguardando $Url"
}

function Wait-DemoDns {
    param(
        [Parameter(Mandatory = $true)][string] $HostName,
        [int] $TimeoutSeconds = 180
    )
    $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            Resolve-DnsName $HostName -Type A -ErrorAction Stop | Out-Null
            return
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ([DateTime]::UtcNow -lt $Deadline)
    throw "Timeout aguardando propagacao DNS de $HostName"
}

function Start-DemoProcessWithEnvironment {
    param(
        [hashtable] $Environment,
        [hashtable] $ProcessArguments
    )
    $Previous = @{}
    try {
        foreach ($Name in $Environment.Keys) {
            $Previous[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
            [Environment]::SetEnvironmentVariable($Name, [string] $Environment[$Name], 'Process')
        }
        return Start-DemoProcess @ProcessArguments
    } finally {
        foreach ($Name in $Environment.Keys) {
            [Environment]::SetEnvironmentVariable($Name, $Previous[$Name], 'Process')
        }
    }
}

function Stop-DemoStartup([object[]] $Processes, [switch] $StopDatabase) {
    $Owned = @($Processes)
    [array]::Reverse($Owned)
    foreach ($Record in $Owned) { [void] (Stop-OwnedDemoProcess -Record $Record) }
    if ($StopDatabase) {
        Push-Location $RepoRoot
        try { & docker compose stop postgres-demo | Out-Null } finally { Pop-Location }
    }
}

function Invoke-DemoCleanupOnce {
    param(
        [Parameter(Mandatory = $true)][hashtable] $State,
        [object[]] $Processes,
        [switch] $StopDatabase
    )
    if ($State.Cleaned) { return }
    Stop-DemoStartup -Processes $Processes -StopDatabase:$StopDatabase
    $State.Cleaned = $true
}

function Invoke-DemoLoggedCommand {
    param(
        [Parameter(Mandatory = $true)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][string] $LogPath
    )
    $PreviousErrorAction = $ErrorActionPreference
    Push-Location $WorkingDirectory
    try {
        # Windows PowerShell 5.1 materializa stderr nativo como ErrorRecord.
        # Mensagens informativas do uv nao devem virar excecao quando exit code = 0.
        $ErrorActionPreference = 'Continue'
        & $FilePath @ArgumentList 2>&1 | Out-File -LiteralPath $LogPath -Encoding UTF8
        $NativeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $PreviousErrorAction
        Pop-Location
    }
    if ($NativeExitCode -ne 0) {
        throw "Comando nativo falhou com codigo $NativeExitCode. Consulte $LogPath"
    }
}

function Get-DemoListenerProcessRecord {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)] $LauncherRecord,
        [Parameter(Mandatory = $true)][string] $StdoutPath,
        [Parameter(Mandatory = $true)][string] $StderrPath
    )
    try {
        $Launcher = Get-Process -Id ([int] $LauncherRecord.Pid) -ErrorAction Stop
    } catch { throw 'O launcher do worker nao esta mais em execucao.' }
    if ($Launcher.StartTime.ToUniversalTime().Ticks -ne [long] $LauncherRecord.StartTimeUtcTicks) {
        throw 'O PID do launcher foi reutilizado.'
    }
    if ($LauncherRecord.Executable -and $Launcher.Path -and
        -not [string]::Equals($LauncherRecord.Executable, $Launcher.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'O executavel do launcher nao corresponde ao registro desta execucao.'
    }
    $OwnerIds = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
        Select-Object -ExpandProperty OwningProcess -Unique)
    if ($OwnerIds.Count -ne 1) { throw "A porta $Port nao possui um unico processo ouvinte." }
    $AncestorPid = [int] $OwnerIds[0]
    $Visited = @{}
    $DescendsFromLauncher = $false
    while ($AncestorPid -gt 0 -and -not $Visited.ContainsKey($AncestorPid)) {
        if ($AncestorPid -eq [int] $LauncherRecord.Pid) {
            $DescendsFromLauncher = $true
            break
        }
        $Visited[$AncestorPid] = $true
        $Info = Get-CimInstance Win32_Process -Filter "ProcessId=$AncestorPid" -ErrorAction SilentlyContinue
        if (-not $Info) { break }
        $AncestorPid = [int] $Info.ParentProcessId
    }
    if (-not $DescendsFromLauncher) {
        throw "O processo que ocupa a porta $Port nao pertence ao launcher desta execucao."
    }
    $Process = Get-Process -Id ([int] $OwnerIds[0]) -ErrorAction Stop
    return [pscustomobject]@{
        Name = $Name; Pid = $Process.Id
        StartTimeUtcTicks = $Process.StartTime.ToUniversalTime().Ticks
        Executable = $Process.Path; StdoutPath = $StdoutPath; StderrPath = $StderrPath
    }
}

function Complete-DemoWorkerStartup {
    param(
        [Parameter(Mandatory = $true)] $LauncherRecord,
        [Parameter(Mandatory = $true)][ref] $Processes,
        [Parameter(Mandatory = $true)][string] $StdoutPath,
        [Parameter(Mandatory = $true)][string] $StderrPath,
        [scriptblock] $ResolveListener,
        [scriptblock] $WaitForReadiness
    )
    $Deadline = [DateTime]::UtcNow.AddSeconds(180)
    do {
        try {
            if ($ResolveListener) {
                $ListenerRecord = & $ResolveListener
            } else {
                $ListenerRecord = Get-DemoListenerProcessRecord -Name 'gesture-worker' -Port 8765 `
                    -LauncherRecord $LauncherRecord -StdoutPath $StdoutPath -StderrPath $StderrPath
            }
            [void] $Processes.Value.Add($ListenerRecord)
            break
        } catch {
            if ($_.Exception.Message -match 'nao pertence|reutilizado|nao corresponde|nao esta mais') { throw }
            Start-Sleep -Milliseconds 250
        }
    } while ([DateTime]::UtcNow -lt $Deadline)
    if (-not $ListenerRecord) { throw 'O worker nao abriu a porta 8765 dentro do prazo.' }
    if ($WaitForReadiness) { & $WaitForReadiness }
    else { Wait-DemoHttp 'http://127.0.0.1:8765/health' 180 | Out-Null }
}

function Invoke-DefenseDemoStart {
    Invoke-DemoPortPreflight
    & (Join-Path $RepoRoot 'scripts\prepare-defense-demo.ps1') | Out-Null

    $Run = New-DemoRunDirectory
    $Processes = New-Object System.Collections.ArrayList
    $DatabaseStarted = $false
    $Published = $false
    $PublicUrl = $null
    $DemoPassword = $null
    $GestureToken = $null
    $CleanupState = @{ Cleaned = $false }

    try {
        Push-Location $RepoRoot
        try {
            & docker compose up -d postgres-demo
            if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar PostgreSQL demo.' }
            $DatabaseStarted = $true
            $Deadline = [DateTime]::UtcNow.AddSeconds(60)
            do {
                $Health = & docker inspect --format '{{.State.Health.Status}}' tcc-back-demo-postgres 2>$null
                if ($Health -eq 'healthy') { break }
                Start-Sleep -Milliseconds 500
            } while ([DateTime]::UtcNow -lt $Deadline)
            if ($Health -ne 'healthy') { throw 'PostgreSQL demo nao ficou pronto.' }
        } finally { Pop-Location }

        Push-Location $WorkerRoot
        try {
            $DemoPassword = (& uv run python -c 'import secrets; print(secrets.token_urlsafe(18))').Trim()
            $GestureToken = (& uv run python -c 'import secrets; print(secrets.token_urlsafe(32))').Trim()
        } finally { Pop-Location }
        if (-not $DemoPassword -or -not $GestureToken) { throw 'Falha ao gerar segredos efemeros.' }

        $DatabaseUrl = 'postgresql://postgres:postgres@127.0.0.1:5435/cattle_auction_demo'
        $OldDatabaseUrl = $env:DATABASE_URL
        $OldDemoPassword = $env:DEMO_PASSWORD
        try {
            $env:DATABASE_URL = $DatabaseUrl
            $env:DEMO_PASSWORD = $DemoPassword
            Push-Location $RepoRoot
            try {
                & npx prisma migrate deploy
                if ($LASTEXITCODE -ne 0) { throw 'Falha nas migrations do banco demo.' }
                & npm run demo:seed --silent | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Falha no seed do banco demo.' }
            } finally { Pop-Location }
        } finally {
            $env:DATABASE_URL = $OldDatabaseUrl
            $env:DEMO_PASSWORD = $OldDemoPassword
        }

        Push-Location $FrontRoot
        try { & npm run build:demo; if ($LASTEXITCODE -ne 0) { throw 'Build demo do front falhou.' } }
        finally { Pop-Location }
        Push-Location $RepoRoot
        try { & npm run build; if ($LASTEXITCODE -ne 0) { throw 'Build do back falhou.' } }
        finally { Pop-Location }

        $NestRecord = Start-DemoProcessWithEnvironment -Environment @{
            DATABASE_URL = $DatabaseUrl; HOST = '127.0.0.1'; PORT = '3000'
            JWT_SECRET = (& uv run --project $WorkerRoot python -c 'import secrets; print(secrets.token_urlsafe(32))').Trim()
        } -ProcessArguments @{
            Name = 'nestjs'; FilePath = (Get-Command node).Source; ArgumentList = @('dist/src/main.js')
            WorkingDirectory = $RepoRoot; StdoutPath = (Join-Path $Run.Directory 'nestjs.out.log')
            StderrPath = (Join-Path $Run.Directory 'nestjs.err.log')
        }
        [void] $Processes.Add($NestRecord)
        Wait-DemoHttp 'http://127.0.0.1:3000/auctions/public' 30 | Out-Null

        $Caddy = Resolve-InstalledDemoTool 'caddy'
        $CaddyRecord = Start-DemoProcessWithEnvironment -Environment @{
            TCC_FRONT_DIST = (Join-Path $FrontRoot 'dist').Replace('\', '/')
        } -ProcessArguments @{
            Name = 'caddy'; FilePath = $Caddy
            ArgumentList = @('run', '--config', (Join-Path $RepoRoot 'deploy\demo\Caddyfile'), '--adapter', 'caddyfile')
            WorkingDirectory = $RepoRoot; StdoutPath = (Join-Path $Run.Directory 'caddy.out.log')
            StderrPath = (Join-Path $Run.Directory 'caddy.err.log')
        }
        [void] $Processes.Add($CaddyRecord)
        Wait-DemoHttp 'http://127.0.0.1:8080/' 20 | Out-Null

        $Cloudflared = Resolve-InstalledDemoTool 'cloudflared'
        $TunnelRecord = Start-DemoProcess -Name 'cloudflared' -FilePath $Cloudflared `
            -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:8080', '--no-autoupdate') `
            -WorkingDirectory $RepoRoot -StdoutPath (Join-Path $Run.Directory 'cloudflared.out.log') `
            -StderrPath (Join-Path $Run.Directory 'cloudflared.err.log')
        [void] $Processes.Add($TunnelRecord)
        $TunnelDeadline = [DateTime]::UtcNow.AddSeconds(45)
        do {
            $Lines = @()
            foreach ($Log in @($TunnelRecord.StdoutPath, $TunnelRecord.StderrPath)) {
                if (Test-Path $Log) { $Lines += Get-Content $Log }
            }
            try { $PublicUrl = Get-QuickTunnelUrl -Lines $Lines } catch { $PublicUrl = $null }
            if ($PublicUrl) { break }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $TunnelDeadline)
        if (-not $PublicUrl) { throw 'Cloudflared nao forneceu a URL publica dentro do prazo.' }
        $Origin = $PublicUrl.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')

        $WorkerRecord = Start-DemoProcessWithEnvironment -Environment @{
            GESTURE_TOKEN = $GestureToken; GESTURE_ALLOWED_ORIGINS = $Origin
            GESTURE_DEBUG_PREVIEW = $(if ($EnableMonitor) { 'true' } else { 'false' })
        } -ProcessArguments @{
            Name = 'gesture-worker-launcher'; FilePath = (Get-Command uv).Source
            ArgumentList = @('run', 'uvicorn', 'app.main:create_configured_app', '--factory', '--host', '127.0.0.1', '--port', '8765', '--workers', '1')
            WorkingDirectory = $WorkerRoot; StdoutPath = (Join-Path $Run.Directory 'worker.out.log')
            StderrPath = (Join-Path $Run.Directory 'worker.err.log')
        }
        [void] $Processes.Add($WorkerRecord)
        Complete-DemoWorkerStartup -LauncherRecord $WorkerRecord -Processes ([ref] $Processes) `
            -StdoutPath $WorkerRecord.StdoutPath -StderrPath $WorkerRecord.StderrPath

        $Manifest = @{
            RunId = $Run.RunId; State = 'validating'; PublicUrl = $Origin; RepoRoot = $RepoRoot
            CreatedAtUtc = [DateTime]::UtcNow.ToString('o'); Processes = @($Processes)
        }
        Write-DemoManifest -Path $Run.ManifestPath -Manifest $Manifest

        Complete-DemoStartup -Smoke {
            Wait-DemoDns -HostName $PublicUrl.Host -TimeoutSeconds 180
            Wait-DemoHttp "$Origin/" 60 | Out-Null
            Wait-DemoHttp "$Origin/api/auctions/public" 60 | Out-Null
            Add-Type -AssemblyName System.Drawing
            $FramePath = Join-Path $Run.Directory 'smoke-frame.jpg'
            $Bitmap = New-Object System.Drawing.Bitmap(640, 480)
            try { $Bitmap.Save($FramePath, [System.Drawing.Imaging.ImageFormat]::Jpeg) } finally { $Bitmap.Dispose() }
            $WebSocketUrl = 'wss://{0}/v1/pose' -f $PublicUrl.Host
            $OldBenchmarkToken = $env:GESTURE_BENCHMARK_TOKEN
            try {
                $env:GESTURE_BENCHMARK_TOKEN = $GestureToken
                Push-Location $WorkerRoot
                try {
                    Invoke-DemoLoggedCommand -FilePath (Get-Command uv).Source -WorkingDirectory $WorkerRoot `
                        -ArgumentList @(
                            'run', '--script', 'scripts/benchmark_client.py', '--url', $WebSocketUrl,
                            '--origin', $Origin, '--input', $FramePath, '--max-frames', '1',
                            '--output', (Join-Path $Run.Directory 'public-smoke.json')
                        ) -LogPath (Join-Path $Run.Directory 'benchmark.log')
                } finally { Pop-Location }
            } finally { $env:GESTURE_BENCHMARK_TOKEN = $OldBenchmarkToken }
        } -Publish {
            $Manifest.State = 'ready'
            Write-DemoManifest -Path $Run.ManifestPath -Manifest $Manifest
            $Pointer = Join-Path ([System.IO.Path]::GetTempPath()) 'tcc-defense-demo\current.txt'
            New-Item -ItemType Directory -Path (Split-Path $Pointer -Parent) -Force | Out-Null
            Set-Content -LiteralPath $Pointer -Value $Run.ManifestPath -Encoding UTF8
            try { Set-Clipboard -Value $GestureToken } catch { }
            Write-Output ''
            Write-Output 'DEMONSTRACAO PRONTA'
            Write-Output "URL: $Origin"
            Write-Output "Token (tambem copiado): $GestureToken"
            Write-Output 'Escritorio: escritorio.demo@tcc.local'
            Write-Output 'Comprador: comprador.demo@tcc.local'
            Write-Output "Senha das contas demo: $DemoPassword"
            Write-Output "Logs: $($Run.Directory)"
            $Published = $true
        } -Cleanup {
            Invoke-DemoCleanupOnce -State $CleanupState -Processes @($Processes) -StopDatabase:$DatabaseStarted
        }
    } catch {
        if (-not $Published) {
            Invoke-DemoCleanupOnce -State $CleanupState -Processes @($Processes) -StopDatabase:$DatabaseStarted
        }
        throw
    } finally {
        $DemoPassword = $null
        $GestureToken = $null
        Remove-Item Env:DEMO_PASSWORD, Env:GESTURE_TOKEN, Env:GESTURE_BENCHMARK_TOKEN, Env:JWT_SECRET -ErrorAction SilentlyContinue
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-DefenseDemoStart
}
