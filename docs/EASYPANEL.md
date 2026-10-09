# Deploy do GingApp no Easypanel

Guia passo a passo para quem nunca usou o Easypanel. Arquivos relacionados (na raiz do repositório):

- `docker-compose.easypanel.yml` – stack com imagens prontas do GHCR (migrate, backend, painel, app, admin).
- `.env.easypanel.example` – todas as variáveis, comentadas (copie para `.env.easypanel`, que está no `.gitignore`).
- `.github/workflows/build.yml` – CI que valida o código e publica as imagens no GHCR.

> **Aviso de honestidade (leia primeiro).** Nada deste guia foi executado de ponta a ponta: **nenhuma imagem Docker do GingApp foi buildada e nenhum deploy real foi feito** nesta máquina (o Docker Hub deu timeout ao tentar baixar `node:22-alpine`). O que foi verificado de fato: o YAML do compose valida com `docker compose config`; os nomes de variáveis, rotas e o prefixo `/api` foram conferidos no código. **As telas e nomes de botões do Easypanel descritos abaixo são do conhecimento geral da ferramenta e NÃO foram vistos ao vivo** – se um rótulo for diferente na sua versão, siga a intenção do passo. Itens não verificados estão marcados com **[NÃO VERIFICADO]**; a lista completa está na seção 12.

---

## 0. Visão geral

```
Internet --HTTPS--> Easypanel (proxy + Let's Encrypt)
    api.seudominio.com.br    -> backend :3000   (NestJS, rotas sob /api)
    painel.seudominio.com.br -> painel  :80     (nginx estático)
    app.seudominio.com.br    -> app     :80     (nginx estático)
    admin.seudominio.com.br  -> admin   :80     (nginx estático)

Rede interna "gingapp" (do compose):  backend --> postgres (nome DNS "postgres", mesmo compose)
```

Peças:

| Peça | De onde vem | Observação |
| --- | --- | --- |
| `postgres` | `postgres:16-alpine` (Docker Hub), **dentro do compose** | Decisão do dono: banco junto da stack. Dados no volume `gingapp_pgdata`; porta não publicada |
| `migrate` | `ghcr.io/junior-vaz/gingapp-migrate` | One-shot: `prisma migrate deploy` + bootstrap do super admin; depois sai |
| `backend` | `ghcr.io/junior-vaz/gingapp-backend` | Healthcheck em `GET /api/health` |
| `painel` / `app` / `admin` | `gingapp-painel` / `gingapp-app` / `gingapp-admin` | Estáticos; sem variáveis de runtime |

Todas as imagens saem com as tags `latest` e `<SHA completo do commit>`.

---

## 1. Criar o projeto no Easypanel

1. No painel do Easypanel, clique em **Create Project** (ou "Novo projeto") e dê um nome curto, sem espaços, por exemplo `gingapp`.
2. O compose fica com o nome do serviço que você criar (ex.: `gingapp`); o Easypanel o executa como o projeto `<projeto>_<serviço>` do Docker.

---

## 2. O Postgres 16 já vem dentro do compose (não crie um serviço separado)

Decisão do dono: o banco sobe **junto da stack**, como o serviço `postgres` do `docker-compose.easypanel.yml` (imagem oficial `postgres:16-alpine`). **Não** crie um serviço Postgres separado no Easypanel.

