# Estado atual do backend

**Data do snapshot:** 2026-08-20
**Projeto:** TCC / Cattle Auction API
**API:** `localhost:3000`
**Banco local:** PostgreSQL `cattle_auction` em `localhost:5434`
**Frontend:** repositório separado, `localhost:5173`

## Componentes

| Componente | Situação |
| --- | --- |
| NestJS | API principal implementada |
| Prisma | Schema e migrations versionados |
| PostgreSQL | Container local `cattle_auction_postgres` |
| Auth | Usuários, casas de leilão e JWT |
| Leilões | CRUD, status, inscrições e vendas |
| Lotes | CRUD, mídia, revisão e lances |
| Live/streams | Gateways Socket.IO e páginas públicas |
| Admin | Convites de escritório e administração |
| Frontend | React/Vite no `tcc-front` |

## Trabalho concluído nesta recuperação

- recriada a configuração local do backend em `.env`;
- criado `.env.example` para evitar nova perda da configuração;
- ajustada a porta do PostgreSQL do TCC de `5433` para `5434`;
- container correto iniciado sem parar o banco do outro projeto;
- 13 migrations aplicadas;
- script `start:prod` corrigido para `dist/src/main`;
- API validada em `GET /users` com `200`;
- build do backend e do frontend concluído.

## Pontos de atenção

- o `.env` é local e não deve ser commitado;
- se a porta `5434` for alterada, atualize simultaneamente `docker-compose.yml`,
  `.env`, DBeaver e a documentação;
- o frontend consome `VITE_API_URL=http://localhost:3000`;
- cadastro no frontend depende de o backend estar ativo e conectado ao banco;
- o banco local recuperado está sem usuários cadastrados neste ambiente.

## Próxima ação recomendada

Antes de iniciar uma nova feature, verificar o fluxo correspondente no
frontend e no backend, confirmar o contrato do DTO e adicionar/atualizar os
testes da rota afetada.

## RF06-RF10: lances em tempo real e pós-leilão (2026-09-02)

Implementados na branch `feat/rf06-rf10-realtime-sales`.

- **RF06 – Tempo real:** `CommerceGateway` (Socket.IO autenticado) emite
  `bid:price-updated` (preço anônimo) à sala `auction:<id>:prices` após cada
  lance persistido. O frontend substituiu o polling de 4s por eventos, com
  ressincronização (`refreshLotsQuietly` + histórico do escritório) na reconexão.
- **RF07 – Registro de lances:** todo lance é gravado em transação serializável
  (retry em `P2034`), mantendo apenas um `WINNING`. Histórico nominal exposto só
  ao escritório dono via `GET /lots/:id/bids` e à sala privada
  `auction:<id>:office` (`bid:office-recorded`). Respostas públicas nunca trazem
  `bidder`/`bidderId`; `GET /lots` expõe apenas `currentPrice`.
- **RF08 – Confirmação da venda:** `POST /sales` valida escritório dono, lote em
  pista, lance vencedor e ausência de venda; cria a venda `CONFIRMED` e marca o
  lote `SOLD` na mesma transação.
- **RF09 – Notificação do vencedor:** `emitSaleWon` envia `sale:won` somente à
  sala privada `user:<buyerId>`; o registro persiste em "Meus arremates".
- **RF10 – Contatos pós-leilão:** `GET /sales` (escritório: comprador+vendedor),
  `GET /sales/me` (comprador: responsável) e `GET /sales/sold`
  (vendedor: comprador). Lote sem consignação usa o escritório como responsável.

### Privacidade dos eventos (auditado)

- `bid:price-updated` e `lot:sold`: `{ lotId, amount|finalPrice, createdAt|soldAt }`, sem identidade.
- `bid:office-recorded`: com `bidder`, apenas para `auction:<id>:office`.
- `sale:won`: apenas para `user:<buyerId>`.

### Verificação executada

- `npm test -- --runInBand` → 28 testes unitários OK (commerce, sales, streams).
- `npm run test:e2e` → 28 testes OK em `auth`, `bidding`, `sales`, `static-pages`.
- `npm run build` → OK.

### Pontos de atenção

- `test/app.e2e-spec.ts` é o boilerplate `nest new` (`GET / → "Hello World!"`),
  incompatível com este app e sempre falho; ainda não versionado — remover.
- `npm run lint` já tinha erros pré-existentes de tipagem de socket em
  `streams.gateway.ts`, `live.gateway.ts` e `test/support/socket.ts`; o novo
  código segue os mesmos padrões do existente.
