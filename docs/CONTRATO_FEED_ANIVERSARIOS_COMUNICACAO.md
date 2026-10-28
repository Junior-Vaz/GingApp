# Contrato técnico: Aniversariantes, Comunicar e Feed do grupo

Complementa `docs/PLANO_FEED_ANIVERSARIOS_COMUNICACAO.md`. É a **fonte única** que backend, painel e app seguem em paralelo.
Rotas sob o prefixo global `/api`. Datas ISO 8601. Erros no corpo padrão do projeto com `code` estável.
Se algo aqui estiver errado ou ambíguo, o agente **reporta a divergência com o nome exato** (não muda em silêncio).

## 0. Decisões (recomendações do plano, adotadas pelo dono: "faça tudo")

1. Feed: `postingMode` ∈ `ALL | STAFF_ONLY | MODERATED`. **Padrão MODERATED** (post de aluno/responsável/monitor fica `PENDING_APPROVAL`
   até um moderador aprovar; post de equipe [MESTRE/PROFESSOR/INSTRUTOR] publica direto). Com `ALL` publica direto, exceto menores.
2. **Menor de 18 anos** (idade pela `birthDate` da Pessoa autora): o post vai SEMPRE para `PENDING_APPROVAL`, em qualquer modo.
   (Autorização de imagem por campo fica para uma fase seguinte; a aprovação do professor é o controle nesta fase.)
3. Moderação pós-publicação por denúncia + fila no painel. 4. Vídeo: **fora** (só fotos). 5. Parabéns automáticos: **opcional**, desligado por padrão.
6. Aniversário: alunos veem só **dia e mês** de **adultos** que não deram opt-out; **idade só para a equipe**; **menores só para a equipe**.
7. WhatsApp: apenas atalho `https://wa.me/55<digitos>?text=<texto>`. 8. Reações: `AXE`, `SALVE`, `GINGA`, `PARABENS`, `CORACAO`.

## 1. Papéis e permissões

- "Membro" = qualquer usuário autenticado do grupo (ALUNO, RESPONSAVEL, MONITOR, PROFESSOR, INSTRUTOR, MESTRE). PLATFORM não usa o feed.
- "Equipe" = MESTRE, PROFESSOR, INSTRUTOR (e MONITOR conta como membro, não como moderador).
- Moderadores do feed: MESTRE (tudo do grupo); PROFESSOR/INSTRUTOR (posts de visibilidade UNIT/CLASS dentro do **escopo de unidade**
  deles e posts GROUP só para ver/denunciar, não para esconder). Use o escopo de unidade existente (`shared/access/unit-scope.ts`).
- Aniversariantes (painel): leitura = quem já lê alunos; enviar parabéns = mesma permissão do aviso rápido (`announcements:create`);
  configuração = só MESTRE.
- Comunicar: criar = `announcements:create`; alcance `GROUP | UNIT | ROLE | BIRTHDAY_MONTH` só MESTRE; `CLASS` também PROFESSOR/INSTRUTOR
  nas **próprias turmas**. Histórico: MESTRE vê tudo; os demais só os seus.

## 2. Aniversariantes (backend `birthdays`)

Fonte: `Person.birthDate` (aluno, responsável e equipe com ficha). Timezone `America/Sao_Paulo`. 29/02 em ano não bissexto = 28/02.
Quem tem matrícula/cargo ativo em vários grupos aparece em cada grupo.

