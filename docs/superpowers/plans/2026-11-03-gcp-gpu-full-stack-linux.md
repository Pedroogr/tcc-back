# GCP GPU Full-Stack Linux Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar frontend, NestJS, PostgreSQL e inferência CUDA em uma única VM T4 de São Paulo, publicados por uma única URL temporária HTTPS/WSS e sem depender do desktop.

**Architecture:** Docker Compose mantém três redes: `edge` para `cloudflared` e Caddy, `app` interna para gateway/API/worker e `data` interna para API/PostgreSQL. Um launcher Bash sobe banco, gateway e Quick Tunnel, extrai a origem pública, injeta segredos efêmeros, executa migrations/seed e só então inicia API e worker. Volumes nomeados preservam banco e uploads; nenhum serviço publica `ports`.

**Tech Stack:** Docker Engine + Compose v2, Node.js 24.22.2, NestJS 11, PostgreSQL 16.15, Caddy 2.11.7, cloudflared 2026.10.5, Python 3.10, uv 0.12.23, PyTorch 2.14.0 + CUDA 13.0, FastAPI/Uvicorn, Bash.

**Spec:** `docs/superpowers/specs/2026-11-03-gcp-gpu-full-stack-linux-design.md`

## Global Constraints

- VM alvo: Google Compute Engine `n1-standard-4`, uma NVIDIA T4, região `southamerica-east1`, Ubuntu 22.04 x86-64 e disco de no mínimo 50 GB.
- O modelo continua em `gesture-poc/yolo11s-pose.pt`, com SHA-256 `1060bda4a27012060eca246f9b2adeea22eabb045a1e58f8d229be29b7ebc2ba`.
- O worker usa Python `>=3.10,<3.11`, um processo Uvicorn, uma conexão ativa e `GESTURE_DEBUG_PREVIEW=false`.
- PyTorch/Torchvision usam `2.14.0+cu130`/`0.29.0+cu130` em Windows e Linux x86-64 por um único `uv.lock`.
- Imagens base fixadas: `node:24.22.2-bookworm-slim`, `postgres:16.15-bookworm`, `caddy:2.11.7-alpine`, `cloudflare/cloudflared:2026.10.5` e `nvidia/cuda:13.0.0-cudnn-runtime-ubuntu22.04`; nenhuma tag `latest`.
- Frontend usa somente `/api`, `/socket.io` e `/v1/pose` na origem atual; token de gesto nunca entra no bundle.
- PostgreSQL, API, worker e gateway não declaram `ports`; apenas o túnel de saída alcança o gateway.
- `FRONTEND_URL` e `GESTURE_ALLOWED_ORIGINS` recebem a origem `https://*.trycloudflare.com` exata; não usar `*`.
- Segredos não entram em Git, argumentos de processo, URL, imagem ou logs; arquivos que os contêm usam modo `0600`.
- `stop.sh` preserva volumes `postgres-data` e `uploads`; somente `reset-data.sh --confirm DELETE-DEMO-DATA` pode removê-los.
- O fluxo Windows atual permanece funcional e os scripts `.sh` são versionados com LF e bit executável.
- O smoke automático não modifica dados comerciais nem exige câmera; a jornada real fica na checklist manual.

## Review Focus

- Volume PostgreSQL existente sem a credencial persistente: `start.sh` deve falhar com recuperação explícita, nunca criar uma senha nova que o volume rejeitará; coberto na Task 4.
- Quick Tunnel sem URL, com duas URLs ou com hostname alterado: startup/status devem falhar como inválidos sem afrouxar CORS; coberto nas Tasks 4 e 6.
- Contêineres com o mesmo nome de projeto mas outro arquivo Compose: stop/reset devem recusar ownership divergente; coberto na Task 6.
- Falha depois de abrir o túnel e antes do smoke: a URL não pode ser publicada como pronta, contêineres transitórios devem parar e volumes permanecer; coberto na Task 5.
- GPU visível no host mas indisponível no worker: preflight/startup devem parar antes de publicar e indicar NVIDIA Container Toolkit; coberto nas Tasks 1, 5 e 7.

---

### Task 1: Worker CUDA reproduzível em Windows e Linux

**Files:**
- Create: `.gitattributes`
- Create: `.dockerignore`
- Create: `deploy/gcp/worker.Dockerfile`
- Modify: `gesture-server/pyproject.toml`
- Modify: `gesture-server/uv.lock`
- Modify: `gesture-server/README.md`
- Modify: `gesture-server/docs/lan-validation.md`

