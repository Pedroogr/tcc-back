$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Caddyfile = Join-Path $RepoRoot 'deploy\demo\Caddyfile'
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tcc-gateway-test-" + [guid]::NewGuid().ToString('N'))
$DistPath = Join-Path $TempRoot 'dist'
$FixtureOut = Join-Path $TempRoot 'fixture.out.log'
$FixtureErr = Join-Path $TempRoot 'fixture.err.log'
$CaddyOut = Join-Path $TempRoot 'caddy.out.log'
$CaddyErr = Join-Path $TempRoot 'caddy.err.log'
$FixtureProcess = $null
$CaddyProcess = $null

function Resolve-CaddyExecutable {
    $Command = Get-Command caddy -ErrorAction SilentlyContinue
    if ($Command) { return $Command.Source }

    $PackageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $Candidate = Get-ChildItem $PackageRoot -Filter caddy.exe -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $Candidate) { throw 'Caddy nao encontrado.' }
    return $Candidate
}

function Wait-Http([string] $Url) {
    $Deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        try { return Invoke-WebRequest $Url -UseBasicParsing }
        catch { Start-Sleep -Milliseconds 100 }
    } while ([DateTime]::UtcNow -lt $Deadline)
    throw "Timeout aguardando $Url"
}

Describe 'Gateway Caddy da demonstracao' {
    BeforeAll {
        New-Item -ItemType Directory -Path $DistPath -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $DistPath 'index.html') -Value '<html>demo-index</html>' -Encoding UTF8
        Test-Path -LiteralPath $Caddyfile | Should Be $true

        $FixtureProcess = Start-Process node -ArgumentList @((Join-Path $PSScriptRoot 'gateway-fixture.js')) `
            -WorkingDirectory $RepoRoot -RedirectStandardOutput $FixtureOut -RedirectStandardError $FixtureErr `
            -WindowStyle Hidden -PassThru
        $env:TCC_FRONT_DIST = $DistPath.Replace('\', '/')
        $CaddyProcess = Start-Process (Resolve-CaddyExecutable) -ArgumentList @('run', '--config', $Caddyfile, '--adapter', 'caddyfile') `
            -WorkingDirectory $RepoRoot -RedirectStandardOutput $CaddyOut -RedirectStandardError $CaddyErr `
            -WindowStyle Hidden -PassThru
        Wait-Http 'http://127.0.0.1:8080/' | Out-Null
    }

    It 'serve o build e o fallback da SPA' {
        (Invoke-WebRequest 'http://127.0.0.1:8080/' -UseBasicParsing).Content | Should Match 'demo-index'
        (Invoke-WebRequest 'http://127.0.0.1:8080/rota-do-react' -UseBasicParsing).Content | Should Match 'demo-index'
    }

    It 'remove o prefixo da API' {
        (Invoke-RestMethod 'http://127.0.0.1:8080/api/marker').path | Should Be '/marker'
    }

    It 'preserva os caminhos de Socket.IO e pose' {
        (Invoke-RestMethod 'http://127.0.0.1:8080/socket.io/marker').path | Should Be '/socket.io/marker'
        (Invoke-RestMethod 'http://127.0.0.1:8080/v1/pose').path | Should Be '/v1/pose'
    }

    It 'roteia mesmo quando o tunnel preserva o Host publico' {
        $Headers = @{ Host = 'exemplo.trycloudflare.com' }
        (Invoke-WebRequest 'http://127.0.0.1:8080/rota-do-react' -Headers $Headers -UseBasicParsing).Content |
            Should Match 'demo-index'
        (Invoke-RestMethod 'http://127.0.0.1:8080/api/marker' -Headers $Headers).path | Should Be '/marker'
        (Invoke-RestMethod 'http://127.0.0.1:8080/v1/pose' -Headers $Headers).path | Should Be '/v1/pose'
    }

    AfterAll {
        Remove-Item Env:TCC_FRONT_DIST -ErrorAction SilentlyContinue
        foreach ($Process in @($CaddyProcess, $FixtureProcess)) {
            if ($Process -and -not $Process.HasExited) {
                Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
                $Process.WaitForExit(3000) | Out-Null
            }
        }
        if (Test-Path -LiteralPath $TempRoot) {
            Remove-Item -LiteralPath $TempRoot -Recurse -Force
        }
    }
}
