# Deploy do GingApp no Easypanel

Fluxo: **push na `master` → GitHub Actions builda e publica as imagens no Docker Hub → o Easypanel baixa o `:latest`.** (Docker Hub e não GHCR porque o servidor deste projeto dá `TLS handshake timeout` no `ghcr.io`, mas baixa do Docker Hub normalmente.) Dois arquivos:

- `docker-compose.easypanel.yml` – cole **inteiro** no serviço Compose do Easypanel.
- `.env.easypanel.example` – as variáveis: `DOCKERHUB_USER`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_NAME`.

O compose sobe `postgres` + `migrate` (aplica as migrations e cria o super admin, depois sai) + `backend` + `painel` + `app` + `admin`. O Postgres roda dentro do compose, com volume `gingapp_pgdata`.

**Não existe URL de API para configurar** (nem `VITE_*`, nem domínio `api.`): cada front chama `/api` no **próprio domínio** e o nginx dele repassa para o serviço `backend` da rede do compose. Por isso não há CORS a ajustar.

> **Verificado localmente:** as 5 imagens buildaram e a stack subiu com esse desenho (front → nginx → backend; `/api/health` 200 pelos 3 nginx; login do admin). **Não verificado:** o Actions publicando no Docker Hub, o servidor baixando do Docker Hub e o Easypanel em si.

## 1. Docker Hub + GitHub (uma vez)

1. Crie uma conta gratuita no [Docker Hub](https://hub.docker.com) e anote o **usuário**.
2. Crie um **Access Token** (Account settings → Personal access tokens) com permissão **Read & Write**.
3. No GitHub, repositório → *Settings → Secrets and variables → Actions → New repository secret*: `DOCKERHUB_USERNAME` (seu usuário) e `DOCKERHUB_TOKEN` (o token).
4. **Rode o workflow** *Build & Push Docker Images* (aba Actions → Run workflow, ou um push na `master`) e espere os 5 jobs ficarem verdes. Em hub.docker.com devem existir os repositórios `gingapp-backend`, `gingapp-migrate`, `gingapp-painel`, `gingapp-app` e `gingapp-admin`.
5. **Privacidade:** repositórios criados por push no Docker Hub costumam nascer **públicos** (confira em Account settings → Default privacy; **[NÃO VERIFICADO]** o padrão exato da sua conta). `gingapp-backend` e `gingapp-migrate` contêm o código do backend; os 3 frontends são estáticos. Se o backend não pode ficar público: contas gratuitas têm só 1 repositório privado, então use um plano pago, ou mantenha público, ou volte ao GHCR (`ghcr.io`) quando a rede do servidor permitir. Repositório privado exige `docker login` no servidor.

## 2. Variáveis (Environment)

- **`DOCKERHUB_USER`:** seu usuário do Docker Hub, em minúsculas.
- **`POSTGRES_PASSWORD`:** só letras e números. Só vale na **primeira** criação do volume; trocar depois não muda a senha gravada (para trocar: `ALTER USER gingapp PASSWORD '...'` no Postgres e depois atualize a variável). Apagar o volume apaga o banco.
- **`JWT_SECRET`:** 32+ caracteres aleatórios (`openssl rand -hex 32`).
- **Super admin:** `EMAIL` e `PASSWORD` **juntos** (só um dos dois, ou senha fraca, faz o `migrate` falhar e o backend não sobe). Senha: 12–72 caracteres, 3 de 4 classes (minúscula, maiúscula, dígito, símbolo), sem conter o e-mail nem termos como `dev@12345`, `senha`, `admin`, `gingapp`. Se o e-mail já existir, o bootstrap **não** altera nada (nem a senha).
- **`COMPOSE_PARALLEL_LIMIT=1`:** baixa uma imagem por vez (o 1º deploy puxa ~1,6 GB).
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
3. **A cada nova versão:** `git push` → espere o Actions ficar verde → **Deploy** no Easypanel (`pull_policy: always` baixa as imagens novas; o `migrate` roda de novo e só aplica migrations pendentes).

## 4. Conferir

1. `https://painel.seudominio.com.br/api/health` → `{"status":"ok",...,"database":"up"}` (passa pelo nginx do painel até o backend).
2. Entre em `https://admin.seudominio.com.br` com o e-mail/senha do super admin e **troque a senha** (Equipe → Redefinir senha).
3. Crie o primeiro grupo e o MESTRE pelo admin ("Novo grupo"); depois entre no painel.

## 5. Problemas conhecidos

- **`pull access denied` / `not found` / `manifest unknown` ao baixar:** o Actions ainda não publicou (passo 1.4), `DOCKERHUB_USER` está errado/com maiúsculas, ou o repositório no Docker Hub é privado e o servidor não está logado.
- **Actions falha em `Log in to Docker Hub`:** secrets `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` ausentes, token sem permissão *Read & Write* ou expirado.
- **Actions falhando em `Pull base images`:** os registros limitam pulls; o passo tenta o espelho da AWS e o Docker Hub (já autenticado) com nova tentativa por alguns minutos. Se esgotar, rode o workflow de novo.
- **`/api/...` dá 502 num front:** o backend não está de pé (veja o log dele e o do `migrate`).
- **Backend não sobe e o `migrate` falhou:** leia o log do `migrate` (senha do super admin fraca, EMAIL sem PASSWORD, ou `POSTGRES_PASSWORD` diferente da gravada no volume).

## 6. O que este repositório não cobre

Backup automatizado do Postgres (manual: `docker exec <container-postgres> pg_dump -U gingapp -d gingapp -Fc > backup.dump` e copie para fora do servidor — o banco é um volume do próprio servidor), monitoramento/alertas, 2FA, logs centralizados e rotação de segredos. Os testes (lint, unitários, e2e) ficam em `.github/workflows/tests.yml`, em pull request ou manualmente, e não bloqueiam o deploy.
