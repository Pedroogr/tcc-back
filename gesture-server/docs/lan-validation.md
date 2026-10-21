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

No notebook Ubuntu, use o equivalente abaixo. O `--script` é importante porque o lock do servidor foi criado para o worker Windows; o cliente de benchmark declara suas próprias dependências portáveis:

```bash
curl -fsS http://IP_DO_DESKTOP:8765/health
read -rsp "Token efêmero: " GESTURE_BENCHMARK_TOKEN; echo
export GESTURE_BENCHMARK_TOKEN
uv run --script scripts/benchmark_client.py \
  --url ws://IP_DO_DESKTOP:8765/v1/pose \
  --origin http://localhost:5173 \
  --input /tmp/tcc-gesture-lan.mp4 \
  --max-frames 300
```

O cliente lê vídeo, imagem ou diretório de imagens fornecido, mantém apenas amostras numéricas em memória e imprime um resumo agregado. Antes de medir, ele repete o primeiro frame três vezes para aquecer CUDA; altere isso somente de forma explícita com `--warmup-frames`. `--output caminho.json` é opcional e grava somente esse resumo. O token nunca deve ser passado como argumento.

Faça três rodadas com o mesmo arquivo, largura (`640`), qualidade JPEG (`80`) e quantidade de frames. Reinicie apenas o cliente entre rodadas; mantenha servidor, rede e alimentação dos equipamentos constantes.

### 2.1. Gravar a sequência controlada — concluída em 2026-10-21

Antes das três rodadas, grave uma única sequência real de 20 segundos no notebook. Ela contém quatro fases de cinco segundos: braços abaixados, uma mão levantada, mão abaixada e a outra mão levantada. O mesmo arquivo deve ser reutilizado nas três rodadas e, depois, na comparação entre os modos local e remoto.

```bash
uv run --no-project --python 3.10 --with opencv-python python - <<'PY'
import cv2
import time

path = "/tmp/tcc-gesture-lan.mp4"
fps = 15
cap = cv2.VideoCapture(0)

if not cap.isOpened():
    raise SystemExit("Não foi possível abrir a câmera 0.")

cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
writer = cv2.VideoWriter(
    path,
    cv2.VideoWriter_fourcc(*"mp4v"),
    fps,
    (width, height),
)

if not writer.isOpened():
    raise SystemExit("Não foi possível criar o vídeo.")

phases = [
    "BRAÇOS ABAIXADOS",
    "LEVANTE UMA MÃO",
    "ABAIXE A MÃO",
    "LEVANTE A OUTRA MÃO",
]

print("A gravação começa em 3 segundos.")
time.sleep(3)

try:
    for phase in phases:
        print(f"AGORA: {phase}", flush=True)
        for _ in range(fps * 5):
            started = time.monotonic()
            ok, frame = cap.read()
            if not ok:
                raise SystemExit("Falha ao capturar frame da câmera.")
            writer.write(frame)
            time.sleep(max(0, 1 / fps - (time.monotonic() - started)))
finally:
    cap.release()
    writer.release()

print(f"Vídeo salvo: {path}")
PY
```

O arquivo fica apenas em `/tmp` no notebook e não é enviado para armazenamento pelo servidor: durante o benchmark, os frames JPEG são processados em memória. Apague-o após encerrar os ensaios, principalmente se houver outras pessoas na imagem.

**Registro de execução:** o vídeo controlado foi gravado no notebook Ubuntu e salvo como `/tmp/tcc-gesture-lan.mp4`. A inspeção confirmou abertura correta, resolução `640×480`, `15 FPS`, `300` frames e duração de `20,0 s`. A preparação, a verificação da entrada e as três rodadas do cliente Python foram concluídas.

## 3. Validar a estação completa

No notebook, configure um `.env.local` não versionado em `tcc-front`:

```dotenv
VITE_GESTURE_INFERENCE_MODE=remote
VITE_GESTURE_SERVER_URL=ws://IP_DO_DESKTOP:8765/v1/pose
```

Inicie o frontend e as dependências normais do sistema. Entre na estação, selecione `GPU remota` e digite o token no campo de senha. Confirme visualmente modo, conectividade, inferência, RTT e FPS. O token deve desaparecer quando a aba for fechada.

Para medir a jornada completa sem poluir a interface operacional, acrescente `?benchmark=1` à rota da estação:

```text
http://localhost:5173/gesture-station/ID_DO_LEILAO?benchmark=1
```

O painel adicional mostra apenas `Benchmark ativo`, a quantidade de amostras e os botões `Zerar` e `Exportar JSON`. Inicie o reconhecimento, aguarde a quantidade planejada de amostras e exporte antes de fechar ou recarregar a aba. Use `Zerar` antes de cada nova rodada. As amostras ficam somente em memória até a exportação explícita, e o JSON contém apenas agregados numéricos, sem token, imagens ou poses.

Durante uma rodada controlada, encerre o servidor no desktop. A estação deve parar com erro, descartar trabalho pendente, não registrar novo evento/lance e não trocar automaticamente para o modo local. A retomada deve exigir ação explícita do operador.

