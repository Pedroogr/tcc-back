# Notas de processo e decisões do TCC

**Período reconstruído:** abril a outubro de 2026
**Última atualização:** 21 de outubro de 2026
**Natureza do documento:** diário retrospectivo de engenharia e fonte para a monografia

## Como usar este documento

Este texto registra o caminho percorrido no desenvolvimento do sistema de
leilões de gado: problemas encontrados, hipóteses consideradas, alternativas,
experimentos, decisões, revisões e pontos ainda em aberto. Ele não é uma
transcrição literal de conversas nem uma exposição de raciocínio privado. É
uma reconstrução verificável baseada no código, histórico do Git, documentos
de projeto, testes, medições e históricos locais de trabalho.

Na monografia, estas notas podem apoiar principalmente os capítulos de
metodologia, desenvolvimento, avaliação e limitações. Antes da versão final,
os fatos importantes devem ser confrontados com requisitos formais, datas do
cronograma e referências bibliográficas.

## 1. Problema e objetivo do sistema

O TCC partiu da necessidade de apoiar leilões de gado com participação remota
e presencial. O sistema deveria organizar os papéis de comprador, vendedor,
leiloeira, administrador e operador, mantendo o andamento do lote coerente
para todas as pessoas conectadas.

O problema deixou de ser apenas “transmitir um leilão”. Na prática, foi
necessário combinar:

- autenticação e autorização por papel;
- cadastro e gestão de leilões e lotes;
- vídeo ao vivo;
- lances concorrentes e atualização em tempo real;
- fechamento da venda e comunicação do vencedor;
- operação presencial por uma interface simples;
- apoio visual à identificação da primeira mão levantada;
- segurança, privacidade, rastreabilidade e desempenho aceitável.

A arquitetura consolidou um backend NestJS com Prisma e PostgreSQL, um
frontend React, Vite e TypeScript, comunicação em tempo real por Socket.IO e
vídeo por WebRTC. O reconhecimento de poses começou como um experimento Python,
passou a funcionar no navegador com ONNX Runtime e, por limitação do notebook,
evoluiu para a proposta de um serviço privado de inferência em GPU.

## 2. Linha do tempo resumida

| Período | Marco | Aprendizado ou consequência |
| --- | --- | --- |
| Abril de 2026 | Estrutura inicial do backend e experimento com WebRTC | A transmissão era apenas uma parte do domínio; estado comercial e permissões precisavam de tratamento próprio. |
| Maio de 2026 | PoC de reconhecimento de gestos, usuários e autenticação | A visão computacional era viável, mas ainda estava isolada do fluxo real do leilão. |
| Junho de 2026 | Telas de transmissão, escritório, administração e lances | O produto começou a representar as jornadas dos diferentes papéis. |
| Agosto de 2026 | Recuperação de ambiente, testes E2E e reformulação visual | Reprodutibilidade e legibilidade do frontend tornaram-se requisitos de engenharia. |
| Setembro de 2026 | RF06–RF10, concorrência, venda, vencedor, IE, operador e relay de gestos | As regras de negócio passaram a ser centralizadas e protegidas por testes. |
| Início de outubro de 2026 | Estação de gestos no navegador e otimização com YOLO11n | A integração ficou simples de distribuir, porém o notebook real expôs um gargalo extremo. |
| 14–20 de outubro de 2026 | Pesquisa de GPU em nuvem, benchmark da RTX 3070 Ti e desenho do servidor remoto | A GPU doméstica mostrou desempenho suficiente; a prioridade passou a ser rede, protocolo e latência ponta a ponta. |
| 21 de outubro de 2026 | Integração Windows–Ubuntu e primeiro smoke pela LAN | Saúde, autenticação e WebSocket/JPEG funcionaram entre o notebook Ubuntu e a RTX. Uma amostra concluiu em `48,962 ms` ponta a ponta, mas um frame sintético comprova o caminho técnico, não p95 nem precisão. |

## 3. Evolução por fase

### 3.1. Arquitetura inicial e recuperação do ambiente

