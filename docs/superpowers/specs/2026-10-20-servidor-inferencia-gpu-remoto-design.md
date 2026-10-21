# Servidor remoto de inferência de gestos

**Data:** 2026-10-20
**Projetos:** `tcc-back` e `tcc-front`
**Status:** aprovado
**Meta de desempenho:** latência ponta a ponta `p95 <= 250 ms`

## Objetivo

Usar o desktop Windows com uma NVIDIA GeForce RTX 3070 Ti como serviço privado
de inferência de pose para a estação de gestos executada em um notebook Linux.
O notebook continua responsável pela câmera e pela interface; o desktop recebe
frames JPEG, executa YOLO Pose com CUDA e devolve somente poses e métricas.

A mudança deve preservar a inferência local atual do navegador como modo de
teste e contingência explícita, sem permitir que uma troca automática de motor
durante uma rodada altere silenciosamente o comportamento da estação.

## Contexto e evidências

- A estação atual executa `yolo11n-pose.onnx`, entrada `640 x 640`, em um Web
  Worker com WebGPU e fallback WASM.
- O notebook que motivou esta mudança chegou a aproximadamente `0,1 FPS`, o que
  tornou o reconhecimento local inviável.
- O desktop possui uma RTX 3070 Ti de 8 GiB reconhecida pelo driver NVIDIA.
- Um ambiente isolado com Python 3.10.11, PyTorch 2.13.0 + CUDA 13.0,
  torchvision 0.28.0 e Ultralytics 8.4.177 reconheceu a GPU corretamente.
- O checkpoint existente `gesture-poc/yolo11s-pose.pt` possui 20.373.161 bytes
  e SHA-256
  `1060bda4a27012060eca246f9b2adeea22eabb045a1e58f8d229be29b7ebc2ba`.
- Com `yolo11s-pose.pt`, `imgsz=640`, FP16, dez aquecimentos e cinquenta
  amostras, o desktop mediu `p50=15,23 ms` e `p95=18,33 ms` em frame sintético.
- Com webcam 1920 x 1080, o mesmo modelo mediu inferência `p50=17,30 ms` e
  `p95=24,40 ms`; captura mais inferência mediu `p50=39,52 ms` e
  `p95=51,81 ms`.
- A confirmação temporal atual exige três amostras positivas durante pelo
  menos 250 ms. Esse valor isolado consome toda a meta ponta a ponta e deverá
  ser comparado com janelas de 80, 100 e 120 ms.

As medições acima validam a viabilidade da GPU, mas não substituem o benchmark
pela rede nem a avaliação de falsos positivos e falsos negativos.

## Decisões fechadas

| Tema | Decisão | Motivo |
| --- | --- | --- |
| Localização | `tcc-back/gesture-server` | Serviço versionado junto ao PoC e independente do NestJS |
| Runtime | Python 3.10, FastAPI e Uvicorn | Mantém transporte e PyTorch no mesmo processo |
| Processo | Um worker | Evita cópias concorrentes do modelo e disputa pela mesma GPU |
| Modelo remoto | `yolo11s-pose.pt`, entrada 640, GPU 0 | O benchmark mostrou folga e o modelo maior favorece precisão |
| Modelo local | `yolo11n-pose.onnx` | Fallback leve já distribuído no frontend |
| Transporte | WebSocket com JPEG binário | Conexão contínua, baixo overhead e controle de backpressure |
| Rede remota | WireGuard direto | O desktop possui IPv4 público e a rota direta evita relay |
| Segurança da aplicação | Token na primeira mensagem e allowlist de origem | Segunda camada além do túnel; token não aparece na URL |
| Estado persistente | Nenhum | Frames e resultados são efêmeros; o serviço não acessa banco |
| Estação inicial | Uma conexão ativa | Corresponde ao uso atual e simplifica a previsibilidade de latência |

WireGuard é a escolha principal. Tailscale, NetBird ou ZeroTier permanecem
alternativas apenas se não for possível administrar o roteador. O roteador
deve continuar no modo `Roteador (Padrão)`; o modo bridge está fora de escopo.

## Arquitetura