- `GET /birthdays?month=1..12&unitId&classId` (painel) → `{items:[{personId,studentId|null,userId|null,name,nickname|null,photo|null,day,month,age|null,turnsAge|null,isMinor,kind:'STUDENT'|'STAFF'|'GUARDIAN',unitId|null,unitName|null,classNames:string[],phone|null,greetedThisYear:boolean}],month,total}` ordenado por dia, nome. `age`/`turnsAge` = idade que a pessoa FAZ no aniversário deste ano.
- `GET /birthdays/summary` (painel) → `{today:[item],next7Days:[item],monthTotal,todayTotal}` (mesmo `item`).
- `POST /birthdays/:personId/greet` `{message?:string(<=500)}` (equipe) → `{sent:boolean,alreadyGreeted:boolean,whatsappUrl:string|null}`. Notifica o aniversariante (se tem usuário) com `type:'BIRTHDAY_GREETING'`; registra `BirthdayGreeting` único por pessoa+ano+origem. `whatsappUrl` só se há telefone. 409 `ALREADY_GREETED` se já houve no ano pelo mesmo canal manual (aceitar `force:true` para reenviar? NÃO: devolve `alreadyGreeted:true` e não reenvia).
- `GET /birthdays/week` (membro, app) → `{items:[{personId,name,nickname|null,photo|null,day,month,isToday,canCongratulate:boolean,congratulatedByMe:boolean}]}` próximos 7 dias incluindo hoje. **Filtra**: menores fora; quem optou por `birthdayVisible=false` fora; o próprio usuário aparece (com `canCongratulate:false`).
- `POST /birthdays/:personId/congratulate` (membro) → `{sent:true}`; 409 `ALREADY_CONGRATULATED` (1 por pessoa por pessoa-aniversariante por ano); 403 se o alvo é menor/opt-out/não visível; notifica `type:'BIRTHDAY_CONGRATS'` ("Fulano te desejou parabéns"), sem mostrar idade.
- `GET /birthdays/settings` e `PUT /birthdays/settings` (MESTRE) → `{dailyDigest:boolean(default true),autoGreeting:boolean(default false),autoGreetingMessage:string,autoGreetingHour:number(0..23,default 8)}`.
- Preferência: `GET /people/me/ficha` e `PATCH /people/me` ganham `birthdayVisible:boolean` (default true).
- Jobs (`BIRTHDAY_CRON`, padrão ligado): 07:30 SP resumo diário aos gestores (`BIRTHDAY_DIGEST`, só se houver aniversariantes; para MESTRE e quem tem `announcements:create` no escopo) e envio horário dos parabéns automáticos no horário do grupo (uma vez por pessoa+ano, mensagem padrão "Parabéns, {nome}! 🎉 A família {grupo} deseja um ótimo dia." substituindo `{nome}` pelo apelido ou primeiro nome e `{grupo}`).
- Auditoria: `BIRTHDAY_GREET`, `BIRTHDAY_SETTINGS_UPDATE`. Nenhum dado de nascimento completo em log/auditoria.

## 3. Comunicar (backend `communications`, sobre `Announcement` + `Notification` existentes)

Não quebrar `/announcements` e o aviso rápido existentes.

- `GET /communications/preview?scope=GROUP|UNIT|CLASS|ROLE|BIRTHDAY_MONTH&unitId&classId&role` → `{count:number,sample:[{name}] (até 5)}`.
- `POST /communications` `{title(2..80),body(2..2000),imageUrl?,scope:{type,unitId?,classId?,role?},scheduledAt?:ISO(futuro, até 90 dias),requiresAck?:'NONE'|'READ'|'GOING' (padrão NONE),pinToFeed?:boolean,pinnedUntil?:ISO,confirmCount:number}` → 201 `{id,status:'SENT'|'SCHEDULED',recipients:number}`. Para alcance com mais de 50 destinatários, `confirmCount` precisa igualar a contagem atual, senão 409 `RECIPIENTS_CHANGED` com `{count}`. Cotas: `COMM_DAILY_LIMIT_ORG` (padrão 30) e `COMM_DAILY_LIMIT_AUTHOR` (padrão 15) por dia civil SP → 429 `COMM_QUOTA_EXCEEDED`. `ROLE`: `ALUNO|RESPONSAVEL|EQUIPE`. `BIRTHDAY_MONTH`: aniversariantes do mês corrente (adultos visíveis + equipe).
- `GET /communications?status&page...` → lista paginada no padrão do projeto (array + `X-Total-Count`) `{id,title,status:'SENT'|'SCHEDULED'|'CANCELLED',scopeType,scheduledAt|null,sentAt|null,recipientsCount,readCount,ackCount,requiresAck,pinToFeed,createdAt,createdByName}`.
- `GET /communications/:id` → lista + `{body,imageUrl,scope,acks:{READ:n,GOING:n,NOT_GOING:n},pending:n}`. `POST /communications/:id/resend-unread` (reenvia só a quem não leu; máx 1 por 24h → 429 `RESEND_TOO_SOON`). `DELETE /communications/:id` cancela se `SCHEDULED` (409 `ALREADY_SENT` se enviado).
- App (membro): `POST /communications/:id/ack` `{response:'READ'|'GOING'|'NOT_GOING'}` → `{ok:true,response}` (uma por usuário; pode trocar GOING↔NOT_GOING). `GET /communications/pinned` → `{items:[{id,title,body,imageUrl,requiresAck,myAck:'READ'|'GOING'|'NOT_GOING'|null,pinnedUntil|null,createdAt}]}` (os fixados vigentes para mim). A notificação do app traz `data.communicationId`.
- Job de agendados: a cada minuto (`COMM_SCHEDULER`, padrão ligado) envia os `SCHEDULED` vencidos (idempotente, uma vez).
- Auditoria: `COMMUNICATION_CREATE|SEND|CANCEL|RESEND`. Sem texto da mensagem na auditoria.

