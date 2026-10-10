# Deploy do GingApp no Easypanel

Dois arquivos, nada mais:

- `docker-compose.easypanel.yml` – cole **inteiro** no serviço Compose do Easypanel.
- `.env.easypanel.example` – as variáveis; cole os pares `CHAVE=VALOR` no **Environment** do serviço.

Como funciona: o compose sobe `postgres` + `migrate` (aplica as migrations e cria o super admin, depois sai) + `backend` + `painel` + `app` + `admin`. As imagens são **construídas no próprio servidor**, buscando o código direto do GitHub (`build.context` com URL do repositório). Não usa GHCR, Docker Hub como registro, CI nem pacotes: só precisa que o servidor alcance o GitHub, o Docker Hub (`node`, `nginx`, `postgres`) e o registry npm.

> **O que foi verificado:** localmente, a mesma stack (postgres + migrate + backend + 3 nginx) subiu, `GET /api/health` respondeu 200 e o login do admin funcionou; o contexto Git com `#branch:pasta` buildou num repositório público de teste. **Não verificado:** a busca de um repositório **privado** com `GIT_TOKEN` (não havia token para testar) e tudo que depende do Easypanel/servidor (telas, DNS, rede). Os nomes de telas abaixo são do conhecimento geral da ferramenta.

## 1. Variáveis (Environment)

Preencha as do `.env.easypanel.example`: `POSTGRES_PASSWORD`, `JWT_SECRET`, `CORS_ORIGINS`, `VITE_API_URL`, `VITE_APP_URL`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (e `SUPER_ADMIN_NAME`, `GIT_TOKEN`). Variável obrigatória ausente faz o deploy falhar na hora, dizendo qual.

- **Postgres:** senha só com letras e números. Ela só vale na **primeira** criação do volume `gingapp_pgdata`; trocar depois não muda a senha gravada (para trocar: `ALTER USER gingapp PASSWORD '...'` no Postgres e depois atualize a variável). Apagar o volume apaga o banco.
- **`VITE_API_URL`** inclui o `/api` (`https://api.seudominio.com.br/api`), sem barra final. As URLs são embutidas nos frontends **no build**: mudou o domínio? Altere a variável e faça novo Deploy.
- **`CORS_ORIGINS`:** exatamente as 3 origens dos frontends (o `api.` não entra), `https`, sem barra final e sem `*`.
- **Super admin:** `SUPER_ADMIN_EMAIL` e `SUPER_ADMIN_PASSWORD` **juntos** (só um dos dois, ou senha fraca, faz o `migrate` falhar e o backend não sobe). Senha: 12–72 caracteres, 3 de 4 classes (minúscula, maiúscula, dígito, símbolo), sem conter o e-mail nem termos como `dev@12345`, `senha`, `admin`, `gingapp`. Se o e-mail já existir, o bootstrap **não** altera nada (nem a senha).
- **`GIT_TOKEN`:** só se o repositório for **privado**. Fine-grained token do GitHub com acesso só ao repositório `GingApp` e permissão *Contents: Read-only*. Vazio = repositório público. (Alternativa sem token: deixar o repositório público.)

## 2. Subir

1. **+ Service → Compose**, cole o `docker-compose.easypanel.yml` e as variáveis; **Save**.
2. **Deploy.** O primeiro leva ~5–10 min (compila backend e 3 frontends no servidor; recomendado ≥ 4 GB de RAM livre ou swap). Cada novo Deploy rebuilda a partir do último commit da `master`.
3. **Domínios** (DNS tipo A para o IP do servidor antes, para o Let's Encrypt emitir o certificado) – em cada serviço, aba **Domains**, com HTTPS:

   | Domínio | Serviço | Porta |
   | --- | --- | --- |
   | `api.seudominio.com.br` | `backend` | 3000 |
   | `painel.seudominio.com.br` | `painel` | 80 |
   | `app.seudominio.com.br` | `app` | 80 |
   | `admin.seudominio.com.br` | `admin` | 80 |

   Nenhuma porta é publicada no host: o Easypanel faz o proxy.

## 3. Conferir

1. `https://api.seudominio.com.br/api/health` → `{"status":"ok",...,"database":"up"}`.
2. Entre em `https://admin.seudominio.com.br` com o e-mail/senha do super admin e **troque a senha** (Equipe → Redefinir senha).
3. Console do navegador (F12): erro `blocked by CORS policy` = origem fora do `CORS_ORIGINS`; requisições indo para `localhost` = `VITE_API_URL` vazio/errado no build.
4. Crie o primeiro grupo e o MESTRE pelo admin ("Novo grupo"); depois entre no painel.

## 4. Problemas conhecidos

- **`path ... not found` no build:** o `build.context` do compose é uma URL do GitHub, então o compose precisa estar **inteiro** como está (não troque os `context` por `./pasta`).
- **Erro de autenticação ao baixar o código:** repositório privado sem `GIT_TOKEN`, ou token sem permissão de leitura no repositório.
- **Build sem memória (`killed`, `exit 137`):** pouca RAM no servidor; adicione swap ou use um servidor com mais memória.
- **Docker Hub `toomanyrequests`/timeout:** o servidor precisa baixar `node`, `nginx` e `postgres` do Docker Hub; tente de novo mais tarde ou faça login no Docker Hub no servidor.
- **Backend não sobe e o `migrate` falhou:** leia o log do `migrate` (senha do super admin fraca, EMAIL sem PASSWORD, ou `POSTGRES_PASSWORD` diferente da gravada no volume).

## 5. O que este repositório não cobre

Backup automatizado do Postgres (manual: `docker exec <container-postgres> pg_dump -U gingapp -d gingapp -Fc > backup.dump` e copie para fora do servidor — o banco é um volume do próprio servidor), monitoramento/alertas, 2FA, logs centralizados e rotação de segredos.

`PLATFORM_ALLOWED_IPS` (restringe o login do admin por IP, comparação exata, sem CIDR) não está no compose enxuto; se precisar, adicione a variável ao serviço `backend` e leia os riscos de auto-bloqueio em `backend/src/interface/http/auth/auth.controller.ts`.
