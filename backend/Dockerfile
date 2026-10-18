# Sem a diretiva "# syntax=docker/dockerfile:1": ela faz o BuildKit baixar a imagem docker/dockerfile
# do Docker Hub (mais um pull sujeito ao limite sem login nos runners do GitHub), e este Dockerfile
# nao usa nenhum recurso que exija o frontend novo.
#
# Imagem base como ARG: o CI troca pelo espelho public.ecr.aws (o Docker Hub limita pulls sem login
# nos runners compartilhados do GitHub). Padrao = Docker Hub, entao `docker build` local nao muda.
ARG NODE_IMAGE=node:22-alpine

# ---------- deps: instala todas as dependencias (incl. dev) para build ----------
# python3/make/g++ sao necessarios so para compilar o binding nativo do bcrypt (node-gyp) -
# node:22-alpine nao traz build tools por padrao, e nao ha binario pre-compilado do bcrypt
# para linux-musl (Alpine), so para glibc. Achado real ao tentar buildar esta imagem pela
# primeira vez (PLANO_PROJETO.md secao 10.12).
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build: gera Prisma Client e compila TypeScript ----------
FROM ${NODE_IMAGE} AS build
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
# que nao tem nenhuma utilidade em runtime. O client gerado (que Ã‰ necessÃ¡rio em runtime) jÃ¡
# existe no stage "build", que tem a CLI disponÃ­vel de verdade via `npm ci` completo â€” o
# runner sÃ³ copia o resultado gerado de lÃ¡, PLANO_PROJETO.md Â§10.12.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
# SEM --omit=optional: o sharp (reprocessa as imagens de POST /uploads) traz o binario nativo (musl) como
# optionalDependency; omitir deixaria o upload sem redimensionar/limpar EXIF.
RUN npm ci --omit=dev

# ---------- runner: imagem final enxuta ----------
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S nodejs && adduser -S nestjs -G nodejs

COPY --from=prod-deps /app/node_modules ./node_modules
# @prisma/client sÃ³ fica utilizÃ¡vel depois de "prisma generate" â€” copiado do stage "build"
# (nÃ£o regenerado aqui) para nÃ£o precisar da CLI do prisma nesta imagem.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/dist ./dist
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY package.json ./

# Imagens enviadas (POST /uploads) ficam em /app/uploads (volume gingapp_uploads no compose). Criada e entregue ao
# usuario nestjs aqui: um volume nomeado novo herda este dono.
RUN mkdir -p /app/uploads && chown nestjs:nodejs /app/uploads
ENV UPLOADS_DIR=/app/uploads
# Anexos PRIVADOS das inscricoes (comprovantes): diretorio IRMAO, fora do servido por /api/uploads (volume proprio no compose).
RUN mkdir -p /app/private-uploads && chown nestjs:nodejs /app/private-uploads && chmod 700 /app/private-uploads
ENV PRIVATE_UPLOADS_DIR=/app/private-uploads

USER nestjs

EXPOSE 3000
CMD ["node", "dist/main.js"]

# ---------- migrate: imagem auxiliar de produÃ§Ã£o = migrations + bootstrap ----------
# O stage "runner" acima deliberadamente NÃƒO tem a CLI do prisma (ver comentÃ¡rio em
# "prod-deps"), entÃ£o nÃ£o dÃ¡ para migrar a partir dele. Reaproveita o stage "build" (que jÃ¡
# tem devDependencies completas â€” CLI do prisma, ts-node, typescript, bcrypt compilado â€” mais
# prisma/ (migrations, permission-matrix.ts, bootstrap.ts), src/ e tsconfig.json) em vez de
# instalar tudo de novo.
# Roda, NESTA ORDEM e parando no primeiro erro (exit != 0):
#   1. prisma migrate deploy  â€” aplica migrations pendentes (idempotente);
#   2. prisma/bootstrap.ts    â€” matriz base RolePermission (sÃ³ linhas ausentes) + primeiro super
#      admin PLATFORM a partir de SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD / SUPER_ADMIN_NAME
#      (opcionais; sem elas sÃ³ aplica a matriz e avisa; invÃ¡lidas = falha). Idempotente. NUNCA
#      cria dados de exemplo â€” o seed de dev (prisma/seed.ts, senha Dev@12345) nÃ£o roda aqui.
# ts-node SEM --transpile-only de propÃ³sito: com TypeScript 6 e este tsconfig, o modo
# transpile-only falha com TS5011 ("rootDir must be explicitly set") porque bootstrap.ts importa
# de ../src (achado real); o modo normal compila e ainda faz a checagem de tipos.
# Uso: docker compose -f docker-compose.prod.yml run --rm migrate
FROM build AS migrate
CMD ["sh", "-c", "npx prisma migrate deploy && npx ts-node prisma/bootstrap.ts"]

