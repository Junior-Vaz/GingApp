# Deploy do GingApp no Easypanel

Fluxo: **push na `master` → GitHub Actions builda e publica as imagens no Docker Hub → o Easypanel baixa o `:latest`.** (Este servidor não alcança `github.com`/`ghcr.io`; alcança `registry-1.docker.io`.) Dois arquivos:

- `docker-compose.easypanel.yml` – cole **inteiro** no serviço Compose do Easypanel.
- `.env.easypanel.example` – as variáveis: `POSTGRES_PASSWORD`, `JWT_SECRET`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_NAME`, `DOCKERHUB_USERNAME` e `COMPOSE_PARALLEL_LIMIT=1` (mais, opcionais, `DEMO_GROUP` e `DEMO_PASSWORD` — seção 5).

O compose sobe `postgres` (alias `gingapp-db`) + `backend` (alias `gingapp-api`) + `backup` (alias `gingapp-backup`, seção 7) + `painel` + `app` + `admin`. **O backend aplica as migrations e cria o super admin ao subir** (como o GestorPrint; não há serviço/imagem `migrate` separado). O Postgres roda dentro do compose, com volume `gingapp_pgdata`.

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

## 5. Grupo demo (opcional)

Um grupo de demonstração completo ("Grupo Axé Demo", slug `demo`), só com dados fictícios, para mostrar o sistema.

- **Ligar:** no Environment do serviço Compose defina `DEMO_GROUP=true` e `DEMO_PASSWORD=<senha forte>` (a senha de **todas** as contas demo; mesma política do super admin: 12–72 caracteres, 3 de 4 classes, sem `senha`, `admin`, `gingapp`, `dev@12345`) e faça **Deploy**. O backend cria o grupo ao subir (alguns segundos a mais no boot). Sem `DEMO_PASSWORD`, ou com senha fraca, o demo **não** é criado e a API sobe normalmente: o motivo aparece no log do backend (`[demo] ERRO: ...`).
- **O que é criado:** 3 unidades (Matriz Goiânia, Filiais Anápolis e Brasília), 30 alunos (crianças e adolescentes com responsável, adultos, 4 inativos), 6 turmas com matrículas, aulas dos últimos 2 meses e das próximas 2 semanas com frequência, cordas e histórico de graduações, mensalidades (pagas, pendentes e em atraso) e despesas, eventos, rodas, comunicados, notificações, certificados e Passaportes públicos. Plano `PROFISSIONAL` (criado se não existir) e assinatura ativa por 1 ano. Datas sempre relativas ao dia do deploy.
- **Contas** (login no `painel.` e no `app.`, senha = `DEMO_PASSWORD`): `mestre@demo.gingapp.com.br` (MESTRE), `professor1@`, `professor2@`, `professor3@` (PROFESSOR), `aluno1@`, `aluno2@`, `aluno3@` (ALUNO) e `aluno4@` (RESPONSAVEL com 2 dependentes, mostra o seletor de aluno no app) — todas `@demo.gingapp.com.br`.
- **Reexecução:** a cada deploy o demo é só **completado** (nada duplica, nada existente é sobrescrito); a senha das contas demo acompanha `DEMO_PASSWORD` e, com o tempo, entram as aulas, mensalidades e eventos novos. Nunca toca em outro grupo (recusa o slug `demo` se ele já for de outro grupo).
- **Desligar:** apague `DEMO_GROUP`/`DEMO_PASSWORD` (ou `DEMO_GROUP=false`) e faça Deploy. **Isso NÃO apaga os dados do demo** — o grupo e as contas continuam existindo; para tirá-lo do ar desative o grupo no admin (Grupos → desativar).
- **Local:** `npm run seed:demo` em `backend/` (sem `DEMO_PASSWORD` e fora de produção usa a senha padrão de desenvolvimento `Demo@Capoeira2026!`).

## 6. Problemas conhecidos

- **`TLS handshake timeout` / timeout em `ghcr.io` ou `github.com`:** neste servidor o GitHub está bloqueado; as imagens vêm do Docker Hub. Se o compose ainda tiver `ghcr.io/...`, atualize para `docker-compose.easypanel.yml`.
- **`unauthorized` / `denied` no Docker Hub:** repositório privado sem login no host — torne público (passo 1.4).
- **`manifest unknown` / `not found`:** o Actions ainda não publicou, ou `DOCKERHUB_USERNAME` no Easypanel não é o mesmo do secret.
- **Actions falhando em `Pull base images`:** os registros anônimos limitam pulls por IP; o passo tenta o espelho da AWS e o Docker Hub com nova tentativa por alguns minutos. Se esgotar, rode o workflow de novo.
- **`/api/...` dá 404 ("Cannot GET /api/...") ou `/api/health` responde `{"status":"ok","timestamp":...}` sem `"database":"up"`:** o front está falando com o backend de OUTRO projeto do mesmo Easypanel. Os serviços com domínio entram também numa rede compartilhada, e nomes genéricos (`backend`, `postgres`) existem em vários projetos: o DNS devolvia o container errado. Por isso o compose usa os aliases únicos `gingapp-api` e `gingapp-db` (e o nginx dos fronts aponta para `gingapp-api`). Cole de novo o YAML atualizado no Easypanel e faça Deploy. O `backend` não precisa de domínio: se houver um `api.` mapeado, pode remover.
- **`/api/...` dá 502 num front:** o backend não está de pé (veja o log dele).
- **Backend reiniciando em loop:** leia o log dele; causas comuns: senha do super admin fraca, `EMAIL` sem `PASSWORD`, ou `POSTGRES_PASSWORD` diferente da gravada no volume.

## 7. Backup e restore do banco

**O que roda:** o serviço `backup` do compose (imagem `postgres:16-alpine`, a mesma do banco; alias `gingapp-backup`) executa `pg_dump -Fc` contra `gingapp-db` assim que sobe e depois a cada `BACKUP_INTERVAL_HOURS` (padrão 24 h), gravando `gingapp-AAAAMMDDTHHMMSSZ.dump` no volume `gingapp_backups` (no contêiner: `/backups`). O dump é gravado como `.tmp` e só vira `.dump` se terminar bem e não estiver vazio; **só depois de um dump novo bem-sucedido** os `.dump` com mais de `BACKUP_KEEP_DAYS` dias são apagados (um dump que falha nunca remove os anteriores).

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `BACKUP_ENABLED` | `true` | `false` deixa o serviço parado (sem dump, sem erro) |
| `BACKUP_KEEP_DAYS` | `14` | retenção em dias (valor inválido volta a 14) |
| `BACKUP_INTERVAL_HOURS` | `24` | intervalo entre dumps |

**Imagens enviadas:** junto de cada dump o serviço grava `gingapp-uploads-AAAAMMDDTHHMMSSZ.tgz` (tar.gz do volume `gingapp_uploads`, montado só leitura em `/uploads`), com a mesma retenção. Para restaurar as imagens: `docker cp <backup>:/backups/gingapp-uploads-....tgz .` e extraia dentro do volume (`docker run --rm -v <projeto>_gingapp_uploads:/u -v "$PWD":/b alpine tar xzf /b/gingapp-uploads-....tgz -C /u`). O `restore.sh` cuida só do banco.

**Limites (leia):** o volume `gingapp_backups` fica **no mesmo servidor** do banco. Ele protege de erro de aplicação/migration e de apagão lógico, **não** de perda do servidor. Copie `/backups` para fora periodicamente (destino é decisão do dono: S3/R2/Backblaze, outro servidor, `rclone`…), ex.: `docker cp <container-backup>:/backups ./backups-$(date +%F)`. Acompanhe `docker logs <container-backup>`: cada rodada loga `[backup] ok: ...` ou `[backup] FALHOU ...`. Não há alerta automático de falha.

**Restaurar passo a passo** (testar a restauração periodicamente — um backup que nunca foi restaurado não é prova de nada):

1. Escolha o dump: `docker exec <container-backup> ls -lh /backups` (use o mais recente bom).
2. **Verificar sem tocar no banco real** (recomendado, rode sempre antes do passo 4 e como teste periódico):
   ```sh
   docker cp ops/backup/restore.sh <container-backup>:/tmp/restore.sh
   docker exec <container-backup> sh /tmp/restore.sh verify /backups/gingapp-AAAAMMDDTHHMMSSZ.dump
   ```
   O script confere o formato do dump (`pg_restore --list`), restaura num banco descartável `gingapp_restore_check` (o container já traz `PGHOST/PGUSER/PGPASSWORD`), conta `User`, `Organization`, `Student`, `_prisma_migrations` e as tabelas do schema, e remove o banco descartável (`--keep` mantém). Saída `[restore] OK` e código 0 = dump íntegro e restaurável. Códigos: 2 dump corrompido, 3 falha no restore, 4 conferência falhou.
3. **Dump de segurança do estado atual** antes de sobrescrever: `docker exec <container-backup> pg_dump -Fc -f /backups/antes-do-restore.dump` (o prefixo diferente impede que a retenção o apague).
4. **Restaurar de verdade:** pare o `backend` (Easypanel → serviço `backend` → Stop; os fronts podem continuar), e rode:
   ```sh
   docker exec <container-backup> sh /tmp/restore.sh replace /backups/gingapp-AAAAMMDDTHHMMSSZ.dump --yes
   ```
   (`pg_restore --clean --if-exists` no banco `gingapp`.) Inicie o `backend` de novo: ele aplica as migrations que faltarem em relação ao dump. Confira `/api/health` (`"database":"up"`) e entre no painel.
5. Desastre total (servidor/volume perdido): suba o compose com o mesmo `POSTGRES_PASSWORD`, deixe o `backend` criar o schema, pare-o, copie o `.dump` guardado fora do servidor para dentro do container `backup` (`docker cp`) e faça o passo 4.

> **Não verificado neste ambiente:** o serviço `backup` e o `restore.sh` foram validados só por leitura — `docker compose config` (YAML, alias, volume, variáveis) e `sh -n` no script (sintaxe). O Docker deste ambiente não consegue baixar imagens, então **não houve execução de `pg_dump`/`pg_restore`**. Faça o passo 2 uma vez em staging/produção logo no primeiro deploy e registre o resultado.

## 8. Privacidade (LGPD): termos, exportação e pedidos de exclusão

- **Textos legais:** versionados em `backend/src/shared/legal/` (`terms-of-use.ts`, `privacy-policy.ts`, `legal-documents.ts`) e servidos publicamente em `GET /api/legal/terms` e `/api/legal/privacy`; os 3 frontends renderizam o mesmo conteúdo (páginas `/termos` e `/privacidade` no app e no painel). **São um MODELO** ("MODELO — revisar com assessoria jurídica"): preencha os campos entre colchetes (razão social, CNPJ, encarregado/DPO, contato, comarca, localização da hospedagem) e revise com um advogado antes de divulgar. Ao mudar qualquer texto, **troque `LEGAL_VERSION`**: todos os usuários passam a ver o aceite pendente.
- **Aceite:** `POST /api/auth/accept-terms {version}` grava `User.acceptedTermsVersion/At` e uma linha em `AuditLog` (ação `ACCEPT_TERMS`, versão, IP) como evidência. O login devolve `termsAcceptanceRequired`. **Decisão:** por padrão o **servidor não bloqueia** quem não aceitou — a tela de aceite é bloqueante só nos frontends — para não quebrar seed, grupo demo e testes. Para o servidor também barrar (403 `TERMS_NOT_ACCEPTED`), defina `TERMS_ENFORCEMENT=true` no backend.
- **Direitos do titular:** `GET /api/auth/me/export` devolve um JSON com os dados do próprio usuário (e dos dependentes de quem é responsável). `POST /api/auth/me/delete-request` apenas **registra** o pedido em `DataDeletionRequest` (status `PENDING`); **nada é apagado automaticamente**.
- **Tratar um pedido de exclusão (manual):** no admin, tela **Pedidos LGPD** (`GET /api/data-deletion-requests`, filtros por status, grupo e período; qualquer usuário da equipe consulta, só **super admin** altera). O ciclo é `PENDING` -> `IN_PROGRESS` -> `DONE` ou `REJECTED` (`PATCH /api/data-deletion-requests/:id {status, note}`; **rejeitar exige a justificativa em `note`**; cada mudança grava `DATA_DELETION_REQUEST_UPDATE` na auditoria). **Marcar `DONE` NÃO apaga nem anonimiza nada: só registra a data e a nota** — a execução é manual. Roteiro: (1) abra o pedido no admin e mude para `IN_PROGRESS`; (2) avalie com o Mestre do grupo (histórico de frequência/financeiro pode ter de ser mantido; nesse caso anonimize nome/e-mail/telefone/documento em vez de apagar); (3) execute no banco (ex.: `UPDATE "User" SET name='Anonimizado', email='anon-<id>@removido.invalid', phone=NULL, photo=NULL, status='INACTIVE', "tokenValidAfter"=now() WHERE id=...;` e os campos equivalentes de `Student`), com backup recente; (4) volte ao admin e marque `DONE` com a nota do que foi feito (ou `REJECTED` com o motivo); (5) responda ao titular no prazo legal. Consulta direta, se precisar: `SELECT d.id, d."requestedAt", d.status, u.email, d."organizationId", d.reason FROM "DataDeletionRequest" d JOIN "User" u ON u.id = d."userId" WHERE d.status IN ('PENDING','IN_PROGRESS') ORDER BY d."requestedAt";`. Enquanto há pedido em aberto (`PENDING` ou `IN_PROGRESS`) o titular não consegue abrir outro.

## 9. Jobs agendados

O backend roda, todo dia às **03:00 (America/Sao_Paulo)**, `FinanceOverdueService.markOverdueAndNotify()` para todas as organizações (mensalidade `PENDING` vencida vira `OVERDUE` e o aluno/responsável é notificado; idempotente). Desligue com `OVERDUE_CRON=false`. Os testes e2e rodam com ele desligado. Com mais de uma réplica do backend o job roda em cada uma (seguro por ser idempotente, só redundante).

## 10. O que este repositório não cobre

Cópia dos backups para fora do servidor e alertas de falha do backup (seção 7), monitoramento/alertas, logs centralizados (o log por requisição existe, seção 15, mas não há coletor) e rotação de segredos. Os testes (lint, unitários, e2e) ficam em `.github/workflows/tests.yml`, em pull request ou manualmente, e não bloqueiam o deploy.

## 11. Imagens enviadas (fotos, logo, capas)

- **Onde ficam:** em disco, no volume Docker `gingapp_uploads` montado em `/app/uploads` do serviço `backend` (variável `UPLOADS_DIR`, padrão local `./uploads`). **Sem S3/R2 nem conta externa.** O volume sobrevive a redeploy; apagar o volume apaga as imagens (os campos no banco passam a apontar para arquivos que não existem mais, e a tela mostra a imagem quebrada).
- **Como funciona:** `POST /api/uploads` (multipart, campo `file`, autenticado) aceita **JPEG/PNG/WebP até 5 MB**, confere os *magic bytes* (não confia em mimetype/extensão), corrige a rotação, remove EXIF/GPS, reduz a no máximo 1600 px no maior lado e grava como WebP com nome aleatório (uuid). Devolve `{ url: "/api/uploads/<uuid>.webp" }`, que o painel/app gravam em `Student.photo`, `Organization.logo`, `Event.imageUrl`, `Roda.imageUrl` e na foto/capa do perfil. `GET /api/uploads/<arquivo>` é público (o nome é imprevisível), com cache de 1 ano, `nosniff` e sem listagem de diretório. Como as imagens passam por `/api` do próprio domínio, o nginx dos fronts (`client_max_body_size 10m`) já cobre.
- **Limites:** 20 envios/min por usuário e por IP (`UPLOAD_THROTTLE_LIMIT`); cota de **1024 MB por grupo** (`UPLOAD_ORG_QUOTA_MB`, 0 = sem limite). Cada envio vira uma linha na tabela `Upload` (grupo, usuário, tamanho).
- **Pendência conhecida:** imagens substituídas/removidas na tela **não** são apagadas do disco (ficam órfãs e contam na cota). Limpeza: listar `Upload` cujo `filename` não aparece em nenhuma coluna de imagem e apagar linha + arquivo (ainda não automatizado).
- **Backup:** ver a seção 7 (`gingapp-uploads-*.tgz`).

## 12. E-mail transacional (opcional): "Esqueci minha senha", convite e certificado em PDF

- **Desligado por padrão.** Sem `SMTP_HOST` (e um remetente) nada muda: `GET /api/auth/capabilities` devolve `{ "passwordResetByEmail": false }`, os 3 frontends **não mostram** "Esqueci minha senha", `POST /api/auth/forgot-password` responde **503** claro e o convite por e-mail é recusado (400). Quem esquecer a senha continua dependendo do Mestre (Professores/Alunos > Redefinir senha) ou do super admin.
- **Variáveis do backend** (ficam no Environment do Compose; ver `.env.easypanel.example`): `SMTP_HOST`, `SMTP_PORT` (padrão 587/STARTTLS; 465 quando `SMTP_SECURE=true`), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (ex.: `GingApp <nao-responder@seudominio.com.br>`; se vazio usa `SMTP_USER` quando for um e-mail) e `SMTP_SECURE`. Além delas, `APP_URL`, `PAINEL_URL` e `ADMIN_URL` (padrão: os domínios `*.gingapp.com.br`) montam o link do e-mail conforme o tipo de usuário (aluno/responsável -> app; mestre/professor -> painel; equipe -> admin) e o QR do certificado PDF (`APP_URL/verificar/<código>`).
- **Como funciona:** `POST /api/auth/forgot-password {email, organizationSlug?}` responde sempre **202** com a mesma mensagem (não revela se o e-mail existe; o envio roda em segundo plano). Gera um token aleatório de 256 bits, grava só o **SHA-256** (`PasswordResetToken`), expira em **1 h**, vale **uma vez** e cada pedido novo invalida os anteriores. `POST /api/auth/reset-password {token, newPassword}` aplica a política de senha (12+ caracteres), consome o token, **revoga todas as sessões** e zera a troca obrigatória. Aluno inativo e grupo inativo não recebem link. Limites: 5/min por IP e 3 a cada 10 min por e-mail no pedido; 10/min por IP no consumo (`FORGOT_THROTTLE_LIMIT`, `FORGOT_EMAIL_THROTTLE_LIMIT`, `RESET_THROTTLE_LIMIT`).
- **Convite:** ao criar o acesso de aluno/responsável com `sendInvite: true` (checkbox "Enviar convite por e-mail" no painel, só aparece com o e-mail ligado) a pessoa recebe um link de 72 h para definir a própria senha, em vez da senha provisória (fluxo padrão, que continua igual). A resposta traz `inviteSent` (false se o e-mail falhou; o acesso já foi criado e o Mestre pode usar "Esqueci minha senha" ou definir senha provisória).
- **Privacidade:** o conteúdo dos e-mails, os endereços e os links **nunca são logados** (só o nome do modelo e o código técnico do erro, ex.: `ECONNREFUSED`); falha de envio não vaza detalhe ao cliente. Atenção: a conta da equipe GingApp (admin) também pode ser recuperada por e-mail — proteja a caixa do super admin.
- **Certificado em PDF:** `GET /api/certificates/:id/pdf` (autenticado; Mestre/Professor do grupo, ou o próprio aluno/responsável) e `GET /api/public/certificates/:código/pdf` (público, mesmos dados da verificação pública) geram um A4 paisagem com grupo, aluno, título, graduação (só na rota autenticada), data, código e QR. Não depende de SMTP.

## 13. Web Push VAPID (opcional, fallback): avisos no celular

> Desde a seção 13b o transporte **principal** é o **FCM** (Firebase). Esta seção descreve o Web Push VAPID, que continua valendo como **fallback**: ele só é oferecido ao app quando o FCM **não** está configurado (`GET /api/push/config` → `provider: "webpush"`). Os dois podem ficar ligados ao mesmo tempo; o FCM tem prioridade e as inscrições antigas (VAPID) continuam recebendo.

- **Desligado por padrão.** Sem `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (as três, válidas) nada muda: `GET /api/push/config` devolve `{ "enabled": false, "provider": null, "publicKey": null, "firebase": null }`, o app **não mostra** "Ativar avisos no celular" e `POST /api/push/subscribe` responde **503**. As notificações continuam aparecendo no sino do app.
- **Gerar as chaves (uma vez):** `npx web-push generate-vapid-keys`. Copie a *Public Key* para `VAPID_PUBLIC_KEY` e a *Private Key* para `VAPID_PRIVATE_KEY` no Environment do Compose (ver `.env.easypanel.example`); `VAPID_SUBJECT` é um contato, ex.: `mailto:contato@seudominio.com.br`. **Não troque as chaves depois**: isso invalida todas as inscrições já feitas (cada aparelho teria de reativar). A chave privada é segredo: nunca commite nem logue.
- **Como funciona:** o aluno/responsável abre Notificações no app e toca em "Ativar avisos no celular"; o navegador pede permissão e a inscrição (`PushSubscription`, única por `endpoint`) é gravada ligada ao usuário (até 10 aparelhos por usuário). Toda notificação gravada pelo `NotificationsService` (aula cancelada/alterada, mensalidade vencida, evento/roda novo, graduação, comunicados) dispara o push **em segundo plano** (falha de push nunca derruba a ação principal). Inscrições recusadas pelo serviço de push com **404/410** são removidas sozinhas.
- **Preferências por usuário:** `GET/PUT /api/push/preferences` (aulas, financeiro, eventos/rodas, graduações, comunicados). Desligar uma categoria só desliga o **push**; a notificação continua no sino.
- **Privacidade:** o push leva só `{title, body, url, tag}` (corpo cortado em 140 caracteres). Mensalidade vencida **não** mostra descrição nem valor na tela de bloqueio ("Há uma pendência financeira..."). Endpoint e chaves do aparelho nunca são logados; só são aceitos endpoints `https` de host público (sem IP/localhost).
- **iPhone/iPad:** o iOS só entrega push para o app **instalado na tela inicial** (Safari > Compartilhar > Adicionar à Tela de Início, iOS 16.4+); o app mostra essa dica.
- **Service worker:** o `sw.js` (workbox, precache do shell) importa `sw-push.js` (handler de `push` e `notificationclick`); as respostas da API continuam fora de qualquer cache.
- **Teste:** o app tem o botão "Enviar aviso de teste" (`POST /api/push/test`, ver 13b), que também vale para o Web Push.

