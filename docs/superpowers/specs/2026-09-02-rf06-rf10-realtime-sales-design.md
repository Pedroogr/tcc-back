# RF06-RF10: lances em tempo real e pós-leilão

**Data:** 2026-09-02  
**Projetos:** `tcc-back` e `tcc-front`

## Objetivo

Completar os requisitos RF06 a RF10 com atualização de preço em tempo real,
registro auditável de todos os lances, confirmação transacional da venda,
notificação privada do comprador vencedor e acesso autorizado aos contatos de
comprador e vendedor depois do leilão.

A correção que isola sessões de comprador e escritório por aba foi concluída
antes desta especificação e não faz parte do escopo de implementação abaixo.

## Estado encontrado

- O modelo Prisma já possui `Bid` e `Sale`.
- `POST /lots/:id/bids` grava cada lance e troca o lance anterior de `WINNING`
  para `OUTBID`.
- O frontend atualiza os lances por polling a cada quatro segundos, não por
  evento em tempo real.
- As consultas públicas de lote incluem dados que identificam os autores dos
  lances.
- O frontend já contém chamadas para `/sales`, painel de confirmação, página
  "Meus arremates" e listener para `sale:won`.
- O backend atual não possui módulo de vendas, rotas `/sales` ou gateway que
  emita `sale:won`; portanto essas telas não funcionam de ponta a ponta.
- Não há uma página pós-leilão para o vendedor.

## Decisões de produto

### Visibilidade durante os lances

- Compradores veem somente o preço atual do lote, atualizado em tempo real.
- Compradores não veem histórico de lances, nome do líder, identificador do
  autor ou qualquer contato.
- O autor recebe apenas a confirmação privada de que seu próprio lance foi
  aceito pela resposta HTTP.
- O escritório responsável vê o histórico operacional completo, com valor,
  horário e nome do comprador de cada lance.
- Os lances permanecem relacionados ao comprador no banco para auditoria.

### Resultado do lote

- O sistema não anuncia a identidade do vencedor para a sala.
- O anúncio público do vencedor é responsabilidade do leiloeiro na
  transmissão.
- A sala recebe somente que o lote foi vendido e seu valor final.
- Apenas o comprador vencedor recebe a notificação `sale:won`.

### Contatos pós-leilão

- O comprador vencedor vê nome, e-mail e telefone do vendedor.
- O vendedor vê nome, e-mail e telefone do comprador vencedor.
- O escritório vê os dados de ambos.
- Quando o lote foi cadastrado diretamente pelo escritório e não possui
  vendedor associado, o comprador vê o escritório como responsável pela
  negociação.
- Contatos só são retornados para vendas confirmadas e para atores autorizados.

## Arquitetura

Será criado um gateway comercial dedicado aos eventos do leilão. Ele não será
misturado ao gateway de streaming/WebRTC. Os serviços de lances e vendas
persistem as alterações primeiro e publicam eventos somente depois de a
transação confirmar.

O gateway usa salas autenticadas derivadas do token, nunca de um identificador
de usuário informado pelo cliente:

- `auction:<auctionId>:prices`: preço e estado do lote, sem identidade;
- `auction:<auctionId>:office`: eventos detalhados, restritos ao escritório
  proprietário do leilão;
- `user:<userId>`: notificações privadas do usuário autenticado.

Ao entrar em uma sala, o gateway valida o ator e a relação do escritório com o
leilão. Uma conexão de usuário nunca entra na sala privada do escritório.

## Backend

### Gateway comercial

O novo módulo de eventos comerciais será exportável para que `LotsService` e
`SalesService` publiquem eventos depois do commit.

Eventos do cliente:

- `auction:join`, com `{ auctionId }`;
- `notifications:join`, sem `userId` no payload.

Eventos para compradores e demais espectadores autenticados da sala:

- `bid:price-updated`, com `{ lotId, amount, createdAt }`;
- `lot:sold`, com `{ lotId, finalPrice, soldAt }`.

Eventos exclusivos do escritório:

- `bid:office-recorded`, com `{ bidId, lotId, amount, createdAt, bidder: { id,
  name } }`.

Evento exclusivo do vencedor:

- `sale:won`, com `{ saleId, lotId, lotCode, lotTitle, auctionId,
  auctionTitle, finalPrice }`.

Nenhum evento de sala contém nome do vencedor ou contatos.

### RF06 e RF07: criação e consulta de lances

`POST /lots/:id/bids` continuará protegido por JWT e aceitará somente usuário
aprovado pelo escritório. O lote deverá estar em `IN_AUCTION`; o estado
`AVAILABLE` significa aguardando entrada em pista e não aceitará lance.

A transação de lance usará isolamento serializável e repetição limitada para
conflitos de escrita do Prisma/PostgreSQL. A cada tentativa válida ela:

1. consulta o lance `WINNING` atual;
2. calcula o mínimo usando `minBidIncrement`;
3. rejeita valor abaixo do mínimo;
4. muda o vencedor anterior para `OUTBID`;
5. cria o novo registro como `WINNING`.

Somente depois do commit o serviço emite o preço anônimo para a sala e o
registro detalhado para o escritório. Assim, falha de socket não desfaz um
lance válido, e uma transação revertida nunca gera evento falso.

A resposta HTTP ao comprador contém somente `{ id, lotId, amount, status,
createdAt }`. As rotas públicas de lotes deixam de incluir `bidderId`, nome do
comprador e o array de histórico. Elas podem retornar um resumo `currentPrice`
sem identidade.

Será adicionada `GET /lots/:id/bids`, autorizada apenas para o escritório dono
do leilão, para obter o histórico completo usado no painel operacional.