As primeiras entregas estabeleceram o backend e a transmissão. À medida que o
domínio cresceu, usuários, leilões, lotes, lances e eventos em tempo real
passaram a exigir módulos próprios. A escolha de NestJS favoreceu a separação
por módulos e a integração com autenticação, WebSocket e Prisma.

Uma dificuldade importante foi fazer o projeto voltar a executar de modo
reproduzível. O arquivo de ambiente precisou ser reconstituído, houve conflito
de porta do PostgreSQL e o banco local foi movido de `5433` para `5434`. As
migrations foram reaplicadas e os comandos de build e inicialização foram
conferidos. Esse episódio mostrou que configuração, migrations e instruções de
setup fazem parte do sistema, mesmo quando não aparecem na interface.

Decisão resultante: o PostgreSQL e o Prisma continuariam como fonte de verdade
do domínio comercial, e serviços auxiliares não deveriam criar uma segunda
fonte de estado.

### 3.2. Reformulação do frontend

Em agosto, a interface foi avaliada como funcional, porém simples e sem uma
identidade visual coerente com o contexto de leilões. Foi escolhida uma direção
visual escura, sem tema claro alternativo, com aparência de mercado ao vivo e
referências rurais discretas. Foram definidos tokens de cor, tipografia,
componentes e estados responsivos.

O arquivo principal do React havia concentrado responsabilidades demais. A
reformulação visual também serviu para decompor essa estrutura, aproximando
componentes, rotas e regras das jornadas a que pertenciam. A decisão não foi
apenas estética: uma tela de operação precisa mostrar preço, lote, conexão e
ações críticas com hierarquia clara e sem ambiguidades.

Alternativas consideradas:

- manter a interface original e mudar somente cores: menor esforço, mas não
  resolvia a hierarquia nem a concentração de responsabilidades;
- oferecer tema claro e escuro desde o início: aumentaria a superfície de
  testes sem benefício essencial para o cenário de uso;
- redesenhar e extrair componentes gradualmente: opção escolhida por melhorar
  usabilidade e manutenção sem reescrever a aplicação inteira.

### 3.3. Rede de segurança por testes

Com o crescimento do sistema, alterações locais começaram a produzir efeitos
em autenticação, banco, gateway e telas. Foi adotada uma estratégia em camadas:

- testes unitários para regras puras e casos-limite;
- testes de integração/E2E do backend contra PostgreSQL isolado;
- testes de interface e jornadas críticas com Playwright;
- testes de contrato para evitar que mocks escondessem incompatibilidades.

Os testes expuseram divergências reais entre frontend e backend. A lição foi
que um mock “conveniente” pode fazer uma tela parecer correta mesmo quando o
contrato real está diferente. A prioridade passou a ser testar regras
financeiras, autorização, concorrência e contratos nos limites onde uma falha
teria maior impacto.

Também surgiram dificuldades de infraestrutura: em algumas execuções o
Playwright completou os casos, mas o processo não encerrou; em outra, a limpeza
de `dist` falhou com `EPERM`, embora o TypeScript validasse com `--noEmit`.
Esses incidentes foram registrados separando falha do produto, falha do teste
e falha do ambiente.

### 3.4. Leilão em tempo real e requisitos RF06–RF10

Os requisitos de atualização do valor, confidencialidade durante a disputa,
fechamento da venda e aviso ao vencedor transformaram o fluxo em uma operação
concorrente. Não bastava atualizar a interface: o backend precisava decidir de
forma atômica qual lance era válido e qual resultado era definitivo.

A solução concentrou as invariantes no backend e usou transações com nível de
isolamento serializável nos pontos críticos. Socket.IO distribuiu eventos, mas
não se tornou a fonte de verdade. A aplicação persistiu a venda e depois
notificou os clientes autorizados.

Decisões importantes:

- durante a disputa, informações sensíveis do comprador não seriam expostas
  para outros participantes;
- o valor deveria avançar por uma regra comum, inclusive no lance presencial;
- valores iguais ou regressivos não poderiam ser aceitos;
- o vencedor receberia confirmação, mas o estado persistido continuaria sendo
  a referência após reconexões;
- fechamento e emissão de eventos precisavam ser idempotentes ou protegidos
  contra repetição.