**Interfaces:**
- Consumes: `gesture-server/app.main:create_configured_app`, modelo e hash existentes.
- Produces: imagem `tcc-gesture-worker:test` que inicia Uvicorn em `0.0.0.0:8765` e aceita uma GPU pelo runtime NVIDIA; lock universal para Windows AMD64 e Linux x86-64.

- [ ] **Step 1: Criar o Dockerfile mínimo que exponha a incompatibilidade atual do lock**

Use `nvidia/cuda:13.0.0-cudnn-runtime-ubuntu22.04`, copie `uv` 0.12.23 da imagem oficial `ghcr.io/astral-sh/uv:0.12.23`, instale Python 3.10 e execute `uv sync --frozen --no-dev`. Copie somente `gesture-server` e `gesture-poc/yolo11s-pose.pt`; crie usuário não-root e fixe `GESTURE_MODEL_PATH=/app/gesture-poc/yolo11s-pose.pt`.

- [ ] **Step 2: Construir para confirmar a falha do lock Windows-only**

Run: `docker build -f deploy/gcp/worker.Dockerfile -t tcc-gesture-worker:test .`

Expected: FAIL porque `uv.lock` suporta apenas `sys_platform == 'win32'` ou não contém a wheel Linux de PyTorch 2.13/CPython 3.10.

- [ ] **Step 3: Tornar o projeto Python universal com o par oficial multiplataforma**

Em `pyproject.toml`, fixe `torch==2.14.0+cu130` e `torchvision==0.29.0+cu130`; declare ambientes disjuntos Windows e Linux x86-64 e `required-environments` para ambos. Regenere `uv.lock` sem atualizar as outras dependências intencionalmente.

- [ ] **Step 4: Verificar lock, testes Windows e imports Linux**

Run:

```bash
cd gesture-server
UV_CACHE_DIR=.uv-cache uv lock --check
UV_CACHE_DIR=.uv-cache uv sync --frozen
UV_CACHE_DIR=.uv-cache uv run python -m pytest -q
cd ..
docker build -f deploy/gcp/worker.Dockerfile -t tcc-gesture-worker:test .
docker run --rm tcc-gesture-worker:test python -c "import cv2, torch, torchvision, ultralytics; print(torch.__version__, torchvision.__version__)"
```

Expected: lock consistente, 54+ testes PASS, build PASS e imports imprimem `2.14.0+cu130 0.29.0+cu130`.

- [ ] **Step 5: Documentar a mudança e a regressão CUDA obrigatória**

Atualize README e validação LAN: o mesmo lock cobre Windows/Linux; antes da defesa, repetir `smoke_gpu.py` e benchmark tanto na RTX 3070 Ti quanto na T4.

- [ ] **Step 6: Commit**

```bash
git add .gitattributes .dockerignore deploy/gcp/worker.Dockerfile gesture-server
git commit -m "build: containerize gesture worker for Linux GPU"
```

### Task 2: Imagens da API e do gateway

**Files:**
- Create: `deploy/gcp/api.Dockerfile`
- Create: `deploy/gcp/gateway.Dockerfile`
- Create: `../tcc-front/.dockerignore`

**Interfaces:**
- Consumes: `npm run build`, `dist/src/main.js`, migrations/seed existentes e `tcc-front/.env.demo`.
- Produces: targets `runtime` e `tools` da API; imagem Caddy com o frontend remoto em `/srv`.

- [ ] **Step 1: Criar `api.Dockerfile` multi-stage**

O estágio `build` usa `node:24.22.2-bookworm-slim`, `npm ci`, `npx prisma generate` e `npm run build`. O target `runtime` usa `npm ci --omit=dev`, copia `dist` e `public`, cria `/app/public/uploads` pertencente ao usuário `node` e executa `node dist/src/main.js`. O target `tools` retém CLI Prisma, schema, migrations e todo o diretório `scripts` para `prisma migrate deploy`, `node scripts/demo/seed-defense-demo.js` e o smoke Socket.IO.

- [ ] **Step 2: Criar imagem de gateway com build do frontend**

O estágio Node executa `npm ci` e `npm run build:demo`; o estágio final `caddy:2.11.7-alpine` copia `dist` para `/srv`. O Caddyfile será montado somente-leitura pelo Compose, portanto não precisa estar no contexto `tcc-front`.

