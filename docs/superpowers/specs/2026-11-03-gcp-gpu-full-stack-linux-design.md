# Deploy temporário full stack com GPU no Google Cloud

**Data:** 2026-11-03
**Projetos:** `tcc-back` e `tcc-front`
**Status:** aprovado
**Natureza:** ambiente temporário de demonstração e medição, não produção

## Intenção

Executar todo o sistema do TCC em uma única VM do Google Compute Engine na
região de São Paulo (`southamerica-east1`), com uma NVIDIA T4. Frontend,
backend NestJS, PostgreSQL, worker Python/CUDA, gateway e túnel público deixam
de depender do desktop residencial.

O navegador da banca acessa uma única URL HTTPS. Frames da câmera, chamadas
REST, Socket.IO e eventos do leilão percorrem somente a rota entre o navegador
e a VM. O desktop local não participa da jornada.

## Objetivos

- reduzir a latência de rede observada quando o backend roda no desktop;
- usar a T4 para a inferência do `yolo11s-pose.pt`;
- executar todos os componentes em contêineres reproduzíveis;
- publicar uma única origem HTTPS/WSS por Cloudflare Quick Tunnel;
- não abrir publicamente as portas do PostgreSQL, NestJS ou FastAPI;
- preservar o banco local e o fluxo Windows já existentes;
- iniciar, verificar, consultar e encerrar o ambiente por comandos simples;
- manter segredos, frames e credenciais fora do Git e dos logs;
- permitir desligar a VM sem perder involuntariamente o banco de demonstração.

## Não objetivos

- transformar o sistema em serviço de produção ou oferecer SLA;
- manter URL pública estável entre reinicializações;
- suportar várias estações de gestos ou várias GPUs;
- migrar o PostgreSQL para Cloud SQL;
- separar componentes entre várias VMs, Kubernetes ou serviços gerenciados;
- criar domínio, certificado ou Cloudflare Named Tunnel nesta etapa;
- garantir mídia WebRTC em redes que exigem TURN;
- alterar regras comerciais, autenticação ou protocolo de inferência;
- substituir o modo local/Windows usado como contingência.

## Restrições e premissas

- A VM alvo é `n1-standard-4` com uma NVIDIA T4 na região
  `southamerica-east1`; uma zona concreta será escolhida conforme capacidade.
- A conta possui cota regional de uma T4 e cota global de uma GPU.
- O host usa Linux Ubuntu compatível com o driver NVIDIA, Docker Engine,
  Docker Compose v2 e NVIDIA Container Toolkit.
- A VM possui IPv4 externo efêmero para saída sem Cloud NAT, mas nenhuma porta
  da aplicação é liberada. O acesso SSH administrativo usa IAP e OS Login.
- O worker continua com Python 3.10, um processo Uvicorn, uma conexão ativa e
  o modelo versionado em `gesture-poc/yolo11s-pose.pt`.
- O par PyTorch/Torchvision passa a `2.14.0+cu130`/`0.29.0+cu130`. O par atual
  `2.13.0+cu130`/`0.28.0+cu130` não oferece wheel estável de PyTorch para
  CPython 3.10/Linux x86-64 no índice CUDA 13.0, portanto não pode sustentar um
  lock realmente multiplataforma.
- O frontend é compilado no modo remoto, usando `/api`, `/socket.io` e
  `/v1/pose` na mesma origem.
- Os repositórios são clonados como diretórios irmãos, `tcc-back` e
  `tcc-front`, dentro de uma pasta de trabalho na VM.
- A demonstração usa dados próprios e nunca aponta para o banco habitual do
  desenvolvedor.
- Quick Tunnel é aceito como dependência temporária: não possui SLA e sua URL
  muda a cada nova execução.

## Abordagens consideradas

### 1. Docker Compose full stack em uma VM — escolhida

Todos os componentes executam na mesma rede privada do Compose. Apenas o
`cloudflared` realiza conexão de saída com a Cloudflare; nenhuma porta da
aplicação precisa ficar aberta para a Internet.

