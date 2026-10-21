# Validação da inferência remota na LAN

Este roteiro produz evidência reproduzível sem salvar frames, poses ou o token. A etapa LAN valida primeiro o transporte e a GPU; a jornada completa da estação exige também o frontend, a API NestJS e suas dependências normais em execução, mas não exige um deploy público.

## Pré-condições

- Desktop e notebook na mesma rede local confiável.
- Perfil de rede do Windows do desktop definido como `Private`.
- Desktop com RTX 3070 Ti, driver NVIDIA funcional e modelo cujo SHA-256 corresponde à configuração.
- Mesmo arquivo de vídeo de teste disponível para todas as rodadas. Não versionar gravações com pessoas sem consentimento.
- Python 3.10 e `uv` no desktop; apenas `uv` é necessário para o cliente isolado no notebook.
- Porta `8765/TCP` fechada nos perfis `Public` e `Domain`.

Registre antes do ensaio:

```powershell
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber
nvidia-smi
uv --version
uv run python --version
uv run python -c "import cv2, torch, ultralytics, websockets; print(cv2.__version__, torch.__version__, ultralytics.__version__, websockets.__version__)"
```

## 1. Preparar o desktop

No diretório `tcc-back\gesture-server`, instale as dependências e gere um token efêmero. O token aparece somente na sessão atual do PowerShell e deve ser transferido ao notebook por um canal privado:

```powershell
uv sync
$env:GESTURE_TOKEN = uv run python -c "import secrets; print(secrets.token_urlsafe(32))"
$env:GESTURE_ALLOWED_ORIGINS = "http://localhost:5173,http://IP_DO_NOTEBOOK:5173"
uv run uvicorn app.main:create_configured_app --factory --host 0.0.0.0 --port 8765 --workers 1
```

Em outro PowerShell administrativo, confirme o perfil e crie uma regra limitada à sub-rede privada:

```powershell
Get-NetConnectionProfile
New-NetFirewallRule -DisplayName "TCC Gesture LAN 8765" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8765 -Profile Private -RemoteAddress LocalSubnet
```

Descubra o IPv4 privado do desktop com `Get-NetIPAddress -AddressFamily IPv4`. Não use nem registre um IP público.

## 2. Validar a partir do notebook

No notebook, clone ou atualize os repositórios e entre em `tcc-back\gesture-server`. O modo `--script` instala somente OpenCV e WebSocket em um ambiente isolado; ele não instala PyTorch/CUDA nem as dependências do servidor:

```powershell
Invoke-RestMethod http://IP_DO_DESKTOP:8765/health
$env:GESTURE_BENCHMARK_TOKEN = Read-Host "Token efêmero"
uv run --script scripts/benchmark_client.py --url ws://IP_DO_DESKTOP:8765/v1/pose --origin http://localhost:5173 --input C:\caminho\ensaio.mp4 --max-frames 300
```

O cliente lê vídeo, imagem ou diretório de imagens fornecido, mantém apenas amostras numéricas em memória e imprime um resumo agregado. Antes de medir, ele repete o primeiro frame três vezes para aquecer CUDA; altere isso somente de forma explícita com `--warmup-frames`. `--output caminho.json` é opcional e grava somente esse resumo. O token nunca deve ser passado como argumento.

Faça três rodadas com o mesmo arquivo, largura (`640`), qualidade JPEG (`80`) e quantidade de frames. Reinicie apenas o cliente entre rodadas; mantenha servidor, rede e alimentação dos equipamentos constantes.

## 3. Validar a estação completa

No notebook, configure um `.env.local` não versionado em `tcc-front`:

```dotenv
VITE_GESTURE_INFERENCE_MODE=remote
VITE_GESTURE_SERVER_URL=ws://IP_DO_DESKTOP:8765/v1/pose
```

Inicie o frontend e as dependências normais do sistema. Entre na estação, selecione `GPU remota` e digite o token no campo de senha. Confirme visualmente modo, conectividade, inferência, RTT e FPS. O token deve desaparecer quando a aba for fechada.

