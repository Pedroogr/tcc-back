$ErrorActionPreference = 'Stop'
$ModulePath = Join-Path $PSScriptRoot '..\DemoRuntime.psm1'

Describe 'DemoRuntime' {
    It 'existe antes dos testes de comportamento' {
        Test-Path -LiteralPath $ModulePath | Should Be $true
    }

    Context 'URL do Quick Tunnel' {
        BeforeEach { Import-Module $ModulePath -Force }

        It 'extrai uma URL unica de log ruidoso' {
            $Url = Get-QuickTunnelUrl -Lines @(
                '2026-10-28 INF iniciando conexao',
                '2026-10-28 INF + https://demo-123.trycloudflare.com pronto'
            )
            $Url.AbsoluteUri | Should Be 'https://demo-123.trycloudflare.com/'
        }

        It 'rejeita log sem URL' {
            { Get-QuickTunnelUrl -Lines @('sem tunnel ainda') } | Should Throw
        }

        It 'rejeita URLs diferentes no mesmo log' {
            { Get-QuickTunnelUrl -Lines @(
                'https://um.trycloudflare.com',
                'https://dois.trycloudflare.com'
            ) } | Should Throw
        }
    }

    Context 'portas locais' {
        BeforeEach { Import-Module $ModulePath -Force }

        It 'aceita uma porta livre' {
            { Assert-DemoPortsAvailable -Ports @(59171) } | Should Not Throw
        }

        It 'rejeita uma porta ocupada' {
            $Listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
            $Listener.Start()
            try {
                $Port = ([System.Net.IPEndPoint] $Listener.LocalEndpoint).Port
                { Assert-DemoPortsAvailable -Ports @($Port) } | Should Throw
            } finally {
                $Listener.Stop()
            }
        }
    }

    Context 'diretorio e manifesto' {
        BeforeEach {
            Import-Module $ModulePath -Force
            $script:TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tcc-runtime-test-" + [guid]::NewGuid().ToString('N'))
        }
        AfterEach { if (Test-Path $script:TempRoot) { Remove-Item $script:TempRoot -Recurse -Force } }

        It 'cria uma execucao dentro da base informada' {
            $Run = New-DemoRunDirectory -BasePath $script:TempRoot
            Test-Path $Run.Directory | Should Be $true
            $Run.ManifestPath | Should Be (Join-Path $Run.Directory 'manifest.json')
        }

        It 'grava e le um manifesto sem segredos' {
            $Path = Join-Path $script:TempRoot 'manifest.json'
            Write-DemoManifest -Path $Path -Manifest @{ RunId = 'abc'; Processes = @() }
            (Read-DemoManifest -Path $Path).RunId | Should Be 'abc'
            (Get-Content $Path -Raw) | Should Not Match 'GESTURE_TOKEN|DEMO_PASSWORD|JWT_SECRET'
        }

        It 'rejeita JSON invalido' {
            New-Item -ItemType Directory -Path $script:TempRoot -Force | Out-Null
            $Path = Join-Path $script:TempRoot 'manifest.json'
            Set-Content -LiteralPath $Path -Value '{invalido'
            { Read-DemoManifest -Path $Path } | Should Throw
        }
    }

    Context 'propriedade de processo' {
        BeforeEach { Import-Module $ModulePath -Force }

        It 'nao encerra PID inexistente ou reutilizado e encerra somente o processo proprio' {
            InModuleScope DemoRuntime {
                $ExpectedStart = [datetime]'2026-10-28T10:00:00Z'
                $Record = [pscustomobject]@{
                    Name = 'fixture'; Pid = 4242
                    StartTimeUtcTicks = $ExpectedStart.ToUniversalTime().Ticks
                    Executable = 'C:\tools\fixture.exe'
                    StdoutPath = 'out.log'; StderrPath = 'err.log'
                }

                Mock Stop-Process { }
                Mock Get-Process { throw 'nao existe' }
                (Stop-OwnedDemoProcess -Record $Record) | Should Be $false
                Assert-MockCalled Stop-Process -Times 0

                Mock Get-Process { [pscustomobject]@{ Id = 4242; StartTime = $ExpectedStart.AddMinutes(1); Path = 'C:\tools\fixture.exe' } }
                (Stop-OwnedDemoProcess -Record $Record) | Should Be $false
                Assert-MockCalled Stop-Process -Times 0

                Mock Get-Process { [pscustomobject]@{ Id = 4242; StartTime = $ExpectedStart; Path = 'C:\tools\fixture.exe' } }
                (Stop-OwnedDemoProcess -Record $Record) | Should Be $true
                Assert-MockCalled Stop-Process -Times 1 -ParameterFilter { $Id -eq 4242 }
            }
        }
    }
}
