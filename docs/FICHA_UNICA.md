# Ficha única do capoeirista — desenho e fases

> Status: **Fases 1–3** commitadas (1f28bec, 5f4b67a, 55fd41f); **Fases 4 (ocorrências) e 5 (equivalência de cordas)**
> implementadas sem commit (seções 6 e 7). O que falta decidir ou rodar está na seção 7b.
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
- **Admin (Vue):** tela "Duplicatas" (lista, comparação lado a lado, mescla com confirmação; ver §12.B).

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
  Adulto sem login aprova por link de uso único (§12.A); sem o link o pedido expira.
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
> **Superado em parte pela seção 13 (cargos DO GRUPO):** o cargo agora é um `GroupRole` do grupo (`groupRoleId`); os campos
> `roles`/`staffRoles` viraram objetos (selos) e ganharam `roleKeys`/`staffRoleKeys`. O `role` enum abaixo segue aceito como legado.
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

## 6. Fase 4 — Ocorrências (IMPLEMENTADA, 2026-10-13)

Migration `20261013030000_occurrences_equivalences` (só adiciona). `Occurrence {organizationId, studentId (matrícula),
personId, kind ADVERTENCIA|SUSPENSAO|EXPULSAO|OUTRA, occurredAt, endsAt? (só suspensão), reason (3–280), status
ACTIVE|CONTESTED|RETRACTED, expelledEnrollment, createdByUserId, contestedAt/contestNote/contestedByUserId,
retractedAt/retractNote/retractedByUserId}` (FK para a matrícula com cascade; sem purga automática).

**Regras (decisões):**
- Escreve, lê e retrata: **só o MESTRE do grupo da matrícula** (`MestreOnlyGuard`). PROFESSOR, INSTRUTOR, MONITOR, ALUNO e
  RESPONSAVEL recebem 403; MESTRE de outro grupo recebe 404.
- **Grupo novo:** o MESTRE lê as ocorrências dos grupos anteriores **só** dentro de `sharedFromOtherGroups[].occurrences` da
  ficha (EnrollmentShare ativo = transferência aprovada), somente leitura; **retratadas não vão**; toda leitura que devolve
  alguma é auditada (`OCCURRENCE_READ_SHARED`, com os ids). Para os demais papéis a chave **nem vem**.
- **A pessoa** (adulto) ou **o responsável** (menor) vê as ocorrências **com o motivo** (decisão: sem o motivo não há como
  contestar) e contesta uma vez (nota 3–280): vira CONTESTED, o Mestre é avisado e vê a nota; quem lê (inclusive o grupo
  novo) vê o selo "contestada". O Mestre autor pode retratar (RETRACTED, com nota).
- Registrar avisa a pessoa/responsável (`OCCURRENCE_REGISTERED`, sem o motivo no texto do aviso). Expulsão com
  `expel: true` encerra a matrícula (Ex-aluno, `leftReason='EXPELLED'`, turmas inativas; o vínculo ALUNO do login cai).
- Auditoria: `OCCURRENCE_CREATE`, `OCCURRENCE_RETRACT`, `OCCURRENCE_CONTEST`, `OCCURRENCE_READ_SHARED`.
- **Retenção:** sem purga automática nesta versão. Recomendação para o owner decidir: retratadas apagadas após 1 ano;
  advertências após 5 anos; expulsões mantidas enquanto a ficha existir; pedido de exclusão (LGPD) avaliado caso a caso.

**Contrato:**
- `POST /api/students/:id/occurrences` `{kind, occurredAt, reason, endsAt?, expel?}` → 201 OccurrenceView; 400
  `EXPEL_ONLY_FOR_EXPULSION`, `ENDS_AT_ONLY_FOR_SUSPENSION`, `INVALID_ENDS_AT`.
- `GET /api/students/:id/occurrences` → OccurrenceView[] (só as do próprio grupo).
- `PATCH /api/students/:id/occurrences/:occurrenceId/retract` `{note?}` → OccurrenceView; 409 `OCCURRENCE_ALREADY_RETRACTED`.
- `OccurrenceView = {id, kind, occurredAt, endsAt, reason, status, expelledEnrollment, createdAt, createdBy:{id,name}|null,
  contestedAt, contestNote, retractedAt, retractNote}`.