```text
Notebook Linux
├── frontend da estação em localhost
├── câmera e compressão JPEG
├── RemotePoseAdapter
├── rastreamento e regra da primeira mão
└── integração existente com o NestJS
             │
             │ WebSocket dentro do WireGuard
             ▼
Desktop Windows
└── gesture-server
    ├── FastAPI/Uvicorn, 1 worker
    ├── autenticação e protocolo
    ├── decodificação JPEG
    ├── YOLO11s Pose / PyTorch / CUDA
    └── resposta com poses e métricas
```

O NestJS continua responsável por usuários, leilões, lotes, lances, vendas,
acessos de operador, banco de dados e relay do alerta final. O serviço Python
não conhece compradores, não registra lances e não publica diretamente em
salas comerciais.

## Estrutura do serviço

```text
gesture-server/
├── pyproject.toml
├── uv.lock
├── README.md
├── app/
│   ├── __init__.py
│   ├── config.py
│   ├── protocol.py
│   ├── inference.py
│   └── main.py
└── tests/
    ├── test_config.py
    ├── test_protocol.py
    ├── test_inference.py
    └── test_websocket.py
```

O ambiente virtual fica fora do Git. O modelo não será duplicado nesta etapa:
o caminho padrão aponta para `../gesture-poc/yolo11s-pose.pt` e pode ser
substituído por `GESTURE_MODEL_PATH`. O hash esperado faz parte da configuração
e é verificado antes de o serviço ficar pronto.

## Limites dos módulos

### Configuração

`config.py` lê e valida somente variáveis `GESTURE_*`. A configuração inclui:

- caminho e SHA-256 do modelo;
- dispositivo CUDA, inicialmente `0`;
- token obrigatório;
- origens permitidas;
- limite máximo do JPEG, inicialmente 512 KiB;
- timeout da mensagem inicial, inicialmente cinco segundos;
- versão do protocolo, inicialmente `1`;
- largura máxima recomendada de captura e qualidade JPEG para o cliente.

Token vazio, modelo ausente, hash divergente ou CUDA indisponível impedem o
estado `ready`. Nenhum segredo é retornado por health check ou log.

### Inferência

`inference.py` expõe uma porta pequena independente do FastAPI:

```python
class PoseEngine(Protocol):
    @property
    def metadata(self) -> ModelMetadata: ...

    def infer(self, jpeg: bytes) -> PoseResult: ...
```

A implementação CUDA carrega o YOLO uma vez durante o lifespan do FastAPI,
mantém o modelo na GPU e processa uma imagem por vez sob um lock. Ela mede
decodificação, preprocessamento, inferência, pós-processamento e total usando
relógio monotônico, com sincronização CUDA na medição da inferência.

O resultado reproduz o contrato atual de `PersonPose`:

- `confidence`: confiança da pessoa;
- `box`: `x1`, `y1`, `x2`, `y2` em pixels do JPEG recebido;
- `normalizedBox`: `x`, `y`, `width`, `height` entre zero e um;
- `keypoints`: dezessete pontos COCO com `x` e `y` em pixels do JPEG e
  `confidence`.

Detecção de mão, tracking e decisão da primeira pessoa permanecem no frontend.

### API

`main.py` cria a aplicação por uma factory que recebe um `PoseEngine`. Essa
injeção permite testar o protocolo sem câmera ou GPU. O processo de produção
usa exatamente um worker do Uvicorn.

## Health check

`GET /health` retorna `503` enquanto o modelo não está pronto e `200` quando a
inferência pode ser aceita. A resposta pronta contém somente:

```json
{
  "status": "ready",
  "protocolVersion": 1,
  "model": {
    "name": "yolo11s-pose",
    "sha256": "1060bda4...",
    "inputSize": 640
  },
  "device": {
    "type": "cuda",
    "name": "NVIDIA GeForce RTX 3070 Ti"
  }
}
```

O endpoint não retorna token, caminhos locais, IP público ou stack trace.

## Protocolo WebSocket

O endpoint é `WS /v1/pose`.

### Abertura e autenticação

