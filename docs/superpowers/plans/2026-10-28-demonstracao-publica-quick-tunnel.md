# Demonstração Pública com Quick Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar temporariamente, por uma única URL HTTPS do Cloudflare Quick Tunnel, o frontend, a API, o Socket.IO e o worker CUDA que continuam executando no desktop Windows.

**Architecture:** Um Caddy local em `127.0.0.1:8080` serve o build React e encaminha `/api`, `/socket.io` e `/v1/pose` para serviços locais. Um iniciador PowerShell prepara um banco de demonstração isolado, sobe os processos, descobre o hostname aleatório do `cloudflared`, inicia o worker com `Origin` exato e só divulga URL/token após um smoke público completo.

**Tech Stack:** React/Vite/TypeScript/Vitest, NestJS/Prisma/PostgreSQL/Jest, FastAPI/Uvicorn/PyTorch, Caddy 2.11.7+, cloudflared 2026.10.5+, PowerShell 5.1+/Pester 3.4+, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-28-demonstracao-publica-quick-tunnel-design.md`

## Global Constraints

- A solução é demonstração temporária, não deploy nem disponibilidade de produção.
- Nenhuma porta de entrada será aberta no roteador; `3000`, `5435`, `8080` e `8765` ficam em loopback.
- A banca instala somente um navegador; Caddy e `cloudflared` existem apenas no desktop.
- O token do worker não pode aparecer em URL, QR Code, bundle, argumento de processo ou log.
- O worker continua com protocolo versão `1`, uma estação ativa e um processo Uvicorn.
- A URL muda a cada nova execução; caminhos públicos do frontend devem ser relativos à origem atual.
- Banco e volume de demonstração são separados e nunca apagam ou alteram o banco habitual.
- Queda remota interrompe explicitamente a estação; não há fallback silencioso para inferência local.
- Frames, poses e snapshots contínuos continuam efêmeros.
- TURN e garantia de mídia WebRTC entre NATs ficam fora deste plano.
- Alterações já existentes e não relacionadas em `tcc-back` pertencem ao usuário e não entram nos commits.

## Review Focus

- URL relativa `/api` não pode virar namespace Socket.IO `/api`; Task 1 fixa isso em teste unitário.
- Hostname aleatório deve produzir `wss://<host>/v1/pose` e `Origin` exato; Tasks 1, 5 e 6 cobrem resolução, parsing e inicialização.
- Porta ocupada ou processo preexistente deve abortar sem matar trabalho do usuário; Tasks 5 e 6 testam propriedade por PID e horário de início.
- Falha no meio da inicialização não pode deixar processos órfãos nem registrar segredos; Tasks 5 e 6 cobrem cleanup e redação.
- Roteamento incorreto de SPA, REST ou upgrades WebSocket deve falhar antes da apresentação; Tasks 4 e 6 cobrem o gateway local e o smoke público autenticado.

---

### Task 1: Tornar os clientes do frontend independentes do hostname

**Files:**
- Create: `../tcc-front/.env.demo`
- Create: `../tcc-front/tests/unit/http.spec.ts`
- Create: `../tcc-front/tests/unit/socket.spec.ts`
- Modify: `../tcc-front/package.json`
- Modify: `../tcc-front/src/api/http.ts`
- Modify: `../tcc-front/src/api/socket.ts`
- Modify: `../tcc-front/src/gesture/gesture-server-settings.ts`
- Modify: `../tcc-front/tests/unit/gesture-server-settings.spec.ts`

**Interfaces:**
- Produces: `resolveSocketServerUrl(apiBase: string, browserOrigin: string): string` em `src/api/socket.ts`.
- Produces: `resolveGestureServerUrl(rawUrl: string, location: Pick<Location, 'protocol' | 'host'>): string` em `src/gesture/gesture-server-settings.ts`.
- Preserva: URLs absolutas LAN (`ws://...`) e API absoluta (`http://localhost:3000`).
- Build de demonstração: `npm run build:demo`, com `VITE_API_URL=/api`, modo `remote` e `VITE_GESTURE_SERVER_URL=/v1/pose`.

