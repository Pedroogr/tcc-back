# Cattle Auction — API (back-end)

API da plataforma de remates de gado desenvolvida como Trabalho de Conclusão de
Curso. Concentra autenticação, regras de negócio, persistência, comunicação em
tempo real, sinalização da transmissão ao vivo e o serviço de inferência de
pose usado no reconhecimento de gestos.

A interface web está no repositório
[tcc-front](https://github.com/Pedroogr/tcc-front).

## Funcionalidades

- Cadastro e autenticação de compradores e vendedores, com validação de CPF,
  CNPJ, telefone e Inscrição Estadual por Unidade Federativa.
- Cadastro de casas de leilões somente por convite emitido pelo administrador.
- Criação de remates e cadastro de lotes com imagens e miniaturas.
- Solicitação e aprovação de compradores por casa de leilões.
- Lances pela Internet e lances presenciais registrados pelo pisteiro, com as
  mesmas regras de progressão de preço.
- Encerramento do lote pela casa de leilões, registro da venda e troca de
  contatos pós-remate entre comprador, vendedor e escritório.
- Acesso temporário do pisteiro por código vinculado a um remate.
- Transmissão ao vivo por WebRTC, com sinalização via Socket.IO.
- Recebimento de alertas da estação de gestos e envio em tempo real ao
  pisteiro.

## Tecnologias

- Node.js, TypeScript e NestJS 11
- PostgreSQL 16 (Docker) e Prisma ORM 7
- Socket.IO para lances, notificações, alertas e sinalização WebRTC
- Jest e Supertest nos testes unitários e de ponta a ponta
- Python, FastAPI, Uvicorn, Ultralytics YOLO11, PyTorch e CUDA no serviço de
  inferência (`gesture-server/`)

## Estrutura

```text
src/
  admin/           convites de casas de leilões (administrador)
  auction-houses/  cadastro e dados das casas de leilões
  auctions/        remates, inscrições e aprovação de compradores, lances
  auth/            autenticação JWT e guardas de perfil
  commerce/        eventos de tempo real de lances e vendas
  gesture/         validação e distribuição dos alertas de gestos
  live/            gateway de tempo real da sala do remate
  lots/            lotes, imagens e miniaturas
  operator/        acesso temporário e lances do pisteiro
  sales/           vendas e informações pós-remate
  streams/         estado e sinalização da transmissão
  users/           usuários, perfis de comprador e vendedor
  common/          validação de campos brasileiros e e-mail
  prisma/          cliente do banco
  runtime/         configuração de escuta do servidor
prisma/            schema e migrations
test/              testes de ponta a ponta (Jest + Supertest)
gesture-server/    serviço Python de inferência de pose em GPU
gesture-poc/       prova de conceito e pesos do modelo YOLO11 Pose
scripts/           criação de administrador, convites e demonstração
deploy/demo/       configuração do gateway Caddy da demonstração
docs/              documentação de continuidade e roteiro da demonstração
```

## Requisitos

- Node.js 20 ou superior e npm
- Docker Desktop (ou Docker Engine com Compose)
- Para o serviço de gestos: Python com [uv](https://docs.astral.sh/uv/), GPU
  NVIDIA e driver com CUDA

## Configuração local

```bash
npm install
cp .env.example .env              # ajuste DATABASE_URL e JWT_SECRET
docker compose up -d postgres     # PostgreSQL em localhost:5434
npx prisma migrate deploy
npm run start:dev                 # API em http://localhost:3000
```

Variáveis do `.env`:

| Variável       | Descrição                                                   |
| -------------- | ----------------------------------------------------------- |
| `DATABASE_URL` | conexão PostgreSQL (`localhost:5434/cattle_auction`)        |
| `FRONTEND_URL` | origem do front-end liberada no CORS (`http://localhost:5173`) |
| `PORT`         | porta da API (padrão `3000`)                                |
| `HOST`         | opcional; interface de escuta (ex.: `127.0.0.1`)            |
| `JWT_SECRET`   | segredo de assinatura dos tokens                            |

O banco usa a porta `5434` para não conflitar com outro PostgreSQL local. Em
um cliente como o DBeaver, use host `localhost`, porta `5434`, banco
`cattle_auction` e as credenciais do `.env`.

## Contas iniciais

A conta de administrador não existe no cadastro público. Crie-a com:

```bash
npm run admin:create -- --email admin@exemplo.com --name "Administrador"
```

A senha é solicitada no terminal. Depois, os convites de casas de leilões podem
ser gerados pelo painel `/admin` do front-end ou pela linha de comando:

```bash
npm run auction-house:invite -- --email escritorio@exemplo.com --expires-days 7
```

O comando imprime o endereço de cadastro que deve ser enviado ao escritório.

## Scripts

| Comando                  | Descrição                                   |
| ------------------------ | ------------------------------------------- |
| `npm run start:dev`      | API em modo de desenvolvimento (watch)      |
| `npm run build`          | compila para `dist/`                        |
| `npm run start:prod`     | executa a versão compilada                  |
| `npm run lint`           | ESLint com correção automática              |
| `npm run format`         | Prettier em `src/` e `test/`                |
| `npm test`               | testes unitários                            |
| `npm run test:cov`       | testes unitários com cobertura              |
| `npm run test:e2e`       | testes de ponta a ponta                     |

## Testes

Os testes unitários ficam junto ao código, em arquivos `*.spec.ts` dentro de
`src/`:

```bash
npm test
```

Os testes de ponta a ponta ficam em `test/` e exercitam a API com um banco
real. O script sobe um PostgreSQL descartável com
`docker-compose.e2e.yml` na porta `5435`, aplica as migrations, executa as
suítes e remove o contêiner ao final:

```bash
npm run test:e2e
```

A porta `5435` também é usada pelo banco da demonstração; execute
`npm run demo:stop` antes de rodar os testes de ponta a ponta.

O serviço de inferência tem testes próprios em Python:

```bash
cd gesture-server
uv sync
uv run pytest -q
```

## Reconhecimento de gestos

A estação de gestos do front-end pode estimar as poses no navegador ou enviar
os quadros ao serviço `gesture-server/`, que executa o YOLO11 Pose em GPU com
CUDA por um WebSocket autenticado. O serviço não acessa o banco, não registra
lances e não armazena imagens. Configuração, monitor de quadros e benchmark
estão em [`gesture-server/README.md`](gesture-server/README.md).

Quando uma mão levantada é confirmada, a estação envia o alerta para esta API,
que valida a casa de leilões, o remate, o horário e a imagem antes de
repassá-lo ao pisteiro.

## Demonstração pública temporária

Para apresentar o sistema a pessoas em outras redes usando só o navegador, o
desktop com GPU executa todos os serviços e os publica por um Cloudflare Quick
Tunnel, com o Caddy servindo o front-end compilado e encaminhando API,
Socket.IO e inferência. O repositório `tcc-front` deve estar clonado ao lado
deste (`../tcc-front`).

```powershell
npm run demo:prepare -- --InstallMissing   # verifica dependências
npm run demo:start -- -EnableMonitor       # sobe tudo e imprime URL, token e contas
npm run demo:status
npm run demo:stop
```

A demonstração usa um banco isolado (`cattle_auction_demo`, porta `5435`) e
não altera o banco de desenvolvimento. URL, token e senha mudam a cada
execução. Não é um deploy de produção. O roteiro completo, com teste por rede
móvel e diagnóstico, está em
[`docs/demo-quick-tunnel.md`](docs/demo-quick-tunnel.md).