- [ ] **Step 3: Construir e inspecionar as imagens**

Run:

```bash
docker build --target runtime -f deploy/gcp/api.Dockerfile -t tcc-api:test .
docker build --target tools -f deploy/gcp/api.Dockerfile -t tcc-api-tools:test .
docker build -f ../tcc-back/deploy/gcp/gateway.Dockerfile -t tcc-gateway:test ../tcc-front
docker run --rm tcc-api:test node --version
docker run --rm --entrypoint sh tcc-api:test -c 'test "$(id -u)" -ne 0 && test -w /app/public/uploads && test ! -e /app/.env'
docker run --rm --entrypoint sh tcc-gesture-worker:test -c 'test ! -e /app/gesture-server/.env'
docker run --rm tcc-gateway:test caddy version
```

Expected: builds PASS, Node imprime `v24.22.2`, Caddy imprime `v2.11.7`, runtime API executa como UID não-zero e contém diretório de uploads gravável.

- [ ] **Step 4: Commit em cada repositório**

```bash
git add deploy/gcp/api.Dockerfile deploy/gcp/gateway.Dockerfile
git commit -m "build: add API and gateway container images"
git -C ../tcc-front add .dockerignore
git -C ../tcc-front commit -m "build: trim frontend Docker context"
```

### Task 3: Topologia Compose sem portas públicas

**Files:**
- Create: `deploy/gcp/compose.yaml`
- Create: `deploy/gcp/Caddyfile`
- Create: `scripts/gcp-demo/tests/fixtures/compose.env`
- Create: `scripts/gcp-demo/tests/compose-contract.test.js`
- Create: `scripts/gcp-demo/tests/gateway-fixture.js`
- Create: `scripts/gcp-demo/tests/gateway-integration.sh`
- Modify: `package.json`

**Interfaces:**
- Consumes: targets/imagens das Tasks 1–2 e variáveis dos arquivos `persistent.env`/`run.env`.
- Produces: serviços `postgres`, `migrate`, `api`, `worker`, `gateway`, `cloudflared`; redes `edge`, `app`, `data`; volumes `postgres-data`, `uploads`.

- [ ] **Step 1: Escrever o teste do contrato Compose antes do manifesto**

O teste Node executa o artefato real:

```js
const config = JSON.parse(runComposeConfig(fixtureEnv));
assert.deepEqual(Object.keys(config.services).sort(), [
  'api', 'cloudflared', 'gateway', 'migrate', 'postgres', 'worker'
]);
for (const service of Object.values(config.services)) assert.equal(service.ports, undefined);
assert.deepEqual(config.services.worker.deploy.resources.reservations.devices[0], {
  capabilities: ['gpu'], count: 1, driver: 'nvidia'
});
assert.deepEqual(Object.keys(config.volumes).sort(), ['postgres-data', 'uploads']);
```

Também valide que Postgres está só em `data`, worker só em `app`, cloudflared só em `edge`, gateway em `edge`+`app`, API em `app`+`data`, e nenhuma imagem usa `latest`.

- [ ] **Step 2: Rodar para confirmar a falha**

Run: `node --test scripts/gcp-demo/tests/compose-contract.test.js`

Expected: FAIL porque `deploy/gcp/compose.yaml` ainda não existe.

- [ ] **Step 3: Implementar Compose e Caddyfile mínimos**

Use healthchecks reais (`pg_isready`, `node fetch`, `python urllib`, `wget`). `migrate` é one-shot no profile `tools`. `worker` reserva uma GPU com `driver: nvidia`, `count: 1`, `capabilities: [gpu]`. Monte `uploads` em `/app/public/uploads`; monte `Caddyfile` como read-only; `cloudflared` executa `tunnel --no-autoupdate --url http://gateway:8080`.

O Caddyfile usa `/srv`, remove `/api`, preserva `/socket.io` e encaminha `/v1/pose` para `worker:8765`. Ele escuta `:8080` dentro da rede, sem `bind 127.0.0.1`.

- [ ] **Step 4: Fazer contrato e validação sintática passarem**

Run:

```bash
node --test scripts/gcp-demo/tests/compose-contract.test.js
docker compose --env-file scripts/gcp-demo/tests/fixtures/compose.env -f deploy/gcp/compose.yaml config --quiet
docker run --rm -v "$PWD/deploy/gcp/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.11.7-alpine caddy validate --config /etc/caddy/Caddyfile
```