- [ ] **Step 1: Escrever testes que fixem API relativa, Socket.IO na origem e WSS derivado**

```ts
it('keeps relative REST under /api but connects Socket.IO to the browser origin', () => {
  expect(resolveSocketServerUrl('/api', 'https://demo.trycloudflare.com'))
    .toBe('https://demo.trycloudflare.com');
});

it.each([
  ['https:', 'demo.trycloudflare.com', 'wss://demo.trycloudflare.com/v1/pose'],
  ['http:', 'localhost:5173', 'ws://localhost:5173/v1/pose'],
])('resolves a relative pose endpoint', (protocol, host, expected) => {
  expect(resolveGestureServerUrl('/v1/pose', { protocol, host })).toBe(expected);
});
```

Também testar que `ws://192.168.15.6:8765/v1/pose` permanece inalterado, URL relativa sem `/` é rejeitada e token continua apenas no `sessionStorage`.

- [ ] **Step 2: Executar os testes e confirmar falha**

Run: `cd ../tcc-front; npm run test:unit -- tests/unit/http.spec.ts tests/unit/socket.spec.ts tests/unit/gesture-server-settings.spec.ts`

Expected: FAIL porque os resolvers ainda não existem e `/v1/pose` não é convertido para WebSocket absoluto.

- [ ] **Step 3: Implementar os resolvers e usá-los nos clientes existentes**

`apiRequest` continua concatenando a base `/api` com caminhos REST. `createStreamSocket` e `createCommerceSocket` usam `resolveSocketServerUrl(apiUrl, window.location.origin)`, mantendo `path: '/socket.io'`. `readGestureServerSettings` resolve o endpoint relativo usando a localização injetável, sem ler `window` em testes.

- [ ] **Step 4: Adicionar `.env.demo` e `build:demo`**

Valores exatos:

```env
VITE_API_URL=/api
VITE_GESTURE_INFERENCE_MODE=remote
VITE_GESTURE_SERVER_URL=/v1/pose
```

- [ ] **Step 5: Executar testes, build e regressão de desconexão explícita**

Run: `cd ../tcc-front; npm run test:unit -- tests/unit/http.spec.ts tests/unit/socket.spec.ts tests/unit/gesture-server-settings.spec.ts tests/unit/remote-pose-estimator.spec.ts tests/unit/pose-estimator-factory.spec.ts`

Expected: PASS; o teste existente de fechamento remoto continua retornando erro, sem criar estimador local.

Run: `cd ../tcc-front; npm run build:demo`

Expected: PASS e `dist/index.html` criado.

- [ ] **Step 6: Commit no repositório frontend**

```bash
cd ../tcc-front
git add .env.demo package.json src/api/http.ts src/api/socket.ts src/gesture/gesture-server-settings.ts tests/unit/http.spec.ts tests/unit/socket.spec.ts tests/unit/gesture-server-settings.spec.ts
git commit -m "feat: support same-origin public demo endpoints"
```

### Task 2: Restringir a API de demonstração ao loopback

**Files:**
- Create: `src/runtime/listen-config.ts`
- Create: `src/runtime/listen-config.spec.ts`
- Modify: `src/main.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `readListenConfig(environment: NodeJS.ProcessEnv): { port: number; host?: string }`.
- Preserva: sem `HOST`, o Nest mantém o comportamento atual e usa porta `3000`.
- Demo: `HOST=127.0.0.1`, `PORT=3000`.

- [ ] **Step 1: Escrever testes de configuração**

```ts
expect(readListenConfig({})).toEqual({ port: 3000 });
expect(readListenConfig({ PORT: '3100', HOST: '127.0.0.1' }))
  .toEqual({ port: 3100, host: '127.0.0.1' });
expect(() => readListenConfig({ PORT: 'invalid' })).toThrow('PORT');
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `npm test -- --runInBand src/runtime/listen-config.spec.ts`

Expected: FAIL porque o módulo ainda não existe.

- [ ] **Step 3: Implementar configuração e aplicá-la em `main.ts`**

Chamar `app.listen(port, host)` quando `host` existir e `app.listen(port)` quando não existir. Documentar `HOST` opcional em `.env.example` sem mudar o padrão local.

