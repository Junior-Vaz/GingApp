# Deploy do GingApp no Easypanel

Fluxo: **push na `master` → GitHub Actions builda e publica as imagens no Docker Hub → o Easypanel baixa o `:latest`.** (Este servidor não alcança `github.com`/`ghcr.io`; alcança `registry-1.docker.io`.) Dois arquivos:

- `docker-compose.easypanel.yml` – cole **inteiro** no serviço Compose do Easypanel.
- `.env.easypanel.example` – as variáveis: `POSTGRES_PASSWORD`, `JWT_SECRET`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_NAME`, `DOCKERHUB_USERNAME` e `COMPOSE_PARALLEL_LIMIT=1`.

O compose sobe `postgres` + `backend` + `painel` + `app` + `admin`. **O backend aplica as migrations e cria o super admin ao subir** (como o GestorPrint; não há serviço/imagem `migrate` separado). O Postgres roda dentro do compose, com volume `gingapp_pgdata`.

**Não existe URL de API para configurar** (nem `VITE_*`, nem domínio `api.`): cada front chama `/api` no **próprio domínio** e o nginx dele repassa para o serviço `backend`. Por isso não há CORS a ajustar.

> **Verificado localmente:** as imagens buildaram e a stack subiu com esse desenho (front → nginx → backend; `/api/health` 200 pelos 3 nginx; login do admin); o backend em um único container aplica as migrations, cria o admin e sobe. **Não verificado neste servidor:** o GitHub Actions publicando no Docker Hub e o Easypanel baixando de lá.

## 1. Antes do primeiro deploy (GitHub + Docker Hub)

1. Crie uma conta no [Docker Hub](https://hub.docker.com/) e um Access Token (*Account Settings → Personal access tokens*, permissão Read & Write).
2. No repositório GitHub: **Settings → Secrets and variables → Actions** e crie:
   - `DOCKERHUB_USERNAME` — usuário do Docker Hub (não o e-mail)
   - `DOCKERHUB_TOKEN` — o token
3. **Rode o workflow** *Build & Push Docker Images* (aba Actions → Run workflow, ou um push na `master`) e espere os 4 jobs ficarem verdes. No Docker Hub devem existir `gingapp-backend`, `gingapp-painel`, `gingapp-app` e `gingapp-admin`.
4. **Deixe os 4 repositórios públicos** (Docker Hub → cada repositório → Settings → Make public), senão o Easypanel precisa de `docker login` no host. Os 3 frontends são estáticos; `gingapp-backend` contém o código do backend.

## 2. Variáveis (Environment)

- **`POSTGRES_PASSWORD`:** só letras e números. Só vale na **primeira** criação do volume; trocar depois não muda a senha gravada (para trocar: `ALTER USER gingapp PASSWORD '...'` no Postgres e depois atualize a variável). Apagar o volume apaga o banco.
- **`JWT_SECRET`:** 32+ caracteres aleatórios (`openssl rand -hex 32`).
- **Super admin:** `EMAIL` e `PASSWORD` **juntos** (só um dos dois, ou senha fraca, faz o backend **não subir**: veja o log). Senha: 12–72 caracteres, 3 de 4 classes (minúscula, maiúscula, dígito, símbolo), sem conter o e-mail nem termos como `dev@12345`, `senha`, `admin`, `gingapp`. Se o e-mail já existir, nada é alterado (nem a senha).
- **`DOCKERHUB_USERNAME`:** o mesmo usuário do secret do Actions (as imagens são `USUARIO/gingapp-*`).
- **`COMPOSE_PARALLEL_LIMIT=1`:** baixa uma imagem por vez.
- *(Opcional)* `CORS_ORIGINS`: o padrão do compose já cobre `painel./app./admin.gingapp.com.br`.

## 3. Subir

1. **+ Service → Compose**, cole o `docker-compose.easypanel.yml` e as variáveis; **Save** e **Deploy**.
2. **Domínios** (DNS tipo A para o IP do servidor antes, para o Let's Encrypt emitir o certificado) – só **3**, em cada serviço, aba **Domains**, com HTTPS, **todos na porta 80**:

   | Domínio | Serviço | Porta |
   | --- | --- | --- |
   | `painel.seudominio.com.br` | `painel` | 80 |
   | `app.seudominio.com.br` | `app` | 80 |
   | `admin.seudominio.com.br` | `admin` | 80 |

   O `backend` não precisa de domínio. O painel monta o link do QR dos certificados trocando `painel.<dominio>` por `app.<dominio>` (use esses prefixos).
3. **A cada nova versão:** `git push` → espere o Actions ficar verde → **Deploy** no Easypanel (`pull_policy: always` baixa as imagens novas; o backend aplica as migrations pendentes ao subir).

## 4. Conferir

1. `https://painel.seudominio.com.br/api/health` → `{"status":"ok",...,"database":"up"}` (passa pelo nginx do painel até o backend). O backend leva até ~1–2 min para ficar pronto (aplica migrations e o bootstrap antes de subir a API).
2. Entre em `https://admin.seudominio.com.br` com o e-mail/senha do super admin e **troque a senha** (Equipe → Redefinir senha).
3. Crie o primeiro grupo e o MESTRE pelo admin ("Novo grupo"); depois entre no painel.

## 5. Problemas conhecidos

- **`TLS handshake timeout` / timeout em `ghcr.io` ou `github.com`:** neste servidor o GitHub está bloqueado; as imagens vêm do Docker Hub. Se o compose ainda tiver `ghcr.io/...`, atualize para `docker-compose.easypanel.yml`.
- **`unauthorized` / `denied` no Docker Hub:** repositório privado sem login no host — torne público (passo 1.4).
- **`manifest unknown` / `not found`:** o Actions ainda não publicou, ou `DOCKERHUB_USERNAME` no Easypanel não é o mesmo do secret.
- **Actions falhando em `Pull base images`:** os registros anônimos limitam pulls por IP; o passo tenta o espelho da AWS e o Docker Hub com nova tentativa por alguns minutos. Se esgotar, rode o workflow de novo.
- **`/api/...` dá 502 num front:** o backend não está de pé (veja o log dele).
- **Backend reiniciando em loop:** leia o log dele; causas comuns: senha do super admin fraca, `EMAIL` sem `PASSWORD`, ou `POSTGRES_PASSWORD` diferente da gravada no volume.

## 6. O que este repositório não cobre

Backup automatizado do Postgres (manual: `docker exec <container-postgres> pg_dump -U gingapp -d gingapp -Fc > backup.dump` e copie para fora do servidor — o banco é um volume do próprio servidor), monitoramento/alertas, 2FA, logs centralizados e rotação de segredos. Os testes (lint, unitários, e2e) ficam em `.github/workflows/tests.yml`, em pull request ou manualmente, e não bloqueiam o deploy.