## 14. Mapa da comunidade (Google Maps) e geocodificação (opcional)## 13b. Firebase Cloud Messaging (FCM, opcional): avisos com o app aberto e fechado

O **FCM** é o transporte principal dos avisos push. Diferente de só "notificar em segundo plano", com o app **aberto** o navegador recebe a mensagem na hora (`onMessage`): o app mostra um aviso na tela (toast), atualiza o sino e, se o usuário permitiu, também uma notificação do navegador; com o app **fechado ou em segundo plano** quem mostra é o service worker `firebase-messaging-sw.js`. O Web Push VAPID (seção 13) segue como **fallback** quando o FCM não está configurado.

**Regra de ligação.** O FCM só liga quando as **duas metades** estão válidas: (1) a conta de serviço (o backend envia) e (2) a config do app Web (o navegador se inscreve). Faltando qualquer campo, `GET /api/push/config` devolve `provider: "webpush"` (se houver VAPID) ou `{ "enabled": false, "provider": null, "publicKey": null, "firebase": null }` e o app esconde o botão. **Nada disso vai no build do app** (não existe `VITE_FIREBASE_*`): o app lê a config em tempo de execução em `GET /api/push/config` (rota autenticada) — por isso basta trocar as variáveis do backend e reiniciar.

### Passo a passo no console Firebase (https://console.firebase.google.com)

