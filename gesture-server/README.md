# Gesture Server

Serviço privado de inferência de pose executado no desktop com GPU. O serviço
não acessa o banco, não registra lances e não persiste imagens.

## Desenvolvimento

```powershell
uv sync
uv run pytest -q
```

Para iniciar o processo de produção com exatamente um worker:

```powershell
$env:GESTURE_TOKEN = "<segredo-da-sessao>"
uv run uvicorn app.main:create_configured_app --factory --host 0.0.0.0 --port 8765 --workers 1
```

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
- `GESTURE_JPEG_QUALITY`: padrão `80`.

Não versione arquivos `.env`, tokens, chaves WireGuard ou endereços públicos.

## Benchmark LAN

O cliente de benchmark aceita vídeo, imagem ou diretório de imagens e não persiste frames nem respostas:

```powershell
$env:GESTURE_BENCHMARK_TOKEN = Read-Host "Token efêmero"
uv run --script scripts/benchmark_client.py --url ws://IP_DO_DESKTOP:8765/v1/pose --origin http://localhost:5173 --input C:\caminho\ensaio.mp4 --max-frames 300
```

O procedimento completo, incluindo firewall privado, três rodadas controladas e a comparação local/remota, está em [docs/lan-validation.md](docs/lan-validation.md).