- `GET /api/people/me/occurrences` → `[{id, kind, occurredAt, endsAt, reason, status, organization:{id,name,logoUrl},
  person:{id,name}, contestedAt, contestNote, retractedAt, canContest, decidingAs}]` (própria ficha + dependentes).
- `POST /api/people/me/occurrences/:id/contest` `{note}` → 200 (mesma visão); 404 sem direito; 409 `OCCURRENCE_NOT_CONTESTABLE`.
- Ficha da equipe: `sharedFromOtherGroups[].occurrences: [{id, kind, occurredAt, endsAt, reason, status, contestNote}]` (só MESTRE).

## 7. Fase 5 — Equivalência de cordas (IMPLEMENTADA, 2026-10-13)

`LevelEquivalence {toOrganizationId, fromLevelId (outro grupo), toLevelId (deste grupo), declaredByUserId}` (único por
grupo + corda de origem) e `StudentGraduation.recognizedFromLevelId`.

**Regras (decisões):**
- Só o MESTRE. O grupo só enxerga cordas de outro grupo que chegaram por **compartilhamento** (EnrollmentShare ativo);
  corda não compartilhada = 404 (não dá para enumerar os sistemas dos outros grupos).
- **Sugestão** por posição relativa: posição da corda no sistema de origem ÷ nº de cordas × nº de cordas do sistema destino
  (arredondado, entre 1 e N). Exemplo: a 3ª de 4 vira a 2ª de 2. O sistema destino é o das graduações do aluno no grupo; na
  falta delas, o primeiro sistema ativo com cordas.
- **Reconhecer** cria a graduação do grupo no nível equivalente, com a **data da graduação de origem** e a nota
  "Reconhecida de <grupo> (<corda>)". A antiga não muda. É idempotente: reconhecer de novo não duplica, só acompanha a
  equivalência corrigida.
- **Pontos (decisão anti-duplicidade):** a reconhecida pontua como GRADUATION na matrícula **nova**. A de origem continua na
  matrícula antiga, que virou Ex-aluno na transferência e fica fora dos rankings (só alunos ATIVOS). A pessoa nunca soma as
  duas. A corda reconhecida também alimenta Hierarquia, Jornada e sugestões de cargo (vale a graduação mais recente).
- Auditoria: `LEVEL_EQUIVALENCE_SET`, `GRADUATION_RECOGNIZE`.

**Contrato:**
- `GET /api/graduations/equivalences/suggestions?studentId=` → `[{fromLevel, fromSystem:{id,name,levelsCount},
  fromOrganization:{id,name,logoUrl}, graduatedAt, declared|null, suggested|null, toSystem:{id,name}|null, recognized}]`.
- `POST /api/graduations/equivalences` `{fromLevelId, toLevelId, recognizeForStudentId?}` → 201 `{equivalence:{id,
  fromLevel, toLevel, fromOrganization}, recognizedGraduation:{id, graduatedAt, graduationLevelId, notes}|null}`; 404 corda
  não compartilhada; 400 `INVALID_TO_LEVEL`, `NOT_SHARED_GRADUATION`.
- `GET /api/graduations/equivalences` → `[{id, fromLevel, toLevel, fromOrganization, createdAt}]`.
- Ficha: `graduations[].recognizedFromLevelId`.

## 7b. Pendências finais da ficha única (o que falta o owner decidir ou rodar)
1. **Produção (antes do deploy):** definir `PERSON_DOC_KEY` e `PERSON_DOC_PEPPER` (nunca trocar); conferir no log do boot
   `[person]` e `[roles]`; revisar `GET /api/people/duplicates` e mesclar o que for a mesma pessoa.
2. **Decidir:** a retenção das ocorrências (proposta na §6); se mestres/professores devem aparecer nas listas, no dashboard e
   no ranking como alunos (hoje sim, `isStaff` permite filtrar); a restrição "monitor só nas turmas dele".
3. **Técnico, adiado:** `Student.personId NOT NULL` (seed, demo e specs ainda criam aluno sem ficha); remover o CPF em
   claro de `Student.document` do banco; "desfazer transferência" e "desmesclar".
   (Entregues depois, ver §12: convite guiado, tela de duplicatas, anonimização LGPD, monitor só nas turmas dele.)

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
- Transparência: a pessoa vê a própria ficha (`/people/me/ficha`), o código e as ocorrências (`/people/me/occurrences`); a
  exportação LGPD (`/auth/me/export`) inclui a Person e as transferências (Fase 2).