Expected: PASS e nenhuma variável ausente.

- [ ] **Step 5: Testar roteamento Caddy em uma rede Docker real**

`gateway-fixture.js` ouve `0.0.0.0` nas portas 3000 e 8765 e devolve o path recebido. `gateway-integration.sh` cria uma rede temporária, executa essa fixture com aliases `api` e `worker`, sobe a imagem `tcc-gateway:test`, e usa um cliente HTTP em contêiner para afirmar os literais `/marker`, `/socket.io/marker`, `/v1/pose` e fallback `demo-index`. Cleanup por `trap` remove somente nomes gerados pelo teste.

Run: `bash scripts/gcp-demo/tests/gateway-integration.sh`

Expected: PASS para static/SPA/API/Socket.IO/pose, inclusive com `Host: exemplo.trycloudflare.com`.

- [ ] **Step 6: Adicionar comando de teste e commit**

Adicione `"gcp-demo:test": "bash scripts/gcp-demo/tests/run.sh"` quando o runner existir na Task 4; por enquanto, `gcp-demo:config` executa o teste Node.

```bash
git add deploy/gcp scripts/gcp-demo/tests package.json
git commit -m "build: define isolated GPU demo stack"
```

### Task 4: Biblioteca de runtime e smoke WSS não destrutivo

**Files:**
- Create: `scripts/gcp-demo/lib/runtime.sh`
- Create: `scripts/gcp-demo/tests/test-helper.sh`
- Create: `scripts/gcp-demo/tests/runtime.test.sh`
- Create: `scripts/gcp-demo/tests/run.sh`
- Create: `scripts/gcp-demo/socket-smoke.js`
- Create: `scripts/gcp-demo/tests/socket-smoke.test.js`
- Create: `gesture-server/scripts/public_smoke.py`
- Create: `gesture-server/tests/test_public_smoke.py`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Produces: `extract_quick_tunnel_url(lines)`, `ensure_persistent_state(state_dir, volume_exists)`, `write_run_env(path, origin)`, `compose(...)`, `assert_owned_project(...)`, `wait_http(...)`; CLI de pose recebe `--url` e `--origin`, lê `GESTURE_TOKEN` do ambiente e termina zero somente após mensagem `ready` versão 1; CLI Socket.IO recebe `--url` e termina zero somente após conexão real no path `/socket.io`.

- [ ] **Step 1: Escrever testes Bash para as falhas de estado**

Casos literais:

- uma URL em log ruidoso retorna `https://demo-123.trycloudflare.com`;
- zero ou duas URLs retornam status não-zero;
- primeira execução cria `persistent.env` modo `0600`, segunda reutiliza exatamente a senha;
- `volume_exists=true` sem `persistent.env` falha sem criar arquivo;
- `write_run_env` rejeita HTTP, paths e hosts fora de `*.trycloudflare.com`;
- ownership divergente entre labels Compose e caminho esperado é recusado.

- [ ] **Step 2: Escrever teste Python com servidor WebSocket real**

Suba `websockets.serve` em porta efêmera, receba `hello`, afirme token/protocolo literais e responda `ready`. O cliente deve passar; respostas `error`, versão diferente e token ausente devem falhar sem imprimir o token.

Adicione também um teste Node com servidor Socket.IO real em porta efêmera. `socket-smoke.js` deve conectar usando transportes `websocket,polling`, path `/socket.io`, encerrar limpo e falhar por timeout em uma porta sem servidor.

- [ ] **Step 3: Rodar para confirmar falhas**

Run:

```bash
bash scripts/gcp-demo/tests/runtime.test.sh
node --test scripts/gcp-demo/tests/socket-smoke.test.js
cd gesture-server && uv run python -m pytest tests/test_public_smoke.py -q
```

Expected: FAIL por funções/scripts ausentes.

- [ ] **Step 4: Implementar biblioteca e cliente mínimos**

Use `set -euo pipefail`, escrita atômica por `mktemp`+`mv`, `umask 077`, `openssl rand` para segredos e `jq` apenas para saída estruturada do Docker. Nenhuma função recebe segredo por argumento de processo; `public_smoke.py` lê `GESTURE_TOKEN` e remove detalhes sensíveis de erros. `socket-smoke.js` não autentica nem modifica salas: comprova somente transporte e upgrade pela origem pública.