### RF08: confirmação de venda

Será criado um módulo `sales` com `SalesController`, `SalesService` e
`CreateSaleDto`. `POST /sales` recebe `{ lotId, notes? }` e exige autenticação
de escritório.

Em uma única transação, o serviço:

1. confirma que o lote existe, está em `IN_AUCTION` e pertence ao escritório;
2. confirma que ainda não existe venda para o lote;
3. lê o lance `WINNING`;
4. cria `Sale` como `CONFIRMED`, usando o comprador e valor do lance;
5. muda o lote para `SOLD`.

Ausência de lance vencedor, escritório incorreto, lote fora de pista ou venda
duplicada não altera o banco. Após o commit, o serviço emite `lot:sold` sem
identidade para a sala e `sale:won` somente para `user:<buyerId>`.

O esquema atual já representa a venda, o comprador, o escritório e o vendedor
indiretamente por `Lot -> Consignment -> seller`; nenhuma nova tabela de
notificação será criada.

### RF09 e RF10: consultas de venda

As consultas usam projeções específicas por papel, em vez de retornar uma
entidade Prisma completa:

- `GET /sales`: somente escritório; lista vendas de seus leilões com comprador
  e vendedor, ou informa que o próprio escritório é o responsável;
- `GET /sales/me`: somente usuário; lista compras em que ele é o vencedor e
  retorna o contato do vendedor ou escritório responsável;
- `GET /sales/sold`: somente usuário vendedor; lista lotes provenientes de
  suas consignações e retorna o contato do comprador.

As três rotas retornam apenas vendas `CONFIRMED`. Um usuário não consegue
consultar contatos de venda da qual não participa.

## Frontend

### Sala do leilão

Um cliente de socket comercial será conectado enquanto a sala estiver aberta.
Ao conectar ou reconectar, ele entra no leilão e refaz a consulta HTTP do
estado atual antes de processar novos eventos.

Para compradores, `BidPanel` apresenta somente o preço atual e o formulário de
lance. Não haverá lista de histórico ou identificação do líder. O polling de
quatro segundos será removido depois de o fluxo de socket estar coberto.

Para o escritório, o painel de encerramento passa a consumir o histórico
autorizado. Ele exibe comprador, valor e horário, e usa o lance vencedor para
habilitar a confirmação. Depois da confirmação, o resultado completo fica
visível apenas no painel do escritório.

O evento `lot:sold` atualiza o lote para vendido e remove as ações de lance,
sem mostrar o vencedor. O evento privado `sale:won` exibe o toast já previsto
no aplicativo e atualiza "Meus arremates".

### Áreas pós-leilão

- "Meus arremates" passa a mostrar o contato do vendedor ou do escritório
  responsável.
- Usuários com perfil de vendedor recebem a opção "Minhas vendas" no menu e
  uma página que mostra o comprador de cada lote vendido.
- "Vendas / Arremates" do escritório mostra comprador e vendedor/responsável.

Os tipos TypeScript de venda serão ajustados para representar explicitamente
as projeções por papel e evitar que a interface dependa de campos que não pode
receber.

## Tratamento de falhas

- Lance abaixo do mínimo, fora de pista ou sem aprovação retorna erro de
  domínio e não publica evento.
- Conflitos serializáveis são repetidos por um número limitado de tentativas;
  se persistirem, o usuário recebe erro para atualizar e tentar novamente.
- Confirmação duplicada retorna conflito e não cria outra venda.
- Falha de entrega do socket não reverte dados confirmados.
- Ao reconectar, o cliente busca o estado persistido para recuperar eventos
  perdidos.
- Um vencedor offline não recebe toast retroativo, mas encontra a venda em
  "Meus arremates" no próximo acesso.
- Erros de autorização não revelam contatos nem existência de registros de
  terceiros além do necessário.

## Estratégia de testes

### Backend

- Serviço/integração de lances: validação de estado, aprovação, incremento,
  preservação de todos os registros e apenas um `WINNING`.
- Concorrência: lances simultâneos não deixam dois vencedores.
- Privacidade REST: respostas públicas e do comprador não contêm identidade de
  outros licitantes.
- Gateway: ingresso nas salas conforme o papel e payload anônimo/detalhado no
  destino correto.
- Vendas: propriedade do lote, ausência de vencedor, duplicidade, criação
  atômica e mudança para `SOLD`.
- Notificação: `sale:won` é endereçado somente ao `buyerId` vencedor.
- Pós-leilão: cada papel recebe apenas suas vendas e os contatos autorizados.

### Frontend

- Comprador não recebe nem renderiza histórico de lances.
- Escritório renderiza o histórico autorizado e consegue confirmar a venda.
- Evento de preço altera o valor atual sem recarregar a página.
- Evento privado de vitória exibe a notificação e atualiza os arremates.
- Páginas de comprador, vendedor e escritório apresentam o contato correto.
- O teste já existente de isolamento de sessões permanece na regressão.

### Verificação final

- Backend: testes unitários, testes E2E, lint e build.
- Frontend: testes E2E, lint, verificação de tokens visuais e build.
- Revisão manual dos contratos garante que eventos de comprador não contenham
  `bidderId`, nome ou contato e que nenhuma sala pública receba o vencedor.

## Fora de escopo

- Central persistente de notificações ou estados lido/não lido.
- Toast retroativo para usuário que estava offline.
- Chat entre comprador e vendedor.
- Pagamento, faturamento, contrato, transporte ou logística.
- Anúncio automático da identidade do vencedor na sala.