- Compartilhamento entre grupos só com aprovação do titular/responsável (F2); ocorrências com contestação (F4).
- Pedido de exclusão (`DataDeletionRequest`) passa a precisar tratar a Person (anonimizar nome/foto/documento, manter
  `gingappCode` para integridade histórica) — procedimento a escrever na F2.

## 12. Pendências entregues depois da Fase 5 (A–F, 2026-10-12/13)

Migration `20261014000000_approval_links_anonymization` (só adiciona): `TransferApprovalToken`, `Person.anonymizedAt`,
`Student.anonymizedAt`.

### 12.A Convite guiado: adulto SEM login aprova a transferência por link
- **Quando:** `POST /api/transfers` para pessoa adulta sem `Person.userId` (menor nunca recebe link: precisa do responsável com
  login). A resposta (201) ganha `approvalLink: { url, expiresAt, emailed } | null` e o `TransferView` ganha
  `needsApprovalLink: boolean` (pedido `PENDING_PERSON`, adulto, sem login; só no lado SENT).
- **Token:** 256 bits aleatórios (`generatePasswordToken`), só o SHA-256 vai ao banco (`TransferApprovalToken`), uso único,
  expira junto com o pedido (`expiresAt` do pedido). Gerar outro invalida os anteriores. Decisão: não reutilizei
  `PasswordResetToken` porque ele exige `userId` (a pessoa ainda não tem User). O token só aparece na criação ou na
  regeneração (não é guardado em claro).
- **URL:** `APP_URL + /aprovar-transferencia?token=...` (sem `APP_URL` a URL sai só com o caminho). Se SMTP estiver ativo e a
  ficha tiver e-mail, o link também é enviado por e-mail (`emailed: true`); sem SMTP, o Mestre copia/envia pelo WhatsApp.
- **Regenerar:** `POST /api/transfers/:id/approval-link` (MESTRE do grupo que pediu; origem 403) -> 200
  `{ url, expiresAt, emailed }`; 409 `TRANSFER_NOT_PENDING` | `TRANSFER_EXPIRED` | `APPROVAL_LINK_NOT_NEEDED` (tem login ou é menor).
- **Públicas (sem login, `@Throttle` forte por IP: GET 30/min, POST 5/min; env `TRANSFER_APPROVAL_READ_THROTTLE_LIMIT` /
  `TRANSFER_APPROVAL_WRITE_THROTTLE_LIMIT` só para os e2e):**
  - `GET /api/public/transfer-approval/:token` -> `{ groupName, groupLogoUrl, sharedOnApproval, isMinor, hasLogin,
    canApproveByLink, emailRequired, expiresAt }` (nunca CPF, contato, nascimento, histórico ou nome da pessoa).
  - `POST .../approve` `{ newPassword (@IsNewPassword), email? }` -> 200 `{ status: 'APPROVED', groupName }`. Na MESMA transação:
    consome o token, cria o `User` (MEMBER, senha própria, sem troca obrigatória), liga à `Person`, aprova (matrícula nova,
    vínculo ALUNO, compartilhamento) - se algo falhar, nada fica criado. O e-mail vem de `email` ou da ficha; e-mail que já é
    conta do GingApp é recusado (`409 EMAIL_IN_USE`: quem tem link não prova ser o dono daquela conta, então nunca
    vinculamos a um User existente; a pessoa entra no app e aprova em Transferências).
  - `POST .../decline` -> 200 `{ status: 'DECLINED', groupName }` (sem criar login).
  - Erros: 404 `TRANSFER_APPROVAL_INVALID` (inexistente/usado/expirado/pedido já decidido - sempre a mesma mensagem), 400
    `EMAIL_REQUIRED`, 400 senha fraca, 403 `MINOR_REQUIRES_GUARDIAN`, 409 `APPROVAL_LINK_NOT_NEEDED`, `EMAIL_IN_USE`,
    `PERSON_ALREADY_IN_GROUP`.