Um erro posterior, em que um lance de mesmo valor ainda podia ser aceito,
reforçou a necessidade de uma função única de progressão de preço e de testes
para os limites `menor`, `igual` e `maior`.

### 3.5. Comprador com IE e operação presencial

Para representar compradores profissionais, o cadastro passou a exigir
Inscrição Estadual acompanhada da UF. Para o operador no local, foi desenhado
um acesso temporário e restrito ao leilão, evitando transformar o dispositivo
de pista em uma conta administrativa permanente.

A interface do operador foi priorizada antes da integração completa do
reconhecimento. Isso permitiu validar primeiro o fluxo humano: visualizar o
lote atual, lançar rapidamente, diferenciar origem `ONLINE` e `ON_SITE` e
receber alertas. A entrada por gesto viria como assistência, não como substituta
da confirmação humana.

Decisões resultantes:

- códigos de operador são de uso único, possuem escopo e expiração;
- a tela é mobile-first e contém somente ações necessárias à pista;
- a regra de preço é compartilhada entre canais;
- o lote corrente é definido pelo backend;
- reconhecimento de mão nunca registra automaticamente um lance.

### 3.6. Do PoC Python à estação de gestos no navegador

O reconhecimento começou com webcam, OpenCV e YOLO Pose em Python. Esse PoC
confirmou que keypoints de ombro, cotovelo e punho poderiam indicar uma mão
levantada. Para integrar a função ao produto, a inferência foi levada ao
navegador com ONNX Runtime, WebGPU e fallback WASM.

A estação foi separada da tela do operador. Ela observa a câmera, rastreia as
pessoas e, após confirmação temporal, envia um snapshot e um alerta. O
operador continua responsável por associar o gesto ao contexto real e efetuar
o lance. Essa separação reduziu acoplamento e tornou mais explícitos os limites
éticos do recurso.

O primeiro modelo distribuído era mais pesado. Para tornar o navegador mais
viável, adotou-se `yolo11n-pose.onnx` com entrada 640. Também foram criados um
Web Worker, descarte de sobreposição de inferências, medição de throughput e
fallback WebGPU/WASM. O tracker passou a acompanhar pessoas entre amostras e a
considerar a primeira confirmação válida, em vez de reagir a um único frame.

Limitações observadas:

- enquadramento, oclusão, iluminação e distância alteram os keypoints;
- um frame isolado gera falsos positivos e falsos negativos;
- “primeira pessoa” é uma decisão temporal, não apenas a posição na imagem;
- desempenho do navegador varia muito conforme GPU, driver e implementação de
  WebGPU/WASM;
- a câmera frontal pode espelhar a percepção de esquerda e direita.

### 3.7. Crise de desempenho no notebook e pesquisa de alternativas

No notebook destinado ao uso da estação, a inferência chegou a cerca de
`0,1 FPS`. A experiência mostrou que uma arquitetura elegante no ambiente de
desenvolvimento pode falhar no hardware de implantação. Foram avaliados:

- continuar otimizando o modelo local;
- trocar ou quantizar a biblioteca/modelo;
- executar todo o sistema em um servidor;
- alugar uma GPU sob demanda;
- usar o desktop doméstico com GPU como worker privado.

A execução totalmente local continuou importante como fallback, mas não
atendia sozinha ao equipamento real. Serviços de GPU em nuvem ofereceriam
elasticidade, porém adicionariam custo recorrente, cold start e dependência do
provedor. Como havia uma RTX 3070 Ti disponível no desktop, decidiu-se medir
antes de contratar infraestrutura.

### 3.8. Benchmark da RTX 3070 Ti

O driver reconhecia a GPU, mas o Python global possuía uma instalação de
PyTorch sem suporte CUDA. Em vez de alterar o ambiente global, foi criado um
ambiente virtual isolado. Nele foram instalados PyTorch e torchvision com CUDA
e a versão necessária do Ultralytics.

O isolamento resolveu dois problemas: evitou quebrar outros projetos e tornou
as dependências do experimento explícitas. Com `yolo11s-pose.pt`, entrada 640
e FP16, os resultados foram:

| Cenário | Resultado |
| --- | --- |
| Frame sintético, inferência | média de 15,56 ms; p50 de 15,23 ms; p95 de 18,33 ms; aproximadamente 64,25 FPS |
| Webcam 1920 × 1080, inferência | p50 de 17,30 ms; p95 de 24,40 ms |
| Webcam, captura mais inferência | p50 de 39,52 ms; p95 de 51,81 ms |
| Verificação visual | aproximadamente 25,5 FPS e 13,3 ms de inferência em uma amostra, com a mão reconhecida corretamente |

Os números provaram que a GPU não era o gargalo dominante. Ainda faltava medir
compressão, transporte, decodificação, tracking e apresentação no notebook.
Por isso, o objetivo de desempenho foi definido como latência ponta a ponta,
e não apenas FPS ou tempo informado pelo modelo.

### 3.9. Servidor privado de inferência em GPU

Foi aprovada uma arquitetura em que o desktop executa um serviço Python
independente, enquanto o notebook conserva câmera, interface, tracking e regra
de confirmação. O serviço recebe JPEG por WebSocket, executa YOLO11s Pose com
CUDA e devolve poses e tempos. Ele não acessa o banco e não conhece usuários,
lotes ou lances.

FastAPI foi escolhido para esse serviço porque a inferência já depende do
ecossistema Python/PyTorch. Usar NestJS como intermediário adicionaria uma
travessia e dois processos sem remover o processo Python. O NestJS permanece
como backend de negócio. O serviço Python é semelhante a um microserviço pela
independência de processo e responsabilidade, embora não precise acessar banco
para receber esse nome.

A comunicação será protegida por WireGuard direto. Tailscale, NetBird ou
ZeroTier ficam como contingência caso o roteador não permita a configuração.
Não será usado modo bridge, e a porta do FastAPI não será publicada diretamente
na Internet. A primeira versão aceita uma estação e uma inferência por vez,
com política “o frame mais recente vence” para impedir o crescimento de filas.

O modo local no navegador permanece disponível de forma explícita. Não haverá
troca silenciosa de `remote-cuda` para WebGPU/WASM durante uma rodada, pois isso
mudaria latência e comportamento sem o operador perceber.

Há uma tensão ainda aberta: o tracker atual exige três confirmações durante
pelo menos 250 ms, valor que sozinho consome toda a meta de latência. Serão
comparadas janelas de 80, 100 e 120 ms, medindo simultaneamente velocidade,
falsos positivos e falsos negativos.

## 4. Matriz das principais decisões

| Problema | Alternativas relevantes | Decisão | Evidência e compensação |
| --- | --- | --- | --- |
| Fonte de verdade do leilão | Socket, cliente ou banco/backend | Backend NestJS + PostgreSQL | Preserva consistência e reconexão; exige transações e mais testes. |
| Concorrência de lances | Validação no cliente ou transação no servidor | Regra no servidor e isolamento serializável | Evita duas vitórias válidas; pode exigir repetição em conflito. |
| Interface visual | Ajuste cosmético ou redesign estruturado | Tema escuro e componentes extraídos | Mais trabalho inicial, melhor hierarquia operacional. |
| Operação presencial | Conta administrativa ou acesso temporário | Código único, restrito e expirável | Reduz privilégio; cria ciclo de emissão e consumo do código. |
| Decisão a partir do gesto | Lance automático ou assistência | Alerta e snapshot para decisão humana | Menos automação, mas reduz risco de falso lance. |
| Inferência inicial | Python separado ou navegador | Navegador com WebGPU/WASM | Distribuição simples e privacidade local; dependência forte do hardware. |
| Modelo local | YOLO11s ou YOLO11n | YOLO11n a 640 | Ganha velocidade; precisão precisa continuar sendo avaliada. |
| Superar limitação do notebook | GPU em nuvem ou GPU doméstica | RTX 3070 Ti doméstica | Sem custo recorrente; disponibilidade e rede passam a ser responsabilidade do projeto. |
| Serviço de GPU | Incorporar ao NestJS ou Python independente | FastAPI + PyTorch, um worker | Evita ponte Node/Python; adiciona um serviço para operar. |
| Transporte | HTTP por frame, WebRTC ou WebSocket | WebSocket com JPEG | Protocolo simples e contínuo; exige backpressure explícito. |
| Rede externa | Exposição pública, VPN gerenciada ou WireGuard | WireGuard direto | Menor dependência e rota direta; exige configuração de roteador e chaves. |
| Falha remota | Fallback automático ou escolha explícita | Interromper rodada e permitir troca manual | Evita comportamento invisível; demanda intervenção do operador. |

