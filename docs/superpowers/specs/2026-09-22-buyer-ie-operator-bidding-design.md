# IE do comprador e lances presenciais por operador

**Data:** 2026-09-22
**Projetos:** `tcc-back` e `tcc-front`

## Objetivo

Exigir inscrição estadual no cadastro de todo comprador antes da aprovação pelo
escritório e permitir que pisteiros registrem, por uma interface móvel própria,
os lances feitos presencialmente durante um remate.

No código e nos contratos HTTP, o ator será chamado exclusivamente de
`operator`. A interface poderá usar o termo “Pisteiro”, que é mais familiar ao
usuário final.

## Estado encontrado

- `BuyerProfile` possui apenas `verificationStatus`; o cadastro de comprador
  ainda não recebe inscrição estadual.
- A aprovação de comprador é representada por `BuyerRegistration` e ocorre por
  escritório, não por leilão.
- O serviço de lotes já garante, em transação serializável, que apenas um lote
  de um leilão esteja em `IN_AUCTION`.
- Lances só podem ser criados pelo próprio usuário comprador e não registram a
  origem online ou presencial.
- O gateway comercial já separa eventos públicos, de compradores e do
  escritório, mas ainda não autentica um `OPERATOR` nem publica a troca do lote
  em pista.
- O frontend principal concentra muitas responsabilidades em `App.tsx`; a área
  do operador deve ser isolada em uma entrada própria.
- Os compradores existentes no banco local são dados de teste e poderão ser
  removidos. Não será criada uma jornada para completar perfis antigos.

## Decisões de produto

### Inscrição estadual

- Novos compradores informam obrigatoriamente `ie` e `ieUf` dentro de
  `buyerProfile`.
- `ie` é normalizada para dígitos e `ieUf` para uma sigla de UF válida em letras
  maiúsculas.
- Não haverá, nesta entrega, suporte a “ISENTO”, não contribuinte ou consulta
  automática à SEFAZ. A conferência é feita manualmente pelo escritório.
- Um comprador sem IE não pode ser aprovado nem dar lance, mesmo que exista
  como dado legado.
- Perfis antigos não receberão tela de complementação. Os compradores de teste
  serão apagados do banco local em uma operação controlada, fora da migration.

### Acesso do operador

- O escritório cria um acesso temporário para um leilão específico e pode
  identificá-lo com um rótulo, por exemplo, “Pista principal”.
- Cada operador ou aparelho recebe um código diferente. O mesmo leilão pode ter
  vários operadores simultâneos.
- O código é exibido somente na criação, vale por até 24 horas ou até o término
  do leilão e pode ser revogado pelo escritório a qualquer momento.
- O código só pode ser usado uma vez para abrir uma sessão. A sessão permanece
  associada ao mesmo acesso e leilão até expirar ou ser revogada.
- O operador não possui conta comum e não acessa a transmissão. Sua tela mostra
  apenas o estado operacional necessário para registrar o lance.

### Registro do lance presencial

- O operador pesquisa somente compradores aprovados pelo escritório responsável
  pelo leilão e que possuem IE.
- A busca retorna nome e os quatro últimos dígitos do CPF/CNPJ, suficientes para
  diferenciar homônimos sem expor telefone, e-mail ou documento completo.
- Antes de enviar, a tela confirma lote, comprador e valor.
- Após o sucesso, comprador e valor são limpos para o próximo lance.
- O histórico do escritório identifica a origem como “Online” ou “Presencial”.

### Sincronização do lote

- O banco é a fonte de verdade para o lote em `IN_AUCTION`.
- Somente o escritório altera o lote em pista. O operador não possui esse
  controle.
- A troca de lote é publicada em tempo real para site público, escritório e
  operadores somente depois do commit da transação.
- Ao conectar ou reconectar, e periodicamente como recuperação, o cliente busca
  o estado autoritativo por HTTP.
- Todo lance presencial envia `expectedLotId`. O backend compara esse valor com
  o lote atualmente em pista dentro da transação do lance.
- Se o lote tiver mudado, o lance é rejeitado. Assim, mesmo uma tela atrasada
  nunca consegue registrar o valor no lote incorreto.
- Durante uma troca ou recuperação da conexão, o formulário fica bloqueado. Ao
  receber outro lote, a seleção do comprador e o valor são limpos.
- Não existe fila offline de lances.

## Modelo de domínio e persistência

### `BuyerProfile`

Serão adicionados:

- `ie: String?`
- `ieUf: String?`

As colunas permanecem anuláveis no esquema para que a migration seja aplicável
com segurança em bancos que ainda contenham perfis antigos. A nulabilidade é
apenas uma concessão de compatibilidade: os serviços de cadastro, aprovação e
lance impõem a presença dos dois campos.

O cadastro de `BUYER` passa a receber:

```json
{
  "buyerProfile": {
    "ie": "123456789",
    "ieUf": "RS"
  }
}
```

