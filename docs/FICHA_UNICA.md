# Ficha única do capoeirista — desenho e fases

> Status: **Fase 1** (commit 1f28bec), **Fase 2** (commit 5f4b67a) e **Fase 3 — cargos** (sem commit; seção 5) implementadas.
> Fases 4–5 desenhadas aqui, não implementadas.
> Visão do owner: *o cadastro de um aluno é único, vinculado ao CPF; uma pessoa tem uma única ficha no GingApp; quando ela
> sai de um grupo e vai para outro, o outro grupo recebe a ficha inteira (aulas, faltas, punições, expulsões); nunca se
> duplica; se ao cadastrar a pessoa já existe, faz-se uma TRANSFERÊNCIA. Mestre, professor, monitor e instrutor também são
> alunos, com suas fichas.*

## 1. Decisões já tomadas (owner)

1. **Identidade:** CPF (cifrado + hash para busca) + **código GingApp** legível e único (`GING-XXXX-XXXX`) + busca assistida
   por nome + nascimento. Criança sem CPF: CPF do **responsável** + data de nascimento, ou o código. Ferramenta de **mesclar**.
2. **Transferência:** a pessoa (ou o responsável, se menor) aprova; o grupo antigo é avisado e pode **contestar pendências**
   por alguns dias, sem bloquear a saída; o grupo novo só vê a ficha completa **após a aprovação**.
3. **Ocorrências** (punições/expulsões): registro estruturado (tipo, data, motivo curto), visível só ao **MESTRE** do grupo
   novo após transferência aprovada, nunca a alunos, com direito de contestação.
4. **Cargos:** todo mundo é aluno (ficha + graduação); MONITOR, INSTRUTOR, PROFESSOR, MESTRE acumuláveis; o sistema de
   graduação do grupo define a partir de qual corda cada cargo é possível; o sistema **sugere**, o mestre **confirma**.

## 2. Modelo de dados final (alvo)

```
Person (ficha, global)                    1 ──── N  Student (matrícula no grupo)
  id, gingappCode (unique)                          id, organizationId, personId (FK), unitId, status,
  name, nickname, birthDate, photo, gender          joinedAt, leftAt (F2), cópia de nome/contato (compat.)
  email, phone                                      ├─ ClassStudent, Attendance, StudentGraduation,
  documentHash (unique, HMAC), documentEnc (AES)    │  FinancialRecord, StudentBilling, Certificate,
  documentLast4, documentKind (CPF|GUARDIAN_CPF|    │  PointEvent, RankingProfile, Achievement ...
                PASSPORT)                           └─ (tudo que já existe continua por Student)
  userId (unique, login)
  mergedIntoId / mergedAt (mescla sem apagar)

TransferRequest (F2)   personId, fromStudentId, toOrganizationId, requestedByUserId, status
                       (PENDING_PERSON | APPROVED | REJECTED | CANCELLED | EXPIRED), approvedByUserId,
                       approvedAt, contestUntil, createdStudentId
TransferContest (F2)   transferRequestId, organizationId (antigo), kind (FINANCEIRO|MATERIAL|OUTRO),
                       note (curta), status (OPEN | RESOLVED | WITHDRAWN)
EnrollmentShare (F2)   studentId (antiga) -> organizationId (nova): o que o grupo novo pode ler
PersonRole (F3)        personId, organizationId, role (MONITOR|INSTRUTOR|PROFESSOR|MESTRE), status
                       (SUGGESTED|CONFIRMED|REVOKED), confirmedByUserId, since
GraduationRoleRule(F3) graduationSystemId, role, minLevelOrder
Occurrence (F4)        personId, organizationId (autor), studentId, kind (ADVERTENCIA|SUSPENSAO|EXPULSAO|OUTRA),
                       occurredAt, reason (<= 280), createdByUserId, contestedAt, contestNote, status
LevelEquivalence (F5)  fromLevelId, toLevelId, organizationId (quem declarou), note
```

Princípio: **Person é a fonte da identidade**; o `Student` atual vira a **matrícula** e mantém os campos duplicados
(nome, nascimento, foto, contato, documento) por compatibilidade com tudo que já lê `Student` (painel, app, relatórios,
ranking, passaporte). Nada é reescrito de uma vez.

## 3. Fase 1 — o que foi entregue (identidade + backfill + cadastro sem duplicar + ficha + mescla)

### 3.1 Schema / migration
- Migration `20261012210000_person_ficha_unica` (só ADICIONA): enum `PersonDocumentKind`, tabela `Person`
  (índices únicos `gingappCode`, `documentHash`, `userId`; índices `birthDate`, `mergedIntoId`; FKs `userId → User` e
  `mergedIntoId → Person` com `ON DELETE SET NULL`) e `Student.personId INT NULL` (índice + FK `ON DELETE SET NULL`).