- [ ] **Step 4: Executar teste e build**

Run: `npm test -- --runInBand src/runtime/listen-config.spec.ts && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit somente dos arquivos desta tarefa**

```bash
git add .env.example src/main.ts src/runtime/listen-config.ts src/runtime/listen-config.spec.ts
git commit -m "feat: allow loopback-only API binding"
```

### Task 3: Criar banco e dados determinísticos de demonstração

**Files:**
- Create: `scripts/demo/demo-data.js`
- Create: `scripts/demo/seed-defense-demo.js`
- Create: `scripts/demo/tests/demo-data.test.js`
- Modify: `docker-compose.yml`
- Modify: `package.json`

**Interfaces:**
- Produces: `DEMO_IDS`, `buildDemoRecords(passwordHash: string)` e `seedDefenseDemo(prisma: PrismaClient, password: string): Promise<DemoSummary>`.
- `DemoSummary`: `{ auctionHouseEmail: string; buyerEmail: string; auctionId: string; lotId: string }`.
- Entradas obrigatórias: `DATABASE_URL` apontando para `cattle_auction_demo` e `DEMO_PASSWORD` não vazio.
- Serviço Compose: `postgres-demo`, banco `cattle_auction_demo`, porta `127.0.0.1:5435:5432`, volume `pgdata-demo`.

- [ ] **Step 1: Escrever testes Node para determinismo e idempotência lógica**

```js
test('buildDemoRecords uses stable ids and never includes the plain password', () => {
  const records = buildDemoRecords('bcrypt-hash');
  assert.equal(records.auctionHouse.id, DEMO_IDS.auctionHouse);
  assert.equal(records.auction.status, 'LIVE');
  assert.doesNotMatch(JSON.stringify(records), /senha-temporaria/);
});
```

Usar Prisma falso para afirmar `upsert` de leiloeira ativa, comprador aprovado, inscrição aprovada, leilão `LIVE`, configurações, stream `WAITING` e lote `IN_AUCTION`, sempre com IDs fixos e sem `deleteMany`.

- [ ] **Step 2: Executar e confirmar falha**

Run: `node --test scripts/demo/tests/demo-data.test.js`

Expected: FAIL porque o módulo ainda não existe.

- [ ] **Step 3: Implementar seed e runner**

Usar `bcryptjs.hash(password, 10)`, transação Prisma e `upsert`. Emails fixos: `escritorio.demo@tcc.local` e `comprador.demo@tcc.local`. O runner encerra sem imprimir senha ou `DATABASE_URL`.

- [ ] **Step 4: Adicionar serviço isolado e comandos npm**

Adicionar `demo:seed` para executar o runner após `prisma migrate deploy`. Não alterar serviço, porta ou volume `postgres` existentes.

- [ ] **Step 5: Validar em banco isolado real duas vezes**

Run:

```powershell
docker compose up -d postgres-demo
$env:DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5435/cattle_auction_demo'
$env:DEMO_PASSWORD='senha-de-teste-nao-usada-na-defesa'
npx prisma migrate deploy
npm run demo:seed
npm run demo:seed
```

Expected: as duas execuções terminam com o mesmo `auctionId`/`lotId`, sem duplicatas e sem tocar o container `tcc-back` normal.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml package.json scripts/demo/demo-data.js scripts/demo/seed-defense-demo.js scripts/demo/tests/demo-data.test.js
git commit -m "feat: add isolated defense demo data"
```

### Task 4: Adicionar o gateway Caddy e provar seu roteamento

**Files:**
- Create: `deploy/demo/Caddyfile`
- Create: `scripts/demo/tests/gateway-fixture.js`
- Create: `scripts/demo/tests/Gateway.Tests.ps1`

**Interfaces:**
- Consumes: build `../tcc-front/dist` da Task 1.
- Consumes: NestJS em `127.0.0.1:3000` e worker em `127.0.0.1:8765`.
- Produces: gateway em `127.0.0.1:8080`.
- Variável: `TCC_FRONT_DIST` contém caminho absoluto do build.
- Contrato de rotas: `/api/*` remove `/api`; `/socket.io/*` e `/v1/pose` preservam caminho; demais rotas servem arquivo ou `index.html`.