O bloco é obrigatório para `BUYER` e não é aceito como substituto dos dados de
`SellerProfile` no cadastro de vendedor.

### `Bid`

Será criado o enum:

```text
BidSource.ONLINE
BidSource.ON_SITE
```

`Bid` receberá `source`, com padrão `ONLINE`, e a relação opcional
`operatorAccessId`. Um lance presencial continua pertencendo ao comprador em
`bidderId`; o acesso do operador é informação adicional de auditoria.

As invariantes são:

- `ONLINE` não requer `operatorAccessId`;
- `ON_SITE` sempre é criado a partir de uma sessão válida de `OperatorAccess`;
- o operador, o comprador, o lote e o leilão precisam pertencer ao mesmo fluxo
  autorizado.

### `OperatorAccess`

A entidade conterá, no mínimo:

- identificador;
- `auctionId`;
- rótulo;
- hash do código, nunca o código em texto puro;
- criação e expiração;
- momento de uso inicial;
- momento opcional de revogação;
- relação com os lances presenciais registrados.

O código terá entropia suficiente para uso temporário e formato curto adequado
à digitação no celular. A rota de login terá limitação de tentativas. A troca do
código por uma sessão marca o acesso como usado de forma atômica, impedindo duas
ativações com o mesmo código.

O JWT do operador identifica `actorType: OPERATOR`, `operatorAccessId` e
`auctionId`, e nunca reutiliza a sessão normal de usuário ou escritório. Sua
expiração não ultrapassa `OperatorAccess.expiresAt`. Cada requisição protegida e
cada ingresso em sala de socket também consulta se o acesso foi revogado ou se
expirou, para que a revogação encerre uma sessão já aberta.

## Backend

### Módulo `operator`

O módulo terá controller, service, DTOs, autenticação e guard próprios. Rotas:

```text
POST   /operator/accesses
GET    /operator/accesses?auctionId=...
DELETE /operator/accesses/:id
POST   /operator/login
GET    /operator/session
GET    /operator/buyers?query=...
POST   /operator/bids
```

As três primeiras operações exigem sessão do escritório dono do leilão. A
listagem nunca devolve o código nem seu hash. A exclusão lógica revoga o acesso
e preserva sua auditoria.

`POST /operator/login` recebe apenas o código e retorna o token da sessão.
`GET /operator/session` retorna o leilão, o acesso e o lote autoritativo em
pista. A busca de compradores é limitada, sanitizada e só retorna registros
`APPROVED` do escritório dono do leilão com IE presente.

`POST /operator/bids` recebe:

```json
{
  "expectedLotId": "lot-id",
  "buyerId": "buyer-id",
  "amount": 1500
}
```

### Serviço interno de lances

O endpoint online atual e o endpoint do operador usarão o mesmo serviço interno
para validar e persistir lances. A interface recebe o comprador efetivo, a
origem e, quando aplicável, o acesso do operador. Isso mantém em um único lugar
as regras de incremento mínimo, concorrência e troca do lance vencedor.

Dentro de uma transação serializável, o lance presencial valida:

1. sessão não expirada nem revogada e restrita ao leilão;
2. lote atualmente em `IN_AUCTION` igual a `expectedLotId`;
3. comprador aprovado pelo escritório e com `ie` e `ieUf`;
4. valor maior ou igual ao próximo mínimo;
5. substituição atômica do `WINNING` anterior pelo novo lance `ON_SITE`.

As repetições já usadas para conflitos serializáveis serão mantidas. Dois
operadores concorrentes não podem deixar dois lances vencedores.

### Eventos comerciais

Depois de a troca de lote confirmar, o backend publica
`lot:stage-changed`. O payload contém os identificadores do leilão e lote e um
resumo operacional sem dados pessoais, incluindo código, título, estágio,
preço atual e próximo valor mínimo quando aplicável.

Operadores autenticados podem entrar somente na sala do leilão registrada no
próprio token. O evento de preço existente continua atualizando todas as telas
depois de um lance online ou presencial. O evento detalhado do escritório passa
a incluir `source`.

O socket acelera a atualização, mas não é a garantia final de consistência. A
consulta HTTP na conexão/reconexão, a atualização periódica e a validação
transacional de `expectedLotId` cobrem perda ou atraso de eventos.

## Frontend

### Cadastro e aprovação do comprador

O formulário de cadastro exibe IE e UF quando `accountType` é `BUYER`, valida
os dois campos e envia `buyerProfile: { ie, ieUf }`. O painel do escritório
mostra IE e UF junto aos dados usados na análise e só oferece aprovação quando
o perfil estiver válido.

Não haverá alerta ou formulário para completar comprador legado.

### Gestão de acessos

Na sala operacional do escritório haverá uma seção para:

- criar acesso com rótulo;
- mostrar o código somente após a criação, com ação de copiar;
- listar rótulo, criação, expiração, uso e situação;
- revogar individualmente um acesso.

Cada criação gera um novo acesso; não há código compartilhado entre operadores.

### Aplicação do operador

