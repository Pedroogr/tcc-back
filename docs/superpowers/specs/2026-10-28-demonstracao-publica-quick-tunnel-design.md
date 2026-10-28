# Demonstração pública temporária com Cloudflare Quick Tunnel

**Data:** 2026-10-28
**Projetos:** `tcc-back` e `tcc-front`
**Status:** aprovado
**Natureza:** exposição temporária para demonstração, não implantação em produção

## Intenção

Permitir que uma pessoa da banca abra uma única URL HTTPS em um navegador
recente, autorize a câmera e use o sistema sem instalar VPN, extensão ou
aplicativo. O frontend, o backend NestJS, o PostgreSQL e o worker Python/CUDA
continuam executando no desktop Windows. Um Cloudflare Quick Tunnel publica
temporariamente um gateway HTTP local.

A solução serve à defesa e aos testes externos do TCC. Ela não pretende manter
o produto disponível continuamente nem substituir um futuro deploy do
frontend, da API e do banco.

## Objetivos

- oferecer uma única URL `https://*.trycloudflare.com` para a demonstração;
- servir o frontend e encaminhar HTTP, Socket.IO e o WebSocket de poses pelo
  mesmo host público;
- permitir acesso a partir de outra rede sem configuração no computador da
  banca;
- preservar o desktop com RTX 3070 Ti como único worker de inferência;
- manter token, frames e resultados fora da URL, do bundle e dos logs;
- iniciar e verificar o ambiente por um comando PowerShell reproduzível;
- encerrar somente os processos criados pelo iniciador da demonstração;
- preservar os modos locais existentes como contingência explícita.

## Não objetivos

- implantação permanente ou disponibilidade de produção;
- URL estável após o encerramento do `cloudflared`;
- funcionamento com o desktop desligado ou sem Internet;
- múltiplas estações de gestos simultâneas;
- expor diretamente as portas `3000`, `8080` ou `8765` no roteador;
- incorporar o token do worker no frontend ou em parâmetros de URL;
- registrar imagens contínuas, poses ou tokens;
- resolver nesta entrega a conectividade WebRTC por TURN;
- substituir autenticação, autorização ou regras comerciais existentes.

## Restrições e premissas

- A banca usa somente navegador; downloads no desktop servidor são aceitos.
- O desktop executa Windows, CUDA e a RTX 3070 Ti já validada.
- O PostgreSQL e os dados de demonstração permanecem locais.
- A primeira versão aceita uma estação autenticada por vez.
- A pessoa usa uma conta de demonstração e informa um token efêmero na tela da
  estação. O token permanece apenas em `sessionStorage`, como hoje.
- A demonstração usa um banco separado do banco de desenvolvimento, com seed
  determinístico e idempotente. O iniciador nunca apaga, restaura ou altera o
  banco habitual do usuário.
- O Quick Tunnel não possui garantia de disponibilidade, muda de hostname a
  cada nova execução e existe somente enquanto o processo continua rodando.
- O vídeo WebRTC atual usa apenas STUN. Sinalização e eventos atravessam o
  gateway, mas mídia entre redes que exijam relay dependerá de uma futura
  configuração TURN.

## Abordagens consideradas

### 1. Gateway local único e Quick Tunnel — escolhida

Um proxy reverso local recebe todo o tráfego em uma porta. O Quick Tunnel
publica somente essa porta. O frontend usa caminhos relativos, portanto o
hostname aleatório não exige recompilação.

Vantagens:

- nenhum domínio, conta Cloudflare ou deploy em nuvem;
- uma URL para site, API e WebSockets;
- HTTPS/WSS fornecido na borda da Cloudflare;
- nenhuma porta de entrada aberta no roteador;
- aproxima a jornada que a banca realmente executará.

Compensações:

- todos os serviços e a Internet residencial tornam-se pontos únicos de falha;
- a URL muda quando o túnel reinicia;
- Quick Tunnel não oferece SLA;
- exige proxy local e orquestração dos processos.

### 2. Quick Tunnel somente para o worker e aplicação em nuvem — adiada

Frontend, NestJS e PostgreSQL seriam implantados, mantendo apenas a GPU atrás
do túnel. A arquitetura se aproxima da implantação final, mas exige escolher e
configurar hospedagem antes de validar o acesso externo básico. O hostname
aleatório do worker também precisaria de configuração dinâmica.

### 3. Domínio e Named Tunnel — adiada

Um domínio na Cloudflare forneceria hostname estável e túnel gerenciável. É a
evolução natural se a demonstração temporária funcionar, porém adiciona compra,
conta e configuração que não são necessárias ao primeiro teste.

### 4. Encaminhamento público de portas — rejeitada

Publicar o FastAPI, NestJS ou um proxy diretamente no roteador aumentaria a
superfície de ataque, exigiria TLS/DDNS e contrariaria a decisão de não expor a
porta de inferência à Internet.

## Arquitetura selecionada

