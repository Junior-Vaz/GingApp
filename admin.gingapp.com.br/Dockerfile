# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Vite embute env vars no bundle em tempo de BUILD, não de execução — sem isso, a imagem
# sempre apontaria para o fallback de dev (localhost:3000) mesmo rodando num domínio real.
# Uso: docker build --build-arg VITE_API_URL=https://api.gingapp.com.br/api .
ARG VITE_API_URL=http://localhost:3000/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- Serve stage ----
FROM nginx:1.27-alpine AS serve

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