## 4. Feed (backend `feed`)

Tipos de post: `POST` (de membro), `ANNOUNCEMENT` (comunicado fixado, só leitura vem de `/communications/pinned`; o feed NÃO duplica).
Visibilidade: `GROUP | UNIT (unitId) | CLASS (classId)`. Status: `PUBLISHED | PENDING_APPROVAL | HIDDEN | REMOVED`.

**Objeto `FeedPost`:** `{id,type:'POST',author:{userId,name,nickname|null,photo|null,roleLabel|null}|null,body|null,media:[{id,url,thumbUrl,width,height}],visibility,unitId|null,classId|null,pinned,status,createdAt,edited,reactions:{counts:{AXE:n,SALVE:n,GINGA:n,PARABENS:n,CORACAO:n},total,mine:'AXE'|...|null},commentsCount,canEdit,canDelete,canModerate}` (`author:null` quando o autor foi anonimizado). `url`/`thumbUrl` = caminho `/api/feed/media/<id>?e=<expiraEpoch>&s=<assinatura>` assinado (HMAC com segredo do servidor, validade 6 h, preso ao grupo); `GET /feed/media/:id` valida a assinatura (sem Authorization, porque `<img>` não envia cabeçalho), `Cache-Control: private, max-age=3600`, `X-Content-Type-Options: nosniff`.

- `GET /feed/settings` (membro) → `{enabled,postingMode,canPost,allowComments,requiresApproval:boolean /*para MIM*/}`; `PUT /feed/settings` (MESTRE) `{enabled?,postingMode?,allowComments?,blockedWords?:string[<=50 itens de <=40 chars]}`; `GET /feed/settings/admin` (MESTRE) inclui `blockedWords`.
- `GET /feed?cursor&limit(<=30,padrão 15)` → `{items:[FeedPost],nextCursor:string|null}` ordenado por `pinned desc, createdAt desc`; só `PUBLISHED` (e os `PENDING_APPROVAL` do próprio autor com `status` visível); respeita visibilidade (GROUP todos; UNIT quem pertence à unidade ou equipe do grupo com escopo; CLASS alunos da turma [matrícula ativa], seus responsáveis e a equipe da turma).
- `POST /feed/media` (multipart `file`, membro) → `{mediaId,url,thumbUrl,width,height}`: só JPEG/PNG/WEBP (magic bytes), ≤5 MB, regravada com sharp (sem EXIF/GPS, lado maior ≤1600 px, miniatura 480 px), limites de pixels/memória; **armazenamento privado** (não em `/uploads` público); pendente até o post (expira em 24 h e é limpo). 413 `FILE_TOO_LARGE`, 415 `FILE_TYPE_NOT_ALLOWED`, 429.
- `POST /feed/posts` `{body?(<=2000),mediaIds?:number[](<=6),visibility,unitId?,classId?}` (exige body ou mídia) → 201 `FeedPost` (status `PUBLISHED` ou `PENDING_APPROVAL`). Erros: 403 `FEED_DISABLED`/`POSTING_NOT_ALLOWED`; 429 `POST_LIMIT` (10/dia por usuário). Texto com palavra bloqueada → vai para `PENDING_APPROVAL` (sem avisar o motivo ao autor além de "aguardando aprovação").
- `PATCH /feed/posts/:id` `{body}` (autor; marca `edited`) ; `DELETE /feed/posts/:id` (autor ou moderador) → 204.
- `PUT /feed/posts/:id/reaction` `{type:'AXE'|'SALVE'|'GINGA'|'PARABENS'|'CORACAO'|null}` (null remove) → `{counts,total,mine}`.
- `GET /feed/posts/:id/comments?cursor&limit(<=30)` → `{items:[{id,parentId|null,author,body,createdAt,canDelete}],nextCursor}`; `POST /feed/posts/:id/comments` `{body(<=500),parentId?}` (um nível de resposta; 403 `COMMENTS_DISABLED`; 429 `COMMENT_LIMIT` 60/dia) → comentário; `DELETE /feed/comments/:id` (autor ou moderador).
- `POST /feed/posts/:id/report` e `POST /feed/comments/:id/report` `{reason:'OFENSIVO'|'IMPROPRIO'|'SPAM'|'MENOR'|'OUTRO',note?(<=300)}` → `{ok:true}` (uma por usuário por alvo; 3 denúncias distintas ocultam automaticamente o post até um moderador decidir).
- Moderação (painel): `GET /feed/moderation/queue?kind=PENDING|REPORTED|HIDDEN&cursor&limit` → `{items:[{post:FeedPost,reports:[{reason,note|null,createdAt}],reportsCount}],nextCursor}`; `POST /feed/posts/:id/approve|hide|restore|pin|unpin` → `FeedPost`; `POST /feed/moderation/reports/:postId/resolve` `{action:'DISMISS'|'HIDE'|'REMOVE'}`; comentários denunciados aparecem na fila com `comment`.
- Notificações: reação/comentário no post do autor → UMA notificação agrupada por post por janela de 30 min (`type:'FEED_ACTIVITY'`, "Fulano e mais N reagiram"), `data.postId`; aprovação do post → `FEED_APPROVED`; rejeição/ocultação pelo moderador → `FEED_HIDDEN` (sem culpar). Nada de notificação por cada reação.
- Retenção/LGPD: `AnonymizationService` (pedido de exclusão) apaga mídia e texto dos posts/comentários do titular (`author:null`, `body:null`). Auditoria `FEED_POST_CREATE|DELETE|APPROVE|HIDE|RESTORE|PIN|REPORT|SETTINGS` sem conteúdo.