1. **Criar o projeto:** *Adicionar projeto* → nome (ex.: `gingapp`) → o Google Analytics pode ficar desligado → *Criar projeto*. O **ID do projeto** aparece em *Configurações do projeto* (ex.: `gingapp-ab123`).
2. **Adicionar um app Web:** na página inicial do projeto, ícone **`</>`** (Web) → apelido `GingApp` → **não** marque o Firebase Hosting → *Registrar app*. Na tela seguinte (ou depois em *Configurações do projeto → Geral → Seus apps → Configuração do SDK*, opção **Config**) copie o objeto `firebaseConfig` e preencha:

   | Campo do `firebaseConfig` | Variável do backend |
   | --- | --- |
   | `apiKey` | `FIREBASE_WEB_API_KEY` |
   | `authDomain` | `FIREBASE_WEB_AUTH_DOMAIN` (opcional; vazio = `<projectId>.firebaseapp.com`) |
   | `projectId` | `FIREBASE_PROJECT_ID` |
   | `storageBucket` | `FIREBASE_WEB_STORAGE_BUCKET` (opcional) |
   | `messagingSenderId` | `FIREBASE_WEB_MESSAGING_SENDER_ID` |
   | `appId` | `FIREBASE_WEB_APP_ID` |

3. **Gerar o par de chaves Web Push:** *Configurações do projeto → **Cloud Messaging** → **Configuração da Web** (Web configuration) → Certificados push da Web (Web Push certificates) → **Gerar par de chaves***. Copie a **chave pública** (começa com `B`, ~87 caracteres) para `FIREBASE_WEB_VAPID_KEY`. (Não confunda com o `VAPID_*` da seção 13: é outro par, gerenciado pelo Firebase.)
4. **Gerar a chave da conta de serviço (envio):** *Configurações do projeto → **Contas de serviço** → **Gerar nova chave privada*** → baixa um `.json`. Dele saem:

   | Campo do `.json` | Variável do backend |
   | --- | --- |
   | `project_id` | `FIREBASE_PROJECT_ID` (o mesmo do passo 2) |
   | `client_email` | `FIREBASE_CLIENT_EMAIL` |
   | `private_key` | `FIREBASE_PRIVATE_KEY` — cole **inteiro**, de `-----BEGIN PRIVATE KEY-----` a `-----END PRIVATE KEY-----`, numa linha só com os `\n` escapados como está no `.json` (com ou sem aspas) ou com quebras de linha reais |

   **Alternativa:** em vez dos três campos acima, defina só `FIREBASE_SERVICE_ACCOUNT_JSON` = o `.json` **inteiro em base64** (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("chave.json"))`). Se as duas formas existirem, as variáveis soltas têm precedência campo a campo.
5. **API habilitada:** a conta de serviço usa a *Firebase Cloud Messaging API (V1)*, que vem ligada em projetos novos. Se o envio falhar com `messaging/third-party-auth-error` ou "API not enabled", ative-a em *Google Cloud Console → APIs e serviços → Firebase Cloud Messaging API*.
6. **Easypanel:** preencha as variáveis no Environment do Compose (ver `.env.easypanel.example`; `docker-compose.easypanel.yml` repassa todas com padrão vazio) e faça **Deploy**. A chave privada é **segredo**: nunca commite nem logue (o backend não loga credenciais nem tokens).
7. **Conferir:** logado no app, `GET /api/push/config` deve mostrar `"provider": "fcm"` e o bloco `firebase`; em *Notificações* toque em **Ativar avisos**, aceite a permissão e use **Enviar aviso de teste** (`POST /api/push/test`).

### Como funciona
- **Inscrição:** o app (SDK `firebase`, carregado sob demanda em um chunk separado e **só** se a config trouxer `provider: "fcm"`) registra `/firebase-messaging-sw.js` (escopo próprio `/firebase-cloud-messaging-push-scope`, sem conflito com o `sw.js` do PWA), pede permissão, obtém o *registration token* e faz `POST /api/push/subscribe` com `{ "provider": "fcm", "token": "...", "platform": "web" }`. O token é **único** no sistema (aparelho compartilhado: o último usuário logado fica com ele), no máximo **10 aparelhos por usuário** (os mais antigos saem). O app renova o token a cada abertura.
- **Envio:** cada notificação gravada (`NotificationsService`) vira push em segundo plano, via `sendEachForMulticast` (até 500 tokens por chamada; avisos iguais viram um único multicast), prioridade alta, TTL de 24 h e link para a tela do app. O payload é mínimo — `data` `{title, body, url, tag}` + `notification` `{title, body}`; mensalidade continua genérica (sem descrição nem valor). Respeita as preferências por categoria da seção 13.
- **Limpeza:** token recusado pelo FCM (`messaging/registration-token-not-registered`, `messaging/invalid-registration-token`, `messaging/invalid-argument`) é apagado sozinho; erro transitório ou falha geral do serviço **não** apaga nada.
- **Desativar:** o botão apaga o token no servidor (`DELETE /api/push/subscribe` com `{ "token": "..." }`) e chama `deleteToken` no SDK.
- **Aviso de teste:** `POST /api/push/test` (autenticado, 3 por minuto por usuário) envia um aviso genérico só aos aparelhos do **próprio** usuário e devolve `{ "sent": n, "devices": m }`; responde 503 se nenhum transporte estiver ligado.
- **iPhone/iPad:** o iOS só entrega push ao app **instalado na tela inicial** (iOS 16.4+); o app mostra a dica.
- **Service workers:** o PWA continua com o `sw.js` (workbox: precache do shell + `sw-push.js` do VAPID). O `firebase-messaging-sw.js` é separado, importa o SDK compat do `www.gstatic.com` (versão fixa) e recebe a config pela URL de registro (`?apiKey=...`), porque um service worker não enxerga a config de runtime. As respostas da API continuam fora de qualquer cache.

### Não validado automaticamente
A suíte usa um remetente FCM falso (nunca fala com o Firebase) e o app é testado com o SDK simulado. O envio real, a entrega em segundo plano, o `onMessage` em primeiro plano e o iOS **só podem ser confirmados** com um projeto Firebase real e um aparelho: faça o passo 7 após o primeiro deploy.


- **Desligado por padrão.** Sem `GOOGLE_MAPS_API_KEY`, `GET /api/map/config` devolve `{ "enabled": false, "apiKey": null, "mapId": null }` e o app (`/comunidade`) mostra a lista no lugar do mapa. `GET /api/map/places` (unidades, treinos, eventos e rodas com posição) funciona mesmo sem chave: só o desenho do mapa depende do Google.
- **Variáveis do backend** (Environment do Compose; ver `.env.easypanel.example`): `GOOGLE_MAPS_API_KEY` (chave de **navegador**, entregue ao app em `/api/map/config` — é pública por natureza, por isso precisa de restrição por referrer), `GOOGLE_MAPS_SERVER_KEY` (chave de **servidor**, só para geocodificar endereços; **nunca** sai do backend nem é logada) e `GOOGLE_MAPS_MAP_ID` (opcional, mapa estilizado). Se só `GOOGLE_MAPS_API_KEY` existir, a geocodificação tenta usá-la como reserva, mas uma chave restrita por referrer **não funciona no servidor** (o Google responde `REQUEST_DENIED` e nada é geocodificado): crie a chave de servidor separada.
- **Criar as chaves no Google Cloud** (console.cloud.google.com):
  1. Crie (ou escolha) um projeto e **ative o faturamento** (a Maps Platform dá crédito mensal gratuito; sem faturamento a API não responde).
  2. Em *APIs e serviços > Biblioteca*, ative **Maps JavaScript API** e **Geocoding API**.
  3. *APIs e serviços > Credenciais > Criar credenciais > Chave de API* — faça **duas** chaves:
     - **Navegador** (`GOOGLE_MAPS_API_KEY`): *Restrições de aplicativo* = **Sites (referenciadores HTTP)** com `https://app.gingapp.com.br/*` (acrescente `http://localhost:*` só se for testar localmente); *Restrições de API* = **Maps JavaScript API**.
     - **Servidor** (`GOOGLE_MAPS_SERVER_KEY`): *Restrições de aplicativo* = **Endereços IP** com o IP de saída do servidor do Easypanel (se o IP mudar, a geocodificação para de funcionar; sem IP fixo use apenas a restrição de API); *Restrições de API* = **Geocoding API**.
  4. (Opcional) *Maps > Gerenciamento de mapas > Criar ID do mapa* (tipo JavaScript, Vetor) e copie para `GOOGLE_MAPS_MAP_ID`.
  5. Defina um **orçamento/alerta** e uma **cota diária** das duas APIs em *APIs e serviços > Cotas* para limitar custo.
  6. Cole as variáveis no Environment do Compose e faça o redeploy do `backend`.
