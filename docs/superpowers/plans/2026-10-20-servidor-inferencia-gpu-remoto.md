# Servidor remoto de inferência de gestos — Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um serviço privado de inferência YOLO Pose na RTX 3070 Ti e permitir que a estação de gestos escolha explicitamente entre inferência remota e local, mantendo o tracker e a decisão humana existentes.

**Architecture:** Um processo FastAPI/Uvicorn carrega `yolo11s-pose.pt` uma vez na GPU e atende uma estação por WebSocket autenticado. O frontend comprime frames em JPEG, mantém uma única requisição em voo e converte a resposta para o contrato atual de poses. NestJS e PostgreSQL permanecem responsáveis somente pelo domínio do leilão.

**Tech Stack:** Python 3.10, FastAPI, Uvicorn, PyTorch CUDA, Ultralytics, Pillow/OpenCV, pytest; React 19, TypeScript, Vite, Vitest e WebSocket nativo.

**Spec:** `../specs/2026-10-20-servidor-inferencia-gpu-remoto-design.md`

## Global Constraints

- Implementar testes antes do código de cada comportamento.
- Não persistir JPEG, pose ou vídeo e não registrar tokens em logs.
- Não alterar regras de lance, tracker ou relay ao operador sem um plano próprio.
- Executar Uvicorn com exatamente um worker.
- Manter o FastAPI inacessível pela Internet pública; WireGuard será configurado somente depois da validação em LAN.
- Usar um `PoseEngine` injetável nos testes; a suíte comum não pode depender de câmera ou GPU.
- Manter no máximo uma inferência em voo no cliente e uma no servidor.
- Preservar alterações não relacionadas que já existam nos dois worktrees.

## Review Focus

1. JPEG malformado, curto, vazio ou maior que o limite não pode derrubar o processo.
2. Token, versão de protocolo ou origem inválidos devem falhar sem vazar segredos.
3. Desconexão, `dispose` e reconexão não podem entregar resultados de uma geração anterior.
4. Segunda estação e pressão de entrada não podem criar uma fila crescente nem disputa silenciosa da GPU.
5. CUDA, modelo ou hash indisponíveis devem manter o serviço não pronto e produzir diagnóstico seguro.

---

## Subprojeto A — Serviço Python validável sem GPU

### Task 1: Criar o pacote, configuração e health check

**Files:**

- Create: `gesture-server/pyproject.toml`
- Create: `gesture-server/uv.lock`
- Create: `gesture-server/README.md`
- Create: `gesture-server/app/__init__.py`
- Create: `gesture-server/app/config.py`
- Create: `gesture-server/app/main.py`
- Create: `gesture-server/tests/test_config.py`
- Create: `gesture-server/tests/test_health.py`
- Modify: `.gitignore`

- [x] Escrever testes para token ausente, modelo ausente, hash divergente e configuração válida.
- [x] Escrever teste de `GET /health`: `503` quando o engine não está pronto e `200` com metadados públicos quando está pronto.
- [x] Executar `uv run pytest tests/test_config.py tests/test_health.py -q` e confirmar falha pelo pacote ainda inexistente.
- [x] Implementar `GestureSettings` lendo apenas variáveis `GESTURE_*`, incluindo caminho, hash, dispositivo, token, origens, limite de 512 KiB, timeout de 5 s e protocolo 1.
- [x] Criar `create_app(engine, settings)` e resposta de health sem caminho local, token ou stack trace.
- [x] Adicionar `.venv`, caches Python, relatórios e arquivos `.env` do subprojeto ao `.gitignore`.
- [x] Executar os testes novamente e confirmar sucesso.
- [x] Executar `uv lock` para produzir `gesture-server/uv.lock` reprodutível.
- [x] Commit: `feat: scaffold GPU inference service`

### Task 2: Definir e testar o protocolo puro

**Files:**

- Create: `gesture-server/app/protocol.py`
- Create: `gesture-server/tests/test_protocol.py`

- [x] Escrever testes para `hello` válido, versão incompatível, payload que não é JSON e campos extras/ausentes.
- [x] Escrever testes para frame binário com menos de 5 bytes, `frameId` uint32 big-endian, JPEG vazio e limite excedido.
- [x] Escrever teste de serialização de `ready`, `pose` e erro estável, verificando que `frameId`, poses e tempos são preservados.
- [x] Executar `uv run pytest tests/test_protocol.py -q` e confirmar falha.
- [x] Implementar tipos imutáveis para metadata, keypoint, box, pose, tempos e resultado.
- [x] Implementar parsing separado de autenticação e frame; nenhuma função pura deve conhecer FastAPI.
- [x] Executar `uv run pytest tests/test_protocol.py -q` e depois `uv run pytest -q`.
- [x] Commit: `feat: define pose websocket protocol`

## Subprojeto B — Inferência CUDA isolada

### Task 3: Implementar a porta e o mapeamento do motor de pose