- **`personId` continua NULL-able nesta fase** (decisão): 34 arquivos de teste, o seed e o demo criam `Student` direto pelo
  Prisma; e o rollback fica trivial. A API completa sob demanda (`ensurePersonForStudent`). O `NOT NULL` entra numa
  migration futura (ver §8), depois de `SELECT count(*) FROM "Student" WHERE "personId" IS NULL` = 0 em produção.
- Mescla **sem tabela de alias**: a ficha mesclada fica com `mergedIntoId`; código GingApp e CPF antigos seguem a cadeia.

### 3.2 Código GingApp
`GING-` + 8 caracteres do alfabeto `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (sem 0/O/1/I): 7 aleatórios (`crypto.randomInt`,
~35 bits) + 1 verificador (soma ponderada com pesos ímpares mod 32 — detecta toda troca de um caractere). Entrada aceita
minúsculas, espaços/hífens e sem o prefixo (`src/interface/http/people/gingapp-code.ts`).

### 3.3 CPF (LGPD)
`src/shared/security/person-document.ts` (+ `aes-gcm.ts`, agora SSOT também do 2FA):
- `documentEnc` = AES-256-GCM da forma canônica (`CPF:<11>` ou `GUARDIAN_CPF:<11>:<aaaa-mm-dd>`), subchave HKDF de
  `PERSON_DOC_KEY` (fallback: `JWT_SECRET`).
- `documentHash` = HMAC-SHA256 da forma canônica, subchave HKDF de `PERSON_DOC_PEPPER` (fallback: `JWT_SECRET`). Sem o
  pepper, o banco sozinho não permite forçar os ~10⁹ CPFs válidos.
- `documentLast4` só para a máscara. **Nenhuma API devolve CPF inteiro da Person**: só `documentMasked = ***.***.***-XX`.
- Validação com dígitos verificadores (o mesmo validador do CSV, movido para o shared e reexportado).
- **Limite conhecido:** `Student.document` (legado) continua em claro e continua saindo em `GET /students` para a equipe
  (comportamento anterior, preservado por compatibilidade). Ver §7, risco R3.

### 3.4 Backfill (`npm run person:backfill`; boot do Docker com `PERSON_BACKFILL`)
Para cada `Student` sem `personId` (ordem de id, em transação por aluno, gravação condicional `personId IS NULL`):
1. mesmo `userId` → a Person desse login (ou a de outra matrícula do mesmo login);
2. senão, mesmo CPF **válido** → a Person com esse hash, **exceto** se ela já tem matrícula no MESMO grupo (cadastro
   duplicado dentro do grupo: cria ficha separada sem CPF e conta em `sameGroupDocumentConflicts`);
3. senão cria Person nova (código, nome, nascimento, foto, contato, CPF cifrado se válido e livre).
Nunca junta por nome + nascimento (só conta candidatos). Completa a ficha encontrada sem sobrescrever. Relatório: fichas
criadas, ligadas por login, ligadas por CPF, documentos não-CPF, conflitos, possíveis duplicatas, matrículas restantes.
Boot: vazio = roda se houver matrícula sem ficha; `true` = sempre; `false` = nunca; falha não impede a API.

### 3.5 Cadastro sem duplicar
`POST /students` e `POST /students/import` (por linha) usam `PersonIdentityService.resolveForEnrollment`:
ordem **código GingApp → CPF (ou CPF do responsável + nascimento) → nome + nascimento (só sugestão)**.
- já tem matrícula **neste** grupo → `409 PERSON_ALREADY_IN_GROUP` (no CSV: `IGNORE`);
- tem matrícula em **outro** grupo → `409 PERSON_EXISTS_ELSEWHERE` com preview mínimo, `transferAvailable:false`
  (no CSV: `ERROR`); nada é criado;
- ficha existente **sem** matrícula nenhuma → reaproveita (nunca duplica);
- não existe + nome parecido e mesmo nascimento em **outro** grupo → `409 POSSIBLE_DUPLICATE` (máx. 5); `confirmNew:true`
  cria e audita `PERSON_DUPLICATE_CONFIRMED` (no CSV: `confirmNew` no corpo vale para todas as linhas);
- não existe → cria Person + Student na mesma transação; corrida (P2002) refaz a consulta uma vez.
- Gêmeos pelo CPF do responsável (mesmo responsável + nascimento, nome diferente) → só `POSSIBLE_DUPLICATE`; confirmando,
  a ficha nova nasce **sem** chave de documento (limite documentado).
- Nome + nascimento **no mesmo grupo** não bloqueia (comportamento antigo; a idempotência do CSV já trata).
- **Login** (`POST /students/:id/account`): "mesmo login = mesma pessoa". A ficha ganha o `userId`; se o login já tinha
  outra ficha (pessoa cadastrada sem CPF em outro grupo), as fichas são **mescladas** automaticamente (salvo conflito:
  audita `PERSON_LINK_CONFLICT` e não mexe). Nunca derruba a criação do acesso.
- **PATCH /students/:id** com `document`: só é validado/aplicado se **mudou** (valor legado reenviado igual passa); CPF de
  outra ficha → `409 DOCUMENT_BELONGS_TO_OTHER_PERSON`; trocar o CPF de ficha com matrículas em vários grupos →
  `409 PERSON_DOCUMENT_LOCKED`. Nome/nascimento/foto/contato só vão para a Person quando ela tem **uma** matrícula.
- Consultas que acham alguém ficam na auditoria (`PERSON_LOOKUP_MATCH`, com `via` create/import) — rastro LGPD.

### 3.6 Contrato exato

**POST /api/students** — corpo ganhou (todos opcionais): `document` (CPF, ≤30), `guardianDocument` (CPF do responsável,
exige `birthDate`), `gingappCode`, `confirmNew` (boolean). **201** = linha do Student (agora com `personId`) +
`person: { id, gingappCode }`.

Erros (corpo sempre `{ statusCode, error, code, message, ...extras }`):

| HTTP | code | extras |
| --- | --- | --- |
| 400 | `INVALID_CPF` | `field: 'document' \| 'guardianDocument'` |
| 400 | `BIRTHDATE_REQUIRED_FOR_GUARDIAN_DOCUMENT` | — |
| 400 | `GINGAPP_CODE_NOT_FOUND` | — (também para código malformado) |
| 400 | `IDENTITY_MISMATCH` | — (código e CPF de pessoas diferentes) |
| 409 | `PERSON_ALREADY_IN_GROUP` | `studentId`, `studentStatus` |
| 409 | `PERSON_EXISTS_ELSEWHERE` | `transferAvailable: false`, `person: Preview` |
| 409 | `POSSIBLE_DUPLICATE` | `canConfirmNew: true`, `possibleMatches: Preview[]` (≤5) |

`Preview = { personId, name, nickname, photo, currentGroups: [{ id, name, logoUrl }], currentLevel: { name, style, colors } | null }`
— nada além disso (sem CPF, contato, nascimento ou histórico). `currentGroups` = grupos com matrícula **ATIVA**;
`currentLevel` = graduação mais recente em qualquer grupo.

**PATCH /api/students/:id** — `document` como acima; 400 `INVALID_CPF`, 409 `DOCUMENT_BELONGS_TO_OTHER_PERSON`,
409 `PERSON_DOCUMENT_LOCKED`.

**POST /api/students/import** — linha aceita `guardianDocument` e `gingappCode`; corpo aceita `confirmNew`. Cada item
ganhou `code?` (`PERSON_ALREADY_IN_GROUP` → `IGNORE`; `PERSON_EXISTS_ELSEWHERE`, `POSSIBLE_DUPLICATE`,
`GINGAPP_CODE_NOT_FOUND`, `IDENTITY_MISMATCH` → `ERROR`). Mesma pessoa repetida no arquivo → `IGNORE`.

**GET /api/students/:id/ficha** (`students:view`, escopo de unidade; outro grupo = 404) e
**GET /api/people/me/ficha[?studentId=]** (a própria pessoa; responsável com `studentId` do dependente via `resolveLink`;
sem ficha = 404 `PERSON_NOT_FOUND`):
```
{ person: { id, gingappCode, name, nickname, birthDate, photo, documentMasked, documentKind },
  enrollments: [{ studentId, organization: { id, name, logoUrl }, unit: { id, name } | null, status,
                  since /* joinedAt ?? createdAt */, until /* null nesta fase */, isCurrent }],
  graduations: [{ id, studentId, organization: { id, name }, graduatedAt,
                  level: { id, name, order, color, style, colors }, system: { id, name } }],
  attendanceByGroup: [{ organization: { id, name }, present, absent, total }],
  certificates: [{ id, title, issuedAt, verificationCode, organization: { id, name } }],
  sharedFromOtherGroups: [],            // Fase 2
  scope: 'OWN_GROUP' | 'SELF' }