## 5. Variáveis de ambiente (todas opcionais, com padrão)

`BIRTHDAY_CRON` (true), `COMM_SCHEDULER` (true), `COMM_DAILY_LIMIT_ORG` (30), `COMM_DAILY_LIMIT_AUTHOR` (15), `FEED_MEDIA_DIR` (padrão: diretório privado
existente `PRIVATE_UPLOADS_DIR`/feed), `FEED_MEDIA_URL_TTL_HOURS` (6), `FEED_POSTS_PER_DAY` (10), `FEED_COMMENTS_PER_DAY` (60). Documentar em `backend/.env.example`,
`.env.easypanel.example`, `docker-compose.easypanel.yml` e `docs/EASYPANEL.md` (seção nova).

## 6. Telas

**Painel:** `Aniversariantes` (`/aniversariantes`: navegação por mês, filtros, "Enviar parabéns", WhatsApp, configurações do grupo) + cartão "Aniversariantes" no
painel inicial; `Comunicar` (`/comunicar`: compositor com alcance e prévia de contagem, agendamento, confirmação, imagem, fixar no feed; aba Histórico com alcance/lidos/confirmados/reenviar/cancelar);
`Feed` (`/feed-moderacao`: abas Pendentes, Denunciados, Ocultos; aprovar/ocultar/remover/fixar/restaurar; cartão de Configurações do feed [ativo, modo de postagem, comentários, palavras bloqueadas]).
**App:** rota `/feed` ("Grupo"): compositor (texto + até 6 fotos + visibilidade), cartões de post (galeria, reações temáticas, comentários em folha, menu ⋯ com apagar/denunciar), estados
"aguardando aprovação", vazio, carregando, paginação infinita + puxar para recarregar, faixa no topo com **aniversariantes da semana** (`/birthdays/week`, botão "Parabenizar") e **comunicados fixados** (`/communications/pinned`, com botões
"Li"/"Vou"/"Não vou"); preferência "Mostrar meu aniversário ao grupo" na edição do perfil; confirmação (`ack`) também na tela de notificações quando `data.communicationId` existir.

## 7. Regras de processo para todos os agentes