Essa opção oferece uma configuração reproduzível, reúne logs e ciclo de vida
em uma ferramenta e elimina o desktop da rota. O custo é um build inicial
maior e a necessidade de preparar corretamente o runtime NVIDIA no host.

### 2. Serviços systemd no host e somente PostgreSQL em Docker — rejeitada

Pode economizar alguma camada de contêiner, mas espalha versões de Node,
Python, CUDA, Caddy e cloudflared pelo host. O risco de divergência e a limpeza
manual são maiores para uma VM temporária.

### 3. Serviços gerenciados separados — adiada

Cloud Run, Cloud SQL e armazenamento gerenciado melhorariam a operação de um
produto permanente. Para a defesa, aumentariam custo, configuração, segredos e
pontos de rede sem resolver melhor o requisito central de uma única GPU.

### 4. Somente o worker na VM — rejeitada

Reduziria o tempo de inferência, mas manteria API, banco e eventos comerciais
dependentes do desktop e da Internet residencial. Isso não atende à decisão de
remover o desktop da jornada completa.

## Arquitetura selecionada

```text
Navegador da banca
        |
        | HTTPS / WSS
        v
https://<aleatorio>.trycloudflare.com
        |
        | túnel de saída
        v
cloudflared (container)
        |
        v
Caddy gateway (container)
        |-- /                         -> frontend React estático
        |-- /api/*                    -> API NestJS, removendo /api
        |-- /socket.io/*              -> API NestJS / Socket.IO
        `-- /v1/pose                  -> worker FastAPI / CUDA
                                              |
                                              `-> NVIDIA T4

API NestJS (container) -> PostgreSQL (container + volume persistente)
```

Todos os serviços compartilham uma rede interna do Compose. PostgreSQL, API e
worker usam apenas `expose`, sem `ports`. O gateway também não publica porta no
IP público da VM; ele é alcançado diretamente pelo `cloudflared` na rede
interna. O firewall do GCP precisa permitir somente o acesso administrativo
necessário à VM, não as portas da aplicação.

## Componentes e responsabilidades

### PostgreSQL

- usa imagem oficial com versão fixada;
- armazena dados em volume nomeado exclusivo da demonstração;
- possui health check antes de migrations e API;
- recebe usuário, senha e nome do banco por arquivo de ambiente de runtime;
- não é acessível fora da rede do Compose.

### API NestJS

- usa uma imagem multi-stage para instalar dependências e compilar o projeto;
- executa como usuário não-root;
- recebe `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL` e demais configurações
  somente em runtime;
- aguarda migrations e seed bem-sucedidos antes de iniciar;
- aceita CORS e Socket.IO somente para a URL pública exata da execução;
- não contém credenciais na imagem.
- persiste `public/uploads` em volume próprio, separado da imagem e do banco.

### Worker de gestos

- usa uma imagem CUDA compatível com o driver da VM e Python 3.10;
- disponibiliza a GPU pelo runtime NVIDIA do Compose;
- executa `uvicorn` com exatamente um worker;
- verifica presença e SHA-256 do modelo antes de ficar pronto;
- recebe token efêmero e origem pública exata em runtime;
- mantém frames e resultados somente em memória;
- não usa preview OpenCV em uma VM sem interface gráfica.

### Gateway Caddy

- serve o build de produção do frontend;
- mantém fallback de SPA;
- encaminha REST, Socket.IO e WebSocket de poses;
- não registra corpos, JPEGs, tokens ou respostas;
- fica acessível apenas dentro da rede do Compose.

### Cloudflared

- cria um Quick Tunnel sem credencial permanente;
- aponta para o gateway pelo nome do serviço na rede interna;
- registra a URL pública para o orquestrador, sem segredos;
- pode reconectar enquanto o processo existir, mas uma nova execução pode
  produzir outro hostname.

## Organização dos arquivos

A orquestração fica versionada no `tcc-back`, que já contém o worker e os
scripts da demonstração. O build do gateway usa o `tcc-front` irmão como
contexto; o launcher valida essa disposição antes de executar qualquer ação.

