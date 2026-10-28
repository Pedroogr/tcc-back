$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$PrepareScript = Join-Path $RepoRoot 'scripts\prepare-defense-demo.ps1'
$StartScript = Join-Path $RepoRoot 'scripts\start-defense-demo.ps1'
$StatusScript = Join-Path $RepoRoot 'scripts\status-defense-demo.ps1'
$StopScript = Join-Path $RepoRoot 'scripts\stop-defense-demo.ps1'

Describe 'Scripts da demonstracao publica' {
    It 'fornece os quatro comandos operacionais' {
        Test-Path $PrepareScript | Should Be $true
        Test-Path $StartScript | Should Be $true
        Test-Path $StatusScript | Should Be $true
        Test-Path $StopScript | Should Be $true
    }

    It 'preparacao sem InstallMissing falha sem tentar instalar' {
        $OldPath = $env:PATH
        $EmptyPath = Join-Path ([System.IO.Path]::GetTempPath()) ("tcc-empty-path-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $EmptyPath | Out-Null
        try {
            $env:PATH = $EmptyPath
            { & $PrepareScript } | Should Throw
        } finally {
            $env:PATH = $OldPath
            Remove-Item $EmptyPath -Recurse -Force
        }
    }

    It 'so publica os acessos depois do smoke e limpa em falha' {
        . $StartScript
        $Events = New-Object System.Collections.ArrayList
        Complete-DemoStartup `
            -Smoke { [void] $Events.Add('smoke') } `
            -Publish { [void] $Events.Add('publish') } `
            -Cleanup { [void] $Events.Add('cleanup') }
        ($Events -join ',') | Should Be 'smoke,publish'

        $Events.Clear()
        { Complete-DemoStartup `
            -Smoke { [void] $Events.Add('smoke'); throw 'smoke falhou' } `
            -Publish { [void] $Events.Add('publish') } `
            -Cleanup { [void] $Events.Add('cleanup') } } | Should Throw
        ($Events -join ',') | Should Be 'smoke,cleanup'
    }

    It 'porta ocupada aborta sem encerrar processo algum' {
        . $StartScript
        Mock Stop-Process { throw 'nao deveria encerrar' }
        $Listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
        $Listener.Start()
        try {
            $Port = ([System.Net.IPEndPoint] $Listener.LocalEndpoint).Port
            { Invoke-DemoPortPreflight -Ports @($Port) } | Should Throw
            Assert-MockCalled Stop-Process -Times 0
        } finally {
            $Listener.Stop()
        }
    }

    It 'aceita mensagem informativa em stderr quando o comando nativo retorna zero' {
        . $StartScript
        $TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tcc-native-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $TempRoot | Out-Null
        $CommandPath = Join-Path $TempRoot 'info.cmd'
        $LogPath = Join-Path $TempRoot 'info.log'
        Set-Content -LiteralPath $CommandPath -Value @('@echo off', 'echo informativo 1>&2', 'exit /b 0') -Encoding ASCII
        try {
            { Invoke-DemoLoggedCommand -FilePath $CommandPath -ArgumentList @() -WorkingDirectory $TempRoot -LogPath $LogPath } |
                Should Not Throw
            (Get-Content $LogPath -Raw) | Should Match 'informativo'
        } finally { Remove-Item $TempRoot -Recurse -Force }
    }

    It 'executa cleanup no maximo uma vez' {
        . $StartScript
        Mock Stop-DemoStartup { }
        $State = @{ Cleaned = $false }
        Invoke-DemoCleanupOnce -State $State -Processes @() -StopDatabase
        Invoke-DemoCleanupOnce -State $State -Processes @() -StopDatabase
        Assert-MockCalled Stop-DemoStartup -Times 1
    }

    It 'registra o processo que realmente possui a porta do worker' {
        . $StartScript
        $Listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
        $Listener.Start()
        try {
            $Port = ([System.Net.IPEndPoint] $Listener.LocalEndpoint).Port
            $Record = Get-DemoListenerProcessRecord -Name 'listener-fixture' -Port $Port `
                -StdoutPath 'out.log' -StderrPath 'err.log'
            $Record.Pid | Should Be $PID
            $Record.StartTimeUtcTicks | Should Be (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks
        } finally { $Listener.Stop() }
    }

    It 'aguarda a propagacao DNS do hostname do tunnel' {
        . $StartScript
        $script:DnsAttempts = 0
        Mock Start-Sleep { }
        Mock Resolve-DnsName {
            $script:DnsAttempts += 1
            if ($script:DnsAttempts -lt 3) { throw 'ainda nao propagou' }
            [pscustomobject]@{ IPAddress = '192.0.2.1' }
        }
        { Wait-DemoDns -HostName 'demo.trycloudflare.com' -TimeoutSeconds 5 } | Should Not Throw
        Assert-MockCalled Resolve-DnsName -Times 3
    }

    It 'status nao revela token presente no ambiente' {
        $TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tcc-status-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $TempRoot | Out-Null
        $ManifestPath = Join-Path $TempRoot 'manifest.json'
        '{"RunId":"test","State":"ready","PublicUrl":"https://demo.trycloudflare.com","Processes":[]}' |
            Set-Content -LiteralPath $ManifestPath
        $env:GESTURE_TOKEN = 'token-que-nao-pode-aparecer'
        try {
            $Output = (& $StatusScript -ManifestPath $ManifestPath | Out-String)
            $Output | Should Not Match 'token-que-nao-pode-aparecer'
            $Output | Should Match 'ready'
        } finally {
            Remove-Item Env:GESTURE_TOKEN -ErrorAction SilentlyContinue
            Remove-Item $TempRoot -Recurse -Force
        }
    }

    It 'stop recusa registro stale e para apenas o servico sem remover volume' {
        $TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tcc-stop-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $TempRoot | Out-Null
        $ManifestPath = Join-Path $TempRoot 'manifest.json'
        $Current = Get-Process -Id $PID
        $Manifest = @{
            RunId = 'test'; State = 'ready'; RepoRoot = $RepoRoot
            Processes = @(@{
                Name = 'stale'; Pid = $PID
                StartTimeUtcTicks = $Current.StartTime.ToUniversalTime().Ticks + 1
                Executable = $Current.Path; StdoutPath = ''; StderrPath = ''
            })
        } | ConvertTo-Json -Depth 5
        Set-Content -LiteralPath $ManifestPath -Value $Manifest
        $global:DockerArguments = $null
        function global:docker { $global:DockerArguments = @($args); $global:LASTEXITCODE = 0 }
        try {
            & $StopScript -ManifestPath $ManifestPath
            (Get-Process -Id $PID -ErrorAction SilentlyContinue) | Should Not BeNullOrEmpty
            ($global:DockerArguments -join ' ') | Should Be 'compose stop postgres-demo'
            ($global:DockerArguments -join ' ') | Should Not Match 'down|volume|pgdata-demo'
        } finally {
            Remove-Item Function:\global:docker -ErrorAction SilentlyContinue
            Remove-Item $TempRoot -Recurse -Force
        }
    }
}