- PowerShell (Git Bash quebrado). **Editar arquivos só com Edit/Write em caminhos absolutos**; nunca `Get-Content/Set-Content/WriteAllText` em código (corrompe acentos).
- **NÃO** fazer `git commit/push/stash`. Não reverter nada. Reler cada arquivo antes de editar. Edições pontuais em arquivos compartilhados
  (`schema.prisma`, `audit-actions.ts`, `app.module.ts`, `package.json`, `lib/nav.ts`, `PLANO_PROJETO.md`).
- Testes simples e rápidos; sem suítes completas. Backend: `npm run test:quick <nome>` (npm 11 engole `-- flag`). Front: `npx vitest run <arquivos>` + `npx tsc --noEmit` + eslint dos arquivos tocados.
- **Vários agentes trabalham ao mesmo tempo.** Backend: NÃO apague `dist/` nem rode `npm run build` completo (o gate final faz o build limpo); para checar tipos use `npx tsc --noEmit -p tsconfig.build.json`. NÃO rode `prisma generate/migrate` (o schema é do agente de schema; se precisar de mudança no schema, peça no relatório). Não suba servidores nas portas 3100/5193; se precisar, use portas livres e **pare tudo ao terminar**.
- Nada de credenciais reais. Limpe os dados de teste que criar (banco e disco) e confirme.
- `routeTree.gen.ts` (painel e app) é gerado pelo plugin do TanStack: regenerar só **no fim** do seu trabalho, e só se criou rotas; o agente de integração faz a regeneração final.
- Cada agente acrescenta ao FINAL do `PLANO_PROJETO.md` uma subseção nova (próximo 10.xx, **releia o arquivo no momento de gravar**; outros agentes escrevem lá) com decisões, o que deu certo/errado e pendências numeradas.
- Relatório final honesto: arquivos, números reais de teste, divergências do contrato (nome exato) e o que NÃO foi validado (navegador, celular, backend real).

## 8. Schema (nomes finais)

Migration `20261030000000_feed_birthdays_communications` aplicada; Prisma Client gerado. Nomes EXATOS (modelos PascalCase, campos camelCase, sem `@@map`). O contrato acima fica intacto; os ajustes estão no fim desta seção.

**Enums:** `CommunicationStatus` (SENT, SCHEDULED, CANCELLED) · `CommunicationScope` (GROUP, UNIT, CLASS, ROLE, BIRTHDAY_MONTH) · `AckRequirement` (NONE, READ, GOING) · `AckResponse` (READ, GOING, NOT_GOING) · `BirthdayGreetingSource` (MANUAL, AUTO) · `FeedPostingMode` (ALL, STAFF_ONLY, MODERATED) · `FeedVisibility` (GROUP, UNIT, CLASS) · `FeedPostStatus` (PUBLISHED, PENDING_APPROVAL, HIDDEN, REMOVED) · `FeedCommentStatus` (PUBLISHED, HIDDEN, REMOVED) · `FeedReactionType` (AXE, SALVE, GINGA, PARABENS, CORACAO) · `FeedReportReason` (OFENSIVO, IMPROPRIO, SPAM, MENOR, OUTRO) · `FeedReportStatus` (OPEN, DISMISSED, ACTIONED).

**Colunas novas em modelos existentes**
- `Person.birthdayVisible Boolean @default(true)`.
- `Organization`: `birthdayDailyDigest Boolean @default(true)`, `birthdayAutoGreeting Boolean @default(false)`, `birthdayGreetingMessage String?` (nulo = mensagem padrão), `birthdayGreetingHour Int @default(8)` (CHECK 0..23), `feedEnabled Boolean @default(false)` (desligado por padrão desde a migration `20261031000000_feed_default_off`; o Mestre liga), `feedPostingMode FeedPostingMode @default(MODERATED)`, `feedAllowComments Boolean @default(true)`, `feedBlockedWords String[] @default([])`.
- `Announcement`: `status CommunicationStatus @default(SENT)`, `scopeType CommunicationScope?`, `scopeRole String?` (ALUNO|RESPONSAVEL|EQUIPE), `scheduledAt DateTime?`, `requiresAck AckRequirement @default(NONE)`, `pinToFeed Boolean @default(false)`, `pinnedUntil DateTime?`, `imageUrl String?`, `recipientsCount Int @default(0)`, `lastResendAt DateTime?`. Relações novas: `acks AnnouncementAck[]`, `notifications Notification[]`. Índices: `[status, scheduledAt]`, `[organizationId, status, createdAt]`, `[organizationId, pinToFeed, status]`.
- `Notification`: `data Json?`, `announcementId Int?` (FK SetNull; índice `[announcementId, readAt]`). "Lidos" de um comunicado = `count(Notification where announcementId = X and readAt != null)`.