- [ ] **Step 1: Escrever fixture e testes de rota antes do Caddyfile**

O fixture Node abre stubs HTTP em portas reservadas pelo teste. O Pester cria um `dist` temporário e afirma:

```powershell
(Invoke-WebRequest "$Gateway/").Content | Should -Match 'demo-index'
(Invoke-WebRequest "$Gateway/rota-do-react").Content | Should -Match 'demo-index'
(Invoke-RestMethod "$Gateway/api/marker").path | Should -Be '/marker'
(Invoke-RestMethod "$Gateway/socket.io/marker").path | Should -Be '/socket.io/marker'
(Invoke-RestMethod "$Gateway/v1/pose").path | Should -Be '/v1/pose'
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/demo/tests/Gateway.Tests.ps1 -EnableExit"`

Expected: FAIL porque `deploy/demo/Caddyfile` ainda não existe.

- [ ] **Step 3: Criar o Caddyfile mínimo**

Desligar admin API e auto-HTTPS locais, escutar `127.0.0.1:8080`, definir `handle` exclusivos na ordem do contrato e usar `try_files {path} /index.html` no fallback estático. Não configurar logs de corpo.

- [ ] **Step 4: Validar configuração e rotas**

Run: `$env:TCC_FRONT_DIST=(Resolve-Path ..\tcc-front\dist); caddy validate --config deploy/demo/Caddyfile --adapter caddyfile`

Expected: `Valid configuration`.

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/demo/tests/Gateway.Tests.ps1 -EnableExit"`

Expected: PASS e nenhum processo fixture/Caddy permanece após o teste.

- [ ] **Step 5: Commit**

```bash
git add deploy/demo/Caddyfile scripts/demo/tests/gateway-fixture.js scripts/demo/tests/Gateway.Tests.ps1
git commit -m "feat: add local demo gateway"
```

### Task 5: Implementar primitivas seguras do iniciador

**Files:**
- Create: `scripts/demo/DemoRuntime.psm1`
- Create: `scripts/demo/tests/DemoRuntime.Tests.ps1`

**Interfaces:**
- Produces: `Get-QuickTunnelUrl -Lines string[] -> [uri]`.
- Produces: `Assert-DemoPortsAvailable -Ports int[] -> void`.
- Produces: `New-DemoRunDirectory -BasePath string -> DemoRun`.
- Produces: `Write-DemoManifest -Path string -Manifest hashtable -> void` e `Read-DemoManifest`.
- Produces: `Start-DemoProcess -Name string -FilePath string -ArgumentList string[] -WorkingDirectory string -StdoutPath string -StderrPath string -> ProcessRecord`.
- Produces: `Stop-OwnedDemoProcess -Record ProcessRecord -> bool`.
- `ProcessRecord`: nome, PID, horário UTC de início, executável e caminhos de log; nunca ambiente ou argumentos secretos.

- [ ] **Step 1: Escrever testes Pester para parsing, portas, manifesto e propriedade**

Cobrir URL em linha de log ruidosa, ausência/duplicidade de `trycloudflare.com`, porta ocupada, manifesto JSON inválido, PID reutilizado com horário divergente e processo legítimo. Mockar `Stop-Process` e afirmar que só o último caso o chama.

- [ ] **Step 2: Executar e confirmar falha**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/demo/tests/DemoRuntime.Tests.ps1 -EnableExit"`

Expected: FAIL porque o módulo não existe.

- [ ] **Step 3: Implementar o módulo sem comandos amplos**

Logs ficam em `%TEMP%\tcc-defense-demo\<timestamp>-<nonce>`. `Start-DemoProcess` usa `Start-Process -WindowStyle Hidden -PassThru` e redireciona streams; segredos entram apenas por ambiente herdado e são removidos do processo pai após o spawn. `Stop-OwnedDemoProcess` valida PID e horário antes de encerrar.