- **Como os pontos entram no mapa:** unidade, evento e roda têm `latitude`/`longitude` opcionais (painel: formulários + botão "Localizar pelo endereço" + link "Ver no Google Maps"). Se o usuário **não** informar as coordenadas e o texto do local mudou (endereço/cidade/UF da unidade; local/cidade/estado do evento ou roda), o backend tenta geocodificar com a chave de servidor — sem chave não faz nada e não dá erro (o item só não aparece no mapa até alguém informar o ponto). Evento sem ponto próprio usa o da sua unidade. `POST /api/map/geocode {query}` (MESTRE/PROFESSOR, 30/min por usuário) alimenta o botão do painel.
- **Visibilidade:** o Mestre liga/desliga "Aparecer no mapa da comunidade" em Configurações (`Organization.mapVisible`, padrão ligado). Grupo desligado ou inativo some do mapa por inteiro (unidades, treinos, eventos e rodas). Eventos só aparecem se públicos (ou do próprio grupo do usuário); rascunho/cancelado nunca. Nenhum dado de aluno, responsável, professor, e-mail ou telefone é devolvido.
- **Privacidade da chave:** a chave de servidor e a URL de geocodificação (que carrega a chave) nunca são logadas — só mensagens genéricas de falha.

## 15. Auditoria, imagens órfãs, 2FA e logs de requisição