1. Você só precisa definir **`POSTGRES_PASSWORD`** (Environment do serviço Compose). Use senha **só com letras e números** (`openssl rand -hex 24`): ela entra dentro de uma URL e caracteres como `@ : / ? # ! %` quebrariam a conexão.
2. O compose monta sozinho a `DATABASE_URL` do `migrate` e do `backend`: `postgresql://gingapp:<POSTGRES_PASSWORD>@postgres:5432/gingapp?schema=public` (usuário e banco fixos `gingapp`; host = nome do serviço, resolvido pelo DNS da rede `gingapp`, que é a mesma do backend). Por isso **não existe mais o problema de rede entre compose e Postgres** que a versão anterior deste guia descrevia.
3. Os dados ficam no **volume nomeado `gingapp_pgdata`** (com o prefixo do projeto, algo como `gingapp_gingapp_pgdata`): sobrevive a redeploy e a recriação dos containers. **Apagar o volume apaga o banco.** Não use "recriar/limpar volumes" no Easypanel sem backup.
4. **A porta 5432 não é publicada**: só os serviços do compose alcançam o banco.
5. **A senha só vale na primeira criação do volume.** Se você trocar `POSTGRES_PASSWORD` depois, o Postgres continua com a senha antiga e o backend passa a falhar com erro de autenticação. Para trocar de verdade: no servidor, `docker exec -it <container-postgres> psql -U gingapp -d gingapp -c "ALTER USER gingapp PASSWORD 'NOVA'"` e só então atualize a variável. Se o primeiro deploy falhou **antes** de o banco ter dado dados e você quer recomeçar com outra senha, apague o volume `gingapp_gingapp_pgdata` (só nesse caso, sem dados a perder).
6. **Banco externo (opcional):** se um dia quiser usar outro Postgres, defina `DATABASE_URL` completa no Environment; ela sobrescreve a URL montada (o serviço `postgres` do compose continuaria subindo sem uso).
7. **Backup.** O banco guarda tudo (alunos, financeiro, certificados). **Backup automatizado não está coberto por este repositório** (seção 11) e agora o banco é um volume do próprio servidor: se o disco/servidor se perder, os dados se perdem junto. Manualmente: `docker exec <container-postgres> pg_dump -U gingapp -d gingapp -Fc > backup.dump` (confira o nome do container com `docker ps`) e copie o arquivo para fora do servidor. **[NÃO VERIFICADO]** o Easypanel pode ter backup de volumes; verifique na interface.

---

## 3. Credenciais do GHCR (as imagens são privadas por padrão)

Os pacotes publicados no GHCR nascem **privados**. O Easypanel precisa de permissão para baixá-los. Duas saídas:

**Opção 1 – PAT com `read:packages` (recomendada para o backend/migrate).**

1. GitHub → *Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token (classic)*. (PATs "fine-grained" **não** dão acesso a pacotes do GHCR; use o clássico.)
2. Marque **somente** `read:packages`. Defina uma validade e anote-a (token expirado = deploy quebra).
3. Guarde o token (aparece uma vez).
4. Registro: servidor `ghcr.io`, usuário = seu usuário do GitHub (`junior-vaz`), senha = o PAT.
   - **Opção A (Apps por imagem):** no serviço App, na origem "Docker Image", informe imagem, usuário e senha do registro. **[NÃO VERIFICADO]** nome exato dos campos.
   - **Opção B (Compose):** **[NÃO VERIFICADO]** se o campo de credenciais do Easypanel vale para serviços Compose. O caminho garantido é fazer login no próprio servidor: via SSH ou console do servidor, `echo <PAT> | docker login ghcr.io -u <usuario> --password-stdin`.

**Opção 2 – tornar os pacotes públicos.**

GitHub → seu perfil → *Packages* → abrir cada pacote (`gingapp-backend`, `gingapp-migrate`, `gingapp-painel`, `gingapp-app`, `gingapp-admin`) → *Package settings* → *Danger Zone → Change visibility → Public*. **[NÃO VERIFICADO]** passos exatos na sua conta.

- Os três frontends são arquivos estáticos que o navegador baixa de qualquer jeito: torná-los públicos não expõe nada novo.
- **Atenção:** `gingapp-migrate` e `gingapp-backend` contêm o **código-fonte/JS compilado do backend**. `gingapp-migrate` em particular é o stage `build` completo (código + devDependencies). Se o código é privado, mantenha esses dois privados e use a Opção 1.

---

## 4. Secrets do GitHub para o CI (URLs embutidas nos frontends)

O Vite **embute** `VITE_*` no JavaScript na hora do build. Isso acontece no GitHub Actions, não no Easypanel. Configure no GitHub: *repositório → Settings → Secrets and variables → Actions → New repository secret*:

| Secret | Valor (exemplo) | Quem usa | Observação |
| --- | --- | --- | --- |
| `VITE_API_URL` | `https://api.seudominio.com.br/api` | painel, app, admin | **Inclui o `/api`** (prefixo global do backend, `app.setGlobalPrefix('api')` em `backend/src/main.ts`). Sem barra no final. |
| `VITE_APP_URL` | `https://app.seudominio.com.br` | só o painel | Origem do **app do aluno**: o QR dos certificados/passaporte abre `/verificar/...` nele. |

Pontos críticos:

- **Se os secrets não existirem, o CI NÃO falha**: `build.yml` usa o padrão `http://localhost:3000/api` e `http://localhost:8082` e publica imagens que só funcionam na máquina do desenvolvedor. Confira os secrets **antes** do primeiro build.
- **Mudar o domínio da API (ou do app) exige rebuild das imagens dos frontends**: atualize os secrets, rode de novo o workflow *Build & Push Docker Images* (aba Actions → Run workflow, ou novo push na `master`) e faça redeploy dos frontends. Definir `VITE_*` no Easypanel **não tem efeito**.
- O workflow só publica em `push` na `master` (ou disparo manual) e **depois** de passar validação (build, lint, testes unitários e e2e do backend). Imagem só existe no GHCR após um run verde.

---

## 5. DNS e domínios