- [ ] **Step 4: Executar testes e procurar vazamento de campos secretos**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/demo/tests/DemoRuntime.Tests.ps1 -EnableExit"`

Expected: PASS.

Run: `rg -n "GESTURE_TOKEN|DEMO_PASSWORD|JWT_SECRET" scripts/demo -g "*.log" -g "*.json"`

Expected: nenhuma ocorrência em fixtures de manifesto/log.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo/DemoRuntime.psm1 scripts/demo/tests/DemoRuntime.Tests.ps1
git commit -m "feat: add safe demo process runtime"
```

### Task 6: Orquestrar preparação, início, status e encerramento

**Files:**
- Create: `scripts/prepare-defense-demo.ps1`
- Create: `scripts/start-defense-demo.ps1`
- Create: `scripts/status-defense-demo.ps1`
- Create: `scripts/stop-defense-demo.ps1`
- Create: `scripts/demo/tests/DefenseDemoScripts.Tests.ps1`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 1–5 e `gesture-server/scripts/benchmark_client.py`.
- `prepare-defense-demo.ps1 [-InstallMissing]` valida Node/npm, Docker, `uv`, modelo/CUDA, Pester, Caddy e `cloudflared`; instalações opcionais usam IDs Winget `CaddyServer.Caddy` e `Cloudflare.cloudflared`.
- `start-defense-demo.ps1 [-EnableMonitor]` produz URL pública, token, credenciais demo, manifesto e diretório de logs.
- `status-defense-demo.ps1` retorna estado redigido e nunca o token.
- `stop-defense-demo.ps1` para somente PIDs validados no manifesto; o PostgreSQL demo é parado sem remover volume.

- [ ] **Step 1: Escrever testes com ferramentas falsas**

Criar executáveis/stubs em diretório temporário e testar:

- preparação sem dependência falha antes de instalar quando `-InstallMissing` não foi usado;
- URL não aparece até todos os smokes passarem;
- falha após iniciar Caddy executa cleanup dos PIDs próprios;
- token não aparece em manifesto, status ou logs;
- porta ocupada aborta sem chamar `Stop-Process`;
- `stop` recusa manifesto stale e preserva volume `pgdata-demo`.

- [ ] **Step 2: Executar e confirmar falha**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/demo/tests/DefenseDemoScripts.Tests.ps1 -EnableExit"`

Expected: FAIL porque os comandos ainda não existem.

- [ ] **Step 3: Implementar preparação sem mutação implícita**

Sem `-InstallMissing`, apenas verificar e imprimir instruções. Com a flag, chamar Winget somente para Caddy/cloudflared ausentes. Nunca instalar Docker, Node, `uv`, driver ou CUDA automaticamente.

- [ ] **Step 4: Implementar a sequência de início**

Ordem obrigatória:

1. validar portas `3000`, `5435`, `8080`, `8765` e pré-requisitos;
2. `docker compose up -d postgres-demo` e aguardar readiness;
3. definir `DATABASE_URL` demo, executar migrations e seed com senha aleatória;
4. `npm run build:demo` no frontend e `npm run build` no backend;
5. iniciar NestJS com `HOST=127.0.0.1`, segredo JWT efêmero e banco demo;
6. iniciar Caddy com `TCC_FRONT_DIST` absoluto;
7. iniciar `cloudflared tunnel --url http://127.0.0.1:8080`, capturar URL;
8. gerar token com `secrets.token_urlsafe(32)` e iniciar Uvicorn em `127.0.0.1:8765`, um worker, `GESTURE_ALLOWED_ORIGINS` igual à URL e preview conforme flag;
9. aguardar `/health` local pronto;
10. validar publicamente `/`, `/api/auctions/public` e um frame sintético pelo benchmark em `wss://<host>/v1/pose` com `Origin` exato;
11. somente então copiar token e imprimir URL, token e credenciais demo.

- [ ] **Step 5: Implementar status, parada e cleanup de falha**

`status` compara manifesto com PID/horário e testa endpoints sem revelar segredo. `stop` encerra worker, túnel, Caddy e NestJS na ordem inversa, depois executa `docker compose stop postgres-demo`. Qualquer exceção do `start` chama o mesmo cleanup em `finally`.

