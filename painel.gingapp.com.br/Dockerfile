# ---- build stage ----
# Imagens base como ARG: o CI troca pelo espelho public.ecr.aws (o Docker Hub limita pulls sem login
# nos runners compartilhados do GitHub). Padrao = Docker Hub, entao `docker build` local nao muda.
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package*.json .npmrc ./
RUN npm ci

COPY . .
# Vite embute env vars no bundle em tempo de BUILD, não de execução.
# Padrao /api (relativo): o nginx do proprio front repassa /api para o servico "backend" (ver nginx.conf),
# entao nao ha URL absoluta embutida. So passe --build-arg VITE_API_URL=<url> para apontar para outra API.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# Origem do app do aluno: o QR de certificados aponta para as paginas publicas /verificar/:code dele.
ARG VITE_APP_URL=
ENV VITE_APP_URL=$VITE_APP_URL
RUN npm run build

# ---- runtime stage ----
FROM ${NGINX_IMAGE} AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