```text
Navegador da banca
        |
        | HTTPS / WSS
        v
https://<aleatorio>.trycloudflare.com
        |
        | Cloudflare Quick Tunnel iniciado pelo desktop
        v
Gateway local :8080
        |-- /                         -> arquivos de tcc-front/dist
        |-- /api/*                    -> NestJS :3000, removendo /api
        |-- /socket.io/*              -> Socket.IO/NestJS :3000
        `-- /v1/pose                  -> FastAPI/Uvicorn :8765
                                               |
                                               `-> YOLO11s Pose / CUDA
```

O PostgreSQL continua acessível somente pelo NestJS na máquina local. O
`cloudflared` enxerga apenas o gateway. O gateway não acessa o banco e não
interpreta frames ou eventos.

## Gateway local

A proposta usa Caddy como binário local e configuração versionada. Ele já
possui suporte a proxy de upgrade WebSocket, arquivos estáticos e fallback de
SPA, evitando implementar um proxy próprio dentro do NestJS ou do worker
Python.

Responsabilidades:

- escutar somente na porta local escolhida para a demonstração;
- servir o build de produção do React;
- aplicar fallback para `index.html` nas rotas do SPA;
- retirar o prefixo `/api` antes de encaminhar REST ao NestJS;
- encaminhar `/socket.io` preservando upgrade e query string;
- encaminhar `/v1/pose` preservando o WebSocket binário;
- não armazenar corpo, JPEG, token ou resposta.

O Caddy não será responsável por TLS público: a Cloudflare termina HTTPS/WSS e
o trecho local permanece em loopback HTTP. As portas internas não precisam ser
liberadas no firewall público.

## Configuração do frontend

O build de demonstração usa a mesma origem pública:

- REST: base `/api`;
- Socket.IO: origem atual, caminho `/socket.io`;
- poses: converter o caminho `/v1/pose` para `ws:` ou `wss:` conforme
  `window.location.protocol`;
- inferência: modo `remote` explícito;
- token: informado em tempo de execução e salvo somente na sessão da aba.

O leitor de configuração deverá aceitar URLs absolutas, preservando o uso LAN,
e caminhos relativos, necessários ao túnel. A resolução será testada sem
depender de um hostname real.

O cliente remoto continuará com uma inferência em andamento e um frame
pendente mais recente. Nesta etapa, uma queda não muda silenciosamente para o
modelo local. O usuário recebe estado de desconexão e pode tentar novamente.

## Configuração do backend e do worker

O NestJS continua ouvindo apenas na porta local configurada. Como o navegador
acessa REST e Socket.IO pela mesma origem pública, o proxy elimina dependência
de hostname fixo no cliente. As políticas existentes de autenticação e
autorização permanecem obrigatórias.

O worker Python continua exigindo:

- uma origem permitida;
- token na primeira mensagem;
- protocolo versão 1;
- uma estação ativa;
- tamanho máximo do JPEG e timeout existentes.

O iniciador deve obter primeiro o hostname do Quick Tunnel e então iniciar ou
reiniciar somente o worker com esse `Origin` exato na allowlist. Não será
permitido um curinga geral de origem. O token será gerado criptograficamente,
copiado para a área de transferência e exibido uma vez no resumo local.

## Inicialização e encerramento

Serão criados dois comandos PowerShell versionados. Um comando de preparação,
executado conscientemente antes do dia da banca, instala ou orienta a instalação
de Caddy e `cloudflared`, prepara o banco isolado e valida dependências. Ele pode
solicitar privilégio administrativo quando a ferramenta de instalação exigir.

O comando usado no dia da apresentação não instala software nem pede
privilégio administrativo. Se uma dependência estiver ausente, ele interrompe
antes de alterar estado e informa como executar a preparação.

O iniciador da demonstração deve:

1. verificar pré-requisitos (`uv`, Node/npm, Caddy, `cloudflared`, modelo e
   CUDA);
2. verificar ou iniciar o PostgreSQL de demonstração isolado e aplicar
   migrations mais seed idempotente;
3. compilar o frontend com configuração relativa de demonstração;
4. iniciar NestJS e gateway em processos identificados;
5. aguardar health checks locais;
6. iniciar o Quick Tunnel e extrair de seus logs somente a URL pública;
7. gerar o token efêmero;
8. iniciar o worker com origem pública exata e monitor opcional;
9. testar health local do worker e executar o smoke público descrito abaixo;
10. mostrar URL, token, QR Code opcional e estado de cada componente.

Logs de execução ficam em uma pasta exclusiva sob `%TEMP%`, sem segredos. Um
manifesto de runtime guarda PIDs, portas e caminhos dos logs. O comando de
encerramento valida esse manifesto e para somente os processos que ele criou.
Processos preexistentes ou portas ocupadas causam erro explicativo; não serão
encerrados por nome ou por varredura ampla.

O smoke público não cria um novo endpoint com metadados internos. Ele valida:

- `GET /` para confirmar túnel, gateway e frontend;
- `GET /api/auctions/public` para confirmar gateway, NestJS e banco sem usar
  credenciais;
- handshake autenticado em `WSS /v1/pose` para confirmar túnel, gateway,
  worker, token, modelo e CUDA.

Detalhes do `/health` do worker permanecem locais. O resumo público registra
somente sucesso, falha e duração de cada etapa.