## 5. Dificuldades e como influenciaram o projeto

### Ambiente e ferramentas

- Conflito de porta do PostgreSQL: levou à documentação explícita do ambiente
  e à separação entre configuração local e código.
- Docker indisponível ou inconsistente em alguns momentos: reforçou a
  necessidade de comandos de verificação e alternativas de diagnóstico.
- `EPERM` na pasta de build: a validação por TypeScript sem emissão permitiu
  distinguir problema de permissão de erro de tipagem.
- Testes Playwright que não encerravam: sucesso dos casos e encerramento do
  runner passaram a ser verificados separadamente.
- Restrições de escrita em objetos Git: foi usado um clone temporário para uma
  entrega anterior, preservando a árvore original e evitando comandos
  destrutivos.
- Janelas gráficas invisíveis na sessão automatizada: a validação visual da
  webcam precisou ser executada pelo usuário na sessão interativa.

### Domínio e consistência

- Eventos em tempo real podiam dar uma aparência correta enquanto o estado
  persistido estava incorreto. A emissão passou a ocorrer ao redor de uma
  operação autoritativa no backend.
- Lance igual aceito revelou duplicação ou lacuna na regra de preço. A regra
  foi direcionada para um ponto comum e cercada por testes de limite.
- Vencedor e contatos exigiram distinguir quem pode ver o quê durante e depois
  do lote.
- Canal presencial e canal online precisavam produzir a mesma progressão de
  preço sem perder a origem do lance.

### Visão computacional e desempenho

- A medição no desktop não representava o notebook. O hardware de implantação
  passou a fazer parte obrigatória da avaliação.
- Ter driver NVIDIA não significava que o PyTorch global usava CUDA. Um
  ambiente isolado e uma verificação explícita do dispositivo passaram a ser
  pré-condições.
- FPS sozinho escondia captura, rede e confirmação. A métrica principal mudou
  para p95 da captura até a apresentação.
- Uma fila convencional aumentaria atraso quando a entrada fosse mais rápida
  que a GPU ou a rede. A política escolhida mantém somente o frame mais recente.
- A primeira requisição real após iniciar o CUDA levou cerca de `2,55 s`,
  enquanto o smoke local aquecido levou `37,575 ms` ponta a ponta. O cliente
  passou a executar três frames de aquecimento não contabilizados para separar
  inicialização de desempenho em regime estável.
- O lock do worker é intencionalmente restrito ao Windows. No Ubuntu, o cliente
  portátil precisou ser executado com `uv run --script`; ferramentas auxiliares
  usaram `--no-project` para não tentar resolver o ambiente CUDA do servidor.
- A imagem inicialmente escolhida estava em uma pasta de uploads ignorada pelo
  Git e, portanto, não existia no notebook. Isso mostrou que a entrada de um
  benchmark precisa ser gerada ou distribuída explicitamente.

### Rede e operação

- Não havia senha administrativa disponível para o roteador durante a análise.
  A implementação foi dividida em software validável na LAN e implantação
  WireGuard posterior.
- O roteador oferecia modo bridge, mas ativá-lo removeria serviços e
  administração úteis. A decisão foi mantê-lo em modo roteador.
- Um IPv4 público torna a conexão direta possível, mas também aumenta a
  responsabilidade de não expor o FastAPI. Somente a porta UDP do túnel poderá
  ser encaminhada.
- O Windows classificava a rede local como pública. Após confirmação explícita,
  o perfil foi alterado para privado e a exceção de firewall ficou limitada à
  porta TCP `8765`, ao perfil privado e à sub-rede local.
- A instalação temporária de SSH no notebook foi considerada desnecessária para
  o ensaio e desativada. Os comandos e resultados continuaram sendo transferidos
  manualmente, sem transformar o notebook em servidor permanente.