- [ ] **Step 6: Executar testes dos scripts**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/demo/tests/DefenseDemoScripts.Tests.ps1 -EnableExit"`

Expected: PASS.

- [ ] **Step 7: Adicionar atalhos npm e commit**

Adicionar `demo:prepare`, `demo:start`, `demo:status` e `demo:stop` chamando PowerShell com `-NoProfile -ExecutionPolicy Bypass -File`.

```bash
git add package.json scripts/prepare-defense-demo.ps1 scripts/start-defense-demo.ps1 scripts/status-defense-demo.ps1 scripts/stop-defense-demo.ps1 scripts/demo/tests/DefenseDemoScripts.Tests.ps1
git commit -m "feat: orchestrate temporary public defense demo"
```

### Task 7: Documentar, validar externamente e registrar evidências

**Files:**
- Create: `docs/demo-quick-tunnel.md`
- Modify: `gesture-server/README.md`
- Modify: `docs/monografia/notas-de-processo-e-decisoes-do-tcc.md`

**Interfaces:**
- Consumes: comandos finais da Task 6.
- Produces: runbook de preparação, ensaio, apresentação, encerramento e contingência.

- [ ] **Step 1: Escrever o runbook com linguagem operacional**

Incluir pré-requisitos, comandos exatos, significado de cada URL/credencial, como testar por 4G, como reconhecer indisponibilidade de API/GPU/túnel, como encerrar e como voltar ao modo local. Destacar que Quick Tunnel não é deploy e que URL/token mudam a cada execução.

- [ ] **Step 2: Atualizar documentação do worker e diário da monografia**

Registrar a substituição temporária do WireGuard pelo Quick Tunnel apenas para demonstração clientless, o papel do Caddy, as limitações, os critérios de validação e que TURN permanece pendente.

- [ ] **Step 3: Rodar todas as suítes proporcionais ao risco**

Run no frontend:

```powershell
npm run test:unit
npm run build:demo
```

Run no backend:

```powershell
npm test -- --runInBand
node --test scripts/demo/tests/demo-data.test.js
powershell -NoProfile -Command "Invoke-Pester scripts/demo/tests -EnableExit"
npm run build
```

Run no worker:

```powershell
uv run pytest -q
```

Expected: todas as suítes passam; registrar contagens e duração no diário sem tokens.

- [ ] **Step 4: Executar ensaio externo completo**

Executar `npm run demo:start -- -EnableMonitor`, abrir a URL em dispositivo usando 4G/5G, entrar com conta demo, informar o token, autorizar câmera e confirmar monitor/poses. Registrar URL apenas como `<trycloudflare-host>`, RTT/FPS/p50/p95 e comportamento de segunda estação, nunca o token ou frames.

- [ ] **Step 5: Confirmar encerramento e repetibilidade**

Executar `npm run demo:stop`; a URL anterior deve ficar indisponível. Repetir `demo:start`; deve gerar hostname e token novos sem duplicar dados e sem tocar o banco normal.

- [ ] **Step 6: Commit de documentação e evidências redigidas**

```bash
git add docs/demo-quick-tunnel.md gesture-server/README.md docs/monografia/notas-de-processo-e-decisoes-do-tcc.md
git commit -m "docs: add temporary public demo runbook"
```

## Self-Review

- **Spec coverage:** frontend relativo, gateway, banco isolado, origem/token, scripts seguros, smokes público/local, documentação, encerramento e limitações WebRTC estão atribuídos às Tasks 1–7.
- **Step scan:** cada etapa produz teste, implementação, verificação ou commit observável; instalação e runtime não foram misturados.
- **Type consistency:** `resolveSocketServerUrl`, `resolveGestureServerUrl`, `DemoSummary` e `ProcessRecord` mantêm os mesmos nomes entre tarefas.
- **Review Focus:** os cinco riscos possuem testes explícitos nas Tasks 1, 4, 5 e 6.
- **Proportion:** detalhes algorítmicos ficaram para o executor; o plano fixa apenas contratos, ordem sensível e evidências exigidas.