- **Retenção da auditoria:** todo domingo às 04:00 (America/Sao_Paulo) o backend apaga linhas de `AuditLog` com mais de `AUDIT_RETENTION_DAYS` dias (padrão **365**; `0` = nunca apagar; `AUDIT_RETENTION_CRON=false` desliga o job). Cada limpeza deixa uma linha `AUDIT_PURGE` (quantas, até que data).
- **Imagens órfãs:** todo domingo às 05:00 o backend remove de `UPLOADS_DIR` (e da tabela `Upload`, devolvendo a cota do grupo) as imagens que **nenhum campo do banco cita** (a lista de colunas vem do schema do Prisma: `Student.photo/coverPhoto`, `Organization.logo`, `Event/Roda.imageUrl`, etc., e campos futuros entram sozinhos) **e** que têm mais de 24 h. `UPLOADS_GC=false` desliga; `UPLOADS_GC=dry-run` só escreve no log o que apagaria (use na primeira vez). O backup diário das imagens (`.tgz`) continua valendo para desfazer um engano.
- **2FA (TOTP, opcional por usuário):** qualquer usuário (app, painel e admin) ativa pela tela da conta; recomendado para a equipe da plataforma e para o MESTRE. Os segredos ficam **cifrados** (AES-256-GCM) com chave derivada de `TWO_FACTOR_KEY` (ou, se vazia, do `JWT_SECRET`). **Defina `TWO_FACTOR_KEY` em produção e guarde-a**: perdê-la (ou girar o `JWT_SECRET` sem ela) deixa os segredos ilegíveis e esses usuários não conseguem concluir o login (resposta 503 "indisponível"). Quem perde o aplicativo usa um dos 8 códigos de recuperação; sem eles um administrador redefine o 2FA: `POST /api/auth/2fa/reset/:userId` (botão **Redefinir 2FA** no admin — detalhe do grupo e Equipe — e no painel — Professores e Acesso do aluno). Quem pode: super admin ativo (qualquer usuário) ou o **Mestre** (só usuários do próprio grupo, exceto outro Mestre e contas que também pertencem a outro grupo); nunca no próprio usuário (este usa "Desativar"). Zera segredo, flag, códigos de recuperação e encerra as sessões do alvo; fica na auditoria (`TWO_FACTOR_RESET`). Codigos errados: 5 em 15 min bloqueiam o usuário (429) e ficam na auditoria (`TWO_FACTOR_FAILURE`).
- **Logs de requisição:** `REQUEST_LOG=true` escreve **uma linha JSON por requisição** no stdout (`ts, level, msg:"http_request", requestId, method, route, status, ms, userId, ip`). A rota é o **padrão** (`/api/students/:id`), nunca a URL real; não há corpo, querystring nem cabeçalhos. O `X-Request-Id` (aceita o do proxy se for curto/inofensivo) sai em **toda** resposta, ligado o log ou não, e é exposto ao navegador via CORS. `/api/health` não é logado. Para ver: `docker logs` do serviço `backend` (ou o log do Easypanel) e filtre por `"msg":"http_request"`.