## 6. Alternativas rejeitadas ou adiadas

- **Lance automático por gesto:** rejeitado por risco operacional e ausência
  de identificação confiável do comprador.
- **Biometria facial:** fora do objetivo, desnecessária e mais sensível em
  privacidade.
- **Persistir vídeo e poses:** rejeitado na primeira versão; não é necessário
  para a função e ampliaria riscos e armazenamento.
- **Mover toda a aplicação para o desktop:** não resolve implantação, mistura
  responsabilidades e reduz flexibilidade.
- **Executar inferência dentro do NestJS:** o modelo continuaria exigindo um
  runtime Python ou uma segunda implementação.
- **GPU em nuvem imediatamente:** adiada porque a GPU disponível apresentou
  grande folga; continua alternativa se disponibilidade doméstica for
  insuficiente.
- **Tailscale como primeira opção:** substituído por WireGuard direto após a
  constatação de que há caminho para IPv4 público e preferência por menor
  dependência externa.
- **Expor FastAPI por port forwarding:** rejeitado; autenticação de aplicação
  não substitui túnel e firewall.
- **Múltiplos workers Uvicorn:** rejeitado para a primeira versão, pois cada
  processo pode duplicar o modelo e disputar a mesma GPU.
- **Fallback remoto/local automático:** rejeitado durante uma rodada para não
  esconder mudanças de desempenho e semântica.

## 7. Privacidade, segurança e responsabilidade humana

O reconhecimento foi delimitado como assistência operacional. Ele detecta
poses e produz um alerta; não identifica biometricamente a pessoa e não cria
um lance. A decisão final permanece com o operador.

Frames são efêmeros e não devem ser salvos pelo serviço de inferência. Logs
devem conter somente identificadores técnicos, tamanhos, durações e códigos de
erro. Tokens, imagens, IP público e dados de compradores não devem aparecer em
logs ou documentos versionados.

Na rede, a defesa é composta: WireGuard, firewall, token na primeira mensagem
WebSocket, validação de origem e ausência de exposição pública do serviço. A
chave da VPN e o token da aplicação têm ciclos de vida independentes.

## 8. Hipóteses, evidências e pendências experimentais

### Hipóteses já apoiadas por evidência

- A RTX 3070 Ti executa YOLO11s Pose a 640 com folga para uma estação.
- O modelo local leve funciona bem no desktop e permanece útil como fallback.
- A regra de gestos pode compartilhar tracker e relay independentemente de o
  estimador ser local ou remoto.
- Separar inferência e domínio impede que o worker de GPU se torne uma segunda
  API de negócio.
- O notebook Ubuntu consegue autenticar, enviar JPEG por WebSocket e receber a
  pose processada pela RTX do desktop através da LAN. Em três rodadas com vídeo,
  os `900/900` frames foram concluídos sem perdas e o p95 do cliente permaneceu
  entre `29,987` e `37,804 ms`. Isso ainda não mede tracker, apresentação ou
  precisão da pose.

### Hipóteses ainda não validadas

- O p95 ponta a ponta ficará abaixo de 250 ms pela Internet residencial.
- JPEG a 640 preservará precisão suficiente em iluminação e distâncias reais.
- Uma janela de 80, 100 ou 120 ms reduzirá latência sem elevar falsos positivos.
- A conexão residencial e o desktop terão disponibilidade suficiente para o
  uso pretendido.
- O acesso direto ao WireGuard funcionará sem CGNAT, bloqueio de porta ou
  mudança frequente de endereço; DDNS pode ser necessário.

### Próximas medições

O ensaio controlado usará uma única gravação real de 20 segundos a `15 FPS`,
dividida em quatro fases de cinco segundos: braços abaixados, uma mão levantada,
mão abaixada e a outra mão levantada. Reutilizar o mesmo arquivo nas três
rodadas e na comparação local/remota reduz variação da entrada; iluminação,
distância, enquadramento e pessoas presentes ainda precisam ser registrados.