O servidor valida o cabeçalho `Origin` contra a allowlist. Após a conexão, o
cliente possui cinco segundos para enviar:

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "token": "<segredo>"
}
```

Token inválido ou versão incompatível encerra a conexão com código estável e
sem explicar qual parte do segredo falhou. O token não é enviado na query
string. Após autenticar, o servidor responde:

```json
{
  "type": "ready",
  "protocolVersion": 1,
  "model": {
    "name": "yolo11s-pose",
    "sha256": "1060bda4...",
    "inputSize": 640
  }
}
```

### Frame

Cada frame é uma única mensagem binária:

```text
4 bytes              restante
frameId uint32 BE     JPEG
```

O JPEG deve ser válido, respeitar o limite de 512 KiB e conter dimensões
positivas. O cliente começa em `frameId=1` e incrementa módulo `2^32`.

### Resposta

Uma inferência bem-sucedida retorna:

```json
{
  "type": "pose",
  "protocolVersion": 1,
  "frameId": 42,
  "modelVersion": "yolo11s-pose:1060bda4",
  "timings": {
    "decodeMs": 2.1,
    "preprocessMs": 1.4,
    "inferenceMs": 18.0,
    "postprocessMs": 1.8,
    "totalMs": 23.3
  },
  "poses": []
}
```

`sampledAtMs` não atravessa a rede: ele é preservado pelo cliente e associado
localmente ao `frameId`. Assim, não há comparação entre relógios de máquinas
diferentes. O cliente calcula o RTT com seu próprio relógio monotônico.

Erros recuperáveis retornam `{ "type": "error", "frameId", "code",
"message" }`. Erros de autenticação, protocolo ou abuso encerram a conexão.
Mensagens de erro públicas não incluem exceções internas.

## Backpressure e descarte de frames

O frontend mantém no máximo uma solicitação em andamento. Enquanto aguarda a
resposta, ele pode substituir em memória o frame pendente ainda não enviado;
quando a resposta chega, envia somente o frame mais recente. Não existe fila
FIFO de imagens.

O servidor processa uma inferência por vez. A primeira versão aceita somente
uma estação autenticada; uma segunda conexão recebe indisponibilidade em vez
de dividir imprevisivelmente a GPU. Respostas de geração anterior ou com
`frameId` não esperado são ignoradas pelo frontend.

## Integração no frontend

A seam atual `start`, `detect` e `dispose` será preservada. Serão introduzidos:

- `LocalPoseEstimator`: implementação atual WebGPU/WASM;
- `RemotePoseEstimator`: WebSocket, compressão e mapeamento do resultado;
- configuração explícita `local` ou `remote` para a estação.

O modo remoto é o padrão no notebook de produção. O modo local continua
disponível para desenvolvimento e contingência manual. Uma falha remota antes
de iniciar permite escolher local; uma falha durante uma rodada interrompe a
estação e mostra o erro, sem troca automática de motor.

O backend exibido pela interface passa a diferenciar `remote-cuda`, `webgpu` e
`wasm`. O `GestureRoundTracker`, o snapshot final e o envio do evento ao NestJS
continuam compartilhados.

## Rede e segurança

- O único encaminhamento público futuro no roteador é a porta UDP do
  WireGuard; a porta do FastAPI não é publicada na Internet.
- O notebook recebe uma chave WireGuard exclusiva.
- O Firewall do Windows restringe a porta do serviço à interface/rede do
  túnel e, durante o teste inicial, ao perfil privado da LAN.
- DDNS será configurado caso o IPv4 público seja dinâmico.
- No servidor, o token da aplicação vive em variável de ambiente. No
  navegador, ele é informado em tempo de execução e mantido somente na sessão
  local da aba; não é incorporado ao bundle nem versionado.
- A origem do navegador é validada mesmo dentro do túnel.
- Frames, poses e snapshots contínuos não são gravados em disco nem em banco.
- Logs contêm somente IDs técnicos, tamanhos, duração e códigos de erro; não
  contêm JPEG, token, IP público ou dados de compradores.

Os primeiros testes executam o frontend em `localhost` no notebook e usam
`ws://` dentro da LAN ou do túnel criptografado. Antes de servir a estação a
partir de uma origem HTTPS pública, será necessário adicionar `wss://`.

