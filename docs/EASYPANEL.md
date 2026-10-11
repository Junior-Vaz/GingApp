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
- **Tratar um pedido de exclusão (manual):** liste os pendentes — `SELECT d.id, d."requestedAt", u.email, d."organizationId", d.reason FROM "DataDeletionRequest" d JOIN "User" u ON u.id = d."userId" WHERE d.status = 'PENDING' ORDER BY d."requestedAt";`. Avalie com o Mestre do grupo (histórico de frequência/financeiro pode ter de ser mantido; nesse caso anonimize nome/e-mail/telefone/documento em vez de apagar), execute, e marque `UPDATE "DataDeletionRequest" SET status='RESOLVED', "resolvedAt"=now(), "resolutionNote"='...' WHERE id=...;` (ou `REJECTED`, sempre com a justificativa). Responda ao titular no prazo legal. **Pendência:** não há tela no admin para isso.

## 9. Jobs agendados

O backend roda, todo dia às **03:00 (America/Sao_Paulo)**, `FinanceOverdueService.markOverdueAndNotify()` para todas as organizações (mensalidade `PENDING` vencida vira `OVERDUE` e o aluno/responsável é notificado; idempotente). Desligue com `OVERDUE_CRON=false`. Os testes e2e rodam com ele desligado. Com mais de uma réplica do backend o job roda em cada uma (seguro por ser idempotente, só redundante).

## 10. O que este repositório não cobre

Cópia dos backups para fora do servidor e alertas de falha do backup (seção 7), monitoramento/alertas, 2FA, logs centralizados e rotação de segredos. Os testes (lint, unitários, e2e) ficam em `.github/workflows/tests.yml`, em pull request ou manualmente, e não bloqueiam o deploy.
