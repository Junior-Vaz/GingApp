# Deploy do GingApp no Easypanel

Mesmo fluxo do GestorPrint: **push na `master` → GitHub Actions builda e publica as imagens no GHCR → o Easypanel baixa o `:latest`.** Dois arquivos:

- `docker-compose.easypanel.yml` – cole **inteiro** no serviço Compose do Easypanel.
- `.env.easypanel.example` – as variáveis; cole os pares `CHAVE=VALOR` no **Environment** do serviço.

O compose sobe `postgres` + `migrate` (aplica as migrations e cria o super admin, depois sai) + `backend` + `painel` + `app` + `admin`. O Postgres roda dentro do compose, com volume `gingapp_pgdata`.

> **O que foi verificado:** localmente, as 5 imagens buildaram com o mesmo método do CI e a stack subiu (`GET /api/health` 200, login do admin 200); o compose e o workflow validam. **Não verificado:** o GitHub Actions rodando de ponta a ponta, o `docker pull` do servidor a partir do GHCR e o Easypanel em si.

## 1. Antes do primeiro deploy (GitHub)

1. **Secrets** (repositório → Settings → Secrets and variables → Actions): `VITE_API_URL` = `https://api.seudominio.com.br/api` (com `/api`, sem barra final) e `VITE_APP_URL` = `https://app.seudominio.com.br`. São embutidos nos frontends durante o build; sem eles a imagem sai apontando para `localhost`. Mudou o domínio? Atualize os secrets, rode o workflow de novo e faça Deploy.
2. **Rode o workflow** *Build & Push Docker Images* (aba Actions → Run workflow, ou um push na `master`) e espere os 5 jobs ficarem verdes. Em **Packages** devem existir `gingapp-backend`, `gingapp-migrate`, `gingapp-painel`, `gingapp-app`, `gingapp-admin`.
3. **Acesso do servidor ao GHCR:** pacotes novos nascem **privados**. Faça como no GestorPrint: ou torne os 5 pacotes públicos (cada pacote → *Package settings → Change visibility*; os 3 frontends são estáticos, mas `gingapp-backend`/`gingapp-migrate` contêm o código do backend), ou deixe o servidor logado no GHCR (`docker login ghcr.io -u junior-vaz` com um PAT clássico `read:packages`; se o servidor já está logado para o GestorPrint, o mesmo login serve).

## 2. Variáveis (Environment)

`POSTGRES_PASSWORD`, `JWT_SECRET`, `CORS_ORIGINS`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (e `SUPER_ADMIN_NAME`). Variável obrigatória ausente faz o deploy falhar na hora, dizendo qual.

- **Postgres:** senha só com letras e números. Só vale na **primeira** criação do volume; trocar depois não muda a senha gravada (para trocar: `ALTER USER gingapp PASSWORD '...'` no Postgres e depois atualize a variável). Apagar o volume apaga o banco.
- **`CORS_ORIGINS`:** exatamente as 3 origens dos frontends (o `api.` não entra), `https`, sem barra final e sem `*`.
- **Super admin:** `EMAIL` e `PASSWORD` **juntos** (só um dos dois, ou senha fraca, faz o `migrate` falhar e o backend não sobe). Senha: 12–72 caracteres, 3 de 4 classes (minúscula, maiúscula, dígito, símbolo), sem conter o e-mail nem termos como `dev@12345`, `senha`, `admin`, `gingapp`. Se o e-mail já existir, o bootstrap **não** altera nada (nem a senha).

## 3. Subir

1. **+ Service → Compose**, cole o `docker-compose.easypanel.yml` e as variáveis; **Save** e **Deploy**.
2. **Domínios** (DNS tipo A para o IP do servidor antes, para o Let's Encrypt emitir o certificado) – em cada serviço, aba **Domains**, com HTTPS:

   | Domínio | Serviço | Porta |
   | --- | --- | --- |
   | `api.seudominio.com.br` | `backend` | 3000 |
   | `painel.seudominio.com.br` | `painel` | 80 |
   | `app.seudominio.com.br` | `app` | 80 |
   | `admin.seudominio.com.br` | `admin` | 80 |

3. **A cada nova versão:** `git push` → espere o Actions ficar verde → **Deploy** no Easypanel (`pull_policy: always` baixa as imagens novas; o `migrate` roda de novo e só aplica migrations pendentes).

## 4. Conferir

1. `https://api.seudominio.com.br/api/health` → `{"status":"ok",...,"database":"up"}`.
2. Entre em `https://admin.seudominio.com.br` com o e-mail/senha do super admin e **troque a senha** (Equipe → Redefinir senha).
3. Console do navegador (F12): `blocked by CORS policy` = origem fora do `CORS_ORIGINS`; requisições indo para `localhost` = secrets `VITE_*` faltando no build.
4. Crie o primeiro grupo e o MESTRE pelo admin ("Novo grupo"); depois entre no painel.

## 5. Problemas conhecidos

- **`TLS handshake timeout` / `unauthorized` / `denied` ao baixar do `ghcr.io`:** `timeout` = rede do servidor até o GHCR (teste `curl -4 -sI https://ghcr.io/v2/` no servidor; `HTTP/2 401` = alcançável); `unauthorized`/`denied` = pacote privado e servidor sem login (passo 1.3); `manifest unknown`/`not found` = o Actions ainda não publicou as imagens (passo 1.2).
- **Actions falhando em `Pull base images`:** os registros anônimos (espelho da AWS e Docker Hub) limitam pulls por IP; o passo tenta os dois com nova tentativa por alguns minutos. Se esgotar, rode o workflow de novo.
- **Backend não sobe e o `migrate` falhou:** leia o log do `migrate` (senha do super admin fraca, EMAIL sem PASSWORD, ou `POSTGRES_PASSWORD` diferente da gravada no volume).

## 6. O que este repositório não cobre

Backup automatizado do Postgres (manual: `docker exec <container-postgres> pg_dump -U gingapp -d gingapp -Fc > backup.dump` e copie para fora do servidor — o banco é um volume do próprio servidor), monitoramento/alertas, 2FA, logs centralizados e rotação de segredos. Os testes (lint, unitários, e2e) ficam em `.github/workflows/tests.yml`, em pull request ou manualmente, e não bloqueiam o deploy.