## 16. Check-in por QR (eventos e aulas)

- **Como funciona:** a equipe abre a tela de QR no painel (rota `/checkin/evento/:id` ou `/checkin/aula/:id`, pelos botões "QR de check-in" de Eventos e "QR de presença" da Frequência); o aluno (ou o responsável, por um dependente) lê o QR no app ou digita o código curto (`E12-K7QXM3PA2B`) e o servidor confirma a presença. O link do QR é `APP_URL/checkin?token=...`.
- **O token NÃO gira:** ele é determinístico (HMAC-SHA256 de tipo + id + grupo, com subchave derivada do `JWT_SECRET`), sem tabela e sem expiração própria. A única "validade" é a **janela do próprio evento/aula** — evento: de 2 h antes até 6 h depois do início; aula: de 2 h antes do início até 2 h depois do fim (sem horário, o dia inteiro); fora dela o servidor recusa mesmo com o código correto. Cada evento/aula tem o **seu** código (o id entra no HMAC), então o QR de hoje não serve para a aula de amanhã. O risco real é quem fotografa o QR e o repassa **dentro da janela**: ainda assim só confirma presença quem já está inscrito no evento / matriculado na turma, e em nome do próprio titular (ou dependente).
- **Boa prática:** **exiba o QR na tela** (a rota `/checkin/...` do painel, projetada ou no celular da equipe, só durante o evento/aula) **e não o imprima de forma permanente** (cartaz fixo, camiseta, folder): um QR impresso fica circulando e, como o código só muda quando o id muda, continua válido durante toda a janela de qualquer pessoa que o tenha. Se um código vazar durante a janela, **cancele o evento** (o servidor recusa evento cancelado) ou oriente a equipe a fazer a chamada manual; girar o `JWT_SECRET` invalida TODOS os tokens e as sessões, então não é um remédio pontual.
- **Decisão (rotação):** não foi implementada rotação (ex.: "epoch" de 5 min no token) porque quebraria o QR impresso/projetado antes de o aluno chegar e não existe hoje nenhum mecanismo de "renovar código"; adicionar um exigiria um campo/tabela de segredo por evento/aula (migração) e a tela correspondente. Fica como evolução opcional: um `checkinNonce` por evento/aula, incluído no HMAC e regenerado por um botão "Renovar código" no painel.