**Files:**

- Create: `gesture-server/app/inference.py`
- Create: `gesture-server/app/smoke_gpu.py`
- Create: `gesture-server/tests/test_inference.py`
- Modify: `gesture-server/app/main.py`
- Modify: `gesture-server/pyproject.toml`

- [x] Criar um resultado Ultralytics mínimo e determinístico em teste, sem importar modelo real.
- [x] Testar confiança, box em pixels, `normalizedBox`, 17 keypoints COCO e tempos não negativos.
- [x] Testar JPEG inválido, imagem com dimensão zero, resultado sem pessoas e falha segura de inferência.
- [x] Testar verificação do SHA-256 antes da carga e indisponibilidade de CUDA.
- [x] Executar `uv run pytest tests/test_inference.py -q` e confirmar falha.
- [x] Definir a interface `PoseEngine`, `ModelMetadata` e uma fábrica de produção.
- [x] Implementar `CudaYoloPoseEngine`: carregar uma vez, usar `device=0`, `imgsz=640`, FP16, lock único e relógio monotônico.
- [x] Sincronizar CUDA ao medir inferência, sem forçar a suíte determinística a ter PyTorch/CUDA.
- [x] Conectar a carga ao lifespan do FastAPI; falha de pré-condição deixa `/health` em `503`.
- [x] Executar `uv run pytest tests/test_inference.py -q` e `uv run pytest -q`.
- [x] Executar smoke manual no desktop com `uv run python -m app.smoke_gpu`, confirmando GPU, modelo e uma inferência.
- [x] Commit: `feat: add CUDA YOLO pose engine`

## Subprojeto C — Sessão WebSocket e controle de carga

### Task 4: Autenticar e limitar a sessão

**Files:**

- Create: `gesture-server/app/session.py`
- Create: `gesture-server/tests/test_websocket.py`
- Modify: `gesture-server/app/main.py`

- [x] Criar fake engine bloqueável para controlar início e término de inferências nos testes.
- [x] Testar origem permitida, timeout do `hello`, token incorreto, versão incorreta e resposta `ready`.
- [x] Testar frame válido e resposta `pose` com o mesmo `frameId`.
- [x] Testar JPEG inválido e grande demais como erro recuperável sem fechar o servidor.
- [x] Testar que uma segunda estação autenticada recebe indisponibilidade enquanto a primeira está ativa.
- [x] Testar desconexão durante inferência e liberação do slot para uma nova estação.
- [x] Executar `uv run pytest tests/test_websocket.py -q` e confirmar falha.
- [x] Implementar comparação de token em tempo constante, allowlist de `Origin` e códigos de fechamento estáveis.
- [x] Implementar gerenciador de estação única e lock de inferência; não criar fila interna de frames.
- [x] Garantir que logs tragam somente evento, duração, bytes e códigos técnicos.
- [x] Executar `uv run pytest -q`.
- [x] Iniciar com `uv run uvicorn app.main:create_configured_app --factory --host 0.0.0.0 --port 8765 --workers 1` e validar `/health` na LAN.
- [x] Commit: `feat: serve authenticated pose websocket`

## Subprojeto D — Adaptador remoto no frontend

### Task 5: Criar o codec e o cliente WebSocket testáveis

**Files:**

- Create: `src/gesture/remote-pose-protocol.ts`
- Create: `src/gesture/remote-pose-protocol.test.ts`
- Create: `src/gesture/remote-pose-estimator.ts`
- Create: `src/gesture/remote-pose-estimator.test.ts`
- Modify: `src/gesture/pose-estimator.ts`

- [x] Extrair uma interface `PoseEstimatorPort` com `start`, `detect` e `dispose`; fazer o estimador local implementá-la sem mudar seu comportamento.
- [x] Escrever testes do frame binário: quatro bytes big-endian, JPEG restante e wrap de uint32.
- [x] Escrever testes de validação das mensagens `ready`, `pose` e `error`, rejeitando versão e campos inválidos.
- [x] Executar `npm run test:unit -- remote-pose-protocol` e confirmar falha.
- [x] Implementar codec sem dependência de React.
- [x] Escrever fake de WebSocket e testes de handshake, token na primeira mensagem, timeout, detecção e mapeamento para `PoseDetectionFrame`.
- [x] Testar uma requisição em voo, substituição pelo frame pendente mais novo, resposta antiga, desconexão e `dispose` idempotente.
- [x] Executar `npm run test:unit -- remote-pose-estimator` e confirmar falha.
- [x] Implementar compressão de `ImageBitmap` em JPEG via canvas injetável/testável e fechar bitmaps em todos os caminhos.
- [x] Implementar geração de conexão; mensagens de conexão antiga não podem resolver promises atuais.
- [x] Executar `npm run test:unit -- remote-pose-protocol remote-pose-estimator` e `npm run build`.
- [x] Commit: `feat: add remote pose estimator`