Crie registros **A** (ou CNAME) para o IP do servidor do Easypanel antes de configurar os domínios (o Let's Encrypt só emite o certificado se o DNS já apontar para o servidor):

| Domínio | Serviço | Porta interna |
| --- | --- | --- |
| `api.seudominio.com.br` | backend | **3000** |
| `painel.seudominio.com.br` | painel | **80** |
| `app.seudominio.com.br` | app | **80** |
| `admin.seudominio.com.br` | admin | **80** |

No Easypanel, em cada serviço, aba **Domains**: adicione o domínio, aponte para a porta da tabela e habilite **HTTPS** (certificado Let's Encrypt automático). **Nenhuma porta é publicada no host** pelo compose – o Easypanel faz o proxy.

`CORS_ORIGINS` deve conter exatamente as três origens dos frontends (o `api.` **não** entra):

```
CORS_ORIGINS=https://painel.seudominio.com.br,https://app.seudominio.com.br,https://admin.seudominio.com.br
```

Regras (do código `backend/src/shared/config/runtime-config.ts`): origem completa com `https://`, sem barra final (o backend remove barras finais, mas mantenha limpo), **`*` é recusado em produção** e **vazio faz o boot falhar**.

---

## 6. Subir os serviços: duas opções

### Opção B (RECOMENDADA) – um serviço "Compose" com `docker-compose.easypanel.yml`

**Por que recomendo:** o compose já codifica a ordem correta (`migrate` roda e termina com sucesso → só então o `backend` sobe, via `condition: service_completed_successfully`), o `migrate` one-shot é suportado nativamente (`restart: "no"`), as 5 imagens e as variáveis ficam num lugar só versionado no git, e trocar de versão é mudar `IMAGE_TAG` e redeployar.

Passos:

1. No projeto: **+ Service → Compose**.
2. Fonte: o repositório Git (`junior-vaz/GingApp`, branch `master`) apontando para o arquivo `docker-compose.easypanel.yml`, **ou** cole o conteúdo do arquivo no editor do serviço. **[NÃO VERIFICADO]** rótulos exatos. (Se usar Git, como o repositório pode ser privado, será preciso uma deploy key/token no Easypanel; colar o conteúdo evita isso, mas então você precisa atualizá-lo à mão quando o arquivo mudar.)
3. Em **Environment**, cole as variáveis de `.env.easypanel.example` já preenchidas (`POSTGRES_PASSWORD`, `JWT_SECRET`, `CORS_ORIGINS`, `TRUST_PROXY=1`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, opcionalmente `SUPER_ADMIN_NAME`, `JWT_EXPIRES_IN`, `PLATFORM_ALLOWED_IPS`, `IMAGE_TAG`). Variáveis obrigatórias ausentes fazem o deploy **falhar na hora** com a mensagem de `${VAR:?...}` (comportamento verificado com `docker compose config`).
4. Faça login no GHCR se os pacotes forem privados (seção 3).
5. Configure os domínios (seção 5) – no serviço Compose, associe cada domínio ao nome do serviço (`backend`, `painel`, `app`, `admin`) e à porta. **[NÃO VERIFICADO]** como a interface do Easypanel pede o nome do serviço no modo Compose.
6. **Deploy.**

**Ordem de subida (já no compose):** `postgres` fica saudável (`pg_isready`) → `migrate` roda e termina → `backend` sobe e fica saudável. O banco está na **mesma rede** do compose, então não há o risco de DNS entre compose e Postgres de versões anteriores deste guia.

### Opção A – 4 serviços "App" por imagem + 1 para o migrate (exige um Postgres SEPARADO)

> Esta opção **não usa o Postgres do compose**: você teria de criar um serviço **Postgres** à parte no Easypanel (**+ Service → Postgres**) e montar a `DATABASE_URL` com o host interno dele (`<projeto>_<serviço>`, ex.: `postgresql://USUARIO:SENHA@gingapp_postgres:5432/BANCO?schema=public`). Como a decisão do dono é o banco dentro do compose, **use a Opção B**; a A fica só como alternativa.

Para cada um crie **+ Service → App**, origem **Docker Image**, e configure:

| Serviço App | Imagem | Domínio → porta | Variáveis |
| --- | --- | --- | --- |
| `backend` | `ghcr.io/junior-vaz/gingapp-backend:latest` | `api...` → 3000 | `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT=3000`, `CORS_ORIGINS`, `TRUST_PROXY=1`, `PLATFORM_ALLOWED_IPS`, `NODE_ENV=production` |
| `painel` | `ghcr.io/junior-vaz/gingapp-painel:latest` | `painel...` → 80 | nenhuma |
| `app` | `ghcr.io/junior-vaz/gingapp-app:latest` | `app...` → 80 | nenhuma |
| `admin` | `ghcr.io/junior-vaz/gingapp-admin:latest` | `admin...` → 80 | nenhuma |
| `migrate` | `ghcr.io/junior-vaz/gingapp-migrate:latest` | (sem domínio) | `DATABASE_URL`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_NAME` |

- Healthcheck do backend (se a tela oferecer): `GET /api/health` na porta 3000.
- Nesta opção a resolução do host do Postgres (`<projeto>_<serviço>`) funciona por serem todos serviços nativos do mesmo projeto **[NÃO VERIFICADO, mas é o modo padrão do Easypanel]**.
- **Fraqueza:** o Easypanel mantém Apps no ar (reinicia o que sai). O `migrate` termina e seria reiniciado em loop – é idempotente (não faz mal), mas polui logs e, se o bootstrap for lento, gasta recursos. Contornos **[NÃO VERIFICADOS]**: deixar o serviço parado depois de rodar, ou sobrescrever o comando do container por `sh -c "npx prisma migrate deploy && npx ts-node --transpile-only prisma/bootstrap.ts; sleep infinity"` (é o `CMD` atual do stage `migrate` em `backend/Dockerfile`, mais o `sleep`; com o `sleep`, uma falha do migrate deixa o container "vivo" – leia o log, não confie no status).
- **Fraqueza 2:** nada garante a ordem migrate → backend; você precisa rodar o migrate **antes** de cada deploy do backend manualmente.

**Resumo da escolha:** B é mais simples e mais seguro (ordem automática, um único lugar de configuração). A só vale se o teste de rede da Opção B falhar ou se você preferir gerir cada serviço isoladamente no painel.

---

## 7. Ordem de deploy e atualização

**Primeira vez**

1. Criar o projeto (seção 1) e gerar a `POSTGRES_PASSWORD` (o Postgres vem no compose, seção 2).
2. Definir os secrets `VITE_API_URL` e `VITE_APP_URL` no GitHub (seção 4).
3. Garantir que o workflow rodou **verde** na `master` e que as 5 imagens existem em *Packages*.
4. Configurar acesso ao GHCR (seção 3).
5. Apontar o DNS (seção 5).
6. Subir o Compose (ou os Apps) – o `migrate` roda primeiro, depois o `backend`; confirme `healthy` antes de seguir.
7. Configurar domínios + HTTPS e testar `https://api.seudominio.com.br/api/health` (esperado: JSON `{"status":"ok","timestamp":"...","database":"up"}`; 503 se o banco estiver fora).
8. Abrir painel, app e admin.

**A cada nova versão**

1. Faça merge na `master` e espere o workflow ficar verde (as imagens `latest` e `<sha>` são atualizadas).
2. No Easypanel, **Deploy/Redeploy** do serviço Compose. `pull_policy: always` baixa as imagens novas; como a imagem do `migrate` mudou, ele roda de novo (`prisma migrate deploy` é idempotente: só aplica migrations pendentes) e então o backend sobe.
   - **[NÃO VERIFICADO]** Se nenhuma imagem do migrate mudou, não há garantia de que o Easypanel o reexecute; é inofensivo, pois não há migration pendente. Para forçar: `docker compose -f docker-compose.easypanel.yml run --rm migrate` no servidor.
3. Se mudou algo que afeta `VITE_*` (domínio), refaça o build (seção 4) antes do redeploy dos frontends.

**Voltar versão:** defina `IMAGE_TAG=<SHA completo de 40 caracteres do commit>` e redeploy. **Cuidado:** migrations do banco **não são revertidas** ao voltar a imagem; só volte para versões compatíveis com o schema atual.

---

## 8. Checklist pós-deploy

1. `https://api.seudominio.com.br/api/health` responde `status: ok` e `database: up`.
2. Abra `https://admin.seudominio.com.br` e faça login com `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` (o admin autentica em `POST /api/auth/platform-login`).
3. **Troque a senha do super admin:** no admin, **Equipe** → ação **Redefinir senha** na sua própria linha (rota `POST /api/platform-team/:id/reset-password`; ao trocar a própria senha as sessões são encerradas e você entra de novo). Use senha forte, ≥ 12 caracteres, nunca `Dev@12345`. Conferido em `backend/prisma/bootstrap.ts`: se já existe usuário com aquele e-mail, o bootstrap **não altera senha nem nada** (só registra no log), então mudar a senha pelo admin não será desfeita num redeploy. Depois da troca você pode apagar `SUPER_ADMIN_PASSWORD` do ambiente (com EMAIL e PASSWORD ambos vazios o bootstrap apenas avisa e segue).
4. **Conferir CORS pelo console do navegador:** com F12 aberto (aba Console e Rede), faça login no admin, no painel e no app. Erro típico: `has been blocked by CORS policy` = a origem daquele front não está (ou está com barra final/`http`) em `CORS_ORIGINS`. Depois de corrigir, redeploy do backend. Confirme também que as requisições vão para `https://api.seudominio.com.br/api/...` e **não** para `localhost` (se forem para localhost, os secrets `VITE_*` estavam faltando no build – seção 4).
5. **Criar o primeiro grupo e o MESTRE — LACUNA CONFIRMADA NO CÓDIGO:** verifiquei que **não existe hoje nenhuma tela nem rota para criar um grupo (organização) ou seu primeiro MESTRE em produção**: `organizations.controller.ts` só tem `GET /organizations`, o admin (`OrganizationsView.vue`) só lista grupos, e o único código que cria `Organization`/`OrganizationUser` é `backend/prisma/seed.ts` (dados de **desenvolvimento**, senha `Dev@12345`). **Não rode `npm run db:seed` em produção.** O novo `backend/prisma/bootstrap.ts` também **não** cria organização (declara isso de propósito: só aplica a matriz de permissões e o super admin). Resultado: com o produto como está, um MESTRE não consegue ser criado em produção pelo fluxo normal. Decisão pendente do dono: criar o fluxo de onboarding de grupo no backend/admin, ou ampliar o bootstrap.
6. Depois que existir um MESTRE: login no painel, criar unidades/turmas, e testar um aluno no app.
7. Abrir um QR de certificado gerado pelo painel e confirmar que abre `https://app.seudominio.com.br/verificar/...` (valida `VITE_APP_URL`).

---

## 9. Restrição por IP do admin (`PLATFORM_ALLOWED_IPS`)

O que faz (conferido em `auth.controller.ts`): se definida, **`POST /api/auth/platform-login`** só aceita requisições cujo `req.ip` esteja **exatamente** na lista (separada por vírgula). Vazio = sem restrição.

Riscos e limites:

- **Auto-bloqueio:** IP residencial muda → ninguém consegue logar no admin. Recuperação: editar a variável no Easypanel e redeploy do backend (se o acesso ao Easypanel estiver de pé).
- **Comparação exata; não há suporte a CIDR/faixas** (diferente do GestorPrint). `203.0.113.0/24` **não funciona** aqui. IPv6 e IPv4-mapeado (`::ffff:1.2.3.4`) podem aparecer em formatos diferentes do esperado **[NÃO VERIFICADO]** – teste logando de fato.
- **Depende de `TRUST_PROXY` correto.** Atrás do proxy do Easypanel use `1`. Se houver outro proxy na frente (ex.: Cloudflare + proxy do Easypanel), o número de saltos é outro (`2`). Valor errado → ou todos aparecem com o IP do proxy (restrição inútil/bloqueia todos), ou o `X-Forwarded-For` pode ser forjado.
- **Só protege o login.** Um token JWT já emitido continua valendo de qualquer IP até expirar (`JWT_EXPIRES_IN`, padrão 1d). A restrição não é uma barreira de rede.
- O limite de tentativas de login (5/min por IP, padrão) também depende de `TRUST_PROXY` correto.

Se for usar, teste primeiro com o seu IP **incluído** e valide o login antes de fechar o acesso.

---

## 10. Variáveis (resumo, conferidas no código)

| Variável | Obrigatória | Onde é lida |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | sim (só letras e números) | serviço `postgres` do compose; também monta a `DATABASE_URL` |
| `DATABASE_URL` | não (opcional: banco externo) | backend e migrate (Prisma); vazio = usa o Postgres do compose |
| `JWT_SECRET` | sim, ≥ 32 chars e ≠ `dev-secret-change-me` | `runtime-config.ts` (`resolveJwtSecret`) |
| `JWT_EXPIRES_IN` | não (padrão `1d` no compose) | compose / backend |
| `PORT` | fixo `3000` | `main.ts` |
| `CORS_ORIGINS` | sim (produção) | `runtime-config.ts` (`parseCorsOrigins`) |
| `TRUST_PROXY` | recomendado `1` | `runtime-config.ts` (`parseTrustProxy`) |
| `PLATFORM_ALLOWED_IPS` | não | `auth.controller.ts` |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` / `SUPER_ADMIN_NAME` | preencher no 1º deploy; EMAIL e PASSWORD juntos ou nenhum (só um, ou senha fraca = `migrate` falha, exit 1) | `backend/prisma/bootstrap.ts` (stage `migrate`). Senha: 12–72 bytes, ≥ 3 das 4 classes, ≥ 6 caracteres distintos, sem espaço nas pontas, sem conter o e-mail nem termos como `dev@12345`, `senha`, `admin`, `gingapp`, `123456`. NAME opcional (padrão "Super Admin") |
| `IMAGE_TAG` | não (padrão `latest`) | só o compose |

---

## 11. O que NÃO está coberto

- **Backup automatizado** do Postgres (nem política de retenção, nem teste de restauração).
- **Monitoramento/alertas** (uptime, CPU, disco, erros). Só existe o healthcheck do Docker.
- **2FA** no login (admin, painel ou app).
- **Logs centralizados** (os logs ficam no Docker/Easypanel e se perdem na rotação).
- Rate limit além do que o backend já faz; WAF/CDN.
- Volume de uploads: não há (uma busca por `multer`, `FileInterceptor`, `writeFile` e `uploads` em `backend/src` não retornou nada, então o backend não grava arquivos em disco hoje; se isso mudar, será preciso um volume).
- Rotação de segredos (`JWT_SECRET`, PAT do GHCR) e do PAT expirando.
- Onboarding de grupos/MESTRE em produção (ver seção 8, item 5).

---

## 13. `TLS handshake timeout` ao baixar do `ghcr.io` (rede do servidor)

Sintoma no deploy: `Error Get "https://ghcr.io/v2/": net/http: TLS handshake timeout` (as outras imagens, como o Postgres do Docker Hub, podem baixar normalmente). É rede do servidor até o GHCR, **antes** de qualquer autenticação: não é senha, nem imagem inexistente.

1. **Diagnóstico** (no servidor, via SSH/console):
   ```bash
   curl -4 -sI -m 15 https://ghcr.io/v2/ | head -1   # IPv4
   curl -6 -sI -m 15 https://ghcr.io/v2/ | head -1   # IPv6
   curl    -sI -m 15 https://ghcr.io/v2/ | head -1   # padrão do sistema
   ```
   `HTTP/2 401` = alcançável (é o esperado sem login). Se `-4` responde e o padrão/`-6` dá timeout, o IPv6 do servidor está quebrado: desative-o (`sysctl -w net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1`, e persista em `/etc/sysctl.d/`) ou priorize IPv4 em `/etc/gai.conf` (`precedence ::ffff:0:0/96 100`) e reinicie o Docker. Outras causas comuns: DNS ruim (use `1.1.1.1`/`8.8.8.8`), MTU baixo do provedor, firewall bloqueando saída, ou congestionamento passageiro (o compose baixa as 5 imagens em paralelo).
2. **Login (as imagens são privadas por padrão):** `echo SEU_PAT | docker login ghcr.io -u junior-vaz --password-stdin` (PAT clássico só com `read:packages`, seção 3).
3. **Baixar uma por vez, com nova tentativa** (evita o paralelismo):
   ```bash
   for i in migrate backend painel app admin; do
     until docker pull ghcr.io/junior-vaz/gingapp-$i:latest; do echo "tentando de novo..."; sleep 5; done
   done
   ```
4. **Deploy sem contatar o registro:** com as imagens já baixadas, defina `PULL_POLICY=missing` no Environment e faça o deploy (o padrão `always` forçaria um novo pull e repetiria o timeout). Depois que a rede estiver estável, volte para `always`, senão os próximos deploys não atualizam as imagens.

---

## 12. Lista do que NÃO foi verificado

1. ~~Build real das imagens~~ **VERIFICADO (2026-10-09, máquina local):** as 5 imagens (backend `runner`, `migrate`, painel, app, admin) buildaram com os mesmos build-args do CI, usando o espelho `public.ecr.aws/docker/library` no lugar do Docker Hub (que dava timeout/`toomanyrequests`). Tamanhos: backend 566 MB, migrate 767 MB, frontends ~75 MB.
2. ~~Execução do `migrate`/`bootstrap`~~ **VERIFICADO (2026-10-09, local):** subiu o compose (`postgres:16-alpine` + `migrate` + `backend`) com essas imagens: Postgres ficou saudável, o `migrate` aplicou todas as migrations e criou o super admin, o backend ficou `healthy` (o healthcheck com `node -e fetch(...)` funcionou dentro da imagem), `GET /api/health` → `200 {"status":"ok","database":"up"}`, `POST /api/auth/platform-login` com o super admin do bootstrap → `200`, e os 3 nginx responderam. Isso **não** foi feito no Easypanel nem no GHCR (só localmente), então continua valendo o que depende do servidor (rede, credenciais, domínios).
3. Qualquer deploy real no Easypanel; todos os nomes de telas/campos do Easypanel.
4. Subida do compose **no servidor do Easypanel** (localmente funcionou, ver item 2). A imagem do Postgres vem do Docker Hub, que pode dar `toomanyrequests`/timeout no servidor: use `POSTGRES_IMAGE=public.ecr.aws/docker/library/postgres:16-alpine` se acontecer.
5. Se `docker compose up` reexecuta o `migrate` já finalizado no Easypanel.
6. Credenciais do GHCR no modo Compose do Easypanel.
7. Backup nativo do Easypanel para o Postgres.
8. Formato de IP (IPv6/mapeado) visto pelo backend atrás do proxy do Easypanel.
9. O workflow `build.yml` publicando de fato no GHCR (ainda não confirmado que o último run ficou verde e que os pacotes existem).