A rota `/operator` carregará um `OperatorApp` isolado da aplicação principal.
Seu token terá uma chave de armazenamento e um cliente HTTP próprios, para não
substituir a sessão de comprador ou escritório no mesmo navegador.

A experiência será mobile-first:

1. tela de entrada do código;
2. cabeçalho de conexão e sincronização;
3. destaque para `Lote <code>`, título, valor atual e próximo mínimo;
4. pesquisa do comprador por nome ou documento;
5. resultado com nome e últimos quatro dígitos do CPF/CNPJ;
6. entrada do valor;
7. confirmação com lote, comprador e valor;
8. retorno de sucesso e formulário limpo.

Sem conexão ou enquanto o estado estiver sendo reconciliado, o botão de envio
fica desabilitado. Erros de lote alterado ou novo mínimo fecham a confirmação,
limpam os dados necessários e exibem o estado atualizado. Código expirado ou
revogado remove a sessão e volta à tela de entrada.

## Tratamento de falhas e segurança

- Código inválido, usado, expirado ou revogado não abre sessão e não revela
  qual condição falhou.
- Tentativas de login são limitadas para impedir força bruta.
- O código em texto puro aparece uma vez e nunca é persistido nem retornado em
  listagens.
- Um operador não consegue trocar `auctionId`, entrar na sala de outro leilão
  ou consultar compradores de outro escritório.
- Dados de contato e documento completo não são enviados à aplicação do
  operador.
- Um comprador reprovado, pendente ou sem IE não aparece na busca e também é
  rejeitado pelo serviço de lances caso seu estado mude após a busca.
- Um lance abaixo do mínimo, para lote antigo ou durante ausência de lote em
  pista não altera o banco nem publica evento.
- Falha no socket não reverte lance confirmado; a próxima consulta recupera o
  estado persistido.
- A interface nunca enfileira um lance para envio posterior.

## Migração e limpeza local

A migration adiciona os campos compatíveis em `BuyerProfile`, o enum
`BidSource`, os campos de auditoria de `Bid` e `OperatorAccess`. Ela não contém
`DELETE` de usuários ou compradores.

Antes de apagar dados de teste, a implementação deve mostrar e conferir o banco
alvo, confirmar que é o ambiente local e listar a quantidade de compradores e
registros dependentes afetados. A limpeza será executada de forma explícita e
separada. Depois disso, novos compradores entram somente pelo contrato com IE.

## Estratégia de testes

### Backend

- Cadastro de comprador sem `buyerProfile`, `ie` ou `ieUf` é rejeitado; IE é
  normalizada e UF inválida é rejeitada; cadastro de vendedor não é afetado.
- Aprovação de comprador sem IE é rejeitada.
- Apenas o escritório dono do leilão cria, lista e revoga acessos.
- Código e hash não aparecem em listagens; login é de uso único; expiração e
  revogação invalidam a sessão; acessos distintos funcionam simultaneamente.
- Sessão e sala do operador ficam restritas ao leilão do token.
- Busca retorna somente compradores aprovados, com IE, e apenas nome e final do
  documento.
- Lance comum grava `ONLINE`; lance do operador grava `ON_SITE` e
  `operatorAccessId`.
- Lance presencial rejeita leilão incorreto, acesso revogado ou expirado,
  comprador sem aprovação ou IE, lote desatualizado e valor abaixo do mínimo.
- Concorrência entre operadores preserva apenas um `WINNING`.
- Troca de estágio publica `lot:stage-changed` somente após o commit.
- Reconexão obtém do HTTP o mesmo lote persistido no banco.

### Frontend

- IE e UF são obrigatórios no cadastro de comprador e aparecem para aprovação.
- Escritório cria, copia, lista e revoga acessos sem voltar a revelar o código.
- Operador entra com código e recebe somente o leilão autorizado.
- Alterar o lote no escritório atualiza site e operador e limpa o formulário.
- Homônimos são diferenciados pelos quatro últimos dígitos do documento.
- Confirmação mostra lote, comprador e valor; o sucesso atualiza preço e
  histórico com origem presencial.
- Estados offline, sincronizando, lote desatualizado e sessão revogada bloqueiam
  corretamente o envio.

### Verificação final

- Backend: `npm test`, `npm run test:e2e`, `npm run lint` e `npm run build`.
- Frontend: `npm run test:e2e`, `npm run lint`, `npm run check:tokens` e
  `npm run build`.
- Revisão manual confirma que o operador não recebe telefone, e-mail, documento
  completo, compradores não aprovados ou dados de outro leilão.

## Fora de escopo

- Integração ou validação automática com a SEFAZ.
- Comprador isento ou não contribuinte.
- Jornada de complementação de perfil legado.
- Cadastro ou aprovação de comprador pela tela do operador.
- Acesso do operador à transmissão, gestão de lotes, encerramento de lote ou
  confirmação da venda.
- Operação offline ou fila posterior de lances.
- Compartilhamento de um único código por vários aparelhos.