**Modelos novos (campo: tipo)**
- `AnnouncementAck`: id, organizationId, announcementId, userId, `response AckResponse`, createdAt, updatedAt; único `[announcementId, userId]`.
- `BirthdayGreeting`: id, organizationId, personId, `year Int`, `source BirthdayGreetingSource`, `greeterUserId Int?`, createdAt; único `[organizationId, personId, year, source]`.
- `BirthdayCongrats`: id, organizationId, personId (aniversariante), `giverUserId Int`, `year Int`, createdAt; único `[organizationId, personId, giverUserId, year]`.
- `FeedPost`: id, organizationId, `authorUserId Int?`, `authorPersonId Int?`, `body String?`, `visibility FeedVisibility @default(GROUP)`, `unitId Int?`, `classId Int?`, `status FeedPostStatus @default(PUBLISHED)`, `pinned`, `edited`, `hiddenReason String?`, `approvedById Int?`, `approvedAt`, createdAt, updatedAt, `deletedAt`. Relações: `author`, `authorPerson`, `approvedBy`, `unit`, `class`, `media`, `reactions`, `comments`, `reports`, `activityNotices`.
- `FeedPostMedia`: id, organizationId, `postId Int?`, `uploaderUserId Int?`, `storageKey` (único), `thumbKey` (único), `width`, `height`, `sizeBytes`, `mimeType`, `order Int @default(0)`, `pendingExpiresAt DateTime?`, createdAt. Pendente = `postId` nulo.
- `FeedReaction`: id, postId, userId, `type FeedReactionType`, createdAt; único `[postId, userId]` (sem organizationId; vem do post).
- `FeedComment`: id, organizationId, postId, `parentId Int?`, `authorUserId Int?`, `body String?`, `status FeedCommentStatus`, createdAt, `deletedAt`; relações `parent`/`replies`.
- `FeedReport`: id, organizationId, `postId Int?`, `commentId Int?`, `reporterUserId Int?`, `reason FeedReportReason`, `note String?`, `status FeedReportStatus @default(OPEN)`, `resolvedById Int?`, `resolvedAt`, createdAt; únicos `[reporterUserId, postId]` e `[reporterUserId, commentId]`; CHECK: exatamente um de postId/commentId.
- `FeedActivityNotice`: id, postId, `authorUserId Int`, `windowStartedAt`, `count Int @default(1)`, `lastActorUserId Int?`, `notificationId Int?`; único `[postId, authorUserId]` (uma linha por post+autor; ao abrir nova janela de 30 min, atualizar `windowStartedAt`, zerar `count` e criar nova `Notification`).

**Ajustes ao contrato (nada do texto acima foi alterado)**
1. Comunicar reaproveita colunas legadas: autor = `Announcement.createdByUserId` (obrigatório, já existente); envio = `publishedAt` (não há `sentAt`); alcance UNIT/CLASS = `unitId`/`classId` (não há `scopeUnitId`/`scopeClassId`); ROLE = `scopeRole` (texto, pois EQUIPE não existe em `OrgRole`; `audienceRole` segue só para o legado). Agendado: `status = SCHEDULED`, `publishedAt` nulo até o envio; o `/announcements` legado deve filtrar `status = SENT`.
2. `Notification` não tinha payload: foi criado `data Json?` (usar `data.communicationId`, `data.postId`) e `announcementId` (FK) para a contagem de lidos.
3. `FeedReport.reporterUserId`, `FeedPostMedia.uploaderUserId` são anuláveis (SetNull) por causa da LGPD; denúncias com denunciante anonimizado não colidem no único.
4. Cotas diárias (`COMM_DAILY_LIMIT_*`, `FEED_POSTS_PER_DAY`, `FEED_COMMENTS_PER_DAY`) saem por contagem, sem tabela. "Menor de 18" continua calculado pela `Person.birthDate` na hora.
5. Índice funcional de aniversário (só no SQL): `EXTRACT(MONTH FROM "birthDate"), EXTRACT(DAY FROM "birthDate")` (parcial `birthDate IS NOT NULL`). Para usá-lo, a consulta SQL crua deve repetir essas expressões; o Prisma Client não usa. Alternativa sem SQL cru: buscar por `birthDate` não nulo e filtrar mês/dia em memória por grupo (pessoas por grupo são poucas).