## 17. Ginga Rank (ranking de alunos e grupos)

- **Pontos** (derivados de presença, evento, roda, graduação e certificado; **mensalidade/financeiro nunca entra**): aula presente **10** (1 por aula, no máximo **3 por dia**); bônus de sequência **+5 por semana consecutiva** com ao menos 1 aula (2ª semana +5, 3ª +10 ... teto **+25**), 1 por semana; evento com presença (`ATTENDED`) **30**; roda já realizada **25**; consistência mensal **+50** (mês encerrado com frequência ≥ 80% e ≥ 4 aulas com chamada); graduação **100 × ordem da corda** (mínimo 1); certificado **20**. Só vale presença marcada pela equipe ou check-in dentro da janela (o aluno não consegue se inscrever como `ATTENDED`).
- **Ligas** (pontos de todos os tempos): Crua 0, Verde 300, Amarela 900, Azul 2000, Roxa 4000, Marrom 7500, Preta 12000. Conquistas: `SEQ_4W`, `FIRST_GRADUATION`, `RODA_10`, `EVENT_5`, `PERFECT_MONTH`, `CENTURION`. Conquista nova e subida de liga geram **uma** notificação cada (vira push FCM); nada é reavisado.
- **Temporada** mensal (`YYYY-MM`, fuso America/Sao_Paulo). Todo dia **02:30** o backend recalcula todos os alunos e no dia **1 às 03:00** fecha o mês anterior: grava o top 10 (`SeasonResult`) por grupo, do Brasil (só opt-in) e dos grupos, e avisa o campeão do grupo e o do Brasil (uma vez; refazer o fechamento não repete). **`RANKING_CRON=false`** desliga os dois jobs (os testes rodam assim). O recálculo também roda na hora, em segundo plano, ao marcar presença, fazer check-in, graduar, emitir/remover certificado e confirmar roda (rodas futuras só entram no recálculo noturno).
- **Backfill** (histórico existente): `npm run ranking:backfill` (idempotente, sem notificar, fecha as temporadas passadas). No boot do Docker (`server`) roda depois do bootstrap e do demo: **`RANKING_BACKFILL`** vazio = só se a tabela de pontos estiver vazia (1 vez); `true` = a cada boot; `false` = nunca. Falha no backfill não impede a API de subir.
- **Privacidade:** no ranking do **próprio grupo** aparecem todos os alunos ativos (menores também) com nome curto ("Maria S.") e avatar. Nos rankings **abertos** (cidade/estado/Brasil) só quem fez opt-in (`PUT /api/ranking/me/settings`), e **menor de idade só com o consentimento do responsável**: é o **mesmo** consentimento do Passaporte (`StudentGuardian.consentPublicProfile`, `PATCH /api/passport/guardian-consent`) — revogar lá tira o menor do ranking aberto na hora. O apelido (2–20 caracteres, filtro de palavrões) substitui o nome. Grupo `INACTIVE` nunca aparece. Ranking de **grupos**: média de pontos por aluno ativo; entra só grupo ativo, com ≥ 3 alunos ativos e **`mapVisible = true`** ("Aparecer no mapa da comunidade" vale também como "aparecer em rankings abertos"). Mudanças de configuração ficam na auditoria (`RANKING_SETTINGS`, sem o texto do apelido).

## 18. Aulas contínuas (geração rolante, sem data final)

- **Como funciona:** turma **ativa**, com dia da semana (`weekday`) e `autoGenerateLessons = true` mantém sozinha as aulas geradas de **hoje até hoje + `LESSONS_HORIZON_DAYS`** dias (padrão **60**, aceita 1 a 365). O Mestre não precisa mais informar data final: `POST /classes/:id/generate-lessons` sem `to` (ou com `continuous: true`) liga o modo contínuo e gera até o horizonte; com `from` + `to` continua valendo o período manual de no máximo 90 dias.
- **Job diário:** todo dia **01:30** (America/Sao_Paulo) o backend percorre todas as turmas elegíveis de todos os grupos ativos e completa o horizonte. Também roda na hora, em segundo plano, ao **criar** a turma e ao **editar** dia, horário, status ou `autoGenerateLessons`. É idempotente (rodar de novo não duplica), nunca recria uma aula **cancelada**, nunca apaga nada e **não notifica** ninguém (aula gerada é silenciosa).
- **Turmas já existentes:** a migration cria `Class.autoGenerateLessons` com padrão **true**. Na primeira execução do job (ou ao editar a turma), toda turma ativa que já tem dia da semana passa a receber aulas até o horizonte. Quem não quiser isso desliga por turma (`PATCH /classes/:id` com `autoGenerateLessons: false`) — as aulas já geradas continuam existindo. Turma **inativa** ou com o modo desligado não gera; as aulas futuras já geradas de uma turma desativada **não** são apagadas (cancele-as pela tela de aulas se necessário). Mudar o **dia ou o horário** de uma turma não reescreve as aulas futuras já geradas (só as novas saem com o dia/horário novo).
- **Variáveis:** `LESSONS_HORIZON_DAYS` (padrão 60) e `LESSONS_CRON=false` (desliga só o job agendado; os testes rodam assim). Estão no `docker-compose.easypanel.yml` com esses padrões.
- **Fotos:** turma, unidade e o perfil do professor/mestre (`User.photo`, vale em todos os grupos) têm foto opcional (`/api/uploads/...` ou URL http(s)); a turma e a unidade aparecem com foto no mapa da comunidade.