```text
tcc-back/
├── deploy/gcp/
│   ├── compose.yaml
│   ├── Caddyfile
│   ├── api.Dockerfile
│   ├── worker.Dockerfile
│   └── gateway.Dockerfile
├── scripts/gcp-demo/
│   ├── prepare-host.sh
│   ├── start.sh
│   ├── status.sh
│   ├── stop.sh
│   └── lib/
└── docs/runbooks/gcp-gpu-demo.md

tcc-front/                 # diretório irmão, contexto do gateway
```

Os Dockerfiles recebem contextos mínimos. Arquivos de exclusão impedem que
`.git`, dependências locais, builds e notas da monografia sejam enviados ao
daemon. O fluxo Windows existente não é substituído.

## Inicialização em duas fases

A URL do Quick Tunnel só existe depois que o túnel inicia, enquanto API e
worker precisam dela para validar a origem. Por isso, um único `docker compose
up` indiscriminado não é suficiente.

O `start.sh` executa este fluxo:

1. valida repositórios irmãos, Docker Compose, `nvidia-smi`, runtime NVIDIA,
   modelo e arquivos obrigatórios;
2. recusa continuar se já existir outro runtime do mesmo projeto ou se o
   arquivo de estado pertencer a processos diferentes;
3. cria ou carrega o diretório privado de estado e a senha estável do banco,
   vinculada ao volume persistente; gera novos `JWT_SECRET` e token do worker;
4. compila as imagens e o frontend sem incorporar segredos;
5. inicia PostgreSQL, gateway e `cloudflared`;
6. aguarda o banco saudável e extrai dos logs somente a URL HTTPS do túnel;
7. grava um arquivo de ambiente privado com a origem pública exata e os
   segredos efêmeros;
8. executa migrations e seed idempotente em um contêiner one-shot;
9. inicia API e worker com a configuração final;
10. aguarda os health checks locais da rede do Compose;
11. executa smoke público não destrutivo de frontend, API e handshake
    autenticado WSS;
12. somente após sucesso mostra URL, credenciais de demonstração e token.

Se qualquer etapa falhar, o script não divulga uma URL como pronta. Ele encerra
os contêineres da execução incompleta, preserva o volume do banco e informa a
etapa e o log relevante sem imprimir segredos.

## Estado, segredos e dados

O estado fica em diretório local ignorado pelo Git, com permissões restritas.
Ele contém apenas o necessário para administrar a demonstração: identidade
estável do projeto Compose, senha do PostgreSQL associada ao volume, URL
pública atual, caminhos de logs e arquivo de ambiente da execução. Senhas e
tokens nunca são passados em argumentos de processo, query string ou imagem.

Os volumes do PostgreSQL e de uploads, além da credencial do banco, são
preservados por `stop.sh`. A exclusão de dados exige um comando separado,
explícito e documentado, que remove volumes e credencial juntos; nunca ocorre
como efeito colateral de iniciar ou parar. Se o volume do banco existir sem o
estado de credencial, o launcher falha com orientação de recuperação em vez de
gerar uma senha que o banco não aceitará. Migrations e seed devem ser
idempotentes para permitir reinício da mesma VM.

O token do worker e o JWT são regenerados a cada nova execução. O frontend não
recebe o token no bundle: o apresentador o informa na estação e ele continua
somente no `sessionStorage` da aba.

## Preparação da VM

O `prepare-host.sh` é executado conscientemente uma vez e pode exigir `sudo`.
Ele instala ou orienta a instalação de Docker Engine, plugin Compose, driver
NVIDIA e NVIDIA Container Toolkit a partir de repositórios oficiais. Depois,
valida com um contêiner CUDA que a T4 está visível.

O script não cria a VM nem altera cotas do GCP. O runbook orienta:

- criar a VM na região de São Paulo em uma zona com capacidade de T4;
- escolher `n1-standard-4`, uma T4 e disco com espaço para imagens/modelos;
- usar uma imagem Ubuntu suportada;
- não marcar regras HTTP/HTTPS públicas para a aplicação;
- manter somente `tcp:22` vindo do intervalo do IAP no firewall e habilitar OS
  Login, sem SSH aberto para toda a Internet;