**Acréscimo (2026-10-27): stories — nomes finais (migration `20261101000000_feed_stories` aplicada; Prisma Client gerado).** Nada acima foi alterado.
- Enum `FeedPostKind` (`POST`, `STORY`). `FeedPost.kind FeedPostKind @default(POST)`; `FeedPost.expiresAt DateTime?` (só stories; o objeto devolve `null` em POST); índice `[organizationId, kind, status, expiresAt]`; relação nova `FeedPost.storyViews`.
- `FeedStoryView`: `id`, `postId`, `userId`, `createdAt`; único `[postId, userId]`; índice `[userId]`; FK `postId` e `userId` com **cascade** (relação `User.feedStoryViews`, nome `"FeedStoryViewUser"`).
- Código de erro novo `STORY_LIMIT` (429). Auditoria `FEED_STORY_CREATE` (entidade `feed_post`; `meta` só com `visibility`, `unitId`, `classId`, `status`, `expiresAt`).
- Envs: `FEED_STORY_TTL_HOURS` (padrão 24; ausente/inválido = 24; valor numérico limitado a 1..48) e `FEED_STORIES_PER_DAY` (padrão 5; inteiro > 0, senão 5).
- Formato final da seção 9 (idêntico ao descrito lá): `GET /feed/stories` → `{groups:[{author,isMine,hasUnseen,items:[{id,media:{id,url,thumbUrl,width,height},caption,createdAt,expiresAt,seen,status}]}]}`; `POST /feed/stories` → 201 `FeedPost` com `kind:'STORY'`, `expiresAt`, `type:'POST'`; `POST /feed/stories/:id/view` → 204. O objeto `FeedPost` ganha `kind:'POST'|'STORY'` e `expiresAt:string|null` em TODAS as respostas (feed, ações de moderação, fila).
- Decisões de borda (backend): reagir/comentar/listar comentários de **story** → **409 `INVALID_STATE`** (quem não vê o story recebe o 404 de qualquer id); `PATCH /feed/posts/:id` em story → 409 `INVALID_STATE` (story não se edita; `canEdit:false`); `pin` em story → 409 `INVALID_STATE`; denunciar story **vigente** vale (`POST /feed/posts/:id/report`), vencido = 404; aprovar story já vencido → 409 `INVALID_STATE`; a fila `PENDING` omite stories vencidos; a cota diária de **posts** não conta stories (e vice-versa); o autor vê os próprios stories (inclusive pendentes) sempre com `seen:true`, então o grupo dele nunca tem `hasUnseen`; `view` de story do próprio autor → 204 sem gravar; legenda normalizada numa linha só (quebras viram espaço).

## 9. Stories e Feed na Home (acréscimo de 2026-10-27)

Pedido do dono: na Home do app, **stories em cima do banner** (cartões verticais arredondados com a foto e o avatar do autor na base, como Instagram) e uma **prévia do Feed entre o banner e "Minha graduação"**. Reaproveita o feed (mesma moderação, mídia privada, visibilidade, regras de menor, LGPD).

**Stories = `FeedPost` com `kind=STORY`** (foto obrigatória + legenda curta), **expiram em 24 h**, sem reação nem comentário na F1.

*Schema (migration `20261101000000_feed_stories`):* enum `FeedPostKind` (`POST`, `STORY`); `FeedPost.kind FeedPostKind @default(POST)`; `FeedPost.expiresAt DateTime?` (só stories); modelo `FeedStoryView` (`postId`, `userId`, `createdAt`; único `[postId, userId]`; cascade a partir do post); índice `[organizationId, kind, status, expiresAt]`. Padrões de env: `FEED_STORY_TTL_HOURS` (24), `FEED_STORIES_PER_DAY` (5 por usuário/dia civil SP).