## 19. Ficha única do capoeirista (Fase 1)

- **O que é:** cada pessoa tem **uma** ficha no GingApp inteiro (tabela `Person`, ligada ao CPF e a um **código GingApp** `GING-XXXX-XXXX`); o cadastro de aluno de cada grupo (`Student`) vira a **matrícula** dessa pessoa no grupo (`Student.personId`). Desenho completo, fases e rollback em [`docs/FICHA_UNICA.md`](FICHA_UNICA.md).
- **Cadastro sem duplicar:** `POST /api/students` com CPF (ou CPF do responsável + nascimento, ou código GingApp) que já tem ficha devolve **409** (`PERSON_ALREADY_IN_GROUP` / `PERSON_EXISTS_ELSEWHERE` com um preview mínimo) e nada é criado; nome + nascimento parecidos em outro grupo = **409 `POSSIBLE_DUPLICATE`** (o painel oferece "Cadastrar mesmo assim", que fica na auditoria). A transferência entre grupos chega na Fase 2.
- **Backfill** (matrículas que já existiam): `npm run person:backfill` (idempotente). No boot do Docker (`server`) roda depois do demo e antes do ranking: **`PERSON_BACKFILL`** vazio = só quando há matrícula sem ficha; `true` = a cada boot; `false` = nunca. Junta matrículas pelo **mesmo login** ou **mesmo CPF válido**; **nunca** por nome (os candidatos aparecem em `GET /api/people/duplicates` e o super admin mescla com `POST /api/people/merge`). Falha no backfill não impede a API de subir (a API cria a ficha sob demanda).
- **Chaves — defina ANTES do primeiro boot e NÃO TROQUE:** `PERSON_DOC_KEY` (cifra o CPF guardado na ficha, AES-256-GCM) e `PERSON_DOC_PEPPER` (segredo do hash HMAC usado para achar a ficha pelo CPF). Vazias = derivam do `JWT_SECRET` — e então **o `JWT_SECRET` também não pode mais ser trocado**. Trocar o pepper faz todo CPF deixar de achar a ficha existente (o próximo cadastro vira duplicata); trocar a chave torna os CPFs cifrados ilegíveis. Guarde as duas junto do backup do banco.
- **Privacidade:** o CPF nunca sai inteiro pela API (só `***.***.***-XX`); o preview do 409 traz só nome, apelido, foto, grupos atuais e corda atual. Consultas que acham alguém ficam na auditoria (`PERSON_LOOKUP_MATCH`, `PERSON_DUPLICATE_CONFIRMED`, `PERSON_MERGE`, `PERSON_LINK_CONFLICT`).

## 20. Transferência entre grupos (ficha única, Fase 2)

- **Fluxo:** o cadastro de quem já tem ficha em outro grupo devolve 409 com `transferAvailable: true`; o **Mestre** do grupo novo pede (`POST /api/transfers`, tela Transferências do painel); a **pessoa** (ou o **responsável**, se menor) aprova ou recusa no app (Perfil → Pedidos de transferência). O grupo antigo é avisado e pode **contestar** pendências (financeira/material/outro) até `TRANSFER_CONTEST_DAYS` dias após o pedido — informativo, **não bloqueia**. Aprovado: matrícula nova ativa no grupo novo (mesma ficha; o login ganha o grupo), a antiga vira **Ex-aluno** (`leftReason TRANSFER`; o login daquele grupo deixa de entrar como aluno) e o grupo novo passa a ver, só leitura, frequência por turma, graduações e certificados das matrículas anteriores (**nunca financeiro**).
- **Job diário 04:15** (America/Sao_Paulo): expira pedidos sem resposta após `TRANSFER_EXPIRY_DAYS` (padrão 14) e encerra (COMPLETED) as aprovações cuja contestação fechou. `TRANSFER_CRON=false` desliga (os testes rodam assim). Auditoria: `TRANSFER_REQUEST/APPROVE/DECLINE/CONTEST/CANCEL/EXPIRE`.
- **CPF legado (Fase 2):** a partir desta fase o CPF da matrícula sai **mascarado** em todas as respostas de `/api/students*` (a exportação CSV mantém o CPF completo só para o Mestre, para a reimportação).

## 21. Cargos acumuláveis (ficha única, Fase 3)

- **Todo mundo é aluno:** mestre, professor, instrutor e monitor têm ficha, matrícula, graduação, frequência e ranking (opt-in) como qualquer aluno. **Cargos** (`MESTRE > PROFESSOR > INSTRUTOR > MONITOR`) se acumulam por pessoa e grupo; o **maior** cargo ativo é o papel de acesso (matriz de permissões). O papel é relido do banco a cada requisição: conceder/revogar vale na hora.
- **Permissões novas:** INSTRUTOR = professor que nunca exclui, sem financeiro, sem graduar/emitir certificado; MONITOR = leitura de alunos/turmas/aulas + chamada; sem financeiro, equipe, dashboard e certificados. As linhas novas da matriz entram pelo `bootstrap` (só as ausentes).
- **Migração sem regressão:** a migration `20261013010000_staff_roles` transforma cada MESTRE/PROFESSOR ativo em cargo equivalente (o acesso não muda). No boot, `prisma/roles-backfill.ts --auto` cria a **matrícula de aluno** da equipe que ainda não tem (`isStaff`: não conta no limite de alunos do plano e não gera mensalidade). **`ROLES_BACKFILL`** vazio = só quando há equipe sem matrícula; `true` = sempre; `false` = nunca. Manual: `npm run roles:backfill`.
- **Promoção:** o sistema de graduação do grupo define a corda mínima de cada cargo (`PUT /api/graduations/systems/:id/role-rules`); quando um aluno a atinge, o Mestre recebe **um** aviso e vê a sugestão (`GET /api/roles/suggestions`); confirma com `POST /api/roles/grant` (revoga com `/api/roles/revoke`, a matrícula de aluno continua). Auditoria: `ROLE_GRANT`, `ROLE_REVOKE`, `GRADUATION_ROLE_RULES_SET`.
