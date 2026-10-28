# Demonstração pública temporária com Quick Tunnel

Este roteiro permite que a banca use somente um navegador, inclusive em outra
rede. O desktop executa o sistema, o banco isolado e a inferência CUDA. O Caddy
serve o frontend e encaminha API, Socket.IO e WebSocket de poses; o
`cloudflared` publica uma URL HTTPS temporária.

Isso **não é deploy**. Quick Tunnel é voltado a testes, não possui garantia de
disponibilidade e cria um hostname novo a cada execução. A URL deixa de atender
quando `cloudflared` é encerrado. O token e a senha demo também mudam a cada
início.

## Preparação antecipada

No Windows, abra PowerShell no `tcc-back` e mantenha Docker Desktop e o driver
NVIDIA disponíveis:

```powershell
npm install
npm run demo:prepare -- --InstallMissing
```

O segundo comando verifica Node/npm, Docker, `uv`, Pester, modelo, CUDA, Caddy e
`cloudflared`. A flag permite instalar **somente** Caddy e `cloudflared` via
Winget. Docker, Node, Python, driver e CUDA nunca são instalados implicitamente.

Portas locais necessárias: `3000`, `5435`, `8080` e `8765`. Elas permanecem
presas ao loopback, exceto conexões de saída feitas pelo túnel.

## Ensaio e apresentação

Para exibir no desktop o quadro que chega ao worker:

```powershell
npm run demo:start -- -EnableMonitor
```

Sem o monitor, use `npm run demo:start`. O comando só mostra os acessos depois
de validar banco, builds, site público, API pública e um frame sintético pelo
WebSocket público. A propagação DNS do hostname pode levar alguns minutos.

Ao final serão mostrados:

- `URL`: abrir no navegador da banca;
- `Token`: colar na tela de transmissão de gestos; também fica na área de
  transferência do desktop;
- contas `escritorio.demo@tcc.local` e `comprador.demo@tcc.local`;
- uma senha efêmera compartilhada pelas duas contas;
- diretório temporário dos logs desta execução.

O token não vai no endereço, manifesto ou logs. Não fotografe nem versione o
token, a senha ou o hostname real. O banco usado é
`cattle_auction_demo` em `127.0.0.1:5435`; o banco normal não é alterado.

### Teste por 4G/5G

1. Desative o Wi-Fi do celular ou use um notebook em outra rede.
2. Abra a URL recém-impressa e entre com uma das contas demo.
3. Na estação de gestos, cole o token e autorize a câmera.
4. Confirme no monitor do desktop as caixas, pontos, esqueleto e tempos.
5. Confirme na estação o estado de conexão e a resposta de mão levantada.
6. Use somente uma estação de gestos por vez nesta versão.

O smoke automático prova o caminho público, mas não substitui esse ensaio de
câmera, usabilidade e rede móvel antes da defesa.

## Estado, diagnóstico e encerramento

```powershell
npm run demo:status
npm run demo:stop
```

`status` informa URL, estado e PIDs próprios sem revelar token ou senha. `stop`
encerra somente processos cujo PID e horário de início coincidem com o
manifesto, para o `postgres-demo` e preserva o volume `pgdata-demo`. Depois, a
URL anterior deve retornar erro e as quatro portas devem ficar livres.

Se algo falhar:

- antes dos builds: confira a dependência indicada por `demo:prepare`;
- em `5435`: pare uma execução demo anterior com `demo:stop`;
- no túnel: aguarde DNS; Quick Tunnel pode exigir uma nova execução;
- em `/api`: confira o log do NestJS e o estado do PostgreSQL demo;
- em `/v1/pose`: confira CUDA/modelo e o log do worker;
- no navegador: confirme que foi usado o token da execução atual.

Os logs ficam em `%TEMP%\tcc-defense-demo\<execução>`. Eles podem conter
hostname e métricas, mas não devem conter token, senha ou frames.

## Voltar ao desenvolvimento local

Execute `npm run demo:stop`, suba backend e frontend pelos comandos habituais e
use o `.env` local, não `.env.demo`. O modo local de inferência do navegador
continua explícito; não há fallback silencioso durante uma rodada.

O Quick Tunnel resolve o acesso clientless da demonstração. Ele não substitui
o WireGuard planejado para uma instalação privada nem um deploy estável. TURN
para vídeo WebRTC em redes restritivas permanece uma decisão separada e
pendente.