- Auditoria: `TRANSFER_APPROVAL_LINK_ISSUE` (meta `emailed`), `TRANSFER_APPROVE`/`TRANSFER_DECLINE` com `meta.via='approval-link'`.
- App: página pública `/aprovar-transferencia?token=` (fora do guard de login/termos). Painel: diálogo com Copiar,
  "Enviar por WhatsApp" e botão "Gerar link de aprovação" nos pedidos enviados.
- Limites: o link vale para quem o tiver (como qualquer link de convite); o Mestre deve enviá-lo só à pessoa. Menor: sempre o
  responsável com login, pelo app.

### 12.B Admin Vue: "Duplicatas"
Menu/rota `/duplicates` (só super admin ativo chama a API): lista de grupos (`GET /people/duplicates`), comparação lado a lado,
escolha de quem MANTER/MESCLAR e `POST /people/merge` com confirmação de que **não existe "desmesclar"**. Erros 400/404/409 em
pt-BR por `code` (`PERSON_MERGE_SAME_GROUP` cita os grupos). `ApiError` do admin passou a guardar `code` e `body`.

### 12.C MONITOR só nas turmas/aulas dele
- Backend: `monitorLessonFilter(user)` (`shared/access/unit-scope.ts`) = aula com `Lesson.teacherUserId = user.id` **ou** de
  turma com `Class.teacherUserId = user.id`; aplicado em `GET /attendance`, `GET/POST /attendance/lessons/:id`,
  `GET /attendance/quick-sessions` e `GET /attendance/lessons/:id/checkin-token`. Fora disso = o mesmo 404 da aula
  inexistente. **Atualizado em 2026-10-15 (PLANO §10.50):** o filtro (agora `ownLessonFilter`) vale também para PROFESSOR e INSTRUTOR (bug: a chamada rápida mostrava turmas de outros); só o MESTRE vê todas as aulas do grupo (respeitando a unidade). Leitura de turmas/aulas continua pela matriz.
- Painel: `session.ts`/`nav.ts` já espelhavam INSTRUTOR e MONITOR (conferido célula a célula com `permission-matrix.ts`, com
  teste); os botões de criar/editar (Novo aluno/turma/aula/comunicado/evento/roda, Emitir certificado, Graduações) passam a
  seguir `useCan`. Menu do MONITOR: sem Financeiro, Equipe, Dashboard, Certificados, Transferências.

### 12.D LGPD: anonimização (`POST /api/data-deletion-requests/:id/anonymize`, super admin ativo)
Corpo `{ confirm: true }` (senão 400). Resposta `{ request: <DataDeletionRequestView, status DONE>, result: { personId,
studentsAnonymized, userDeactivated, occurrencesRetained } }`. Uma transação:
- **Person** (e as fichas mescladas nela): nome `Pessoa removida`; apelido, nascimento, foto, gênero, e-mail, telefone, CPF
  (`documentEnc/Hash/Last4/Kind`) e login removidos; **`gingappCode` novo** (o antigo deixa de achar a ficha); `anonymizedAt`.
  O CPF fica livre (a pessoa pode ganhar ficha nova sem colidir).
- **Matrículas** (por ficha ou por login): mesmo tratamento, `userId`/capa/redes nulos, status `FORMER` com
  `leftReason='ANONYMIZED'`, turmas inativas, apelido do ranking e perfil público apagados/despublicados; responsáveis
  (`StudentGuardian`) viram `Responsável removido` sem contato/login; compartilhamentos revogados; pedidos de transferência
  abertos cancelados e notas limpas; tokens de aprovação invalidados.
- **User:** nome `Pessoa removida`, e-mail `anonimizado-<id>@anonimizado.invalid`, sem telefone/foto/2FA, senha aleatória,
  `status=INACTIVE`, `tokenValidAfter` (revoga TODAS as sessões), vínculos inativos, cargos revogados, avisos/push/tokens apagados.
- **Preservado sem identificar:** frequência, graduações, certificados, financeiro, pontos, auditoria e as contagens agregadas.
- **Regra das ocorrências (decisão):** **retidas, sem bloquear.** Tipo, datas e status (inclusive EXPULSÃO) ficam ligados à
  matrícula anonimizada; `reason` e as notas de contestação/retratação viram `[removido na anonimização]`. A matrícula já não
  identifica ninguém, então a retenção do fato não expõe a pessoa; o registro serve ao grupo (aviso a outros grupos não é mais
  possível: o compartilhamento é revogado).