## Falhas e recuperação

- Modelo ausente, hash divergente ou CUDA indisponível mantém `/health` em
  `503` e impede conexões de inferência.
- JPEG inválido ou grande demais gera erro estável sem derrubar o processo.
- Timeout de inferência encerra a rodada atual e deixa a estação parada até
  ação explícita do operador.
- Desconexão não enfileira frames nem resultados para entrega posterior.
- Reconexão cria uma nova geração; respostas antigas não alteram o tracker.
- Se o processo Python cair, um gerenciador de serviço do Windows poderá
  reiniciá-lo em etapa posterior; múltiplos workers não serão usados para isso.
- Se o WireGuard ficar indisponível, o frontend mostra servidor remoto
  inacessível e permite troca manual para o modo local fora de uma rodada.

## Observabilidade e desempenho

Serão registrados, sem conteúdo de imagem:

- tempo de captura e compressão no cliente;
- bytes do JPEG;
- RTT do WebSocket;
- tempos de decodificação, preprocessamento, inferência, pós-processamento e
  total no servidor;
- tempo de tracking e confirmação temporal;
- tempo até a apresentação do reconhecimento;
- frames capturados, enviados, substituídos e rejeitados.

Relatórios usam `p50`, `p95`, FPS efetivo, jitter, perda e taxa de descarte. O
critério principal é `p95 <= 250 ms` da captura até a apresentação. Também será
medida a rota WireGuard direta e comparada à LAN.

## Estratégia de testes

### Serviço Python

- Configuração: token ausente, hash divergente, arquivo ausente e CUDA
  indisponível.
- Protocolo: hello válido, token inválido, versão incompatível, frame curto,
  JPEG inválido, frame grande e `frameId` preservado.
- Inferência: mapeamento de box e keypoints para o contrato `PersonPose` usando
  um resultado determinístico.
- WebSocket: health, autenticação, resposta `ready`, pose, erro recuperável,
  segunda estação e desconexão.
- Smoke GPU separado: modelo real, dispositivo CUDA e benchmark; não faz parte
  da suíte determinística comum.

### Frontend

- Seleção explícita de estimador local/remoto.
- Handshake e serialização do frame binário.
- Uma inferência em andamento e substituição pelo frame mais recente.
- Mapeamento da resposta para `PoseDetectionFrame`.
- Descarte de resposta antiga e limpeza no `dispose`.
- Falha antes de iniciar, queda durante rodada e ausência de fallback
  silencioso.
- Regressão do tracker, snapshot e relay existente ao operador.

### Integração

- Webcam do notebook para desktop na mesma LAN.
- Mesma jornada por WireGuard fora da rede doméstica.
- Token inválido e origem não permitida.
- Desligamento do serviço durante uma rodada.
- Jitter, atraso e perda simulados.
- Comparação com o modo local usando o mesmo vídeo gravado.
- Janelas de confirmação de 80, 100 e 120 ms, medindo falsos positivos e
  falsos negativos.

## Sequência de entrega

1. Criar o subprojeto Python, configuração e health check.
2. Implementar motor CUDA e benchmark reproduzível.
3. Implementar protocolo WebSocket autenticado e backpressure.
4. Criar `RemotePoseEstimator` sem alterar o tracker.
5. Integrar escolha explícita local/remoto na estação.
6. Validar ponta a ponta na LAN.
7. Configurar WireGuard, firewall e DDNS quando necessário.
8. Medir a rota externa e ajustar compressão/confirmação temporal.
9. Configurar inicialização automática e `wss://` somente após a validação.

## Fora de escopo

- Registrar lance automaticamente a partir do gesto.
- Identificar biometricamente uma pessoa ou associar pose a comprador.
- Persistir vídeo, frames contínuos, poses ou histórico de gestos.
- Acessar diretamente o banco do NestJS.
- Substituir o relay de snapshot e alerta ao operador já existente.
- Várias estações ou várias GPUs na primeira versão.
- Balanceamento horizontal ou múltiplos workers.
- Expor o FastAPI diretamente à Internet.
- Alterar o roteador para modo bridge.
