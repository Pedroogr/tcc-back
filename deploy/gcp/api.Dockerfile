FROM node:24.22.2-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate

COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN npm run build

FROM build AS tools

ENV NODE_ENV=production

FROM node:24.22.2-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

RUN mkdir -p /app/public/uploads/lots \
    && chown -R node:node /app/public/uploads

USER node

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