Em 21 de outubro, a sequência foi gravada no notebook Ubuntu e salva
temporariamente em `/tmp/tcc-gesture-lan.mp4`. Isso concluiu a preparação da
entrada reproduzível. A inspeção confirmou abertura correta, resolução
`640×480`, `15 FPS`, `300` frames e `20,0 s` de duração. A gravação e seus
metadados ainda não constituem evidência de desempenho ou precisão; as três
rodadas permaneciam pendentes naquele momento.

Na primeira rodada LAN, os `300` frames foram enviados e concluídos sem
descarte, substituição ou rejeição. O p95 foi de `29,282 ms` para RTT,
`15,747 ms` para inferência, `18,685 ms` para o servidor e `31,997 ms` desde a
leitura do frame até a resposta WebSocket. O throughput observado foi de
`37,778 FPS`, mas esse valor resulta da leitura do arquivo sem ritmo de
reprodução e não deve ser confundido com os `15 FPS` da gravação ou com FPS de
apresentação. Tracker e pintura no navegador não fizeram parte desta rodada.

Na segunda rodada, os `300` frames também foram concluídos sem perdas. O p95
foi de `34,329 ms` para RTT, `14,262 ms` para inferência, `17,807 ms` para o
servidor e `37,804 ms` até a resposta. A diferença em relação à primeira
rodada concentrou-se mais no transporte e na compressão do que na inferência,
mas a terceira repetição ainda era necessária antes de resumir a estabilidade.

Na terceira rodada, novamente não houve perdas entre os `300` frames. O p95
foi de `26,475 ms` para RTT, `15,088 ms` para inferência, `17,966 ms` para o
servidor e `29,987 ms` até a resposta. Considerando as três rodadas, foram
concluídos `900/900` frames, o throughput médio foi de `37,941 FPS` e a média
dos p95 por rodada foi de `30,029 ms` para RTT, `15,032 ms` para inferência,
`18,153 ms` para servidor e `33,263 ms` até a resposta. Essa média resume os
três agregados e não equivale a recalcular o p95 sobre as 900 amostras.

O servidor medido executava Windows 11 Pro build `26200`, Ryzen 9 5900X,
`31,9 GiB` de RAM, RTX 3070 Ti de `8 GiB` e driver NVIDIA `617.42`. O ambiente
Python usava Python `3.10.11`, PyTorch `2.13.0+cu130`, Ultralytics `8.4.177` e
OpenCV `5.0.0`. Essas versões foram registradas junto ao roteiro para permitir
comparações futuras sem tratar o resultado como independente do ambiente.

O cliente era um Dell Inspiron 15 3520 com Ubuntu `25.10`, kernel
`6.17.0-41-generic`, Intel Core i5-1235U, `14 GiB` de RAM, Python `3.10.22` e
uv `0.13.4`. A primeira coleta das versões das bibliotecas falhou ao consultar
o atributo de versão do módulo OpenCV; os dados já emitidos foram preservados e
a consulta pelos metadados dos pacotes confirmou opencv-python `5.0.0.93` e
websockets `16.1.1`, sem reinstalar o projeto do servidor no Linux.

A gravação foi feita com iluminação natural e a webcam integrada do notebook,
que estava apoiado no colo, a aproximadamente `30 cm` da pessoa. O
enquadramento mostrava o tronco de uma única pessoa.

Ao planejar a instrumentação do navegador, foi considerada inicialmente a
exibição de todas as métricas em um painel. A proposta foi reduzida porque a
finalidade da estação é auxiliar a operação, não apresentar telemetria ao
pisteiro. A interface normal permaneceu inalterada; somente a rota com
`?benchmark=1` mostra o estado, a quantidade de amostras e ações de zerar e
exportar. Os detalhes ficam no JSON agregado, sem imagens, poses ou token.

A instrumentação inicia o relógio antes da criação do frame, separa resposta,
tracker e apresentação e encerra a medição após uma oportunidade de pintura do
navegador. RTT foi mantido como métrica diagnóstica de ida do frame e volta da
resposta, incluindo o trabalho remoto, mas não foi confundido com latência
percebida. O desenvolvimento test-first elevou a suíte do frontend de 104 para
116 testes; lint e build também passaram. A coleta real no notebook ainda era
necessária para preencher os percentis de tracker, apresentação e ponta a
ponta.

