# GingApp - app do aluno

SPA estática (Vite + React 19 + TanStack Router/Query + shadcn + Tailwind 4) que consome a API NestJS.
Substitui o app Vue anterior de `app.gingapp.com.br`.

```sh
npm install
cp .env.example .env     # ajuste VITE_API_URL
npm run dev              # http://localhost:5173
npm run build            # gera dist/ (servível por nginx)
npm run lint && npm test
```

- `VITE_API_URL` (build-time) aponta para a API (padrão `http://localhost:3000/api`).
- Sessão em `localStorage` (`mb_token` / `mb_user`); 401 limpa a sessão e volta ao `/login`.
- PWA: o service worker só cacheia shell e assets, nunca `/api/`.
- Docker: `docker build --build-arg VITE_API_URL=https://api.gingapp.com.br/api -t gingapp-app .`