- [ ] **Step 5: Criar runner e integrar package scripts**

`run.sh` executa `bash -n`, testes Bash, teste Node do Compose e pytest do smoke. Atualize `.gitignore` com `/.runtime/` e `.uv-cache-plan/`; force LF em `.gitattributes`; adicione scripts `gcp-demo:test`, `gcp-demo:start`, `gcp-demo:status`, `gcp-demo:stop` e `gcp-demo:reset`.

Run: `npm run gcp-demo:test`

Expected: todos PASS sem Docker daemon para a parte unitária; `gateway-integration.sh` permanece um gate explícito separado.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .gitattributes package.json scripts/gcp-demo gesture-server
git update-index --chmod=+x scripts/gcp-demo/tests/*.sh
git commit -m "test: add safe cloud demo runtime primitives"
```

### Task 5: Inicialização em duas fases

**Files:**
- Create: `scripts/gcp-demo/lib/startup.sh`
- Create: `scripts/gcp-demo/start.sh`
- Create: `scripts/gcp-demo/tests/startup.test.sh`
- Modify: `scripts/gcp-demo/tests/run.sh`

**Interfaces:**
- Consumes: biblioteca Task 4 e serviços Task 3.
- Produces: `start.sh` idempotente quanto a estado persistente, mas recusa duas execuções ativas; publica URL/senha demo/token somente após smoke completo.

- [ ] **Step 1: Escrever testes de transição usando funções reais e executáveis externos falsos no PATH**

Cubra:

- preflight sem `nvidia-smi`, Compose ou repositório irmão falha antes de criar runtime;
- execução ativa recusa segundo start;
- falha de migration impede `api`/`worker` e não chama `publish_summary`;
- falha do smoke chama cleanup uma vez, sem `--volumes`;
- URL válida atualiza `FRONTEND_URL` e `GESTURE_ALLOWED_ORIGINS` com o mesmo literal;
- sucesso chama, em ordem, `preflight,build,phase1,url,migrate,phase2,smoke,publish`.

- [ ] **Step 2: Rodar e observar falha**

Run: `bash scripts/gcp-demo/tests/startup.test.sh`

Expected: FAIL porque `startup.sh`/`start.sh` ainda não existem.

- [ ] **Step 3: Implementar o fluxo de startup**

Sequência exata:

1. validar Bash, Docker/Compose, curl, jq, openssl, `nvidia-smi`, runtime NVIDIA, dois repositórios e modelo/hash;
2. verificar ausência de execução ativa e ownership do projeto fixo `tcc-gpu-demo`;
3. criar/reusar `persistent.env`; gerar `run.env` temporário com JWT, token e senha demo, ainda sem origem válida;
4. construir imagens;
5. subir `postgres gateway cloudflared`;
6. esperar Postgres saudável e extrair exatamente uma URL em até 60 s;
7. gravar `PUBLIC_ORIGIN`, `FRONTEND_URL` e `GESTURE_ALLOWED_ORIGINS` atomicamente;
8. `docker compose run --rm migrate` para migration+seed;
9. subir `api worker`, aguardar healthchecks e confirmar `torch.cuda.is_available()` dentro do worker;
10. validar DNS, `GET /`, `GET /api/auctions/public`, conexão real com `socket-smoke.js` e `public_smoke.py` por WSS;
11. gravar manifesto sem segredos e publicar URL, contas demo, senha demo e token no terminal uma vez.

Um `trap` antes da publicação executa `docker compose down --remove-orphans` sem volumes. Depois de pronto, o trap não derruba o ambiente.

- [ ] **Step 4: Passar os testes e análise de shell**

Run:

```bash
bash -n scripts/gcp-demo/start.sh scripts/gcp-demo/lib/startup.sh
bash scripts/gcp-demo/tests/startup.test.sh
shellcheck scripts/gcp-demo/start.sh scripts/gcp-demo/lib/*.sh
```

Expected: PASS; nenhum segredo aparece na saída capturada pelos testes.

- [ ] **Step 5: Commit**

```bash
git add scripts/gcp-demo
git update-index --chmod=+x scripts/gcp-demo/start.sh scripts/gcp-demo/tests/*.sh
git commit -m "feat: orchestrate two-phase GPU demo startup"
```

### Task 6: Status, parada segura e reset explícito

**Files:**
- Create: `scripts/gcp-demo/status.sh`
- Create: `scripts/gcp-demo/stop.sh`
- Create: `scripts/gcp-demo/reset-data.sh`
- Create: `scripts/gcp-demo/tests/lifecycle.test.sh`
- Modify: `scripts/gcp-demo/tests/run.sh`

**Interfaces:**
- Consumes: manifesto não secreto, labels Compose, URL anunciada pelo cloudflared e arquivos de estado.
- Produces: status `ready|degraded|invalid`; stop restrito ao projeto; reset destrutivo somente com confirmação literal.

- [ ] **Step 1: Escrever testes de lifecycle antes dos scripts**

Afirme comportamentos observáveis:

- `status.sh` nunca imprime valores de `GESTURE_TOKEN`, `JWT_SECRET`, `POSTGRES_PASSWORD` ou `DEMO_PASSWORD` presentes no ambiente;
- hostname dos logs diferente do manifesto retorna `invalid`;
- `stop.sh` com labels estrangeiros sai não-zero e não chama `docker compose down`;
- `stop.sh` válido chama `down --remove-orphans`, nunca `--volumes`;
- `reset-data.sh` recusa ausência/erro na confirmação e execução ativa;
- confirmação exata chama `down --volumes`, remove ambos os volumes e só depois apaga credencial/manifesto.

- [ ] **Step 2: Rodar para confirmar falha**

Run: `bash scripts/gcp-demo/tests/lifecycle.test.sh`

Expected: FAIL por scripts ausentes.

- [ ] **Step 3: Implementar scripts mínimos**

`status.sh` combina `docker compose ps --format json`, health dentro de API/worker, site público e URL dos logs. `stop.sh` valida labels `com.docker.compose.project` e `com.docker.compose.project.config_files`. `reset-data.sh --confirm DELETE-DEMO-DATA` exige stack parada, executa remoção de volumes e trata estado órfão de forma explícita.

- [ ] **Step 4: Verificar lifecycle completo**

Run:

```bash
npm run gcp-demo:test
bash scripts/gcp-demo/tests/lifecycle.test.sh
```

Expected: PASS, incluindo mutação que adiciona `--volumes` ao stop (o teste deve falhar nessa mutação).

- [ ] **Step 5: Commit**

```bash
git add scripts/gcp-demo package.json
git update-index --chmod=+x scripts/gcp-demo/status.sh scripts/gcp-demo/stop.sh scripts/gcp-demo/reset-data.sh
git commit -m "feat: manage cloud demo lifecycle safely"
```

### Task 7: Wizard de preparação e runbook operacional

**Files:**
- Create: `scripts/gcp-demo/prepare-host.sh`
- Create: `docs/runbooks/gcp-gpu-demo.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-03-gcp-gpu-full-stack-linux-design.md`

**Interfaces:**
- Consumes: VM Ubuntu 22.04 criada pelo usuário e os scripts anteriores.
- Produces: wizard repetível de seis estágios e runbook completo de criar, preparar, iniciar, medir, parar stack e parar VM.

- [ ] **Step 1: Copiar sem alterações a biblioteca de `wizard/template.sh`**

Não reescreva nem edite a seção acima do marcador `STAGES`. O wizard terá seis estágios, sem capturar segredos:

1. confirmar VM `n1-standard-4` + T4 + Ubuntu 22.04 + disco >=50 GB, Secure Boot desativado, sem regras HTTP/HTTPS, IPv4 efêmero, OS Login e SSH somente pelo IAP;
2. detectar/instalar driver NVIDIA pelo instalador oficial do Compute Engine e orientar reboot/reexecução;
3. detectar/instalar Docker Engine e Compose v2 pelo repositório oficial;
4. detectar/instalar NVIDIA Container Toolkit, executar `nvidia-ctk runtime configure --runtime=docker` e reiniciar Docker após confirmação;
5. validar `tcc-back`/`tcc-front` irmãos e permissões do usuário no grupo Docker;
6. executar `nvidia-smi`, contêiner CUDA com `nvidia-smi`, `docker compose config` e mostrar próximos comandos.

- [ ] **Step 2: Escrever runbook com caminhos exatos do Console e comandos**

Inclua capacidade versus cota, escolha entre `southamerica-east1-a/b/c`, firewall IAP `35.235.240.0/20` somente `tcp:22`, Secure Boot desativado para simplificar a instalação do driver, clonagem dos repositórios irmãos e referências oficiais:

- Google GPU drivers: `https://cloud.google.com/compute/docs/gpus/install-drivers-gpu`
- Docker Ubuntu: `https://docs.docker.com/engine/install/ubuntu/`
- NVIDIA Container Toolkit: `https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html`
- Compose GPU: `https://docs.docker.com/compose/how-tos/gpu-support/`
- Cloudflare Quick Tunnel: `https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/`

Documente também que `stop.sh` não para cobrança; depois dele, o usuário deve parar a VM no Console. A checklist manual cobre login, câmera, gesto, Socket.IO, evento comercial e benchmark de dois minutos após 30 s de aquecimento. Registre que mídia WebRTC ainda pode falhar em redes que exigem TURN, mesmo com sinalização Socket.IO saudável.

- [ ] **Step 3: Verificar wizard sem executá-lo ponta a ponta**

Run:

```bash
bash -n scripts/gcp-demo/prepare-host.sh
shellcheck scripts/gcp-demo/prepare-host.sh
```

Expected: sintaxe/shellcheck PASS. Faça a inspeção estática exigida pela skill: seis estágios na ordem documentada, cada ação privilegiada com confirmação e cada estágio idempotente. Não execute o wizard, pois ele abre URLs, instala pacotes e aguarda o usuário.

- [ ] **Step 4: Rodar regressão completa local**

Run:

```bash
npm test -- --runInBand
npm run lint
npm run build
npm run gcp-demo:test
cd gesture-server && uv run python -m pytest -q && uv lock --check
cd ../../tcc-front && npm run test:unit && npm run lint && npm run build:demo
```

Expected: todas as suítes e builds PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/gcp-demo/prepare-host.sh docs/runbooks README.md docs/superpowers/specs/2026-11-03-gcp-gpu-full-stack-linux-design.md
git update-index --chmod=+x scripts/gcp-demo/prepare-host.sh
git commit -m "docs: add GCP GPU demo runbook"
```

### Task 8: Validação ponta a ponta na T4

**Files:**
- Modify: `docs/runbooks/gcp-gpu-demo.md` somente se a execução real revelar correções operacionais.
- Modify: `gesture-server/docs/lan-validation.md` para registrar métricas agregadas da T4, sem imagens ou segredos.

**Interfaces:**
- Consumes: VM preparada, commits das Tasks 1–7 e rede externa de teste.
- Produces: evidência de GPU, smoke público, jornada manual e benchmark comparável aos 6 FPS.

- [ ] **Step 1: Preparar a VM com o wizard**

Run: `bash scripts/gcp-demo/prepare-host.sh`

Expected: Docker/Compose e runtime NVIDIA prontos; `docker run --rm --gpus all nvidia/cuda:13.0.0-base-ubuntu22.04 nvidia-smi` mostra uma T4.

- [ ] **Step 2: Iniciar a stack e confirmar status**

Run:

```bash
bash scripts/gcp-demo/start.sh
bash scripts/gcp-demo/status.sh
```

Expected: `ready`, uma URL HTTPS, todos os healthchecks verdes e worker com `torch.cuda.is_available() == true`.

- [ ] **Step 3: Executar checklist manual por outra rede**

Abra a URL fora da rede da VM; faça login com as contas demo; valide frontend, REST, Socket.IO, câmera, token, reconhecimento do gesto e persistência de um evento no banco demo. Não use dados reais.

- [ ] **Step 4: Medir desempenho**

Após 30 s de aquecimento, grave pelo menos dois minutos de métricas agregadas: FPS efetivo, RTT, inferência, end-to-end p50/p95 e descarte. Compare explicitamente com 6 FPS; `p95 <= 250 ms` é alvo, não gate do launcher. Resultado `<= 6 FPS` exige diagnóstico antes da defesa.

- [ ] **Step 5: Validar encerramento e persistência**

Run:

```bash
bash scripts/gcp-demo/stop.sh
bash scripts/gcp-demo/start.sh
```

Expected: URL antiga inválida, URL nova/origens novas, mesmo volume PostgreSQL e mesmos uploads, segredos efêmeros novos. Depois do teste final: `stop.sh` e parar a VM no Console do GCP.

- [ ] **Step 6: Registrar somente resultados agregados e commit final**

```bash
git add docs/runbooks/gcp-gpu-demo.md gesture-server/docs/lan-validation.md
git commit -m "docs: record T4 deployment validation"
```