Durante uma rodada controlada, encerre o servidor no desktop. A estação deve parar com erro, descartar trabalho pendente, não registrar novo evento/lance e não trocar automaticamente para o modo local. A retomada deve exigir ação explícita do operador.

Para comparar `local` e `remote` com o mesmo vídeo, use uma câmera virtual (por exemplo, OBS Virtual Camera) alimentada pelo arquivo de ensaio. Repita a sequência em cada modo e registre manualmente verdadeiros positivos, falsos positivos e falsos negativos. Não conclua superioridade fora dessa amostra.

## 4. Tempos e interpretação

O cliente Python mede captura/leitura, compressão, bytes do JPEG, RTT e os tempos do servidor (`decode`, `preprocess`, `inference`, `postprocess` e total). O valor `endToEnd` do benchmark termina no recebimento da resposta e não inclui o tracker React nem a pintura do navegador.

Tracker e apresentação são medições exclusivas da estação web. Registre-as com instrumentação/perfil do navegador durante a jornada completa; se não forem medidas, mantenha `PENDENTE`. Não substitua esses valores por RTT ou tempo de inferência. O critério final é `p95 <= 250 ms` desde a captura até a apresentação.

## 5. Registro dos resultados

Preencha somente após executar cada rodada:

| Campo | Rodada 1 | Rodada 2 | Rodada 3 |
| --- | ---: | ---: | ---: |
| Data/hora | PENDENTE | PENDENTE | PENDENTE |
| Frames capturados/concluídos | PENDENTE | PENDENTE | PENDENTE |
| JPEG médio (bytes) | PENDENTE | PENDENTE | PENDENTE |
| FPS efetivo | PENDENTE | PENDENTE | PENDENTE |
| Descarte/rejeição | PENDENTE | PENDENTE | PENDENTE |
| Captura p50/p95 (ms) | PENDENTE | PENDENTE | PENDENTE |
| Compressão p50/p95 (ms) | PENDENTE | PENDENTE | PENDENTE |
| RTT p50/p95 (ms) | PENDENTE | PENDENTE | PENDENTE |
| Decode p50/p95 (ms) | PENDENTE | PENDENTE | PENDENTE |
| Preprocess p50/p95 (ms) | PENDENTE | PENDENTE | PENDENTE |
| Inferência p50/p95 (ms) | PENDENTE | PENDENTE | PENDENTE |
| Postprocess p50/p95 (ms) | PENDENTE | PENDENTE | PENDENTE |
| Tracker p50/p95 (ms) | PENDENTE | PENDENTE | PENDENTE |
| Apresentação p50/p95 (ms) | PENDENTE | PENDENTE | PENDENTE |
| Ponta a ponta p50/p95 (ms) | PENDENTE | PENDENTE | PENDENTE |

Registre também hardware, versões, resolução/FPS do vídeo, iluminação, distância da câmera, número de pessoas e o método de rotulagem. Separe resultados LAN de futuros resultados WireGuard.

### Pré-validação automatizada — 2026-10-21

- `gesture-server`: `uv run python -m pytest -q` → 46 testes passaram; `uv lock --check` → lock consistente.
- `tcc-front`: `npm run test:unit` → 104 testes passaram; `npm run lint` → sem avisos; `npm run build` → concluído com o aviso conhecido de chunk acima de 500 kB.
- Smoke local do cliente contra a RTX, após três frames de aquecimento: uma imagem, `endToEnd=37,575 ms`, `inference=28,228 ms`, sem rejeição. Essa única amostra valida o funcionamento do cliente, não representa resultado LAN nem sustenta conclusão de desempenho.

## 6. Encerramento seguro

```powershell
Remove-Item Env:GESTURE_BENCHMARK_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:GESTURE_TOKEN -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "TCC Gesture LAN 8765"
```

Revise os logs do servidor antes de anexá-los à monografia. Eles podem conter ID, quantidade de bytes e duração, mas não devem conter token, JPEG, poses, IP público nem dados comerciais.
