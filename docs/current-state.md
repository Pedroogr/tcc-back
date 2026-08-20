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
