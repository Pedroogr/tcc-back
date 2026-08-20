# Handoff para agentes

Este é o backend do projeto TCC (`tcc-back`). O frontend está no repositório
irmão [`tcc-front`](../../tcc-front). Use este arquivo para retomar o trabalho
em outra sessão ou com outro agente.

## Ordem de leitura

1. [`README.md`](../README.md), para setup local;
2. [`prisma/schema.prisma`](../prisma/schema.prisma), fonte do modelo do banco;
3. [`current-state.md`](current-state.md), snapshot deste handoff;
4. controllers, DTOs e services do módulo que será alterado;
5. migrations relevantes em [`prisma/migrations`](../prisma/migrations).

Não exponha `.env`, credenciais ou tokens em commits, logs ou documentação.

## Estado atual — 2026-08-20

- API NestJS + TypeScript;
- PostgreSQL 16 com Prisma;
- autenticação de usuários e casas de leilão com JWT;
- módulos de usuários, autenticação, casas de leilão, leilões, lotes,
  transmissão/live, streams e administração;
- migrations Prisma versionadas;
- frontend React/Vite em repositório separado;
- `.env` local recriado nesta sessão e mantido fora do Git;
- PostgreSQL local do TCC exposto na porta `5434`, para não conflitar com outro
  PostgreSQL que já usa `5433`;
- migrations aplicadas no banco local e `GET /users` validado com resposta
  `200`;
- não há uma nova funcionalidade em andamento registrada neste repositório;
  o último trabalho operacional foi restaurar o ambiente local.

## Setup local

```powershell
docker compose up -d postgres
npx prisma migrate deploy
npm run build
npm run start:dev
```

A API fica em `http://localhost:3000` e o frontend em
`http://localhost:5173`.

O `.env` esperado contém:

```env
DATABASE_URL=postgresql://<user>:<password>@localhost:5434/cattle_auction
FRONTEND_URL=http://localhost:5173
PORT=3000
JWT_SECRET=<local-secret>
```

No DBeaver: host `localhost`, porta `5434`, banco `cattle_auction`, usuário e
senha definidos no `.env` local.

## Fluxos já implementados

- cadastro e login de usuário;
- cadastro/login de casa de leilão por convite;
- criação e consulta de leilões;
- criação, edição, upload e consulta de lotes;
- cadastro e revisão de compradores em leilões;
- lances e registro de vendas;
- transmissão ao vivo e sinalização WebRTC/Socket.IO;
- criação de convites de escritório pelo administrador;
- perfis de comprador e vendedor.

## Como validar alterações

```powershell
npm run build
npm test
npm run lint
```

Para validar uma rota, prefira um fluxo completo pela API e pelo frontend,
porque o cadastro faz `POST /auth/register` e em seguida `POST /auth/login`.

Ao alterar DTOs, controllers ou services, verifique também o `ValidationPipe`
global, CORS, guards JWT e as relações no Prisma.

## Como encerrar uma sessão

1. registre aqui o que foi concluído e o que ficou pendente;
2. documente decisões de arquitetura ou contrato junto da alteração;
3. rode as validações relevantes;
4. não inclua `.env`, uploads, `node_modules` ou artefatos de build;
5. deixe claro no commit quais arquivos e fluxos foram afetados.