*Backend (módulo `feed`, edições pontuais):*
- `GET /feed` e a contagem de posts passam a listar **só `kind=POST`**; os objetos `FeedPost` ganham `kind:'POST'|'STORY'` e `expiresAt:string|null`. A fila de moderação e a anonimização LGPD **incluem stories** (o painel mostra o selo "Story").
- `GET /feed/stories` (membro) → `{groups:[{author:{userId,name,nickname|null,photo|null,roleLabel|null}|null,isMine:boolean,hasUnseen:boolean,items:[{id,media:{id,url,thumbUrl,width,height},caption:string|null,createdAt,expiresAt,seen:boolean,status:'PUBLISHED'|'PENDING_APPROVAL'}]}]}` só stories vigentes (`expiresAt > agora`) e visíveis ao usuário (mesma regra GROUP/UNIT/CLASS do feed; `PENDING_APPROVAL` só para o próprio autor); ordem: **meu grupo primeiro**, depois autores com `hasUnseen` (mais recente primeiro), depois os já vistos; itens de cada autor do mais antigo para o mais novo. Feed desligado → 403 `FEED_DISABLED`.
- `POST /feed/stories` `{mediaId:number,caption?:string(<=140),visibility:'GROUP'|'UNIT'|'CLASS',unitId?,classId?}` → 201 `FeedPost` (`kind:'STORY'`, `expiresAt = agora + FEED_STORY_TTL_HOURS`). Mesmas regras de status/segurança do post (feed ligado; `postingMode` [STAFF_ONLY → 403 `POSTING_NOT_ALLOWED`; MODERATED → membro comum `PENDING_APPROVAL`; ALL → direto]; **menor de 18 sempre `PENDING_APPROVAL`**; palavra bloqueada na legenda → `PENDING_APPROVAL`; mídia só do próprio autor, pendente e não usada [a mesma `POST /feed/media` do feed]; IDOR de unidade/turma como no post). 429 `STORY_LIMIT`.
- `POST /feed/stories/:id/view` → 204 idempotente (só se visível e vigente; grava `FeedStoryView`); o próprio autor não precisa marcar.
- Apagar/ocultar/aprovar/fixar usam as rotas existentes `DELETE /feed/posts/:id` e `/feed/posts/:id/approve|hide|restore` (stories não são fixáveis: `pin` em story → 409 `INVALID_STATE`).
- Limpeza: o cron do feed (`FEED_MEDIA_CLEANUP`) passa a marcar `REMOVED` e apagar mídia de stories vencidos (`expiresAt` + 1 h) e `FeedStoryView` em cascata. Auditoria `FEED_STORY_CREATE` (sem conteúdo).
- Em `GET /feed/stories` as URLs de mídia seguem o mesmo esquema assinado do feed (6 h; foto não aprovada só pelo autor/moderador via `r=1`).

*App (Home, `components/gingapp/home.tsx`):* ordem nova: **(1) linha de stories → (2) banner (`HeroCarousel`) → (3) prévia do Feed → (4) "Minha graduação"** → resto. **(1)** rolagem horizontal; primeiro cartão "Seu story" (+; abre o criador: escolher foto de câmera/galeria, legenda opcional ≤140, visibilidade, publicar; mostra "enviado para aprovação" se pendente); depois um cartão vertical arredondado (~104×148 px) por autor, foto de fundo, degradê na base, **avatar sobreposto na borda inferior** e o nome embaixo; anel de cor para `hasUnseen`; toque abre o visualizador em tela cheia (barras de progresso por item, avança sozinho a cada 5 s, toque direita/esquerda troca, fechar, cabeçalho com avatar/nome/"há X", legenda, e **Apagar** se for meu; chama `/view` ao exibir). **(3)** seção "Grupo" com até **3 posts recentes** (`GET /feed?limit=3`) reaproveitando o `PostCard` (com variante compacta se necessário), botão "Ver tudo" → `/feed`, e estado vazio "Seja o primeiro a postar!" + atalho para o compositor quando `canPost`. Tudo **só aparece com o feed ligado** (`useFeedSettings().data?.enabled`); carregando/erro/desligado = oculto, sem erro visível. O atalho "Grupo" atual da Home é substituído por esta seção.

*Painel:* a fila de moderação mostra o selo "Story" (e a validade) nos itens `kind==='STORY'`.

*Tipos TS/hooks do app:* `useStories()`, `useCreateStory()`, `useMarkStoryViewed()`, `useDeleteStory()` (reusa `useDeletePost`) em `src/lib/feed.ts` (ou `src/lib/stories.ts`).
