# ---- Build stage ----
# Imagens base como ARG: o CI troca pelo espelho public.ecr.aws (o Docker Hub limita pulls sem login
# nos runners compartilhados do GitHub). Padrao = Docker Hub, entao `docker build` local nao muda.
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package*.json .npmrc ./
RUN npm ci

COPY . .
# Vite embute env vars no bundle em tempo de BUILD, não de execução — sem isso, a imagem
# sempre apontaria para o fallback de dev (localhost:3000) mesmo rodando num domínio real.
# Uso: docker build --build-arg VITE_API_URL=https://api.gingapp.com.br/api .
ARG VITE_API_URL=http://localhost:3000/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- Serve stage ----
FROM ${NGINX_IMAGE} AS serve

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
