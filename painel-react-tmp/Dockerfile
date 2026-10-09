# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json .npmrc ./
RUN npm ci

COPY . .
# Vite embute env vars no bundle em tempo de BUILD, não de execução.
# Uso: docker build --build-arg VITE_API_URL=https://api.gingapp.com.br/api .
ARG VITE_API_URL=http://localhost:3000/api
ENV VITE_API_URL=$VITE_API_URL
# Origem do app do aluno: o QR de certificados aponta para as paginas publicas /verificar/:code dele.
ARG VITE_APP_URL=http://localhost:4173
ENV VITE_APP_URL=$VITE_APP_URL
RUN npm run build

# ---- runtime stage ----
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