- **Bloqueios (409):** `DELETION_REQUEST_FINAL` (pedido já DONE/REJECTED), `ANONYMIZE_PLATFORM_USER` (equipe da plataforma é
  tratada à mão), `ANONYMIZE_LAST_MESTRE` (único MESTRE ativo de um grupo: nomeie outro antes).
- Marca o pedido `DONE` (`resolvedAt`, nota `Anonimizado em AAAA-MM-DD.`). Auditoria `PERSON_ANONYMIZE` (só ids e contagens, sem
  nome/e-mail). Admin: botão "Anonimizar" (pedidos abertos, super admin) com confirmação forte (digitar ANONIMIZAR ou o e-mail).
- Limites: arquivos de foto já enviados ficam no disco até o GC semanal de imagens órfãs; `AuditLog` antigo não é reescrito
  (a retenção da auditoria cuida); dependentes de um responsável anonimizado ficam sem responsável até haver outro; não há
  reversão.

### 12.E Dados que o painel espera
- `GET /api/students` (lista): por item `classNames: string[]` (turmas ATIVAS onde a matrícula está ATIVA, por nome) e
  `currentCord: { name, style, colors } | null` (graduação mais recente - data, depois id - de qualquer sistema). Duas
  consultas em lote por página (sem N+1). O painel aceita o formato antigo (string).
- `GET /api/graduations/systems/:id`: cada nível ganha `studentCount` = alunos ATIVOS cuja graduação mais recente **neste
  sistema** é o nível (uma consulta).
- Extras adicionados a pedido do painel: `student.photo` em `GET /finance` e nos certificados, `studentPhoto` em
  `GET /finance/delinquents`, `organizationLogoUrl` em `/auth/login` e `/auth/me` (logo no cabeçalho mobile).

### 12.F Painel (UI)
Logo no cabeçalho mobile (logo do grupo ou `/icone.png`) e correção do estouro horizontal a 375px (causa: ações do cabeçalho
com largura fixa de 240px e título que não encolhia; `PageHeader` com ações `shrink-0`) - medido 375/375 nas 18 rotas do menu
(antes até +39px). Avatar do aluno em Financeiro, Certificados e Inadimplentes.

### 12.G Números e pendências
Gates na seção "Ficha única — pendências A–F" do `PLANO_PROJETO.md`. Pendências que continuam: `Student.personId NOT NULL`,
remover o CPF em claro de `Student.document`, "desfazer transferência"/"desmesclar", retenção/purga das ocorrências (a regra de
anonimização acima não substitui a política de purga), MONITOR só pode ver (não filtrar) as demais turmas na UI.

## 13. Cargos DO GRUPO (IMPLEMENTADA, 2026-10-13)

**Problema (owner):** os cargos eram um enum fixo (`StaffRole` MONITOR/INSTRUTOR/PROFESSOR/MESTRE); na capoeira há
Contramestre, Formado, Treinel... e cada grupo é diferente. **Agora cada grupo cria/edita os seus cargos.**

### 13.1 Modelo (migration `20261015000000_group_roles`, só adiciona)
- `GroupRole {id, organizationId, name, slug (único no grupo, estável: não muda ao renomear), accessRole (StaffRole), rank Int,
  color String? (#RRGGBB), icon String? (lucide da lista permitida), isDefault, active, createdAt, updatedAt}`.
- **`accessRole` = PERFIL DE ACESSO base** (um dos papéis da matriz `RolePermission`: MESTRE|PROFESSOR|INSTRUTOR|MONITOR;
  ALUNO não é cargo). A matriz, os guards, `@CanAccess`, o token e o `session.ts` do painel **não mudaram**: continuam por papel.
- **`rank`** = hierarquia visual (maior = mais sênior): ordena listas, escolhe o **selo principal** e a árvore da Jornada.
- `PersonRole.groupRoleId` (FK, `SetNull` só para histórico de cargo excluído). `PersonRole.role` passou a ser a **cópia do
  accessRole** do cargo no momento da concessão (o accessRole de um cargo só muda quando ninguém o exerce, então não diverge).
  `GraduationRoleRule.groupRoleId` e `RoleSuggestionNotice.groupRoleId` (únicos por sistema+cargo e aluno+cargo; `role` = cópia).
  O enum `StaffRole` ficou como tipo do perfil de acesso (legado + accessRole).