## Fluxo da banca

1. O apresentador inicia o ambiente e recebe a URL.
2. A URL é aberta por uma rede externa para o smoke test.
3. A banca abre o link ou lê um QR Code.
4. A pessoa entra com uma conta de demonstração.
5. Na estação de gestos, informa o token temporário.
6. O navegador solicita permissão para a câmera.
7. Frames JPEG seguem por WSS até o desktop; poses voltam no mesmo canal.
8. O monitor local permite observar o que a GPU recebeu e detectou.

O token não será colocado no QR Code nem em query string. A URL sozinha não
concede acesso às funções autenticadas nem ao worker de gestos.

## Segurança e privacidade

- O túnel é iniciado de dentro para fora; não há port forwarding.
- HTTPS/WSS termina na Cloudflare e o trecho até `cloudflared` usa o túnel.
- O gateway e os serviços de origem ficam limitados ao host local sempre que a
  ferramenta permitir.
- JWT do sistema e token do worker mantêm funções distintas.
- O worker valida o `Origin` aleatório exato e o token por comparação segura.
- Tokens não aparecem em argumento de processo, URL, QR Code ou log.
- O monitor OpenCV permanece local e não cria outro endpoint de imagem.
- Frames contínuos continuam efêmeros e não são gravados.
- A URL é desativada ao encerrar o Quick Tunnel.

## Falhas e recuperação

- Se o Quick Tunnel cair mas o processo continuar, o `cloudflared` pode tentar
  reconectar; o frontend deve indicar a perda da sessão.
- Se o processo encerrar, a URL antiga deixa de ser válida. Uma nova execução
  gera URL, token e QR Code novos.
- O iniciador deve falhar antes de divulgar a URL se API, GPU ou handshake não
  estiverem prontos.
- O fechamento inesperado do worker não derruba a API comercial; a estação
  mostra indisponibilidade.
- O frontend não troca automaticamente de inferência remota para local durante
  uma rodada.
- A contingência da defesa é executar o sistema localmente e demonstrar os
  resultados previamente medidos, caso a Internet externa não funcione.

Uma reconexão automática transparente do estimador remoto não será incluída
sem preservar o estado da rodada. A primeira entrega mantém a ação explícita
“tentar novamente”; telemetria e mensagens deverão diferenciar queda do túnel,
recusa de token e worker indisponível quando o protocolo permitir.

## WebRTC

O gateway encaminha a sinalização Socket.IO, mas o vídeo do leilão continua
peer-to-peer. O STUN atual pode funcionar entre algumas redes e falhar em NATs
ou firewalls restritivos. O teste de demonstração deve registrar se foi obtido
um candidato direto. Se a banca precisar obrigatoriamente assistir à
transmissão entre redes arbitrárias, TURN será especificado e implementado em
uma entrega própria antes de declarar essa jornada confiável.

## Validação

### Automatizada

- resolução de API relativa e absoluta no frontend;
- resolução de `ws:` e `wss:` para o caminho de poses;
- Socket.IO usa a origem pública e não cria namespace `/api`;
- configuração Caddy cobre SPA, REST, Socket.IO e poses;
- iniciador não imprime token em logs e recusa conflito de porta;
- encerramento atua somente nos PIDs registrados;
- suítes existentes de frontend, backend e gesture-server continuam passando.

### Integração local

- frontend pelo gateway local;
- REST e autenticação pelo prefixo `/api`;
- Socket.IO por `/socket.io`;
- câmera para worker por `/v1/pose` usando WebSocket;
- monitor OpenCV recebe e desenha o frame.

### Integração externa

- acesso por 4G/5G, sem conexão à LAN do desktop;
- câmera autorizada em origem HTTPS;
- login, consulta do leilão e eventos Socket.IO;
- autenticação do worker e sequência sustentada de frames;
- registro de RTT, FPS, p50/p95 e desconexões;
- encerramento invalida a URL pública;
- nova execução gera URL nova e volta ao estado pronto.

## Critérios de aceite

- Um navegador em outra rede abre uma única URL sem software adicional.
- Login, REST e eventos comerciais funcionam pela URL pública.
- A estação envia frames por `wss://` e recebe poses da RTX 3070 Ti.
- A URL e o token não exigem recompilar o frontend a cada execução.
- O token não aparece no bundle, na URL ou nos logs.
- Uma segunda estação recebe indisponibilidade previsível.
- O monitor local continua opcional e não persiste imagens.
- O ambiente possui comandos reproduzíveis de iniciar, verificar e encerrar.
- A documentação chama a solução de demonstração temporária, não deploy.

## Evolução posterior

Se o teste temporário atender à banca, a evolução recomendada é:

1. registrar um domínio e substituir o Quick Tunnel por Named Tunnel;
2. implantar frontend, NestJS e PostgreSQL em infraestrutura permanente;
3. manter o desktop somente como worker ou migrar inferência para GPU em
   nuvem;
4. adicionar TURN para WebRTC confiável entre redes;
5. substituir o token manual por credenciais curtas emitidas por uma camada
   autenticada, sem acoplar o worker ao banco comercial.