Para comparar `local` e `remote` com o mesmo vídeo, use uma câmera virtual (por exemplo, OBS Virtual Camera) alimentada pelo arquivo de ensaio. Repita a sequência em cada modo e registre manualmente verdadeiros positivos, falsos positivos e falsos negativos. Não conclua superioridade fora dessa amostra.

## 4. Tempos e interpretação

O cliente Python mede captura/leitura, compressão, bytes do JPEG, RTT e os tempos do servidor (`decode`, `preprocess`, `inference`, `postprocess` e total). O valor `endToEnd` do benchmark termina no recebimento da resposta e não inclui o tracker React nem a pintura do navegador.

Tracker e apresentação são medições exclusivas da estação web. O modo `?benchmark=1` usa os seguintes limites:

- `captureToResponse`: do início da criação do frame até a resposta do estimador;
- `inference`: tempo de inferência informado pelo estimador;
- `rtt`: ida do frame ao servidor e volta da resposta, incluindo o trabalho remoto;
- `tracker`: somente a atualização do tracker no navegador;
- `presentation`: do fim do tracker até uma oportunidade de pintura posterior do navegador;
- `endToEnd`: do início da criação do frame até essa apresentação.

Os percentis usam nearest rank e são arredondados para três casas decimais. Não substitua tracker, apresentação ou `endToEnd` por RTT ou tempo de inferência. O critério final é `endToEnd.p95 <= 250 ms` desde a captura até a apresentação.

## 5. Registro dos resultados

Preencha somente após executar cada rodada:

### Ambiente do servidor durante o ensaio — 2026-10-21

| Item | Valor |
| --- | --- |
| Sistema operacional | Windows 11 Pro `10.0.26200` (build `26200`) |
| CPU e memória | AMD Ryzen 9 5900X (12 núcleos), `31,9 GiB` de RAM |
| GPU | NVIDIA GeForce RTX 3070 Ti, `8.192 MiB` |
| Driver NVIDIA | `617.42` |
| Modelo | `yolo11s-pose`, entrada `640`, SHA-256 `1060bda4a27012060eca246f9b2adeea22eabb045a1e58f8d229be29b7ebc2ba` |
| Python / uv | Python `3.10.11`; uv `0.12.23` |
| Visão e ML | OpenCV `5.0.0`; PyTorch `2.13.0+cu130`; Ultralytics `8.4.177` |
| Serviço | websockets `16.1.1`; FastAPI `0.156.4`; Uvicorn `0.54.0` |

### Ambiente do notebook cliente durante o ensaio — 2026-10-21

| Item | Valor |
| --- | --- |
| Equipamento | Dell Inspiron 15 3520 |
| Sistema operacional | Ubuntu `25.10`; kernel `6.17.0-41-generic` |
| CPU e memória | Intel Core i5-1235U (12ª geração), `14 GiB` de RAM |
| Python / uv | Python `3.10.22`; uv `0.13.4` |
| Dependências do cliente | opencv-python `5.0.0.93`; websockets `16.1.1` (confirmados pelos metadados dos pacotes) |

A primeira tentativa de ler a versão pelo atributo do módulo `cv2` falhou; a consulta pelos metadados dos pacotes funcionou sem alterar o ambiente.

### Condições físicas da gravação — 2026-10-21

| Item | Condição registrada |
| --- | --- |
| Iluminação | Natural |
| Câmera | Webcam integrada do notebook |
| Posição do equipamento | Notebook apoiado no colo |
| Distância aproximada | `30 cm` entre a pessoa e a câmera |
| Enquadramento | Tronco |
| Pessoas na imagem | Uma pessoa |

| Campo | Rodada 1 | Rodada 2 | Rodada 3 |
| --- | ---: | ---: | ---: |
| Data/hora | 2026-10-21 (hora não registrada) | 2026-10-21 (hora não registrada) | 2026-10-21 (hora não registrada) |
| Frames capturados/concluídos | 300/300 | 300/300 | 300/300 |
| JPEG médio (bytes) | 23.218,423 | 23.218,423 | 23.218,423 |
| FPS efetivo | 37,778 | 37,596 | 38,449 |
| Descarte/rejeição | 0/0 | 0/0 | 0/0 |
| Captura p50/p95 (ms) | 0,707/1,598 | 0,774/1,621 | 0,811/1,723 |
| Compressão p50/p95 (ms) | 2,112/2,480 | 2,220/3,593 | 2,248/3,533 |
| RTT p50/p95 (ms) | 21,846/29,282 | 22,452/34,329 | 21,724/26,475 |
| Decode p50/p95 (ms) | 0,635/0,737 | 0,611/0,720 | 0,642/0,729 |
| Preprocess p50/p95 (ms) | 0,526/0,910 | 0,567/0,939 | 0,568/0,925 |
| Inferência p50/p95 (ms) | 11,469/15,747 | 11,774/14,262 | 11,426/15,088 |
| Postprocess p50/p95 (ms) | 1,401/1,565 | 1,396/1,535 | 1,399/1,488 |
| Servidor total p50/p95 (ms) | 14,227/18,685 | 14,597/17,807 | 14,307/17,966 |
| Tracker p50/p95 (ms) | NÃO MEDIDO | NÃO MEDIDO | NÃO MEDIDO |
| Apresentação p50/p95 (ms) | NÃO MEDIDO | NÃO MEDIDO | NÃO MEDIDO |
| Ponta a ponta do cliente p50/p95 (ms) | 24,666/31,997 | 25,475/37,804 | 25,294/29,987 |