- clonar os dois repositórios como irmãos;
- executar preparação, logout/login quando necessário e então o launcher.

Versões e imagens serão fixadas no plano de implementação depois de validar
compatibilidade entre PyTorch, CUDA, driver e arquitetura da VM. Não será usada
a tag `latest` para componentes de runtime.

## Encerramento e operação

`status.sh` mostra estado dos serviços, URL atual, health checks e utilização
da GPU sem revelar token ou senhas. Se o hostname anunciado pelo `cloudflared`
divergir da allowlist da API ou do worker, o status é `inválido` e orienta
`stop.sh` seguido de `start.sh`; não haverá watchdog que altere origens durante
uma rodada. `stop.sh` valida os labels e o diretório do projeto Compose antes
de remover somente contêineres e rede daquela demonstração. O volume do banco,
sua credencial e as imagens permanecem.

Após `stop.sh`, o Quick Tunnel deixa de existir. Para parar a cobrança de CPU e
GPU é obrigatório também interromper a VM no Console ou com `gcloud`. O runbook
destaca essa diferença e recomenda criar alerta/orçamento de faturamento.

Reiniciar a VM não promete restaurar automaticamente o Quick Tunnel. A escolha
é deliberada: o apresentador executa `start.sh`, recebe uma nova URL e só então
divulga o ambiente.

## Segurança e privacidade

- O tráfego público usa HTTPS/WSS terminado pela Cloudflare.
- A VM abre conexão de saída; não há port forwarding da aplicação.
- PostgreSQL, NestJS, FastAPI e Caddy não têm portas públicas.
- API e worker validam a origem pública exata, sem `*`.
- JWT e token de inferência permanecem segredos distintos.
- O modelo e seu hash são verificados antes de o worker ficar pronto.
- Contêineres de aplicação executam sem root quando a imagem permitir.
- Frames, poses e snapshots contínuos não são persistidos nem registrados.
- Logs omitem corpos, tokens, credenciais e dados pessoais.
- O banco é apenas de demonstração, com contas e senhas próprias.

O Quick Tunnel torna a URL difícil de prever, mas ela não é tratada como
controle de acesso. Login da aplicação e token do worker continuam
obrigatórios.

## Health checks, testes e observabilidade

### Validação estática e automatizada

- `docker compose config` deve resolver sem variáveis ausentes;
- testes verificam geração/validação do ambiente sem expor segredos;
- testes do launcher cobrem pré-requisito ausente, URL não encontrada, falha de
  migration, limpeza restrita ao projeto e preservação do volume;
- configuração do Caddy cobre SPA, REST, Socket.IO e `/v1/pose`;
- suítes existentes de backend, frontend e worker continuam passando;
- o build de cada imagem deve terminar sem arquivo secreto no contexto final.

### Smoke local na VM

- PostgreSQL saudável e migrations aplicadas;
- API consulta o banco;
- worker reporta CUDA e modelo prontos;
- Caddy entrega frontend e encaminha API, Socket.IO e poses;
- `nvidia-smi` associa o processo do worker à T4.

### Smoke público

- `GET /` pela URL do túnel;
- endpoint público da API pelo prefixo `/api`;
- conexão Socket.IO pela mesma origem;
- handshake autenticado em `wss://<origem>/v1/pose`;

O smoke automático termina aí para ser não destrutivo e independente de
câmera. Envio de frame real, login e gravação de evento comercial pertencem a
uma checklist manual pós-inicialização, usando somente as contas e o leilão do
banco de demonstração. O launcher diferencia `infraestrutura pronta` de
`jornada manual validada`.

### Medição

O teste externo registra FPS efetivo, RTT, p50/p95, tempo de inferência e taxa
de descarte, sem registrar imagens. Após 30 segundos de aquecimento, a coleta
dura pelo menos dois minutos. A meta existente `p95 <= 250 ms` é um alvo de
desempenho, não um bloqueio para iniciar a infraestrutura. O projeto hoje só
classifica menos de 5 FPS como não confiável, portanto esta entrega não inventa
um novo limite arbitrário: compara o resultado com os 6 FPS observados. Um
resultado igual ou inferior a 6 FPS significa que o deploy não atingiu seu
objetivo prático e deve ser diagnosticado antes da defesa.