### Task 6: Integrar a escolha explícita na estação

**Files:**

- Create: `src/gesture/pose-estimator-factory.ts`
- Create: `src/gesture/pose-estimator-factory.test.ts`
- Create: `src/gesture/gesture-server-settings.ts`
- Create: `src/gesture/gesture-server-settings.test.ts`
- Modify: `src/gesture/use-gesture-station.ts`
- Modify: `src/gesture/GestureStationApp.tsx`
- Modify: `src/gesture/pose-types.ts`
- Modify: `.env.example`

- [ ] Definir modo e URL não secretos em `.env.example`; receber o token em um campo `password` da estação e mantê-lo somente no `sessionStorage`, nunca no bundle ou no Git.
- [ ] Testar leitura, atualização e limpeza da configuração de sessão sem retornar o token em mensagens, estado de telemetria ou logs.
- [ ] Testar a factory para `local` e `remote` e erro em configuração incompleta.
- [ ] Testar labels `remote-cuda`, `webgpu` e `wasm`.
- [ ] Testar falha remota antes do início com opção manual de modo local.
- [ ] Testar queda durante rodada: parar captura, limpar pendências, manter tracker sem novo evento e mostrar erro; não alternar automaticamente.
- [ ] Executar os testes direcionados e confirmar falha antes da implementação.
- [ ] Injetar a factory na estação e preservar o tracker, snapshot e relay existentes.
- [ ] Exibir modo, conectividade, RTT, inferência e FPS efetivo sem mostrar token ou URL sensível.
- [ ] Executar `npm run test:unit`, `npm run lint` e `npm run build`.
- [ ] Commit: `feat: select local or remote gesture inference`

## Subprojeto E — Integração e evidência experimental

### Task 7: Validar ponta a ponta na LAN

**Files:**

- Create: `gesture-server/scripts/benchmark_client.py`
- Create: `gesture-server/tests/test_benchmark_metrics.py`
- Create: `gesture-server/docs/lan-validation.md`
- Modify: `gesture-server/README.md`

- [ ] Escrever testes das agregações p50, p95, FPS, descarte e bytes antes do script.
- [ ] Implementar cliente de benchmark com vídeo/frames fornecidos, sem persistir respostas ou imagens por padrão.
- [ ] Documentar preparação do desktop, variáveis, firewall de perfil privado, execução com um worker e verificação pelo notebook.
- [ ] Medir captura, compressão, RTT, decode, preprocess, inferência, postprocess, tracker e apresentação.
- [ ] Executar ao menos três rodadas controladas, registrar hardware, versões, tamanho da amostra e resultados.
- [ ] Confirmar que desconectar o serviço interrompe a estação sem criar lance ou fallback automático.
- [ ] Comparar o mesmo vídeo em `local` e `remote`, registrando precisão observada e desempenho sem inferir conclusão além da amostra.
- [ ] Executar todas as suítes dos dois projetos e registrar comandos/resultados no documento.
- [ ] Commit: `test: validate remote inference over LAN`

### Task 8: Preparar o runbook da etapa WireGuard

**Files:**

- Create: `gesture-server/docs/wireguard-runbook.md`
- Modify: `gesture-server/README.md`
- Modify: `docs/monografia/notas-de-processo-e-decisoes-do-tcc.md`

- [ ] Documentar pré-condições: acesso administrativo ao roteador, confirmação de IPv4/CGNAT, backup da configuração e teste LAN aprovado.
- [ ] Definir endereços privados do túnel, porta UDP, rotação de chaves, regra de firewall e allowlist sem versionar chaves, token ou IP público.
- [ ] Documentar DDNS como etapa condicional e Tailscale/NetBird/ZeroTier somente como contingência.
- [ ] Incluir testes de fora da rede: health privado, handshake válido/inválido, queda, reconexão, jitter e p95 ponta a ponta.
- [ ] Incluir procedimento de rollback que remova somente a regra específica de encaminhamento e preserve o modo roteador.
- [ ] Revisar o runbook com o usuário antes de qualquer alteração no roteador.
- [ ] Após execução humana, anexar resultados anonimizados ao diário da monografia.
- [ ] Commit: `docs: add private GPU deployment runbook`

## Final Verification

- [ ] No backend: `uv run pytest -q` dentro de `gesture-server`.
- [ ] No frontend: `npm run test:unit`, `npm run lint` e `npm run build`.
- [ ] Smoke GPU real confirma CUDA, nome e hash do modelo.
- [ ] Teste LAN confirma uma estação, descarte do frame antigo e ausência de fila crescente.
- [ ] Revisão de logs confirma ausência de token, JPEG, IP público e dados comerciais.
- [ ] Benchmark registra p50/p95 ponta a ponta e separa claramente resultados LAN e WireGuard.
- [ ] `git status` nos dois repositórios contém apenas mudanças esperadas antes de cada commit.