- **Acesso efetivo** (`OrganizationUser.role`) = o MAIOR accessRole entre os cargos ativos (mesma lógica da Fase 3, agora sobre o
  perfil). **Selo principal** = o cargo de maior rank. Ex.: Contramestre (PROFESSOR, 35) + Formado (INSTRUTOR, 25) → acesso
  PROFESSOR, selo "Contramestre".
- **Padrões** (todo grupo; `isDefault`): Mestre 40/MESTRE/#B45309/crown, Professor 30/PROFESSOR/#1D4ED8/graduation-cap,
  Instrutor 20/INSTRUTOR/#047857/award, Monitor 10/MONITOR/#7C3AED/clipboard-check (slugs `mestre|professor|instrutor|monitor`).

### 13.2 Migração sem regressão
- A migration cria os 4 padrão em cada grupo (`type GROUP`) e aponta cada `PersonRole`/regra/aviso existente para o padrão do
  mesmo accessRole. `PersonRole.role` e `OrganizationUser.role` **não mudam**. Banco de dev (medido antes/depois): memberships
  MESTRE 3 / PROFESSOR 5 / INSTRUTOR 1 / MONITOR 1 / ALUNO 2 / RESPONSAVEL 2 e cargos ativos MESTRE 3 / PROFESSOR 5 /
  INSTRUTOR 1 / MONITOR 1 **idênticos**; 3 grupos → 12 cargos padrão; 10/10 `PersonRole` e 3/3 regras ligados; 0 divergências
  perfil×cargo; `prisma migrate diff` sem diferença.
- Backfill idempotente `npm run group-roles:backfill` / boot `GROUP_ROLES_BACKFILL` (vazio = só com pendência; `true` sempre;
  `false` nunca; roda antes do `roles-backfill`, com `|| echo`). As rotas também criam os padrão sob demanda (grupos criados por
  fora do `createGroup`, ex.: fixtures). `createGroup` já cria os 4.

### 13.3 Regras
- Só o **MESTRE** (acesso efetivo) cria/edita/exclui/reordena/migra. Leitura (`GET /group-roles`) = quem lê alunos (`students:view`).
- Nome 2–30 (espaços colapsados), sem duplicata case-insensitive no grupo; até **20** cargos; ícone da lista permitida; cor hex.
- **Em uso** (alguém o exerce hoje) → não exclui, não inativa, não muda o perfil (409 `GROUP_ROLE_IN_USE` com `peopleCount`;
  ofereça inativar/migrar). Os 4 padrão **nunca** são excluídos (409 `DEFAULT_GROUP_ROLE`), só renomeados/recoloridos/
  reordenados/inativados (se sem uso). Sempre resta **um cargo ativo com perfil MESTRE** (409 `LAST_MESTRE_ROLE`).
- Excluir cargo sem uso: histórico (`PersonRole` revogado) fica com `groupRoleId` nulo e o perfil preservado; regras/avisos em cascata.
- **Migrar** (`POST /group-roles/:id/migrate {targetGroupRoleId}`): revoga o cargo de origem (histórico) e concede o destino a
  cada pessoa, recalculando o acesso (maior perfil); 409 `LAST_MESTRE` se o grupo ficaria sem nenhum Mestre (pela membership).
- Conceder exige cargo ATIVO (409 `GROUP_ROLE_INACTIVE`). `LAST_MESTRE` (revogar) passou a contar também o Mestre de papel
  legado sem cargo materializado.
- Notificações `ROLE_GRANTED/ROLE_REVOKED/ROLE_SUGGESTION` usam o **nome do cargo do grupo**; auditoria `ROLE_GRANT/REVOKE` com
  `groupRoleId/groupRoleName`; CRUD auditado: `GROUP_ROLE_CREATE/UPDATE/DELETE/REORDER/MIGRATE` (entidade `group_role`).
- Sugestão: regra atingida (`order >= minLevelOrder`) de cargo ATIVO com **rank maior** que o maior cargo que a pessoa já tem.