# ---------- server: imagem do backend usada no Easypanel (migrations + bootstrap + API) ----------
# Mesmo padrao do GestorPrint/idinner: UMA imagem de backend que, ao subir, aplica as migrations e so
# entao inicia a API (sem servico/imagem "migrate" separado). Reaproveita o stage "build" (CLI do prisma,
# ts-node, dist/ compilado). Ordem, parando no primeiro erro (exit != 0 => o container reinicia e tenta
# de novo, mostrando o erro no log):
#   1. prisma migrate deploy - aplica migrations pendentes (idempotente);
#   2. prisma/bootstrap.ts   - matriz base RolePermission + primeiro super admin PLATFORM a partir de
#      SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD/SUPER_ADMIN_NAME (idempotente; nunca cria dados de exemplo);
#   3. prisma/demo.ts        - SO quando DEMO_GROUP=true: cria/completa o grupo de demonstracao (slug "demo",
#      contas @demo.gingapp.com.br; senha = DEMO_PASSWORD, validada com a mesma politica do super admin).
#      Idempotente e restrito ao grupo demo. O demo e opcional: se falhar (ex.: senha fraca) o erro vai
#      para o log e a API sobe do mesmo jeito. prisma/ inteiro ja e copiado para o stage "build"
#      (COPY prisma ./prisma), entao demo.ts, demo-data.ts e o que ele importa (bootstrap.ts,
#      permission-matrix.ts, ../src/shared/security) estao na imagem. Desligar DEMO_GROUP nao apaga dados.
#   4. node dist/main.js     - a API (exec: vira o PID 1 e recebe os sinais do Docker).
# Os stages "runner" (imagem enxuta) e "migrate" ficam para o docker-compose.prod.yml.
FROM build AS server
ENV NODE_ENV=production
# Imagens enviadas (POST /uploads): o compose monta o volume gingapp_uploads aqui (UPLOADS_DIR=/app/uploads).
RUN mkdir -p /app/uploads
ENV UPLOADS_DIR=/app/uploads
# Anexos PRIVADOS das inscricoes (volume gingapp_private_uploads): nunca servidos por rota publica.
RUN mkdir -p /app/private-uploads && chmod 700 /app/private-uploads
ENV PRIVATE_UPLOADS_DIR=/app/private-uploads
EXPOSE 3000
#   3b. prisma/ranking-backfill.ts --auto - Ginga Rank: deriva os pontos do historico (idempotente, sem notificar).
#      RANKING_BACKFILL=true roda sempre; =false nunca; sem a variavel roda UMA vez (tabela PointEvent vazia). Roda DEPOIS
#      do demo para o grupo demo ja entrar no ranking. Falha so' vai para o log (o recalculo noturno cobre).
#   3a1. prisma/group-roles-backfill.ts --auto - Cargos DO GRUPO (docs/FICHA_UNICA.md secao 13): os 4 cargos padrao de cada
#      grupo e o cargo do grupo nos cargos/regras antigos. GROUP_ROLES_BACKFILL=true sempre; =false nunca; vazio = quando ha
#      pendencia. Idempotente; nunca muda acesso. Falha so' vai para o log (as rotas criam os padrao sob demanda).
#   3a2. prisma/roles-backfill.ts --auto - Cargos (Fase 3): cargo ativo + matricula de aluno (isStaff) + ficha para cada membro
#      ativo da equipe. ROLES_BACKFILL=true sempre; =false nunca; vazio = quando ha equipe sem matricula. Falha so' vai para o log.
#   3a. prisma/person-backfill.ts --auto - Ficha unica (docs/FICHA_UNICA.md): liga cada Student sem personId a uma Person
#      (mesmo login / mesmo CPF / ficha nova; nunca por nome). PERSON_BACKFILL=true roda sempre; =false nunca; sem a
#      variavel roda quando ha Student sem ficha. Idempotente. Falha so' vai para o log (a API completa sob demanda).
CMD ["sh", "-c", "npx prisma migrate deploy && npx ts-node prisma/bootstrap.ts && { [ \"$DEMO_GROUP\" != true ] || npx ts-node prisma/demo.ts || echo '[demo] ERRO: o grupo demo nao foi criado (veja as linhas acima); a API sobe mesmo assim.'; } && { [ \"$PERSON_BACKFILL\" = false ] || npx ts-node prisma/person-backfill.ts --auto || echo '[person] ERRO: o backfill da ficha unica falhou (veja as linhas acima); a API sobe mesmo assim.'; } && { [ \"$GROUP_ROLES_BACKFILL\" = false ] || npx ts-node prisma/group-roles-backfill.ts --auto || echo '[group-roles] ERRO: o backfill dos cargos do grupo falhou (veja as linhas acima); a API sobe mesmo assim.'; } && { [ \"$ROLES_BACKFILL\" = false ] || npx ts-node prisma/roles-backfill.ts --auto || echo '[roles] ERRO: o backfill dos cargos falhou (veja as linhas acima); a API sobe mesmo assim.'; } && { [ \"$RANKING_BACKFILL\" = false ] || npx ts-node prisma/ranking-backfill.ts --auto || echo '[ranking] ERRO: o backfill do ranking falhou (veja as linhas acima); a API sobe mesmo assim.'; } && exec node dist/main.js"]