## Falhas e recuperação

- Sem capacidade de T4 na zona, a criação da VM deve tentar outra zona de
  `southamerica-east1`; isso é capacidade, não cota.
- Se a GPU não aparecer no contêiner, o launcher para antes do worker e aponta
  driver/runtime NVIDIA como causa provável.
- Se a URL do túnel não surgir dentro do prazo, contêineres transitórios são
  encerrados e nenhuma origem curinga é usada.
- Se migration ou seed falhar, API e worker não são publicados como prontos.
- Se o worker cair, frontend informa indisponibilidade sem mudar silenciosamente
  para inferência local durante uma rodada.
- Se o Quick Tunnel reconectar com outro hostname, a execução é reiniciada para
  regenerar as allowlists; `status.sh` detecta a divergência, não há recuperação
  automática durante uma rodada e não se relaxa CORS.
- Se o volume estiver corrompido, o operador escolhe explicitamente entre
  restaurar backup ou recriar somente o banco de demonstração.
- Se a Internet externa falhar no dia, o fluxo Windows/local permanece como
  contingência documentada.

## Riscos e compensações

- Uma única VM continua sendo ponto único de falha, mas é apropriada para uma
  demonstração temporária.
- O Quick Tunnel pode introduzir latência ou instabilidade; a região próxima e
  a remoção do desktop residencial ainda eliminam um salto importante.
- Construir PyTorch/CUDA pode consumir tempo e disco; imagens fixadas e cache
  do Docker tornam reinícios posteriores mais previsíveis.
- T4 melhora inferência, mas não corrige por si só compressão, rede ou janela
  temporal. As métricas ponta a ponta continuam obrigatórias.
- O custo continua enquanto a VM estiver ligada, mesmo sem usuário. Parar os
  contêineres não interrompe cobrança da VM/GPU.
- Quick Tunnel e STUN não garantem WebRTC em toda rede; TURN permanece uma
  entrega separada se o vídeo peer-to-peer for indispensável.

## Compatibilidade do worker entre Windows e Linux

O manifesto do worker continuará único. `pyproject.toml` e `uv.lock` serão
ampliados para resolver explicitamente Windows e Linux x86-64. Python 3.10,
CUDA 13.0 e as demais dependências permanecem fixados; PyTorch e Torchvision
sobem juntos para `2.14.0+cu130` e `0.29.0+cu130`, par publicado oficialmente
para CPython 3.10 tanto em Windows quanto em Linux x86-64. Não será criado um
segundo conjunto de versões exclusivo do contêiner, pois isso permitiria que o
worker local e o worker da VM divergissem silenciosamente.

A alteração só é aceita se `uv sync --frozen`, a suíte determinística e o smoke
CUDA passarem nos dois ambientes. Como é uma troca de runtime de inferência,
ela também exige repetir o benchmark do modelo no Windows e na T4 antes da
defesa. A imagem Linux usa o mesmo lock. O fluxo Windows permanece suportado e
documentado.

## Critérios de aceite

- A VM executa frontend, API, PostgreSQL, worker, gateway e túnel sem depender
  do desktop.
- `docker compose config` e todos os builds passam em Linux.
- O worker vê a T4, valida o modelo e aceita uma estação por WSS.
- Um navegador em outra rede usa uma única URL HTTPS para login, REST,
  Socket.IO e gestos.
- Nenhuma porta da aplicação ou banco está aberta publicamente.
- Origem, JWT, senha do banco e token não estão em imagem, Git, URL ou logs.
- Falha parcial não divulga o ambiente como pronto e a limpeza não afeta outros
  contêineres nem os volumes persistentes de banco e uploads.
- `stop.sh` invalida a URL; o runbook deixa explícito que a VM deve ser parada
  para encerrar a cobrança.
- O fluxo Windows existente continua funcionando.
- O teste pela rede da faculdade registra FPS e latência ponta a ponta para
  comparação com os 6 FPS observados.
