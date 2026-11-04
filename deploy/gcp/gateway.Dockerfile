FROM node:24.22.2-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:demo

FROM caddy:2.11.7-alpine

COPY --from=build /app/dist /srv
