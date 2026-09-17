# syntax=docker/dockerfile:1

# ---------- deps: instala todas as dependencias (incl. dev) para build ----------
# python3/make/g++ sao necessarios so para compilar o binding nativo do bcrypt (node-gyp) -
# node:22-alpine nao traz build tools por padrao, e nao ha binario pre-compilado do bcrypt
# para linux-musl (Alpine), so para glibc. Achado real ao tentar buildar esta imagem pela
# primeira vez (PLANO_PROJETO.md secao 10.12).
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build: gera Prisma Client e compila TypeScript ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

# ---------- prod-deps: apenas dependencias de producao ----------
# NAO roda "prisma generate" aqui (achado real: a imagem final chegou a 688MB porque isso
# fazia o npx instalar a CLI "prisma" -- uma devDependency -- direto nesta imagem, trazendo
# junto ~130MB de dependencias transitivas dela (effect, es-toolkit, fast-check, typescript)
# que nao tem nenhuma utilidade em runtime. O client gerado (que É necessário em runtime) já
# existe no stage "build", que tem a CLI disponível de verdade via `npm ci` completo — o
# runner só copia o resultado gerado de lá, PLANO_PROJETO.md §10.12.
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional

# ---------- runner: imagem final enxuta ----------
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S nodejs && adduser -S nestjs -G nodejs

COPY --from=prod-deps /app/node_modules ./node_modules
# @prisma/client só fica utilizável depois de "prisma generate" — copiado do stage "build"
# (não regenerado aqui) para não precisar da CLI do prisma nesta imagem.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/dist ./dist
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY package.json ./

USER nestjs

EXPOSE 3000
CMD ["node", "dist/main.js"]

# ---------- migrate: imagem auxiliar SÓ para `prisma migrate deploy` em produção ----------
# O stage "runner" acima deliberadamente NÃO tem a CLI do prisma (ver comentário em
# "prod-deps"), então não dá para migrar a partir dele. Reaproveita o stage "build" (que já
# tem devDependencies completas + prisma/ com as migrations) em vez de instalar tudo de novo.
# Uso: docker compose -f docker-compose.prod.yml run --rm migrate
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]