Registre também hardware, versões, resolução/FPS do vídeo, iluminação, distância da câmera, número de pessoas e o método de rotulagem. Separe resultados LAN de futuros resultados WireGuard.

Nas três rodadas, `effectiveFps` mede o throughput do cliente processando o arquivo sem respeitar o ritmo de reprodução de `15 FPS`; não representa a taxa original da câmera nem a taxa de apresentação do navegador. O valor “ponta a ponta do cliente” termina na resposta WebSocket e não inclui tracker ou apresentação. Os resumos agregados foram salvos temporariamente no notebook como `/tmp/tcc-lan-run-1.json`, `/tmp/tcc-lan-run-2.json` e `/tmp/tcc-lan-run-3.json`.

### Consolidado das três rodadas

Foram processados `900/900` frames, sem substituição, rejeição ou descarte. A tabela abaixo calcula a média dos valores agregados de cada rodada; ela não é um percentil recalculado a partir das 900 amostras individuais.

| Métrica | Média dos p50 | Média dos p95 | Faixa dos p95 |
| --- | ---: | ---: | ---: |
| Captura (ms) | 0,764 | 1,647 | 1,598–1,723 |
| Compressão (ms) | 2,193 | 3,202 | 2,480–3,593 |
| RTT (ms) | 22,007 | 30,029 | 26,475–34,329 |
| Decode (ms) | 0,629 | 0,729 | 0,720–0,737 |
| Preprocess (ms) | 0,554 | 0,925 | 0,910–0,939 |
| Inferência (ms) | 11,556 | 15,032 | 14,262–15,747 |
| Postprocess (ms) | 1,399 | 1,529 | 1,488–1,565 |
| Servidor total (ms) | 14,377 | 18,153 | 17,807–18,685 |
| Ponta a ponta do cliente (ms) | 25,145 | 33,263 | 29,987–37,804 |

O throughput médio das três rodadas foi `37,941 FPS`. O p95 do cliente ficou muito abaixo de `250 ms` nas três execuções, mas o critério completo de captura até apresentação ainda não pode ser declarado atendido porque tracker e pintura do navegador não foram medidos.

### Pré-validação automatizada — 2026-10-21

- `gesture-server`: `uv run python -m pytest -q` → 46 testes passaram; `uv lock --check` → lock consistente.
- `tcc-front`: `npm run test:unit` → 116 testes passaram; `npm run lint` → sem avisos; `npm run build` → concluído com o aviso conhecido de chunk acima de 500 kB.
- Instrumentação web: ativação exclusiva por `?benchmark=1`, coleta em memória, separação entre tracker/apresentação, zeragem, exportação agregada e ciclo de desenvolvimento do React cobertos por 12 novos testes. A execução no navegador real do notebook permanece pendente.
- Smoke local do cliente contra a RTX, após três frames de aquecimento: uma imagem, `endToEnd=37,575 ms`, `inference=28,228 ms`, sem rejeição. Essa única amostra valida o funcionamento do cliente, não representa resultado LAN nem sustenta conclusão de desempenho.

### Primeiro smoke notebook Ubuntu → desktop Windows — 2026-10-21

- O endpoint de saúde e o WebSocket foram alcançados pela LAN no desktop `192.168.15.4`, com o servidor usando CUDA na RTX 3070 Ti.
- Uma imagem sintética preta de `640×480` foi capturada, enviada e concluída sem rejeição, substituição ou descarte.
- Resultado da amostra única: `FPS efetivo=21,199`, `JPEG médio=5.427 bytes`, `captura=1,867 ms`, `compressão=1,816 ms`, `RTT=45,279 ms`, `decode=0,493 ms`, `preprocess=1,482 ms`, `inferência=30,230 ms`, `postprocess=0,478 ms`, `servidor=33,114 ms` e `ponta a ponta=48,962 ms`.
- `tracker` e `apresentação` permaneceram sem medição porque o cliente Python termina ao receber a resposta WebSocket.
- Como houve apenas um frame sintético, esses números comprovam conectividade, autenticação, protocolo e execução remota do modelo; eles não constituem p50/p95, teste de precisão de pose nem as três rodadas controladas.

## 6. Encerramento seguro

```powershell
Remove-Item Env:GESTURE_BENCHMARK_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:GESTURE_TOKEN -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "TCC Gesture LAN 8765"
```

No notebook Ubuntu, remova o token da sessão e, após todos os ensaios, o vídeo temporário:

```bash
unset GESTURE_BENCHMARK_TOKEN
rm -f /tmp/tcc-gesture-lan.mp4
```

Revise os logs do servidor antes de anexá-los à monografia. Eles podem conter ID, quantidade de bytes e duração, mas não devem conter token, JPEG, poses, IP público nem dados comerciais.