```
Equipe (`OWN_GROUP`): só as matrículas **do seu grupo**. Própria pessoa/responsável (`SELF`): todas.

**GET /api/people/me/code[?studentId=]** → `{ personId, gingappCode, qrDataUrl }` (PNG data URL do código).

**GET /api/people/duplicates** (super admin ativo da plataforma) →
`{ total, groups: [{ key, birthDate, people: [{ id, gingappCode, name, birthDate, documentKind, documentMasked, hasLogin,
createdAt, enrollments: [{ studentId, status, organization: { id, name } }] }] }] }` (≤100 grupos; fichas com CPFs
próprios diferentes nunca aparecem juntas).

**POST /api/people/merge** `{ keepId, mergeId }` (super admin) → **200** `{ person: { id, gingappCode, name },
mergedPersonId, movedStudents }`. Erros: 400 `SAME_PERSON`; 404 `PERSON_NOT_FOUND`; 409 `PERSON_ALREADY_MERGED`;
409 `PERSON_MERGE_SAME_GROUP` (`organizations: [{ id, name }]`, nada é alterado); 409 `PERSON_MERGE_USER_CONFLICT`.
A mantida herda o que não tem (login, CPF, nascimento, foto, apelido, contato); audita `PERSON_MERGE`.

### 3.7 Frontends (mínimo)
- **Painel/Alunos:** campo "CPF" (máscara + dígitos verificadores; legado não-CPF não bloqueia a edição se não mudou),
  "CPF do responsável" e "Código GingApp" no cadastro, diálogos dos três 409, botão **Ficha** (código com copiar, CPF
  mascarado, matrículas, cordas, presença por grupo, certificados), colunas novas no CSV + "importar mesmo assim".
- **App/Perfil:** cartão "Meu código GingApp" (copiar + QR recolhível); some em 404/erro.
- **Admin (Vue):** ainda **sem** tela de duplicatas/mescla (só API) — pendência.

## 4. Fase 2 — Transferência entre grupos (IMPLEMENTADA, 2026-10-12)

### 4.1 Schema (migration `20261012230000_transfers`, só adiciona)
- `TransferRequest {id, personId, fromOrganizationId, fromStudentId?, toOrganizationId, toUnitId?, toStudentId?,
  requestedByUserId, decidedByUserId?, status (PENDING_PERSON|APPROVED|DECLINED|CANCELLED|EXPIRED|COMPLETED),
  requestedAt, decidedAt?, expiresAt (+TRANSFER_EXPIRY_DAYS, padrão 14), contestUntil (pedido + TRANSFER_CONTEST_DAYS,
  padrão 7), note?, updatedAt}`.
- `TransferContest {id, requestId, organizationId, byUserId, reason (PENDING_PAYMENT|EQUIPMENT|OTHER), note? (≤200), createdAt}`.
- `EnrollmentShare {id, personId, fromStudentId, fromOrganizationId, toOrganizationId, requestId, grantedAt, revokedAt?}`
  (único `fromStudentId+toOrganizationId`). `Student.leftAt`, `Student.leftReason`.
- Semântica: **APPROVED** = aprovado, matrícula nova criada, contestação ainda aberta; **COMPLETED** = contestação encerrada
  (job). Idempotência "1 pedido aberto por pessoa+grupo" por transação com `SELECT ... FOR UPDATE` na Person (sem índice
  parcial, para não criar drift no Prisma).
- **`Student.personId NOT NULL` ADIADO:** seed, demo e ~34 specs criam `Student` direto pelo Prisma sem ficha e não há
  prova da contagem de nulos em produção; o backfill do boot + `ensurePersonForStudent` continuam cobrindo.

### 4.2 Regras
- Pede: só **MESTRE** do grupo novo (`MestreOnlyGuard` + `students:create`). Alvo por `personId`, `gingappCode` ou `document`.
  Já tem matrícula no grupo → 409 `PERSON_ALREADY_IN_GROUP`; nenhuma matrícula em outro grupo → 409
  `PERSON_NOT_ENROLLED_ELSEWHERE`. Origem: a matrícula **ativa** em outro grupo; se houver mais de uma ativa (ou o
  `fromOrganizationId` não conferir) → 400 `FROM_ORGANIZATION_REQUIRED` com a lista; **se nenhuma estiver ativa** (a pessoa já
  saiu do grupo antigo) a origem é a matrícula mais recente — decisão para não travar quem já saiu (sem transferência ela
  nunca mais poderia ser cadastrada, pois o 409 da Fase 1 vale para qualquer matrícula em outro grupo).
- Decide: **adulto = o próprio login** (`Person.userId`); **menor** (nascimento < 18 anos, regra `isMinor` do ranking) = só os
  **responsáveis com login** de qualquer matrícula da pessoa (o menor não decide). Sem direito = 404 (não vaza).
  Adulto sem login não consegue aprovar: o pedido expira (pendência: convite pelo app).
- Contestação: só o MESTRE do grupo **antigo**, enquanto `status ∈ {PENDING_PERSON, APPROVED}` e `agora ≤ contestUntil`;
  informativa (aparece para a pessoa ao decidir e para o grupo novo), **nunca bloqueia**.
- Aprovação (uma transação): matrícula nova `ACTIVE` no grupo novo (mesma Person, `unitId` pedido, `joinedAt` = agora, nome/
  foto/contato da ficha, CPF legado copiado), login ganha vínculo **ALUNO** no grupo novo (e o `Student.userId`), responsáveis
  da matrícula de origem são copiados (com vínculo **RESPONSAVEL**; sem o consentimento público, que é por grupo); matrícula
  de origem vira **FORMER** + `leftAt` + `leftReason='TRANSFER'` e as turmas dela ficam INACTIVE (o vínculo ALUNO do grupo
  antigo passa a ser barrado pela regra existente de aluno inativo); `EnrollmentShare` para **todas** as matrículas
  anteriores da pessoa em outros grupos.
- O grupo novo **não vê nada** do grupo antigo antes da aprovação (a ficha do aluno do grupo antigo dá 404; o pedido só
  mostra nome/foto/código e os nomes dos grupos). Depois, `sharedFromOtherGroups` traz, só leitura: período, motivo de
  saída, graduações, **frequência por turma** e certificados. **Nunca** financeiro, contato, responsáveis ou notas.
- Notificações (`Notification.type`, push cai na categoria "avisos"): `TRANSFER_REQUEST` (pessoa/responsáveis + mestres
  do grupo antigo), `TRANSFER_CONTESTED` (pessoa + mestres do grupo novo), `TRANSFER_APPROVED` (mestres dos dois grupos),
  `TRANSFER_DECLINED` (mestres do grupo novo), `TRANSFER_CANCELLED` (pessoa), `TRANSFER_EXPIRED` (mestres do grupo novo).
  As da pessoa vão com `organizationId` nulo (o pedido envolve dois grupos).
- Auditoria: `TRANSFER_REQUEST/APPROVE/DECLINE/CONTEST/CANCEL/EXPIRE` (+ `PERSON_PROFILE_UPDATE`).
- Job `TransferCronService` 04:15 SP (`TRANSFER_CRON=false` desliga): PENDING vencido → EXPIRED (audita, avisa);
  APPROVED com `contestUntil` passado → COMPLETED. Decidir um pedido vencido ainda não processado → 409 `TRANSFER_EXPIRED`
  (e ele vira EXPIRED na hora).

### 4.3 Contrato exato
- **POST /api/transfers** (MESTRE) `{personId?|gingappCode?|document?, fromOrganizationId?, unitId?, note? (≤280)}` →
  **201** TransferView (novo) | **200** TransferView (já havia pendente). Erros: 400 `TRANSFER_TARGET_REQUIRED`,
  `INVALID_CPF`, `GINGAPP_CODE_NOT_FOUND`, `FROM_ORGANIZATION_REQUIRED` (`organizations:[{id,name}]`),
  `TRANSFER_INVALID_UNIT`; 404 `PERSON_NOT_FOUND`; 409 `PERSON_ALREADY_IN_GROUP` (`studentId`, `studentStatus`),
  `PERSON_NOT_ENROLLED_ELSEWHERE`; 403 não-MESTRE.
- **GET /api/transfers[?direction=sent|received]** (MESTRE) → TransferView[] (máx. 200, mais novo primeiro).
- **GET /api/transfers/:id** (MESTRE de origem ou destino; outro grupo 404).
- **POST /api/transfers/:id/cancel** (MESTRE do destino; origem 403) → 200 TransferView; 409 `TRANSFER_NOT_PENDING`.
- **POST /api/transfers/:id/contest** (MESTRE da origem; destino 403) `{reason: PENDING_PAYMENT|EQUIPMENT|OTHER, note?}` →
  **201** `{id, reason, note, createdAt, organization:{id,name}}`; 409 `TRANSFER_CONTEST_CLOSED`.
- `TransferView = {id, status, direction:'SENT'|'RECEIVED', person:{id,name,nickname,photo,gingappCode}, fromOrganization:
  {id,name,logoUrl}, toOrganization:{...}, toUnit:{id,name}|null, requestedAt, expiresAt, contestUntil, decidedAt, note,
  toStudentId (só SENT), canCancel, canContest, contests:[{id,reason,note,createdAt,organization:{id,name}}]}`.
- **GET /api/people/me/transfers** → PersonTransferView[] (própria ficha + dependentes): mesmos campos base +
  `person:{id,name,photo}`, `canDecide`, `decidingAs:'SELF'|'GUARDIAN'|null`, `sharedOnApproval:['ATTENDANCE','GRADUATIONS','CERTIFICATES']`.
- **POST /api/people/me/transfers/:id/approve | /decline** → 200 PersonTransferView; 404 sem direito/inexistente;
  409 `TRANSFER_NOT_PENDING` | `TRANSFER_EXPIRED` | `PERSON_ALREADY_IN_GROUP`.
- **PATCH /api/people/me** `{name?, nickname?|null, photo?|null, phone?|null, email?|null}` → `{person:{id,gingappCode,name,
  nickname,birthDate,photo,documentMasked,documentKind}}`; propaga nome/foto/telefone/e-mail a todas as matrículas; 404
  `PERSON_NOT_FOUND`.
- **POST /api/students** 409 `PERSON_EXISTS_ELSEWHERE` agora: `transferAvailable:true`, `transfer:{method:'POST',
  path:'/api/transfers', body:{personId}}`.
- **Ficha da equipe:** `enrollments[].until` = `leftAt`, `+leftReason`; `sharedFromOtherGroups:[{shareId, organization:
  {id,name,logoUrl}, studentId, since, until, leftReason, sharedAt, graduations:[{id,graduatedAt,level,system}],
  attendanceByClass:[{class:{id,name},present,absent,total}], certificates:[{id,title,issuedAt}]}]`.
- **CPF legado mascarado:** todas as respostas de `/api/students*` trazem `document` como `***.***.***-XX` (CPF) ou
  `***` + 2 últimos caracteres; reenviar a máscara no PATCH não muda nada. CSV: completo só para o MESTRE.
- **LGPD:** `GET /api/auth/me/export` ganhou `people:[{id,gingappCode,name,nickname,birthDate,photo,gender,email,phone,
  documentKind,documentMasked,createdAt,updatedAt,transfers:[...]}]`.

### 4.4 Riscos/limites da Fase 2
- Adulto sem login (cadastro sem acesso) não consegue aprovar → o grupo antigo precisa criar o acesso, ou o pedido expira.
- Nascimento ausente = tratado como adulto (só o próprio login decide).
- Aprovar encerra a matrícula de origem mesmo com contestação aberta (decisão do owner: não bloquear); a cobrança é assunto
  entre os grupos.
- Não há "desfazer transferência" nem revogação de `EnrollmentShare` por tela (campo `revokedAt` pronto).
- Treinar em dois grupos ao mesmo tempo continua sem fluxo próprio (a transferência sempre encerra a origem).
- Push de `TRANSFER_*` abre `/notificacoes` (categoria "avisos"); o app leva de lá para `/transferencias`.

## 5. Fase 3 — Cargos acumuláveis (IMPLEMENTADA, 2026-10-12/13)

### 5.1 Decisões
- **Menor impacto nas permissões:** `MONITOR` e `INSTRUTOR` foram **acrescentados ao `OrgRole`** (a matriz `RolePermission`,
  `@CanAccess`, guards e o token continuam iguais); o cargo capoeirístico acumulável fica em **`PersonRole`** (enum `StaffRole`).
  O **maior** cargo ativo (MESTRE > PROFESSOR > INSTRUTOR > MONITOR) é gravado em `OrganizationUser.role` e a `JwtStrategy`
  passa a **reler o papel do banco a cada requisição** (conceder/revogar vale na hora; antes valia o papel do token).
- **Matriz nova** (`prisma/permission-matrix.ts`, 6 papéis × 13 recursos = 78 linhas; bootstrap só insere as ausentes):
  INSTRUTOR = PROFESSOR que **nunca exclui**, graduações/certificados/unidades/equipe só leitura, **sem financeiro**;
  MONITOR = leitura de alunos/turmas/aulas/graduações/eventos/rodas/comunicados/unidades + **chamada** (attendance
  view/create/edit); **sem** financeiro, equipe, dashboard e certificados. Escopo por unidade (UserUnitAccess) vale para
  PROFESSOR, INSTRUTOR e MONITOR; INSTRUTOR/MONITOR podem ser o responsável de turma/aula; INSTRUTOR administra eventos/rodas.
- **Quem nomeia:** só o **MESTRE** do grupo concede/revoga qualquer cargo, **inclusive outro MESTRE** (co-mestre; auditado).
  O último MESTRE ativo do grupo não pode ser revogado (409 `LAST_MESTRE`). PROFESSOR/INSTRUTOR/MONITOR não concedem (403).
- **Staff também é aluno:** a migration materializa cada MESTRE/PROFESSOR ativo como cargo (`source MIGRATION`, acesso
  intacto); o backfill (`npm run roles:backfill` / boot `ROLES_BACKFILL`) cria a matrícula de aluno de quem é da equipe e
  não tem (**`Student.isStaff = true`: não conta em `Plan.maxStudents` e não gera mensalidade** — só quem tem
  `StudentBilling` é cobrado) e liga à ficha. A tela Equipe (criar/editar membro) sincroniza o cargo; **não** cria matrícula
  sozinha (o backfill do boot cobre; evita quebrar limpezas de specs que apagam usuários).
- **Conceder exige matrícula ATIVA no grupo** (cargo para pessoa de outro grupo = transferência antes) e **login**: sem User,
  400 `LOGIN_REQUIRED`; com `email` + `password` (ou `sendInvite`) reutiliza o fluxo de acesso do aluno (nunca duplica User).
  Revogar mantém a matrícula; sem cargo restante o acesso volta a ALUNO (ou RESPONSAVEL se só acompanha dependente) e as
  unidades de atuação são limpas. Histórico preservado (`revokedAt`).
- **Sugestões:** `GraduationRoleRule {graduationSystemId, role, minLevelOrder}` (único por sistema+cargo); sugerido = aluno
  ATIVO cuja graduação mais recente tem `order >= minLevelOrder` e que não tem o cargo **nem um maior**. Ao lançar uma
  graduação, os MESTRES recebem **um** aviso `ROLE_SUGGESTION` por aluno+cargo (`RoleSuggestionNotice`, nunca repete).

### 5.2 Contrato exato
- **POST /api/roles/grant** (MESTRE; `teachers:create`) `{studentId?|personId?, role: MESTRE|PROFESSOR|INSTRUTOR|MONITOR,
  email?, password?, sendInvite?}` → **201** `{studentId, userId, roles: StaffRole[], accessRole}`. Erros: 400
  `ROLE_TARGET_REQUIRED`, `LOGIN_REQUIRED` (e os do acesso do aluno: senha fraca, convite desligado...); 404 aluno de outro
  grupo/inexistente; 409 `STUDENT_NOT_ACTIVE`, `ROLE_ALREADY_ACTIVE`, e-mail indisponível. Notifica `ROLE_GRANTED`.
- **POST /api/roles/revoke** (MESTRE; `teachers:edit`) `{studentId?|personId?, role}` → **200** mesma view; 409
  `ROLE_NOT_ACTIVE`, `LAST_MESTRE`. Notifica `ROLE_REVOKED`.
- **GET /api/roles/suggestions** (MESTRE) → `[{studentId, personId, name, photo, hasLogin, currentRoles, role, level:{id,name,
  order,color,style,colors}, system:{id,name}, graduatedAt}]`.
- **GET /api/graduations/systems/:id/role-rules** (`graduations:view`; outro grupo 404) e **PUT** (MESTRE; `graduations:edit`)
  `{rules:[{role, minLevelOrder}]}` (substitui) → `{systemId, rules:[{role, minLevelOrder, level|null}]}`; 400
  `INVALID_LEVEL_ORDER` (ordem inexistente no sistema), `DUPLICATE_ROLE_RULE`.
- **GET /api/teachers** (lista "Equipe"; `?role=` aceita os 4 cargos): cada item ganhou `roles: StaffRole[]` (o papel legado
  conta enquanto o backfill não materializa) e `student: {id, status, level|null} | null`. POST/PATCH `/teachers` aceitam
  INSTRUTOR/MONITOR; `PUT /teachers/:id/units` vale para qualquer cargo exceto MESTRE.
- **GET /api/students**: `staffRoles: StaffRole[]` por item; filtro `?role=`.
- **Ficha** (`/students/:id/ficha`, `/people/me/ficha`): `enrollments[].roles` e `roles:[{organization:{id,name}, role, grantedAt}]`.
- **GET /api/auth/me**: `roles: StaffRole[]` (grupo do token); `role` pode ser INSTRUTOR/MONITOR.

### 5.3 Riscos / limites
- MONITOR faz chamada de **qualquer** turma dentro do seu escopo de unidade (não há vínculo monitor↔turma além de ser o
  responsável da turma); a regra "só as turmas dele" exigiria checagem por turma no AttendanceService (pendência).
- O backfill cria matrícula de aluno para toda a equipe: listas de alunos, dashboard, relatórios e o ranking do grupo passam
  a incluir mestres/professores (intencional: todo mundo é aluno; ranking aberto segue o opt-in).
- Papel no token deixou de valer: um MESTRE rebaixado perde as permissões na próxima requisição (antes só no novo login).
- `Plan.maxStudents` ignora `isStaff`; um aluno promovido continua contando (ele já ocupava a vaga).

## 6. Fase 4 — Ocorrências
- `Occurrence` (tipo, data, motivo ≤ 280, autor, contestação). Escrita: MESTRE do grupo da matrícula. Leitura: MESTRE do
  grupo (e do grupo novo **após** transferência aprovada); **nunca** alunos, responsáveis ou professores; a própria pessoa
  vê que existe e contesta (`POST /occurrences/:id/contest`). Auditoria de toda leitura cross-group. `member-privacy`
  ganha marcadores de ocorrência.

## 7. Fase 5 — Equivalência de cordas
- `LevelEquivalence` declarada pelo grupo novo ao receber uma transferência ("Azul do grupo X = Verde/Amarela aqui");
  sugestão automática por `order` relativo; usada na ficha e em cargos (F3). Nunca altera graduações antigas.

## 8. Migração segura (produção)
1. Deploy da imagem: `migrate deploy` (só adiciona) → bootstrap → demo → **person-backfill --auto** → ranking → API.
2. Antes do 1º boot: definir `PERSON_DOC_KEY` e `PERSON_DOC_PEPPER` (aleatórias, guardadas com o backup).
3. Conferir o log `[person] backfill concluido ...` (contagens) e `GET /api/people/duplicates`.
4. Futuro (F2): `ALTER TABLE "Student" ALTER COLUMN "personId" SET NOT NULL` só com contagem de nulos = 0 e com seed/demo
   e specs já criando Person.

## 9. Rollback
- **Código:** voltar a imagem anterior funciona com o banco migrado (colunas/tabela novas são ignoradas pelo código antigo;
  `Student.personId` é nullable; nada do legado foi alterado — o backfill só preenche `personId`).
- **Banco (se necessário):** `ALTER TABLE "Student" DROP CONSTRAINT "Student_personId_fkey"; DROP INDEX "Student_personId_idx";
  ALTER TABLE "Student" DROP COLUMN "personId"; DROP TABLE "Person"; DROP TYPE "PersonDocumentKind";` e
  `prisma migrate resolve --rolled-back 20261012210000_person_ficha_unica`. Perde-se só a identidade nova (códigos,
  CPFs cifrados, mesclas) — os dados dos grupos ficam intactos.
- **Desligar só o backfill:** `PERSON_BACKFILL=false`.

## 10. Riscos e limites (Fase 1)
- **R1 — RESOLVIDO na Fase 2 (transferência).** Texto original: bloqueio de cadastro entre grupos até a Fase 2: quem já tem ficha (CPF/código) em outro grupo **não pode** ser
  cadastrado no grupo novo (409, `transferAvailable:false`). Saída provisória: cadastrar **sem** CPF → `POSSIBLE_DUPLICATE`
  → "cadastrar mesmo assim" (fica auditado) e o super admin mescla depois. Prioridade: entregar a Fase 2 logo.
- **R2 — Chaves:** trocar `PERSON_DOC_PEPPER` (ou o `JWT_SECRET` sem ele) quebra a busca por CPF; trocar `PERSON_DOC_KEY`
  torna `documentEnc` ilegível. Sem ferramenta de re-hash ainda.
- **R3 — (Fase 2: agora mascarado nas respostas da API; continua em claro no banco)** CPF legado em claro: `Student.document` continua em claro e visível à equipe (como antes). F2: máscara/remoção.
- **R4 — Enumeração:** staff pode testar CPFs para descobrir se alguém tem ficha (o preview mostra nome/foto/grupo). Mitigado
  por auditoria de toda consulta que acha alguém + rate limit global; avaliar limite específico.
- **R5 — Gêmeos** pelo CPF do responsável e **nomes muito diferentes** (apelido no cadastro) escapam da sugestão.
- **R6 — Mescla automática pelo login:** ligar um e-mail já usado em outro grupo une as fichas (regra "mesmo login = mesma
  pessoa"); e-mail errado digitado pela equipe uniria pessoas diferentes — reversão é manual (sem "desmesclar" ainda).
- **R7 — Fichas órfãs:** apagar `Student` (só specs/limpezas manuais fazem isso) deixa Person sem matrícula; ela é
  reaproveitada se a pessoa voltar (não duplica), mas acumula no banco de dev.
- **R8 — `until` da matrícula** é sempre `null` (não há data de saída registrada até a F2).

## 11. LGPD
- Base legal: execução de contrato/legítimo interesse do grupo para identificação única; CPF minimizado (cifrado + hash,
  máscara na API, nunca em log/auditoria — `sanitizeAuditMeta` remove chaves `hash`).
- Transparência: a pessoa vê a própria ficha (`/people/me/ficha`) e o código; exportação LGPD (`/auth/me/export`) ainda não
  inclui a Person (pendência).
- Compartilhamento entre grupos só com aprovação do titular/responsável (F2); ocorrências com contestação (F4).
- Pedido de exclusão (`DataDeletionRequest`) passa a precisar tratar a Person (anonimizar nome/foto/documento, manter
  `gingappCode` para integridade histórica) — procedimento a escrever na F2.