1. Medir tracker e apresentação na estação web para completar a latência percebida.
2. Testar queda do serviço, interrupção segura e reconexão.
3. Comparar YOLO11n local e YOLO11s remoto com o mesmo vídeo.
4. Avaliar falsos positivos e falsos negativos nas três janelas temporais.
5. Repetir por WireGuard fora da rede doméstica e medir perda e jitter.

## 9. Lições que podem fundamentar a monografia

1. **Requisitos funcionais e implantação são inseparáveis.** O reconhecimento
   funcionava conceitualmente, mas o notebook real mudou a arquitetura.
2. **Tempo do modelo não é tempo percebido.** Captura, transporte, filas,
   tracking e interface precisam entrar na mesma métrica.
3. **Tempo real não elimina uma fonte autoritativa.** WebSocket distribui
   mudanças; transação e banco definem o resultado comercial.
4. **Automação deve ser proporcional ao risco.** Uma sugestão visual tolera
   incerteza que um lance financeiro automático não toleraria.
5. **Interfaces profundas reduzem retrabalho.** Preservar `start`, `detect` e
   `dispose` permite trocar o estimador sem reescrever o tracker.
6. **Testes valem mais nos limites críticos.** Concorrência, autorização,
   preço igual, reconexão e protocolo inválido têm prioridade sobre cobertura
   superficial.
7. **Reprodutibilidade exige isolamento.** Ambiente CUDA isolado, hash do
   modelo e versões registradas tornam o benchmark auditável.
8. **Decisões são provisórias até encontrar evidência real.** Navegador local,
   GPU em nuvem e GPU doméstica foram avaliados em momentos diferentes; mudar
   de decisão diante de novas medições foi parte do método, não uma falha.

## 10. Questões abertas

- Qual será o conjunto de vídeos e cenários usado para comparar precisão?
- Como será medido o instante exato de “apresentação” na interface?
- Qual janela temporal produz o melhor equilíbrio entre rapidez e erro?
- O serviço será iniciado por Agendador de Tarefas, NSSM ou outro gerenciador?
- Será necessário `wss://` quando a estação deixar de ser servida em localhost?
- Qual política de disponibilidade é aceitável para um TCC e qual seria
  necessária em operação comercial?
- Como documentar consentimento, retenção e finalidade das imagens em uma
  eventual implantação real?

## 11. Fontes usadas na reconstrução

### Repositórios e documentação local

- históricos Git de `tcc-back` e `tcc-front`;
- `docs/current-state.md`, `docs/agent-handoff.md` e planos de implementação;
- especificações de testes críticos, RF06–RF10, operador e reconhecimento;
- documentos de direção visual e estado atual do frontend;
- pesquisa de implantação de GPU e medições locais;
- código e testes das áreas de autenticação, leilão, lances, operador e gesto.

### Históricos locais de assistência

Foram consultados os históricos JSONL existentes neste computador para Codex e
Claude, incluindo conversas sobre redesign do frontend, requisitos em tempo
real, cadastro com IE, tela do operador, falha de desempenho do notebook e
alternativas de GPU. Eles foram usados como pistas cronológicas e conferidos
contra artefatos do repositório sempre que possível.

Não foi localizado no workspace um arquivo da monografia em `.tex`, `.docx`,
`.odt` ou `.pdf`. Também não há acesso automático, por este repositório, a
conversas que existam somente na nuvem, em outra conta, em outro computador ou
em outra ferramenta sem arquivos locais exportados. Se esses históricos forem
exportados posteriormente, este diário deve receber uma nova revisão.

## 12. Documentos relacionados

- `docs/superpowers/specs/2026-10-20-servidor-inferencia-gpu-remoto-design.md`:
  arquitetura aprovada do worker de GPU;
- `docs/superpowers/plans/2026-10-20-servidor-inferencia-gpu-remoto.md`:
  plano test-first para implementar a arquitetura;
- `tcc-front/docs/`: direção visual, estado do frontend e pesquisas de
  implantação;
- `gesture-poc/`: PoC, modelo e ferramentas locais de medição.