### 13.4 Contrato exato (prefixo `/api`)
`Badge = {id, name, slug, color|null, icon|null, accessRole, rank}`.
- `GET /group-roles` → `[{id, name, slug, accessRole, rank, color, icon, isDefault, active, peopleCount, createdAt}]` (rank desc).
- `POST /group-roles {name, accessRole, rank?, color?, icon?, active?}` → **201** item. 400 `INVALID_GROUP_ROLE_NAME` (e validação
  de cor/ícone/perfil); 409 `GROUP_ROLE_NAME_TAKEN`, `GROUP_ROLE_LIMIT`. Sem `rank`: logo acima do maior cargo do mesmo perfil.
- `PATCH /group-roles/:id {name?, accessRole?, rank?, color?|null, icon?|null, active?}` → 200 item; 404 outro grupo; 409
  `GROUP_ROLE_IN_USE`, `LAST_MESTRE_ROLE`, `GROUP_ROLE_NAME_TAKEN`.
- `DELETE /group-roles/:id` → **204**; 409 `DEFAULT_GROUP_ROLE`, `GROUP_ROLE_IN_USE`, `LAST_MESTRE_ROLE`.
- `PUT /group-roles/reorder {order:[todos os ids, mais sênior primeiro]}` → 200 lista (rank = n·10 … 10); 400 `INVALID_ROLE_ORDER`.
- `POST /group-roles/:id/migrate {targetGroupRoleId}` → 200 `{moved, from:{id,name}, to:{id,name}}`.
- `POST /roles/grant {studentId|personId, groupRoleId, email?, password?, sendInvite?}` (aceita `role` legado → cargo de slug padrão)
  → 201 `{studentId, userId, roles: Badge[], roleKeys: string[], accessRole}`; novos erros 404 `GROUP_ROLE_NOT_FOUND`, 409
  `GROUP_ROLE_INACTIVE`, 400 `GROUP_ROLE_REQUIRED`. `POST /roles/revoke {studentId|personId, groupRoleId}` (ou `role`) → 200 idem.
- `GET /roles/suggestions` → `[{studentId, personId, name, photo, hasLogin, currentRoles: Badge[], currentRoleKeys, role: Badge,
  groupRoleId, accessRole, level, system, graduatedAt}]`.
- `GET|PUT /graduations/systems/:id/role-rules` — PUT `{rules:[{groupRoleId, minLevelOrder}]}` (até 20; aceita `role` legado) →
  `{systemId, rules:[{groupRoleId, groupRole: Badge & {active}, role, minLevelOrder, level|null}]}` (rank desc); 400
  `GROUP_ROLE_NOT_FOUND`, `DUPLICATE_ROLE_RULE`, `INVALID_LEVEL_ORDER`.
- `GET /teachers`: `roles: Badge[]` + `roleKeys` (slugs); filtro `?groupRoleId=` (o `?role=` continua).
- `GET /students`: `staffRoles: Badge[]` + `staffRoleKeys`; filtro `?groupRoleId=` (o `?role=` continua).
- Ficha: `enrollments[].roles: Badge[]` + `enrollments[].roleKeys`; `roles: [{organization, role (perfil), groupRole: Badge, grantedAt}]`.
- `GET /auth/me`: `roles: Badge[]` + `roleKeys`; `role` = papel de acesso.
- `GET /graduations/hierarchy`: **`staff: [{groupRole:{id, name, slug, color, icon, rank, accessRole}, people:[{id, displayName,
  photo, level, isMyTeacher}]}]`** (rank desc; cada pessoa só no seu cargo de maior rank); `masters`/`teachers` mantidos (derivados).
- **Mudança de forma:** `roles`/`staffRoles`/`enrollments[].roles` e `suggestions[].role` deixaram de ser strings (enum) e viraram
  objetos; consumidores antigos devem usar `roleKeys`/`staffRoleKeys`/`accessRole`.

### 13.5 Demo (idempotente)
Grupo demo ganha **Contramestre** (PROFESSOR, rank 35, #B91C1C, medal; regra corda ordem 8) e **Formado** (INSTRUTOR, rank 25,
#0E7490, star; regra ordem 7) — criados uma vez (não recria se o Mestre excluiu: confere a auditoria); `professor1` vira
Contramestre e `aluno3` ganha Formado (além de Instrutor). Regras dos padrão só se o sistema não tem nenhuma.