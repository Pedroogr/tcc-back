# Gesture Server

Serviço privado de inferência de pose executado no desktop com GPU. O serviço
não acessa o banco, não registra lances e não persiste imagens.

## Desenvolvimento

```powershell
uv sync
uv run pytest -q
```

O `uv.lock` é único para os ambientes suportados do worker: Windows AMD64 e
Linux x86_64, ambos com Python 3.10. Ele fixa PyTorch `2.14.0+cu130` e
torchvision `0.29.0+cu130`; depois de alterar dependências, valide as duas
plataformas antes de versionar o lock:

```powershell
uv lock --check
uv run python -c "import torch, torchvision; print(torch.__version__, torchvision.__version__)"
```

No Linux, a imagem de produção executa a mesma verificação sem depender do
Python do host:

```bash
docker build -f deploy/gcp/worker.Dockerfile -t tcc-gesture-worker:test .
docker run --rm tcc-gesture-worker:test python -c \
  "import cv2, torch, torchvision, ultralytics; print(torch.__version__, torchvision.__version__)"
```

Para iniciar o processo de produção com exatamente um worker:

```powershell
$env:GESTURE_TOKEN = "<segredo-da-sessao>"
uv run uvicorn app.main:create_configured_app --factory --host 0.0.0.0 --port 8765 --workers 1
```

Para acompanhar no desktop os quadros recebidos durante um teste funcional,
ative o monitor local antes de iniciar o servidor:

```powershell
$env:GESTURE_DEBUG_PREVIEW = "true"
```

A janela mostra o JPEG recebido com caixas, confiança, pontos e esqueleto de
pose. O painel exibe resolução, tamanho do JPEG, quantidade de poses, frames
processados, FPS do servidor, modelo, GPU e os tempos de decode, preprocess,
inferência, postprocess e total. Nenhuma imagem é salva. Pressione `Q` para
fechá-la até o próximo reinício do servidor. Deixe essa opção desativada durante
benchmarks, pois desenhar e apresentar os quadros pode alterar os tempos
observados.

## Configuração

Todas as variáveis pertencem ao prefixo `GESTURE_`:

- `GESTURE_TOKEN`: obrigatório e nunca retornado pela API;
- `GESTURE_MODEL_PATH`: padrão `../gesture-poc/yolo11s-pose.pt`;
- `GESTURE_MODEL_SHA256`: padrão fixado ao modelo validado;
- `GESTURE_CUDA_DEVICE`: padrão `0`;
- `GESTURE_ALLOWED_ORIGINS`: lista separada por vírgulas;
- `GESTURE_MAX_JPEG_BYTES`: padrão `524288`;
- `GESTURE_HELLO_TIMEOUT_SECONDS`: padrão `5`;
- `GESTURE_PROTOCOL_VERSION`: padrão `1`;
- `GESTURE_CAPTURE_MAX_WIDTH`: padrão `640`;
- `GESTURE_JPEG_QUALITY`: padrão `80`;
- `GESTURE_DEBUG_PREVIEW`: padrão `false`; aceita somente `true` ou `false`.

Não versione arquivos `.env`, tokens, chaves WireGuard ou endereços públicos.

## Benchmark LAN

O cliente de benchmark aceita vídeo, imagem ou diretório de imagens e não persiste frames nem respostas:

```powershell
$env:GESTURE_BENCHMARK_TOKEN = Read-Host "Token efêmero"
uv run --script scripts/benchmark_client.py --url ws://IP_DO_DESKTOP:8765/v1/pose --origin http://localhost:5173 --input C:\caminho\ensaio.mp4 --max-frames 300
```

O procedimento completo, incluindo firewall privado, três rodadas controladas e a comparação local/remota, está em [docs/lan-validation.md](docs/lan-validation.md).

Ao comparar a RTX local com uma T4 na nuvem, execute primeiro
`scripts/smoke_gpu.py` e depois três rodadas de `scripts/benchmark_client.py`
com o mesmo vídeo, resolução, qualidade JPEG e quantidade de frames. Registre
separadamente GPU, driver, versão do PyTorch e os percentis de rede e servidor;
não compare apenas o FPS informado pela câmera.

## Demonstração pública temporária

Para a defesa clientless, o projeto raiz oferece um orquestrador que mantém o
worker em `127.0.0.1:8765` e publica somente o gateway Caddy por um Quick Tunnel:

```powershell
cd ..
npm run demo:prepare -- --InstallMissing
npm run demo:start -- -EnableMonitor
npm run demo:status
npm run demo:stop
```

O iniciador define `GESTURE_ALLOWED_ORIGINS` com o hostname exato da execução e
passa o token somente pelo ambiente herdado. URL, token e credenciais mudam a
cada início; token e senha não são persistidos no manifesto. O smoke usa
`wss://<hostname>/v1/pose` antes de divulgar o acesso.

Consulte [o runbook da demonstração](../docs/demo-quick-tunnel.md) para o teste
por 4G/5G, diagnóstico, encerramento e limitações. Quick Tunnel é temporário e
não substitui deploy, WireGuard ou a futura avaliação de TURN.
