# GINGAPP — PLANO DE PROJETO (ARQUITETURA, BANCO, SEGURANÇA, API, FRONTEND, PWA, ROADMAP)

> Documento gerado a partir de [`projeto.txt`](projeto.txt) (visão de produto) + análise do padrão de admin do
> SaaS **GestorPrint** (`d:\Projetos\GitHub\GestorPrint`), replicando arquitetura, Docker e design do
> `admin.gestorprinte.com.br` conforme decisão do owner.
>
> Segue a ordem exigida pelo próprio `projeto.txt` (seção 93): Arquitetura → Banco → Segurança → API →
> Frontend → PWA → Roadmap. Nenhuma tela é criada antes deste documento ser validado.

---

## 0. Decisão de escopo (registrada)

O owner confirmou: replicar do GestorPrint **(a) o padrão de arquitetura e Docker** e **(b) o mesmo design
visual do SaaS Admin** — não só o padrão técnico de autorização. Isso significa que o GingApp nasce com
**4 aplicações de frontend + 1 backend**, no mesmo espírito do GestorPrint (que tem `app` + `admin` +
`landing` + backend único):

| GestorPrint | GingApp (equivalente) | Público | Prioridade |
|---|---|---|---|
| `backend/` (NestJS) | `backend/` (NestJS) | — | MVP |
| `app.gestorprinte.com.br` (ERP tenant, desktop-first) | `painel.gingapp.com.br` (Gestão do Grupo — Mestre/Professor, desktop-first) | Mestres/Professores | MVP |
| — (não existe no GestorPrint) | `app.gingapp.com.br` (PWA do Capoeirista, mobile-first) | Alunos/Responsáveis | MVP |
| `admin.gestorprinte.com.br` (SaaS Admin, equipe interna) | `admin.gingapp.com.br` (SaaS Admin, equipe interna GingApp) | Equipe GingApp | **MVP reduzido** (ver §7) |
| `gestorprinte.com.br` (landing) | `gingapp.com.br` (landing) | Público | Fase 2 |

**Nota sobre o design do SaaS Admin:** este documento define a arquitetura, guards, rotas e estrutura de
pastas do `admin.gingapp.com.br` espelhando 1:1 o `admin.gestorprinte.com.br` (mesmo layout com sidebar,
mesmos componentes-base: `SidebarLayout`, `AlertModal`, tabela de tenants/planos, Tailwind). A extração
fiel de tokens visuais (cores, tipografia, espaçamentos) do GestorPrint exige inspecionar o Tailwind
config e os componentes renderizados — isso fica como tarefa técnica pontual no início da Fase de
implementação do frontend admin (§9), não bloqueia este plano.

---

## 1. ARQUITETURA GERAL

```text
                                  GINGAPP
                                     │
        ┌───────────────┬───────────┼───────────────┬───────────────┐
        │               │           │               │               │
   painel.gingapp   app.gingapp  admin.gingapp  gingapp.com.br     API
   (Painel Grupo)    (PWA Aluno)  (SaaS Admin)    (Landing)     compartilhada
   Vue3+TS+Vite      Vue3+TS+Vite  Vue3+TS+Vite    Vue3+Vite         │
   desktop-first     mobile-first  desktop-first    estático         │
        │               │           │               │               │
        └───────────────┴───────────┴───────┬───────┴───────────────┘
                                              │
                                        BACKEND (NestJS)
                                  Clean-ish Architecture
                              (interface/http por domínio)
                                              │
                        ┌─────────────────────┼─────────────────────┐
                        │                     │                     │
                   PostgreSQL              Storage              Redis (Fase 2+)
                   (Prisma ORM)          (S3-compatible)      (cache/filas/sessão)
```

**Um único backend NestJS atende os 3 apps autenticados** (painel do grupo, PWA do aluno, admin da
plataforma) — não há microserviço separado para admin. A separação é feita por **discriminador de
usuário** (`userType`), guards e RBAC, exatamente como no GestorPrint. Isso evita duplicar
autenticação/infra e é o núcleo do padrão a replicar.

### 1.1 Stack (confirma a sugestão do `projeto.txt` §62-66, já compatível com o GestorPrint)

| Camada | Tecnologia |
|---|---|
| Frontend (3 SPAs) | Vue 3.5 + TypeScript + Vite 8 + Pinia + Tailwind 4 (ver §10.1 — `npm create vite@latest` entrega Vite 8 por padrão hoje, não 7 como originalmente sugerido) |
| Frontend Landing | Vue 3 + Vite (estático) ou Astro/HTML puro |
| PWA | Web App Manifest + Service Worker (Workbox) no `app.gingapp.com.br` |
| Backend | Node.js + NestJS + TypeScript |
| ORM | Prisma (schema único, `tenantId`/`organizationId` em todo model multi-tenant) |
| Banco | PostgreSQL 15+ |
| Cache/Filas | Redis — **não** no MVP; entra quando houver necessidade real (notificações em massa, filas de e-mail) |
| Storage | S3-compatível (Cloudflare R2 ou similar) — fotos, logos, certificados |
| Deploy | Docker por serviço (mesmo padrão do GestorPrint), orquestrado via `docker-compose` |

### 1.2 Infraestrutura / Docker (padrão GestorPrint)

Cada app é um serviço Docker independente, com build e deploy próprios — igual ao GestorPrint (4
serviços). Estrutura de repositório (monorepo, pastas irmãs):

```text
GingApp/
  backend/
    Dockerfile
    src/
    prisma/
  painel.gingapp.com.br/
    Dockerfile
    src/
  app.gingapp.com.br/
    Dockerfile
    src/
  admin.gingapp.com.br/
    Dockerfile
    src/
  gingapp.com.br/
    Dockerfile
    src/
  docker-compose.yml          # dev: sobe backend + postgres + os 3 SPAs em modo dev
  docker-compose.prod.yml      # prod: build estático servido por nginx + reverse proxy
  PLANO_PROJETO.md
  projeto.txt
```

Serviços no `docker-compose`: `postgres`, `backend`, `painel`, `app`, `admin`, `landing`,
`reverse-proxy` (nginx/traefik). `redis` entra como serviço opcional quando ativado (Fase 2+).

Ambientes (`projeto.txt` §97): `development`, `staging`, `production` — variáveis via `.env` por
serviço, nunca hardcoded.

---

## 2. BANCO DE DADOS

### 2.1 Estratégia de multi-tenancy

Isolamento **na camada de aplicação** (não RLS no Postgres, replicando a escolha do GestorPrint — mais
simples de auditar e testar no início): todo model pertencente a um grupo carrega `organizationId`, e
todo service filtra por ele. O teste de segurança mais importante do projeto (`projeto.txt` §95) é:

> Um usuário de uma organização nunca deve conseguir acessar dados privados de outra organização.

A entidade de tenant aqui é **`Organization`** (não `Tenant`, para casar com a linguagem de domínio do
`projeto.txt` — grupo de capoeira), mas o papel é idêntico ao `Tenant` do GestorPrint.

### 2.2 Discriminador de usuário (padrão GestorPrint aplicado ao GingApp)

Não existe tabela `AdminUser` separada. Um único model `User`, com:

```prisma
model User {
  id             Int       @id @default(autoincrement())
  email          String    @unique
  passwordHash   String
  name           String
  phone          String?
  photo          String?
  userType       String    @default("MEMBER")   // 'MEMBER' (mestre/professor/aluno/responsável) | 'PLATFORM' (equipe GingApp)
  isSuperAdmin   Boolean   @default(false)        // bypass total, igual isSuperAdmin do GestorPrint
  status         String    @default("ACTIVE")
  twoFactorSecret String?
  tokenValidAfter DateTime?                       // para "revoke sessions"
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  memberships    OrganizationUser[]
}
```

Usuários `PLATFORM` (equipe GingApp) não pertencem a nenhuma organização real — assim como o GestorPrint
usa um tenant fantasma `id=1`, aqui eles simplesmente não têm `OrganizationUser` nenhum, ou usam uma
organização "sistema" (`id=1`, `type=SYSTEM`) apenas para health-check/seed, decisão a confirmar na
modelagem detalhada do Prisma.

O papel dentro de um grupo específico (Mestre/Admin, Professor, Aluno, Responsável) vive em
`OrganizationUser`, não no `User` — porque uma pessoa pode, em tese, ser responsável de um aluno em um
grupo e capoeirista em outro:

```prisma
model OrganizationUser {
  id             Int      @id @default(autoincrement())
  organizationId Int
  userId         Int
  role           String   // MESTRE | PROFESSOR | ALUNO | RESPONSAVEL
  status         String   @default("ACTIVE")
  createdAt      DateTime @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id])
  user           User         @relation(fields: [userId], references: [id])

  @@unique([organizationId, userId])
}
```

### 2.3 Entidades principais (evolução do rascunho do `projeto.txt` §60-61)

```text
Plataforma (GestorPrint-style, novo em relação ao projeto.txt)
├── users                        (com userType, isSuperAdmin)
├── plans                        (catálogo de planos + feature flags)
├── subscriptions                (assinatura de cada organization)
├── subscription_events          (trilha de eventos de billing)
├── organization_feature_overrides (exceções por organização)
├── role_permissions             (matriz role × recurso × ação)
├── platform_settings            (config-as-data, chave/valor, com secrets mascarados)
├── platform_announcements       (avisos broadcast p/ organizations)
└── audit_logs                   (trilha de auditoria única, plataforma + grupo)

Organização (domínio do projeto.txt)
├── organizations                (grupo de capoeira — o "tenant")
├── organization_users           (papel do usuário dentro do grupo)
├── units                        (matriz/filial — projeto.txt §16)
├── user_unit_access             (professor autorizado em múltiplas unidades)
├── students
├── student_guardians
├── classes (turmas)
├── class_students
├── lessons (aulas)
├── attendance (frequência)
├── graduation_systems           (configurável por grupo — §26)
├── graduation_levels
├── student_graduations
├── financial_records
├── events
├── event_participants
├── announcements (comunicados internos, com escopo — §47)
└── notifications

Comunidade (pública/compartilhável)
├── states
├── cities
├── communities                  (comunidade estadual)
├── rodas
├── roda_participants
├── public_profiles
└── certificates (Fase 2)
```

### 2.4 Índices e relacionamentos críticos

- Todo model de "Organização" tem índice composto `(organizationId, status)` para as queries mais
  comuns (listagem de alunos ativos, turmas ativas etc.).
- `attendance` indexado por `(lessonId, studentId)` único, e por `(studentId, createdAt)` para cálculo
  de percentual de frequência.
- `student_graduations` indexado por `(studentId, createdAt)` para montar o histórico/jornada.
- `rodas`/`events` indexados por `(stateId, date)` e `(cityId, date)` para o calendário da comunidade
  (`projeto.txt` §42).
- `audit_logs` indexado por `(organizationId, createdAt)` e `(userId, createdAt)`.
- Nenhum dado privado (`students`, `financial_records`, `student_guardians`) tem FK direta para tabelas
  de comunidade — a ligação com conteúdo público passa sempre por `public_profiles`, que é opt-in
  (`projeto.txt` §17 e §53).

---

## 3. SEGURANÇA E AUTORIZAÇÃO (padrão GestorPrint aplicado)

### 3.1 Autenticação — dois logins JWT distintos

```text
POST /api/auth/login            → userType = 'MEMBER'   (mestre/professor/aluno/responsável)
POST /api/auth/platform-login   → userType = 'PLATFORM'  (equipe interna GingApp)
```

- Mesma estratégia JWT (`@nestjs/jwt` + `passport-jwt`), `JwtAuthGuard` global com opt-out via
  `@Public()`.
- Erro de credenciais **genérico** nos dois logins (não revela se o e-mail existe nem qual tipo de
  conta é) — mesmo comportamento do GestorPrint.
- Rate limiting (`@nestjs/throttler`) em login e reset de senha.
- Token em `localStorage`, com chaves diferentes por app (`gp_token`-style): `mb_token` no
  painel/PWA do grupo, `sa_token` no admin — evita colisão de sessão se os SPAs forem abertos no
  mesmo navegador.
- 2FA (TOTP) para contas `PLATFORM`: **Fase 2**, não MVP — evita atraso na entrega inicial, mas a
  estrutura de campo (`twoFactorSecret`) já nasce no schema para não exigir migração depois.
- Allowlist de IP para `platform-login` (`PLATFORM_ALLOWED_IPS`): opcional, ativável por variável de
  ambiente — mesmo mecanismo do GestorPrint, como camada extra de defesa.

### 3.2 Autorização — guards em camadas

1. **`PlatformOnlyGuard`** — só permite acesso se `userType === 'PLATFORM'` (ou `isSuperAdmin`).
   Aplicado a tudo que é exclusivo do `admin.gingapp.com.br`: `platform-users`, `plans`,
   `subscriptions`, `platform-settings`, `platform-announcements`, `audit/platform`.
2. **RBAC por recurso** (`RolePermission` + `@CanAccess(resource, action)` + `CanAccessGuard`) — matriz
   `role × resource → {view, create, edit, delete}`, cobrindo os papéis do grupo (`MESTRE`,
   `PROFESSOR`, `ALUNO`, `RESPONSAVEL`). No MVP a matriz pode nascer **como constante versionada no
   código** (seed fixo no banco), e só ganha tela de edição própria quando houver necessidade real de
   customização por grupo — evita construir UI de RBAC configurável antes da hora.
3. **Bypass total** para `isSuperAdmin` (igual GestorPrint).
4. Isolamento por organização: todo `service` do backend recebe o `organizationId` do usuário
   autenticado via `@CurrentOrganization()` (decorator análogo ao `@CurrentTenant()` do GestorPrint) e
   filtra todas as queries por ele — nunca confiar em `organizationId` vindo do corpo da requisição para
   dados sensíveis.
5. Isolamento por unidade (matriz/filial): professor só vê alunos/turmas das unidades em que está
   autorizado (`user_unit_access`); mestre/admin do grupo vê tudo (`projeto.txt` §59).

### 3.3 Auditoria obrigatória

Toda mutação sensível (criar/editar/remover usuário da plataforma, mudar permissão, resetar senha de
outro usuário, mudar plano/feature override, publicar comunicado em escopo amplo) grava em `audit_logs`
— mesmo padrão do `AuditService.logAction()` do GestorPrint.

### 3.4 Proteção de dados de menores (LGPD)

Muitos alunos de capoeira são crianças/adolescentes — item explícito do `projeto.txt` §58:

- `student_guardians` obrigatório para alunos menores de idade (campo `birthDate` determina).
- `public_profiles` de menores exige consentimento explícito do responsável (`consentByGuardianId`),
  nunca opt-in automático.
- Fotos de menores em conteúdo comunitário (rodas/eventos) seguem a mesma regra de consentimento.

---

## 4. API

Organizada por domínio, prefixo `/api`, seguindo a mesma convenção do GestorPrint: módulos exclusivos
da plataforma usam nome explícito (`platform-*`), nunca reaproveitam nomes genéricos do domínio de
grupo.

```text
/api/auth                      login, platform-login, refresh, 2fa (fase 2)
/api/users                     usuário autenticado (perfil próprio)
/api/organizations             grupo — CRUD (mestre/admin do próprio grupo + PLATFORM p/ todas)
/api/units                     matriz/filiais
/api/students
/api/teachers
/api/classes
/api/lessons
/api/attendance
/api/graduations
/api/finance
/api/events
/api/rodas
/api/community                 comunidade estadual/nacional (dados públicos)
/api/announcements             comunicados internos do grupo
/api/notifications

# Exclusivos do SaaS Admin (PlatformOnlyGuard)
/api/plans
/api/subscriptions             + /api/subscriptions/webhook (público, autenticado por token)
/api/platform-users             equipe interna GingApp
/api/platform-settings          config-as-data
/api/platform-announcements     avisos broadcast p/ organizations
/api/audit                      + /api/audit/platform (cross-organization)

/api/health
```

---

## 5. FRONTEND — 4 aplicações

### 5.1 `painel.gingapp.com.br` — Gestão do Grupo (Mestre/Professor)

Desktop-first. Rotas (`projeto.txt` §68, mantidas):

```text
/dashboard /alunos /professores /turmas /aulas /frequencia /graduacoes
/financeiro /eventos /rodas /comunicados /relatorios /unidades /configuracoes
```

### 5.2 `app.gingapp.com.br` — PWA do Capoeirista (Aluno/Responsável)

Mobile-first. Rotas (`projeto.txt` §69):

```text
/app /app/jornada /app/aulas /app/frequencia /app/financeiro
/app/eventos /app/rodas /app/comunidade /app/notificacoes /app/perfil
```

### 5.3 `admin.gingapp.com.br` — SaaS Admin (equipe interna GingApp)

Estrutura e design espelhando `admin.gestorprinte.com.br` 1:1:

```text
/login
/dashboard                     KPIs de plataforma (grupos ativos, MRR quando houver billing)
/organizations                 lista + CRUD (equivalente a /tenants do GestorPrint)
/organizations/:id             detalhe: uso, atividade, unidades, plano, feature overrides
/plans                         Fase 2 (MVP tem plano único, sem tela de CRUD)
/team                          CRUD da equipe interna GingApp (platform-users)
/audit                         trilha de auditoria cross-organization
/settings                      config global (super admin only)
/announcements                 avisos in-app para organizations
```

Guard de rota simples no frontend (token presente → libera; ausente → `/login`) — autorização real
sempre validada no backend, mesmo padrão do GestorPrint.

Componentes-base a replicar visualmente do admin do GestorPrint: `SidebarLayout`, `AlertModal`, tabela
padrão de listagem (organizations no lugar de tenants), cards de KPI do dashboard. Extração exata dos
tokens de design (paleta, tipografia) do Tailwind config do GestorPrint é tarefa da primeira sprint de
frontend do admin.

### 5.4 `gingapp.com.br` — Landing

Estático, fora do MVP funcional (pode nascer como página única simples na Fase 1, evoluir na Fase 2).

### 5.5 Design system compartilhado

Componentes-base comuns aos 3 apps autenticados (`projeto.txt` §72): `Button`, `Input`, `Select`,
`Modal`, `Drawer`, `Card`, `Badge`, `Avatar`, `Tabs`, `Table`, `Calendar`, `Toast`, `Alert`, `Dropdown`,
`BottomNavigation` (mobile). Recomenda-se extrair como pacote interno (`packages/ui` ou similar) para
não duplicar entre `painel`, `app` e `admin` — decisão técnica a confirmar quando o segundo app
começar a repetir componentes do primeiro.

### 5.6 Direção visual (registrada pelo owner)

Exigência geral: **UI/UX minimalista e bem cuidada nos 4 frontends** — nunca aparência de "sistema
corporativo genérico" (alinhado ao `projeto.txt` §73: capoeira, cultura, movimento, energia).

**`app.gingapp.com.br` (PWA do Capoeirista) — tema escuro dedicado**, inspirado pela referência visual
compartilhada pelo owner (app de feed mobile dark):

- Fundo em tom escuro roxo/azul-marinho profundo (não preto puro) como base do tema.
- Cards com cantos bem arredondados (16–20px), sombras suaves, hierarquia por espaçamento generoso —
  não por linhas divisórias.
- Carrossel de avatares no topo da Home (aplicável a "próximas aulas"/turmas do aluno, no espírito das
  "stories" da referência).
- Uma cor de destaque vibrante (ex.: rosa/magenta) para CTAs, badges e ícones ativos — o resto da
  paleta neutro/escuro.
- Bottom navigation com ícone + label (mapeia o menu mobile do `projeto.txt` §33: Início, Jornada,
  Aulas, Comunidade, Perfil).
- Conteúdo visual em primeiro plano (fotos de rodas/eventos) em cards grandes, como no feed de
  referência — reforça o pilar "Comunidade" do produto.
- Tipografia com pouco contraste de peso, priorizando legibilidade sobre fundo escuro.

**`painel.gingapp.com.br`** (gestão do grupo) e **`admin.gingapp.com.br`** (SaaS Admin): mesmo padrão
de minimalismo e acabamento visual, mas desktop-first e orientado a dados — a paleta/tema exato do
admin segue o design do `admin.gestorprinte.com.br` (decisão já registrada em §0), a extrair na
primeira sprint de frontend do admin (§9). Dark mode nesses dois pode entrar como toggle futuro, não é
requisito de MVP.

**`gingapp.com.br`** (landing): minimalista, alinhado à identidade de marca da capoeira — não precisa
ser dark por padrão, mas deve manter a mesma qualidade de acabamento.

Este é um direcionamento de estilo, não um design system finalizado — os tokens exatos (paleta em hex,
escala tipográfica, grid de espaçamento) serão definidos na primeira sprint de UI de cada app,
usando esta seção como briefing.

---

## 6. PWA (`app.gingapp.com.br`)

- Web App Manifest + ícones + splash + theme color.
- Service Worker com cache estratégico (Workbox): shell da aplicação em cache, dados sensíveis
  (financeiro, cadastro) sempre online — nunca cacheados publicamente (`projeto.txt` §70-71).
- Instalação (`beforeinstallprompt` no Android, instrução manual no iOS/Safari).
- Notificações web push quando suportado; arquitetura de notificação desacoplada do frontend — backend
  decide quem recebe, por quê, alcance e tipo (`projeto.txt` §48-49).
- Compatibilidade iOS: sem depender de APIs exclusivas do Android.
- Arquitetura preparada para futura camada Capacitor (não implementar agora).

---

## 7. ROADMAP

### FASE 1 — MVP

**Núcleo (arquitetura + gestão + comunidade, `projeto.txt` §78):**
1. Arquitetura base + Docker (backend + 3 apps + postgres).
2. Modelagem de banco (Prisma) + migrations.
3. Backend base + autenticação dupla (`login` / `platform-login`).
4. Multi-tenant (`organizationId` em todo model) + autorização (RBAC básico + `PlatformOnlyGuard`).
5. Organizations, Units (matriz/filiais).
6. Users, Students, Teachers, Classes, Lessons, Attendance, Graduations.
7. Dashboard do grupo, Financeiro básico.
8. Events, Rodas, Announcements, Notifications, Comunidade estadual.
9. PWA do aluno.

**SaaS Admin mínimo (necessário só para operar o onboarding dos grupos-piloto — sem billing):**
10. `platform-login`, dashboard de plataforma, `organizations` (CRUD administrativo), `platform-users`
    (equipe interna), `audit` básico, `platform-settings` mínimo.
11. Plano único fixo (sem `plans`/`subscriptions` dinâmicos ainda — alinhado ao modelo comercial do
    `projeto.txt` §5).

### FASE 2

- PWA completo, calendário estadual, inscrições, confirmação de presença, certificados, QR Code,
  relatórios avançados, notificações segmentadas, perfil do capoeirista, passaporte.
- SaaS Admin completo: `plans` dinâmicos, `subscriptions`/billing (gateway de pagamento), feature
  overrides por organização, impersonation, 2FA para equipe `PLATFORM`, `platform-announcements`,
  central de treinamento (padrão GestorPrint).
- Landing page completa.

### FASE 3

- Pagamentos online (aluno/grupo), WhatsApp, loja, instrumentos/patrimônio, marketplace de eventos,
  perfil público, validação de certificados, estatísticas nacionais.

### Ordem técnica de desenvolvimento (consolidada)

```text
1. Arquitetura + Docker
2. Modelagem do banco
3. Backend base
4. Autenticação (member + platform)
5. Multi-tenant
6. Autorização (RBAC + PlatformOnlyGuard)
7. Organizations / Matriz / Filiais
8. SaaS Admin mínimo (onboarding)
9. Usuários, Alunos, Professores
10. Turmas, Aulas, Frequência
11. Graduações
12. Dashboard do grupo
13. Financeiro
14. Eventos, Rodas, Comunidade
15. PWA
16. Notificações
17. Testes
18. Piloto com grupos reais
19. Feedback → Melhorias
```

---

## 8. TESTES E SEGURANÇA (checklist mínimo)

- Backend: autenticação (ambos os logins), autorização (RBAC + `PlatformOnlyGuard`), isolamento
  multi-tenant, CRUD dos módulos MVP.
- **Teste crítico obrigatório**: usuário de uma organização nunca acessa dados privados de outra
  organização — nem por manipulação de `organizationId` no payload.
- Frontend: fluxos principais dos 3 apps, formulários, permissões visuais coerentes com o backend,
  responsividade (desktop nos 2 admins, mobile no PWA).
- PWA: instalação, manifest, service worker, cache, navegação mobile.

---

## 9. PRÓXIMOS PASSOS IMEDIATOS

Ver §10.1 para o que já está feito. Pendências ficam numeradas em §10.1.3 — não repetir aqui.

---

## 10. LOG DE EXECUÇÃO

### 10.1 Fase 1 — Fundação (scaffold inicial do monorepo)

**Data:** 2026-09-16 · **Status:** ✅ concluído (base validada empiricamente, não só compilada)

**Estratégia de execução:** 3 subagentes em paralelo (Sonnet — complexidade média, conforme matriz de
balanceamento), cada um dono de uma parte sem sobreposição de arquivos; o loop principal (Sonnet)
coordenou, verificou com uma via independente (psql direto no container, não só a saída do Prisma CLI)
e fez a integração final (Docker Compose, resolução de conflito de porta, commit).

#### 10.1.1 O que foi feito e o que deu certo

**Backend (`backend/`)** — NestJS + Prisma:
- Schema Prisma com **34 models + 8 enums**, cobrindo as 3 camadas do plano (Plataforma/Organização/
  Comunidade) — validado com `npx prisma format`/`validate` pelo agente, e depois **validado de verdade**
  pelo orquestrador: `npx prisma migrate dev --name init` rodou contra um Postgres real
  (`docker-compose`, container `gingapp-postgres-1`, migration `20260916200915_init`), e a existência
  das 34 tabelas + `_prisma_migrations` foi confirmada por uma **segunda via independente**
  (`docker exec gingapp-postgres-1 psql -U gingapp -d gingapp -c "\dt"` → 35 linhas), não só pela
  saída do próprio comando que as criou.
- Auth dupla implementada de verdade (não só esqueleto): `POST /api/auth/login` (MEMBER) e
  `POST /api/auth/platform-login` (PLATFORM), bcrypt, `JwtAuthGuard` global + `@Public()`,
  `PlatformOnlyGuard`, `@CurrentUser()`/`@CurrentOrganization()`, rate limiting, allowlist de IP
  opcional, revogação de sessão via `tokenValidAfter`.
- 14 módulos-esqueleto (organizations, units, students, teachers, classes, lessons, attendance,
  graduations, finance, events, rodas, announcements, notifications, health), cada um com pelo menos
  um endpoint GET real via Prisma.
- **Smoke test real do orquestrador** (não só `npm run build`): `node dist/main.js` de pé contra o
  Postgres do docker-compose → `GET /api/health` retornou `{"status":"ok","database":"up"}` e
  `GET /api/organizations` sem token retornou `401` corretamente. Processo encerrado após o teste.

**`painel.gingapp.com.br` e `admin.gingapp.com.br`** — Vue 3 + TS + Vite + Pinia + Tailwind:
- Todas as rotas pedidas roteadas de verdade, `SidebarLayout` com item ativo, guard de sessão
  (`mb_token`/`sa_token`), `LoginView` funcional (mock). Builds limpos validados **ao vivo no browser**
  pelo próprio agente (login mock → dashboard → sidebar), não só por `npm run build`.

**`app.gingapp.com.br`** — PWA do aluno, tema dark:
- Paleta aplicada via tokens Tailwind (`--color-bg #1a1625`, `--color-accent #ec4899` etc., ver tabela
  completa que o agente reportou), bottom nav com 5 itens, todas as 11 rotas roteadas.
- `vite-plugin-pwa` configurado com estratégia de cache diferenciada: `NetworkOnly` para `/api/finance/*`
  (nunca cacheado — exigência de segurança do §6), `NetworkFirst` para demais `/api/*`,
  `StaleWhileRevalidate` para imagens. Manifest e Service Worker gerados e conferidos no build de
  produção (`dist/manifest.webmanifest`, `dist/sw.js`).

**Integração (orquestrador):**
- `docker-compose.yml` de dev criado: `postgres` + `backend` + `painel` + `app` + `admin`, todos com
  hot-reload via bind mount.
- `.gitignore` raiz criado (não existia) cobrindo `node_modules`, `dist`, `.env`, e
  `.claude/settings.local.json` (config local de sessão, não deve ir para o repo compartilhado).
- Commit inicial: `ad09520` — "feat: fundacao do monorepo GingApp" (188 arquivos, sem `.env`/
  `node_modules`/segredos — conferido via `git status --short` antes do commit).

#### 10.1.2 O que NÃO deu certo de primeira e a solução

1. **Conflito de porta do Postgres.** Tentativa 1: mapear o Postgres do GingApp em `55432:5432` →
   falhou (`port is already allocated`). Investigação (`docker ps -a`) revelou que esta máquina já
   roda **múltiplos outros projetos em Docker**: `gestorprinte-pg` (Postgres em 55432),
   `gestorprint-db-1` (Postgres em 5432), `idinercombr-db-1` (Postgres em 5433), mais Redis em
   6379/6380. **Solução:** porta `15432` (confirmada livre via `netstat`), atualizada em
   `docker-compose.yml`, `backend/.env` e `backend/.env.example`, e revalidada — subiu e ficou
   `healthy`.
2. **Portas de dev dos 3 frontends colidiam com o GestorPrint**, que já roda nativamente (fora de
   Docker) em `5173`/`5174` nesta máquina (achado pelo agente do painel/admin, confirmado por
   `netstat`). **Solução:** portas do GingApp deslocadas para uma faixa própria — `4173` (app),
   `4174` (painel), `4175` (admin) — editadas nos 3 `vite.config.ts`.
3. **Vite 8 em vez de Vite 7** (pedido original, §62 do plano/instrução aos agentes): `npm create
   vite@latest` hoje entrega `^8.3.0` por padrão. Os 3 frontends ficaram **consistentes entre si**
   (todos em Vite 8), então não há divergência real de versão dentro do monorepo — só uma divergência
   em relação ao que o plano originalmente sugeria. Documento atualizado (§1.1) para refletir a
   realidade em vez de manter um número desatualizado.
4. **NestJS 12 gerado pelo `@nestjs/cli` atual vem em ESM puro** (exigiria `.js` em todo import
   relativo, TS 6, toolchain diferente). O agente do backend reconfigurou para CommonJS estável para
   reduzir risco de atrito com bcrypt/passport-jwt/Prisma — decisão pragmática, documentada, não
   escondida.
5. **Backend não conectava ao Postgres durante o scaffold** (credenciais placeholder `postgres/postgres`
   não autenticavam contra um Postgres pré-existente do sistema). O agente não "mascarou" isso como
   sucesso — reportou explicitamente que a migration real não tinha rodado. Resolvido na integração
   (item 10.1.1) com o Postgres dedicado do GingApp em `15432`.

#### 10.1.3 Pendências (numeradas — para retomar sem redescobrir)

1. **RBAC granular (`RolePermission` + `@CanAccess`) não implementado** — schema já tem a tabela, guard
   ainda não. Próximo módulo a implementar antes de dar acesso real a Professor/Aluno/Responsável.
2. **App `gingapp.com.br` (landing) ainda não foi criado** — adiado de propósito (Fase 2 no roadmap
   original, §7), mantém a pasta ausente do monorepo por enquanto.
3. **Extração dos tokens visuais reais do `admin.gestorprinte.com.br`** (paleta/tipografia exatas)
   continua pendente — `painel.gingapp.com.br` e `admin.gingapp.com.br` estão com paleta neutra
   provisória (decisão explícita do agente para não inventar uma marca).
4. **Dockerfiles de produção (multi-stage → nginx) dos 4 apps não foram testados** — só o modo dev
   (`docker-compose.yml`, via `node:22-alpine` + `npm run dev`) foi validado. `docker-compose.prod.yml`
   ainda não existe.
5. **`docker-compose.yml` de dev reinstala `npm install` a cada `docker compose up`** (sem lockfile
   cacheado em imagem própria) — aceitável agora, mas lento; otimizar com Dockerfile.dev dedicado se
   incomodar no dia a dia.
6. **Nenhum teste automatizado ainda** (§8 do plano) — não é bloqueador da fundação, mas é a próxima
   frente depois do RBAC.
7. **Seed de dados de desenvolvimento** (organização de exemplo, usuário PLATFORM inicial para logar no
   admin) não existe — sem ele, não dá para logar em nenhum dos 3 apps ainda, mesmo com tudo de pé.
8. **Ícones do PWA são placeholders gerados por script** (círculo magenta), não arte de marca real.

**Próximo passo recomendado:** item 7 (seed) é o que desbloqueia testar o login de ponta a ponta nos 3
apps contra o backend real — provavelmente o próximo passo antes de seguir para RBAC ou para os módulos
de negócio (alunos, turmas, aulas) da ordem técnica em §7.

### 10.2 Fase 1 — Seed de desenvolvimento (resolve pendência 7 de §10.1.3)

**Data:** 2026-09-16 · **Status:** ✅ concluído e validado ponta a ponta contra o backend real

- Criado `backend/prisma/seed.ts` (idempotente, `npx prisma db seed`), populando: 1 usuário PLATFORM
  (`owner@gingapp.com.br`, super admin), 1 `Plan` único, 1 `Organization` piloto (`ginga-brasil`) +
  `Subscription` ativa, 1 `Unit` (matriz), os 4 papéis MEMBER (`mestre`/`professor`/`aluno`/
  `responsavel@gingabrasil.com.br`), 1 `Student` (menor de idade, exercitando a regra de §3.4) + seu
  `StudentGuardian`, 1 `GraduationSystem` com 2 níveis + 1 `StudentGraduation`, 1 `Class` com o aluno
  matriculado, a matriz `RolePermission` completa (4 papéis × 9 recursos, valores alinhados aos perfis
  de `projeto.txt` §18) e um pedaço de comunidade (`State` GO, `City` Goiânia, `Community`, 1 `Roda`
  pública). Senha única de dev: `Dev@12345` (fixture documentado, não é segredo real).
- Adicionado `ts-node` como devDependency + bloco `"prisma": {"seed": ...}` no `package.json`.
- **Validação empírica end-to-end** (não só "seed rodou sem erro"): com o backend real de pé contra o
  Postgres seedado, testei via `curl`:
  1. `POST /auth/platform-login` com `owner@gingapp.com.br` → `200` + token válido.
  2. `POST /auth/login` com `mestre@gingabrasil.com.br` → `200` + token com `organizationId`/`role`
     corretos.
  3. `POST /auth/login` com senha errada → `401`.
  4. `POST /auth/platform-login` com um usuário MEMBER (aluno) → `401` (não vaza que o e-mail existe).
  5. `GET /organizations` sem token → `401`.
  6. `GET /organizations` com token de MEMBER válido → `200`.
  7. `GET /rodas` (rota pública, sem token) → `200` com a roda seedada.
  - Verificação independente extra: consulta direta via `psql` confirmou os 5 usuários, a contagem de
    `OrganizationUser` por papel (1 cada) e a matriz `RolePermission` para o recurso `students`.
- **Achado corrigido em trânsito:** `npm install` do `ts-node` revelou 6 vulnerabilidades (5 high, 1
  critical) via `npm audit` — todas em dependências de build/dev-time (`deepmerge-ts` usado pelo CLI do
  Prisma; `node-tar`/`@mapbox/node-pre-gyp` usados só na compilação nativa do `bcrypt`), não em
  superfície de runtime da aplicação. **Não apliquei `npm audit fix --force`** porque isso trocaria o
  `bcrypt` para a v6 (breaking change) sem eu ter testado compatibilidade — fica como pendência 9
  abaixo, para tratar deliberadamente, não às cegas.

**Pendências atualizadas (substituindo a lista de §10.1.3):**

1. ~~RBAC granular~~ — **resolvido em §10.3**.
2. App `gingapp.com.br` (landing) ainda não criado — adiado para Fase 2 por decisão original.
3. Extração dos tokens visuais reais do `admin.gestorprinte.com.br` continua pendente.
4. Dockerfiles de produção (multi-stage → nginx) dos 4 apps não testados — só o modo dev foi validado.
5. `docker-compose.yml` de dev reinstala `npm install` a cada `up` — aceitável por ora.
6. Nenhum teste automatizado ainda.
7. ~~Seed de dados de desenvolvimento~~ — **resolvido em §10.2**.
8. Ícones do PWA são placeholders gerados por script, não arte de marca real.
9. **Novo:** `npm audit` no backend acusa 1 vulnerabilidade critical + 5 high, todas em dependências de
   build (Prisma CLI / compilação nativa do bcrypt) — avaliar `bcrypt@6` (breaking change) numa sessão
   dedicada, com teste de hash/compare antes de trocar.
10. **Novo:** login MEMBER/PLATFORM só testado via `curl` direto no backend — ainda não testado a
    partir dos 3 frontends reais (que hoje têm `login()` mockado nas stores Pinia, não ligado à API).

### 10.3 Fase 1 — RBAC granular (resolve pendência 1)

**Data:** 2026-09-16 · **Status:** ✅ concluído e validado empiricamente (caminho de permissão E de
bloqueio, não só o caminho feliz)

- Criados `backend/src/shared/decorators/can-access.decorator.ts` (`@CanAccess(resource, action)`,
  `action` ∈ `view|create|edit|delete`) e `backend/src/shared/guards/can-access.guard.ts`
  (`CanAccessGuard`), registrado como `APP_GUARD` global em `app.module.ts`, **depois** do
  `JwtAuthGuard` na ordem de providers. Rotas sem `@CanAccess()` passam direto (mesmo padrão de
  opt-in do `@Public()`); `PLATFORM`/`isSuperAdmin` tem bypass total; para `MEMBER`, consulta
  `RolePermission` pelo `role` do token.
- Aplicado `@CanAccess('<resource>', 'view')` nos 8 controllers organizacionais que já tinham
  endpoint real: `students`, `classes`, `lessons`, `attendance`, `graduations`, `finance`, `events`,
  `announcements` (o 9º recurso da matriz seedada, `rodas`, é rota pública e não passa por RBAC).
- **Validação empírica dos dois caminhos** (não só o caminho feliz):
  1. `GET /students` com token MESTRE, ALUNO e `/finance` com RESPONSAVEL (todos `canView=true` no
     seed) → `200` nos três.
  2. **Prova real do bloqueio**: inverti `RolePermission.canView` para `false` (RESPONSAVEL ×
     finance) **direto no Postgres via `psql`** (não no código) → `GET /finance` com o mesmo token
     RESPONSAVEL passou a `403` com a mensagem exata do guard (`"Papel RESPONSAVEL não tem permissão
     de "view" em "finance""`) → confirmei que `GET /students`, com o mesmo usuário, continuou `200`
     (prova de que o bloqueio é por recurso, não global) → restaurei a permissão e confirmei `200`
     de novo no `/finance`.
  3. Token PLATFORM contra rota org-scoped (`/finance`): `CanAccessGuard` corretamente **não**
     bloqueou (bypass funcionou — não apareceu o erro do RBAC), mas a requisição falhou depois, em
     `@CurrentOrganization()`, com `401 "Token sem contexto de organização"` — comportamento esperado
     hoje (PLATFORM não tem organização própria; impersonation ainda não existe, é pendência de
     Fase 2 no roadmap original).

**Pendências novas desta etapa:**

11. `@CanAccess` só cobre a ação `view` até agora — as demais ações (`create`/`edit`/`edit`/`delete`)
    ficarão pendentes até os módulos ganharem endpoints de mutação (fora do escopo da fundação).
12. `organizations`, `units` e `teachers` ainda não têm `@CanAccess` — não fazem parte da matriz
    seedada em §10.2; decidir se precisam de RBAC granular próprio ou se continuam "qualquer membro
    autenticado da organização acessa" por enquanto.

### 10.4 Fase 1 — Ligação real dos 3 frontends à API (resolve pendência 10)

**Data:** 2026-09-16 · **Status:** ✅ concluído e validado na UI real (não só build)

- `stores/auth.ts` dos 3 apps trocado de mock (`setTimeout` + token fake) para chamada real:
  `painel` e `app` → `POST /auth/login`; `admin` → `POST /auth/platform-login`. Tipos de `AuthUser`
  atualizados para o formato real de resposta do backend (`userType`, `isSuperAdmin`,
  `organizationId`, `organizationSlug`, `role`).
- `LoginView.vue` dos 3 apps ganhou uma linha de dica com as credenciais do seed (dev-only).
- **Achado corrigido em trânsito:** um processo `vite dev` órfão de uma sessão anterior (deste mesmo
  projeto, iniciado 17:15 local) estava preso na porta `4173`, fazendo o `app.gingapp.com.br` subir
  na `4176` por acidente (fallback automático do Vite). Processo identificado
  (`Get-CimInstance Win32_Process`, confirmado como o próprio `vite.js` deste repo) e encerrado; app
  voltou a subir na porta correta.
- **Validação real na UI** (Postgres + backend + os 3 `npm run dev` de pé, testado pelo browser, não
  só `curl`): login preenchido e submetido de verdade em `painel` (mestre), `admin` (owner/PLATFORM)
  e `app` (aluno) — os três redirecionaram para a rota pós-login certa e o `localStorage` ficou com
  um JWT real (`eyJhbGci...`, não mais `mock-...`) e os dados reais do usuário vindos do backend.
  Screenshot do Home do PWA confirmou visualmente o tema dark renderizando com os dados reais ("Olá,
  Ana", turmas da semana, bottom nav).
- Todos os processos de teste (backend, 3 dev servers, container do Postgres) foram encerrados ao
  final — nada ficou rodando em background.

**Pendências novas desta etapa:**

13. `HomeView.vue` do `app.gingapp.com.br` mostra o **slug** da organização (`ginga-brasil`) como
    nome do grupo, não um nome de exibição bonito (`Grupo Ginga Brasil`) — o backend hoje só retorna
    `organizationSlug` no login; resolver quando existir um endpoint `GET /organizations/:id` ou
    quando o payload do login passar a incluir o nome também.
14. Login com e-mail pertencente a múltiplas organizações não tem seletor de UI (`organizationSlug`
    manual) — não é um caso real ainda (seed só tem 1 org por usuário), mas fica pendente para
    quando houver.

### 10.5 Fase 1 — Módulo Alunos: CRUD completo, fatia vertical de referência

**Data:** 2026-09-16 · **Status:** ✅ concluído e validado empiricamente (UI real + API real,
caminho feliz e casos de borda)

Primeiro módulo de negócio implementado de ponta a ponta (backend + frontend), escolhido pelo owner
como fatia vertical de referência antes de replicar o padrão para turmas/aulas/frequência/graduações/
professores.

- **Backend**: `CreateStudentDto`/`UpdateStudentDto` (class-validator), `StudentsService` com
  `findAll`/`findOne`/`create`/`update`/`remove`, `StudentsController` com as 5 rotas
  (`GET /students`, `GET /students/:id`, `POST /students`, `PATCH /students/:id`,
  `DELETE /students/:id`), cada uma com `@CanAccess('students', <action>)` correspondente.
  Decisão de modelagem: `DELETE` **nunca apaga o registro** — marca `status = INACTIVE` (o histórico
  não deve ser apagado quando o aluno fica inativo, `projeto.txt` §20). `unitId` recebido no corpo é
  sempre validado contra `organizationId` do token antes de gravar (nunca confiar em FK vinda do
  cliente).
- **Frontend**: `AlunosView.vue` do `painel.gingapp.com.br` deixou de ser placeholder — lista real
  (`GET /students`), modal de criar/editar com todos os campos, select de unidade populado por
  `GET /units`, badge de status, ação "Inativar" com confirmação.
- **Validação empírica completa, não só build**:
  1. **UI real no browser**: logado como mestre, criei um aluno pela tela ("Lucas Ferreira") →
     apareceu na lista com a unidade certa → confirmado direto no Postgres via `psql`. Editei o nome
     pela tela ("Lucas Ferreira Silva") → refletido na lista e no banco.
  2. **Achado de tooling, não de código**: o botão "Inativar" usa `confirm()` nativo do navegador, que
     a automação do browser não consegue confirmar (dialog bloqueia/auto-dispensa) — `read_network_requests`
     confirmou que nenhum `DELETE` foi disparado nesse clique. Não é um bug da feature.
  3. Para não deixar essa ponta sem prova real, testei o `DELETE /students/:id` direto via `curl` com
     token de mestre: `200`, aluno passou para `status: INACTIVE` no banco (confirmado via `psql`),
     registro **preservado** (não apagado).
  4. RBAC no novo endpoint: `DELETE` com token de ALUNO (que não tem `canDelete` em `students`) → `403`.
  5. Validação cross-tenant: `POST /students` com `unitId` inexistente → `400 "Unidade inválida para
     esta organização"`. `GET /students/999` (não existe) → `404`.
- Todos os processos de teste encerrados ao final (backend, painel dev, Postgres).

**Pendências novas desta etapa:**

15. O botão "Inativar" da UI não foi validado por clique automatizado (limitação do `confirm()`
    nativo) — validado pela API diretamente. Considerar trocar por um modal de confirmação próprio
    (em vez de `window.confirm`) numa próxima iteração, o que também melhoraria a UX visual (o
    `confirm()` nativo do navegador destoa do design system escuro/claro do produto).
16. O padrão de `StudentsService`/`StudentsController`/`AlunosView.vue` desta seção é o molde a
    replicar para `teachers`, `classes`, `lessons`, `attendance`, `graduations` nas próximas rodadas.

### 10.6 Fase 1 — Réplica do padrão: Professores, Turmas, Aulas, Frequência, Graduações

**Data:** 2026-09-16 · **Status:** ✅ concluído e validado empiricamente (API real + UI real nos
pontos mais novos, RBAC confirmado em todos)

Estratégia de execução: **Professores** foi feito pelo orquestrador principal (não seguia o padrão
CRUD genérico — não existe model `Teacher`, é papel dentro de `OrganizationUser`, e exigiu estender
o seed de RBAC). **Turmas, Aulas, Frequência e Graduações** foram delegados a 4 subagentes Sonnet em
paralelo (arquivos sem sobreposição), cada um com o `StudentsService`/`Controller`/`AlunosView.vue`
como referência obrigatória — instruídos a **não subir Docker/Postgres/backend/dev server** (para não
colidir entre si na mesma máquina) e validar só via `npm run build`. A validação de comportamento
real (curl + browser) ficou centralizada aqui, depois que os 4 terminaram.

#### Professores (feito pelo orquestrador)

- Não existe tabela `Teacher` — "professor" é o papel `MESTRE` ou `PROFESSOR` de um
  `OrganizationUser`. `id` nas rotas é o id da membership, não do `User`.
- `POST /teachers` cria `User` (userType MEMBER) + `OrganizationUser` juntos numa transação
  Prisma (`$transaction`); rejeita e-mail já cadastrado (400). `PATCH` atualiza nome/telefone no
  `User` e papel/status na membership. `DELETE` nunca apaga — marca a membership como `INACTIVE`
  (mesmo padrão de preservar histórico).
- **RBAC estendido**: `teachers` não estava na matriz original — adicionei ao `seed.ts` com override
  por recurso (antes o script só suportava uma matriz uniforme por papel; refatorado para suportar
  `RESOURCE_OVERRIDES` por recurso). Matriz final: MESTRE tudo, PROFESSOR só `view` (vê colegas, não
  gerencia), ALUNO/RESPONSAVEL sem acesso nenhum. **Achado corrigido em trânsito**: o `upsert` do seed
  usava `update: {}` (não atualizava nada se a linha já existisse) — troquei para atualizar de verdade
  os 4 booleanos, senão rodar o seed de novo nunca corrigiria uma permissão que mudou.
- `ProfessoresView.vue`: lista + modal criar (nome, e-mail, telefone, senha inicial, papel) + editar
  (sem e-mail/senha) + inativar.

#### Turmas, Aulas, Frequência, Graduações (delegados, resumo — replicaram o padrão de Alunos)

- **Turmas**: CRUD idêntico ao de Alunos (`Class`), com dia da semana (0-6) e horário. Soft-delete
  para `INACTIVE`.
- **Aulas**: CRUD de `Lesson`, com validação cross-tenant de `classId` (400 "Turma inválida para
  esta organização"), `unitId` e `teacherUserId` (400 "Professor inválido para esta organização" —
  valida que é uma membership MESTRE/PROFESSOR da mesma org, não só um `User` qualquer).
- **Frequência**: não é CRUD — é registro em lote por aula. `GET /attendance/lessons/:id` retorna o
  roster (todo aluno matriculado na turma da aula, com `present: null` se ainda não registrado).
  `POST /attendance/lessons/:id` recebe um array e faz upsert em transação (tudo ou nada) pela
  constraint única `[lessonId, studentId]`; valida cada `studentId` contra a organização antes de
  gravar. Frontend usa checkbox tri-state (indeterminate/presente/ausente) para distinguir "ainda não
  olhei" de "marquei ausente".
- **Graduações**: dois níveis — configuração (`GraduationSystem`/`GraduationLevel`, sem delete, não
  foi pedido) e histórico (`StudentGraduation`, registra e lista por aluno). **Gap de schema
  identificado pelo agente**: `projeto.txt` §27 pede que cada graduação guarde também Unidade,
  Professor/Mestre, Evento e Certificado, mas o model `StudentGraduation` só tem
  `studentId`/`graduationLevelId`/`graduatedAt`/`notes` — implementado fiel ao schema existente
  (proibido alterar `schema.prisma` nesta rodada), gap sinalizado como pendência de schema.

#### Validação empírica consolidada (feita pelo orquestrador, depois dos 4 agentes)

1. Build limpo de `backend` e `painel` juntos (todos os módulos no mesmo commit de código).
2. Postgres subido, **seed re-rodado** (idempotente — confirmei via `psql` que a matriz `teachers`
   ficou exatamente `MESTRE: tudo / PROFESSOR: só view / ALUNO,RESPONSAVEL: nada`).
3. **Teachers**: criei uma professora nova via `POST /teachers` — retornou membership + user reais.
4. **Classes**: criei e editei uma turma via API — refletido no `GET /classes`.
5. **Lessons**: criei uma aula com professor válido (200); com `teacherUserId` de um ALUNO → `400`
   "Professor inválido"; com `classId` inexistente → `400` "Turma inválida".
6. **Attendance**: roster antes de registrar mostrou `present: null`; depois do `POST`, `true`;
   `studentId` inválido → `400`. Repeti o fluxo completo **na UI real** (selecionei a aula, cliquei
   Salvar) — `read_network_requests` confirmou `POST .../attendance/lessons/1 → 201 Created`.
7. **Graduations**: criei um nível novo ("Azul") via API, registrei uma graduação para a aluna do
   seed, histórico foi de 1 para 2 registros. Repeti **na UI real**: naveguei para `/graduacoes`,
   selecionei a aluna no select, o histórico carregou os 2 registros certos (mais recente primeiro,
   com a observação exibida) — confirma que o frontend cruza os dados corretamente.
8. **RBAC nos 5 módulos novos**: ALUNO tentando `POST /classes` → `403`; ALUNO tentando `GET /teachers`
   → `403`; ALUNO em `GET /graduations/students/1` → `200` (tem `view=true`) — os três exatamente como
   a matriz define.
9. Todos os processos de teste (backend, painel dev, Postgres) encerrados ao final.

**Pendências novas desta etapa:**

17. **UX a revisar com o owner**: no `FrequenciaView.vue`, uma linha nunca clicada pelo professor é
    salva como `present: false` (ausente) em vez de ficar sem registro — decisão do agente, documentada
    como trade-off, mas vale confirmar se é o comportamento desejado (o risco é marcar como falta um
    aluno que o professor simplesmente esqueceu de revisar).
18. `StudentGraduation` não tem campos para Unidade/Professor/Evento/Certificado que `projeto.txt`
    §27 pede — decisão de ampliar o schema fica para quando isso virar prioridade real (exigiria nova
    migration).
19. `GET /graduations` e `GET /graduations/systems` fazem hoje a mesma consulta (redundância latente,
    não removida por estar fora do escopo pedido ao agente).
20. Nenhum dos 5 módulos novos tem teste automatizado ainda (mesma pendência geral de §10.1.3 item 6).

### 10.7 Fase 1 — Dashboard, Financeiro, Eventos, Rodas (fecha o núcleo de Gestão do MVP)

**Data:** 2026-09-16 · **Status:** ✅ concluído, validado empiricamente — **um bug real de UI foi
encontrado e corrigido nesta rodada**, não só limitações de tooling.

Estratégia: **Dashboard** e **Rodas** feitos pelo orquestrador (Dashboard não tinha padrão CRUD para
copiar — é agregação; Rodas exigiu uma correção de schema antes de poder ser implementado do jeito
certo). **Financeiro** e **Eventos** delegados a 2 subagentes Sonnet em paralelo, seguindo o molde de
Alunos, com instrução explícita de não subir Docker/backend (o orquestrador estava mexendo em
schema/migration ao mesmo tempo).

#### Gap de schema corrigido antes de tudo: `Roda.organizationId`

O model `Roda` original (criado na Fase de fundação, §1) não tinha nenhuma FK para `Organization` —
impossível saber quem organizou uma roda ou restringir quem pode editá-la/excluí-la. **Migration real
aplicada**: `20260916210225_add_organization_to_roda`, adiciona `organizationId Int?` (nullable — uma
roda pode em tese ser pública sem organização no futuro) + índice + relação inversa em `Organization`.
Verificado via `psql \d "Roda"` que a coluna e o índice existem de verdade. A roda já seedada
(criada antes da migration) ficou com `organizationId` nulo — corrigida manualmente via `UPDATE` no
Postgres (o script de seed só cria registros novos, não conserta os que já existem — registrado como
lição para quando o seed precisar de outra alteração retroativa: ou apagar o dado antigo, ou fazer um
patch manual como este).

**Achado de infraestrutura corrigido em trânsito**: a primeira tentativa de `npx prisma migrate dev`
falhou com `EPERM` ao gerar o Prisma Client — a DLL do query engine estava travada por **4 processos
node órfãos** de sessões de teste anteriores desta mesma máquina (`nest start --watch`, `dist/main`
compilado, 2× `vite` do app.gingapp) que eu não tinha encerrado direito em rodadas passadas. Identificados
via `Get-CimInstance Win32_Process` (filtrando `CommandLine` por "GingApp") e encerrados — a lição:
tarefas anteriores desta sessão deixaram processos vivos além do que os logs de "encerrei tudo"
sugeriam; passei a checar por `CommandLine` (não só por porta) antes de mexer em schema/migration.

#### Dashboard (`GET /dashboard`, feito pelo orquestrador)

Agregação sem padrão de referência — desenhado do zero a partir de `projeto.txt` §30: alunos
ativos/novos(30d)/inativos, turmas ativas, aulas de hoje, mensalidades previstas vs. atrasadas
(`atrasado` = `status=OVERDUE` **ou** `PENDING` com `dueDate` vencido — nada transiciona
automaticamente entre os dois ainda, sem cron/job), frequência média dos últimos 30 dias, graduações
dos últimos 30 dias, próximos 5 eventos. RBAC: recurso `dashboard` adicionado ao seed, restrito a
MESTRE/PROFESSOR (ALUNO/RESPONSAVEL não têm — este é o painel administrativo, não a Home do
capoeirista).

#### Achado de segurança corrigido antes de implementar Financeiro

A matriz RBAC original dava `canView=true` para ALUNO/RESPONSAVEL em **todo** recurso por padrão —
isso vazaria a situação financeira de **todos os alunos** da organização para qualquer aluno logado
(`GET /finance` não é filtrado por aluno). Corrigido no seed: `finance` ganhou override
(`RESOURCE_OVERRIDES`) com ALUNO/RESPONSAVEL sem nenhum acesso, restrito a MESTRE/PROFESSOR.

#### Financeiro, Eventos, Rodas — resumo

- **Financeiro**: CRUD de `FinancialRecord`. `DELETE` é **hard delete de verdade** (não soft-delete
  como os outros módulos — lançamento errado deve poder ser removido, não "inativado"). `update` com
  `status: 'PAID'` sem `paidAt` preenche a data/hora atual automaticamente.
- **Eventos**: CRUD de `Event` (hard delete em cascata dos `EventParticipant`, numa `$transaction`) +
  sub-recurso de participantes (`GET/POST /events/:id/participants`,
  `DELETE /events/:id/participants/:participantId`), validando que é sempre **exatamente um** de
  `studentId`/`guestName` (nunca os dois, nunca nenhum).
- **Rodas**: CRUD com a nova validação de dono (`organizationId`) — `update`/`remove` só funcionam se
  a roda pertence à organização do token (404 senão); `create`/`update` validam `stateId`/`cityId`/
  `communityId` contra a existência real (dados públicos, não contra a organização). Adicionados 2
  endpoints públicos de conveniência (`GET /rodas/reference/states`, `GET /rodas/reference/cities`)
  que não existiam antes, só para popular os selects do formulário.

#### Validação empírica — incluindo um bug real de UI encontrado e corrigido

1. Build limpo de `backend` e `painel` juntos.
2. Postgres subido, seed re-rodado (idempotente — matriz confirmada em **11 recursos** agora, incluindo
   `dashboard`).
3. **Dashboard**: `GET /dashboard` retornou números batendo exatamente com os dados reais criados nas
   sessões de teste anteriores (1 aluno ativo, 1 inativo, 2 turmas, frequência 100%, 1 graduação) —
   confirmado também **na UI real** (`/dashboard` no browser, todos os cards certos).
4. **Financeiro via curl**: criado, marcado como pago (auto `paidAt`), excluído de verdade
   (`GET` depois → `404`).
5. **Financeiro na UI real — BUG ENCONTRADO E CORRIGIDO**: ao preencher e submeter o formulário de
   criar lançamento pela tela, nada acontecia (nenhum `POST` disparado). `read_console_messages`
   revelou o erro real: `form.amountReais.replace is not a function` — o `<input type="number">` do
   Vue 3 já entrega `number` via `v-model` (não `string`), mas o código gerado pelo agente assumia
   string e chamava `.replace(',', '.')`. **Corrigido** (`FinanceiroView.vue`): removida a chamada
   `.replace`, `Number(form.amountReais)` direto. Rebuild + reteste na UI real: `POST /finance → 201`,
   valor gravado certo (`R$ 180,50`). Também conferi que nenhuma outra view tem o mesmo padrão
   (`grep` por `.replace(` combinado com `type="number"` — só existia em Financeiro).
6. **Eventos via curl**: evento criado, participante aluno adicionado, participante convidado
   adicionado, tentativa com os dois campos preenchidos → `400 "Informe studentId ou guestName."`
   (reteste depois de um primeiro teste mal calibrado que caiu na validação de tamanho mínimo do
   `guestName` em vez da regra que eu queria provar).
7. **Achado de teste, não de app**: um teste inicial via `curl` inline no bash mostrou
   "Gin�sio Municipal" corrompido — investigado e confirmado como **problema de encoding do meu
   comando de shell no Windows** (Git Bash), não do backend: reconstruí o payload como arquivo UTF-8
   de verdade e confirmei acentuação perfeita tanto na resposta da API quanto **direto no Postgres via
   `psql`** (segunda via independente).
8. **Rodas via curl**: estados listados (`GET /rodas/reference/states`, público), roda criada com
   `stateId` válido, listagem pública (`GET /rodas`, sem token) retornando as rodas certas.
9. **RBAC dos 4 módulos**: ALUNO em `GET /finance` → `403`; ALUNO em `GET /dashboard` → `403`; ALUNO em
   `GET /events` → `200` (view padrão); ALUNO tentando `POST /rodas` → `403`.
10. Dado de teste corrompido (evento "Batizado 2026" com location malformada pelo bug de encoding do
    meu shell) excluído antes de encerrar.
11. Todos os processos de teste (backend, painel dev, Postgres) encerrados ao final.

**Pendências novas desta etapa:**

21. Nenhum teste automatizado para os 4 módulos novos (mesma pendência recorrente).
22. `FinanceFormState.amountReais` continua tipado como `string` na interface TypeScript mesmo
    recebendo `number` em runtime — o bug foi corrigido no código que usa o valor, não na
    declaração de tipo (inconsistência cosmética, não funcional; ajustar se for mexer nesse arquivo
    de novo).
23. Endpoints de referência de estado/cidade (`/rodas/reference/states`, `/rodas/reference/cities`)
    vivem dentro do módulo `rodas` por conveniência — se `Event`/`Unit` também precisarem de
    estado/cidade no futuro, vale extrair para um módulo `locations` próprio em vez de duplicar.
24. `Roda.organizationId` é nullable — nenhuma decisão de produto ainda sobre o que uma roda "sem
    organização" significa na prática (hoje não existe fluxo que crie uma).

Com isso, o **núcleo de Gestão do MVP está completo** (`projeto.txt` §78, lista 1-14): autenticação,
grupo/matriz/filiais, usuários, permissões, alunos, professores, turmas, aulas, frequência,
graduações, dashboard, financeiro básico — faltam eventos/rodas/comunicados/notificações do lado
"Comunidade" do MVP (eventos e rodas já têm backend completo agora; falta comunicados, notificações,
e o PWA do aluno consumindo tudo isso de verdade em vez de dados mockados).

### 10.8 Fase 1 — Comunicados, Notificações e endpoints "/me" para o PWA

**Data:** 2026-09-16 · **Status:** ✅ backend concluído e validado empiricamente (frontend do PWA
é a próxima etapa, §10.9)

Tudo feito pelo orquestrador (não delegado): a lógica de distribuição de notificações e os
endpoints "/me" cruzam múltiplos módulos e exigem entender o modelo de dados inteiro — não é um
CRUD isolado que dê para replicar de um molde.

#### Comunicados (`Announcement`) → distribuição automática de Notificações

CRUD completo (create/update/remove, `remove` marca `isActive=false`, nunca apaga — comunicado é
registro de comunicação com valor de auditoria). **O que torna isso mais que um CRUD**: ao publicar
(`create`), o service monta o público-alvo e cria uma `Notification` por usuário:
- `unitId` nulo → todo `OrganizationUser` ativo da organização (qualquer papel).
- `unitId` preenchido → união de: MESTRE (sempre, vê tudo), professores com `UserUnitAccess` naquela
  unidade, alunos daquela unidade (via `Student.unitId`) e os responsáveis vinculados a eles (via
  `StudentGuardian`).
- Só distribui na criação, não em edições (para não notificar de novo por causa de uma correção de
  texto — decisão registrada no código).

**Gap de produto conhecido e documentado**: o schema só suporta o escopo binário grupo/unidade;
`projeto.txt` §47 pede escopos mais finos (minha turma/meu estado/público) que exigiriam campos
novos — fora do escopo desta rodada.

#### Notificações (`Notification`)

`GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`,
`PATCH /notifications/read-all` — todas escopadas por `userId` do token, nunca por organização
(um usuário só vê e só marca como lida a própria notificação; sem `@CanAccess`, a segurança vem da
query sempre filtrar por `userId`, não de RBAC por papel).

#### Endpoints "/me" — resolvem a pendência de Fase 2 registrada em §10.7

Todos seguem o mesmo padrão: resolvem os alunos ligados ao usuário autenticado (ele mesmo, se for
ALUNO com `Student.userId` próprio, e/ou seus dependentes via `StudentGuardian`) e escopam a
resposta só a isso — nunca à organização inteira. Nenhum usa `@CanAccess` (a segurança vem da query,
não de RBAC por papel), o que permite existirem mesmo com `finance`/`dashboard` restritos para
ALUNO/RESPONSAVEL na matriz:
- `GET /students/me` — o(s) `Student` ligado(s) ao usuário (novo, em `StudentsService.findMine`,
  reaproveitado por todos os outros abaixo via injeção de módulo).
- `GET /finance/me` — registros financeiros só dos alunos "meus".
- `GET /attendance/me` — `{ records, last30dPercent }` só dos alunos "meus".
- `GET /classes/me` — turmas em que os alunos "meus" estão matriculados (via `ClassStudent`).
- `GET /lessons/me` — aulas das turmas "minhas", ordenadas por data crescente (pensado para
  "próxima aula" ficar sempre no topo).

Cadeia de injeção entre módulos: `LessonsModule` importa `ClassesModule` importa `StudentsModule`
importa nada — cada um expõe seu `findMine` e o de cima reaproveita, em vez de duplicar a consulta
de "quais alunos são meus" em 4 lugares.

#### Participação em Rodas (`RodaParticipant`) — "quero participar" (projeto.txt §41)

Como `Roda` é pública (sem RBAC por organização), a participação usa uma regra de autorização
diferente da matriz `RolePermission`, calculada no service, não em `@CanAccess`:
- `POST /rodas/:id/participants` — autoregistro do próprio usuário (`userId` do token), idempotente
  (clicar de novo não duplica).
- `DELETE /rodas/:id/participants/:participantId` — só o próprio participante pode remover a
  própria presença, **ou** um MESTRE/PROFESSOR da organização que organiza aquela roda especificamente
  (comparando `roda.organizationId` com o do token) pode remover qualquer participante (gestão da
  lista); qualquer outra combinação → `403`.
- `GET /rodas/:id/participants` — pública, mesmo espírito de `findAll`/`findOne`.

#### Validação empírica (tudo numa única sessão de shell para não bater no rate limit do login)

1. Comunicado org-wide criado → os 4 membros da organização receberam `Notification` (confirmado
   consultando `/notifications` do aluno).
2. `unread-count` correto antes/depois de marcar como lida; responsável tentando marcar a
   notificação do aluno (não é dele) → `404` (isolamento por dono confirmado).
3. Comunicado escopado por `unitId` criado com sucesso (não testei o fan-out fino aluno-vs-professor
   nesta rodada — coberto pela leitura do código, não por teste automatizado; pendência).
4. `GET /students/me` (aluno) → a própria Ana. `GET /students/me` funcionaria com RESPONSAVEL de
   forma análoga (lógica idêntica à de `finance/me`, já testada com sucesso para RESPONSAVEL antes
   do rate limit interromper o teste direto — revalidar quando o PWA estiver ligado de verdade).
5. `GET /finance/me` (aluno) → só o lançamento da própria Ana (`R$ 180,50`), não os de outros alunos.
6. `GET /attendance/me` → registro certo + `last30dPercent: 100`.
7. `GET /classes/me` e `GET /lessons/me` → só a turma/aula em que a Ana está matriculada.
8. `POST /rodas/1/participants` (aluno) → idempotente (POST duplicado retornou o mesmo registro,
   não criou um segundo). `GET /rodas/1/participants` → 2 participantes (mestre do seed + aluno).
9. **Os 3 caminhos de permissão de `leave` testados e confirmados**: aluno removendo a participação
   do mestre (não é dele) → `403`; aluno removendo a própria → `200`; professor (admin da
   organização) removendo a participação do aluno → `200`.
10. Build limpo de `backend` a cada mudança; nenhum servidor/Docker deixado rodando ao final.

**Pendências novas desta etapa:**

25. Fan-out de comunicado por unidade não tem teste automatizado provando que exatamente o público
    certo (professor daquela unidade + alunos daquela unidade + responsáveis) recebeu a notificação
    — só o caminho org-wide foi testado ponta a ponta.
26. `GET /finance/me`/`attendance/me`/`classes/me`/`lessons/me` não têm `@CanAccess` — decisão
    deliberada (a segurança vem da query, não do papel), mas vale relembrar se algum desses módulos
    ganhar um guard global mais restritivo no futuro, para não quebrar por engano.
27. ~~`RESPONSAVEL` em `/students/me` não foi revalidado~~ — **resolvido em §10.9**: confirmado na UI
    real do PWA logado como Carla (responsável), Home mostrou "Graduação atual de Ana Capoeirista"
    corretamente.

### 10.9 Fase 1 — PWA do aluno ligado à API real (fecha o MVP completo)

**Data:** 2026-09-16 · **Status:** ✅ concluído — **um bug real de autorização e três bugs de fuso
horário foram encontrados e corrigidos** durante a validação, não só limitações de tooling.

Estratégia: as 10 telas do `app.gingapp.com.br` foram divididas em 2 subagentes Sonnet em paralelo,
cada um dono de 5 views sem sobreposição de arquivos (só um dos dois tocou `utils/api.ts`, para
adicionar o método `patch` que faltava). Ambos instruídos a não subir Docker/backend (o orquestrador
tinha acabado de terminar de construir os endpoints "/me" na mesma máquina).

- **Grupo A** (orquestrador → agente): `HomeView`, `JornadaView`, `AulasView`, `FrequenciaView`,
  `PerfilView` — consumindo `students/me`, `lessons/me`, `attendance/me`,
  `graduations/students/:id`, `announcements` (filtrado no cliente por unidade/ativo).
- **Grupo B** (orquestrador → agente): `FinanceiroView`, `EventosView`, `RodasView`,
  `ComunidadeView`, `NotificacoesView` — consumindo `finance/me`, `events` (+ participantes),
  `rodas` (+ participantes), `notifications` (+ marcar como lida/todas).

#### Bug real de autorização encontrado e corrigido: "Quero participar" em Eventos nunca funcionava

Ao clicar "Quero participar" na tela de Eventos do PWA, a chamada real `POST /events/:id/participants`
voltava **`403 Forbidden`** — não é limitação de tooling, é um bug de RBAC introduzido na Fase 10.7:
a rota usava `@CanAccess('events', 'create')`, e só MESTRE/PROFESSOR têm essa permissão na matriz —
um ALUNO comum **nunca conseguiria se inscrever em um evento pela própria conta**, quebrando a
funcionalidade central da tela.

**Correção**: removido `@CanAccess` das rotas `POST/DELETE .../participants`; autorização própria
implementada no `EventsService` (`isOrgAdmin` + `StudentsService.findMine`, mesmo padrão já usado em
`RodasService.leave`): MESTRE/PROFESSOR pode inscrever/remover qualquer aluno (gestão de lista pelo
painel); um MEMBER comum só pode se autoinscrever/cancelar a si mesmo ou seus dependentes. Inscrição
via `guestName` (sem aluno vinculado) segue permissiva para criar, mas só um admin da organização
pode remover — o DTO nunca guardou `userId` de quem inscreveu, limitação já conhecida e agora também
documentada no código-fonte, não só no plano.

**Retestado na UI real depois do fix**: clicar "Quero participar" → `201 Created`, botão vira
"Cancelar presença" → clicar de novo → `200 OK`, botão volta ao estado inicial.

#### Três bugs de fuso horário encontrados e corrigidos (mesma causa raiz)

Campos de "só data" (`Lesson.date`, `FinancialRecord.dueDate`, `StudentGraduation.graduatedAt`) são
preenchidos no painel via `<input type="date">` — chegam ao banco como **meia-noite UTC**. Exibi-los
com `toLocaleDateString('pt-BR')` sem forçar `timeZone: 'UTC'` desloca um dia para trás em fusos
negativos (o fuso desta máquina). Achado ao navegar a tela de Financeiro do PWA: um lançamento
cadastrado com vencimento **05/10/2026** apareceu como **04/10/2026**.

Corrigidos com `timeZone: 'UTC'` na formatação: `FinanceiroView.vue` (dueDate), `AulasView.vue`
(lesson.date), `JornadaView.vue` (graduatedAt — o mais sério dos três: sem o fix, uma graduação de
**01/10** apareceria como "set." em vez de "out.", errando o mês, não só o dia). Um quarto lugar tinha
o problema na **lógica**, não só na exibição: `HomeView.vue` comparava `lesson.date` (meia-noite UTC)
contra "meia-noite local" para decidir se uma aula é "próxima" — em fuso negativo, uma aula de hoje
podia ficar de fora do carrossel por parecer "no passado". Corrigido normalizando os dois lados da
comparação para a mesma convenção (meia-noite UTC do dia local atual), não só a formatação de texto.
Retestado: Home continuou mostrando a aula de "Qui" corretamente depois do fix (sem regressão).

#### Validação empírica completa (10 telas, 2 papéis)

Login como ALUNO (Ana): Home (graduação + carrossel + avisos reais), Jornada (timeline cronológica
correta), Aulas (próximas/anteriores), Frequência (100%, registro certo), Financeiro (valor e data
certos após o fix), Eventos (participar → cancelar, ambos `2xx` reais), Rodas (participar, `201`),
Comunidade (agrega rodas+eventos públicos futuros), Notificações (marcar todas como lidas → `200` →
confirmado via `psql` que `readAt` foi gravado nas 2 notificações → botão some da UI), Perfil (papel,
grupo, aluno vinculado). Login como RESPONSAVEL (Carla): Home e Financeiro confirmados mostrando os
dados de Ana (dependente), fechando a pendência 27.

Todos os processos de teste (backend, dev server do PWA, Postgres) encerrados ao final; nenhum
processo órfão restante (verificado via `Get-CimInstance`).

**Pendências novas desta etapa:**

28. Cancelar a própria inscrição de convidado (`guestName`) em Eventos não é possível — só um admin
    da organização pode remover participantes desse tipo (limitação de schema documentada, não
    corrigida: exigiria adicionar `userId` ao fluxo de criação de `EventParticipant`).
29. `ComunidadeView.vue` não tem paginação/filtro por estado — lista só as próximas rodas/eventos
    públicos sem segmentação geográfica (`projeto.txt` §38 prevê "minha cidade → meu estado →
    Brasil", fora do escopo desta rodada).
30. Nenhuma das 10 views do PWA tem teste automatizado.

Com isso, o **MVP completo está de pé** (`projeto.txt` §78, Gestão + Comunidade): backend com todos
os módulos, RBAC, painel administrativo funcional, e o PWA do aluno consumindo dados reais de ponta a
ponta. Os itens ainda pendentes são poli­mento (design real do GestorPrint, testes automatizados,
Dockerfiles de produção) e Fase 2 (billing, planos dinâmicos, certificados, QR Code).

### 10.10 Fase 1 — Testes automatizados do backend (e2e)

**Data:** 2026-09-17 · **Status:** ✅ concluído — infraestrutura de teste montada do zero e **um
obstáculo técnico real de ecossistema encontrado e contornado** (não uma simples configuração).

Pendência mais repetida em quase toda fase anterior ("nenhum teste automatizado ainda"). Escolhido
como próxima frente por ser a que mais protege o que já foi construído contra regressão — em
particular o teste de isolamento multi-tenant, que o próprio plano (§8) chama de "o teste de
segurança mais importante do projeto".

#### Obstáculo real: Jest não consegue rodar contra `@nestjs/common@12.0.3` (pacote ESM puro)

Primeira tentativa: Jest + ts-jest (padrão de mercado para NestJS). Falhou com
`Must use import to load ES Module` ao carregar `@nestjs/common`. Investigação:
`@nestjs/common@12.0.3` é publicado como **ESM puro** (`"type": "module"`, sem entrada CommonJS) —
confirmado lendo o `package.json` do pacote instalado. O backend em si roda normalmente
(`node dist/main.js`, testado dezenas de vezes nesta sessão) porque o **Node 22.17 já suporta
`require()` nativo de ESM síncrono** (`require(esm)`) — confirmado com um teste isolado
(`node -e "require('@nestjs/common')"` funcionou). O problema é que o **carregador de módulos do
próprio Jest não delega para esse mecanismo nativo do Node** — reimplementa `require` por conta
própria e não sabe lidar com ESM.

Tentativas de contornar dentro do Jest (`transformIgnorePatterns` para forçar o ts-jest a
retranspilar os arquivos ESM de `@nestjs/common` para CommonJS antes do require) reduziram o erro
mas não eliminaram — a cadeia de imports internos do pacote (`validation.pipe.js` →
`load-package.util.js`) reapresentava o mesmo erro mais fundo, e cada camada exigiria mapear mais
pacotes transitivos. **Decisão**: abandonar Jest para os testes e2e (só para eles — não afeta o
resto do projeto) e usar o **test runner nativo do Node** (`node:test` + `node:assert/strict`),
que usa o `require` normal do Node e portanto herda o suporte nativo a `require(esm)` já confirmado.
Rodando via `node --require ts-node/register --test`, os 3 specs passaram de primeira.

#### O que foi montado

- `test/global-setup.ts` — roda `prisma migrate deploy` + `prisma db seed` uma vez antes da suíte
  (script npm separado, não um hook do test runner), garantindo que o Postgres tem o schema
  migrado e os dados base do seed (matriz RolePermission, organização/usuários de exemplo).
- `test/env-setup.ts` — sobe o limite do throttle de login (`LOGIN_THROTTLE_LIMIT`, novo — env var
  configurável adicionada em `auth.controller.ts`, default 5/min mantido em produção) para 100
  só nos testes, porque a suíte faz vários logins reais em sequência e bateria no limite de
  produção (achado confirmado empiricamente nas sessões manuais anteriores, §10.7-§10.9).
- `test/utils/test-app.ts` — bootstrap da aplicação real via `@nestjs/testing`, mesmos guards/pipes
  globais de `src/main.ts` (nenhum mock).
- `test/utils/assert-helpers.ts` — `assertMatchObject`, um helper mínimo para checagem parcial de
  objeto (equivalente ao `toMatchObject` do Jest) usando só `node:assert`.
- 3 suítes, **21 testes, todos passando, rodados duas vezes seguidas para confirmar idempotência**:
  1. **`auth.e2e-spec.ts`** (8 testes): login MEMBER válido, senha errada, e-mail inexistente
     (mesma mensagem genérica nos dois — não vaza qual credencial está errada), cross-login
     bloqueado nos dois sentidos (MEMBER→platform-login, PLATFORM→login), platform-login válido,
     rota protegida sem token (401), rota pública sem token (200).
  2. **`multi-tenant-isolation.e2e-spec.ts`** (6 testes) — **o mais importante**: cria uma segunda
     organização isolada de verdade (própria da suíte, apagada no `after`) com seu próprio
     mestre e aluno, e confirma que nenhuma das duas organizações consegue LER (nem por listagem
     nem por id direto), EDITAR ou APAGAR dados da outra — sempre `404`, nunca `200`/`403` (o que
     vazaria a existência do registro). Depois de cada tentativa de mutação bloqueada, confirma
     **direto no Postgres** que o dado da vítima continua intacto — não confia só no código HTTP.
  3. **`rbac.e2e-spec.ts`** (7 testes): ALUNO bloqueado de criar turma (com verificação de que
     nada foi gravado no banco), MESTRE consegue criar (com verificação de que a linha existe de
     verdade), ALUNO bloqueado de ver professores, MESTRE consegue, e a dupla
     `GET /finance` (403 para ALUNO) vs. `GET /finance/me` (200 para ALUNO) que prova que a
     restrição de privacidade de §10.7 está mesmo ativa.
- `npm run test:e2e` roda tudo (setup + suíte). Pré-requisito documentado: `docker compose up -d
  postgres` já rodando.

**Pendências novas desta etapa:**

31. Só 3 dos ~15 módulos do backend têm teste automatizado (auth, isolamento multi-tenant via
    students, RBAC via classes/teachers/finance) — os demais (turmas completas, aulas, frequência,
    graduações, eventos, rodas, comunicados, notificações, dashboard) continuam sem teste. A
    infraestrutura montada aqui (test-app, assert-helpers, padrão de fixture/cleanup) já serve de
    molde para estender a cobertura módulo a módulo.
32. Nenhum teste de frontend (painel, admin, PWA) — só o backend.
33. `test:e2e:setup` assume que `docker compose up -d postgres` já está rodando — não sobe/derruba
    o container sozinho (decisão deliberada, para não interferir com um Postgres de dev já em uso
    pela mesma pessoa rodando os testes).

### 10.11 Fase 1 — Cobertura de testes estendida para os demais módulos (fecha a pendência 31)

**Data:** 2026-09-17 · **Status:** ✅ concluído — **um bug real de formato de resposta HTTP foi
encontrado e corrigido**, não só limitação de tooling.

Estratégia: 3 subagentes Sonnet em paralelo, cada um escrevendo (nunca executando) testes para um
grupo de módulos, seguindo à risca o padrão de `node:test` já estabelecido em §10.10. Instruídos
explicitamente a **não rodar a suíte nem subir Docker/Postgres** — três processos mutando a mesma
organização compartilhada do seed ao mesmo tempo teria produzido dados inconsistentes/corridas. A
execução real ficou centralizada no orquestrador, depois que os 3 terminaram de escrever.

- **Grupo A** (`students`, `classes`, `teachers`, `lessons`): CRUD completo de cada um, sempre com
  verificação direta no Postgres (não só código HTTP), incluindo os casos de FK inválida (`unitId`,
  `classId`, `teacherUserId`) e soft-delete.
- **Grupo B** (`attendance`, `graduations`, `finance`, `dashboard`): registro de frequência em lote,
  configuração de graduação + histórico, hard-delete financeiro com auto-preenchimento de `paidAt`,
  e o Dashboard — este último com uma **organização isolada própria** criada só para esse propósito
  (mesmo padrão do teste de isolamento multi-tenant), para os números agregados serem 100% determinísticos
  independentemente do que outras suítes ou sessões manuais já colocaram na organização do seed.
- **Grupo C** (`events`, `rodas`, `announcements`+`notifications`): reprova especificamente que o bug
  de autorização da Fase 10.9 (ALUNO não conseguia se autoinscrever em evento) continua corrigido,
  testa a distinção "dono vs. admin da organização" em `leave` de Rodas, e o fan-out de notificações
  por comunicado (org-wide notifica todo mundo, isolado por `userId` para marcar como lida).

#### Bug real encontrado ao rodar a suíte consolidada pela primeira vez

Rodando os 14 arquivos juntos pela primeira vez: **82 de 83 passaram**. O único que falhou —
`GET /notifications/unread-count` — não era um erro de teste malfeito, era um **bug real de
formato HTTP**: o controller retornava um `number` puro (`return this.prisma.notification.count(...)`),
e o Nest, ao ver que o valor de retorno não é um objeto/array, faz o Express responder com
`Content-Type: text/html` em vez de `application/json` (confirmado empiricamente com `curl -i`:
corpo `"2"`, `Content-Type: text/html; charset=utf-8`). Isso quebra qualquer cliente que decida como
fazer parse do corpo com base no content-type (ex.: supertest/superagent, usado nos próprios testes)
— um `fetch(...).json()` comum (como o `api.ts` dos frontends já usa) ainda funcionaria por acidente,
mas a resposta HTTP em si estava incorreta.

**Correção**: `NotificationsService.countUnreadForUser` passou a retornar `{ count: number }` em vez
de um `number` puro — consistente com `markAllAsRead`, que já retornava `{ count }`. Confirmado que
nenhum frontend ainda consumia esse endpoint (`grep` nos 3 frontends não achou nenhuma referência),
então a correção não quebrou nada em produção. Teste ajustado para `res.body.count` e revalidado.

#### Validação empírica final

1. Suíte completa (14 arquivos, 83 testes) rodada **duas vezes seguidas** com
   `--test-concurrency=1` (execução sequencial forçada — necessário porque alguns testes, como o de
   fan-out de notificações e o próprio Dashboard, dependem de contagens/estado que outro teste rodando
   em paralelo no mesmo Postgres poderia bagunçar): **83/83 nas duas rodadas**, sem flakiness.
2. Limpeza verificada de forma independente via `psql` direto, contando por padrões de nome (`e2e`,
   `teste`, `isolation`) em `Organization`, `User`, `Class`, `Notification`, `Announcement`,
   `GraduationSystem`, `Event` — **zero resíduo** em todas as tabelas depois de duas rodadas
   completas da suíte.
3. `package.json`'s `test:e2e` consolidado para rodar os 14 arquivos em ordem (fundação → módulos
   de negócio → comunidade), com `--test-concurrency=1` explícito.

**Cobertura atual**: 14 dos ~15 módulos do backend têm teste e2e real (auth, multi-tenant, RBAC,
students, classes, teachers, lessons, attendance, graduations, finance, dashboard, events, rodas,
announcements/notifications). Não cobertos ainda: `organizations`, `units` (CRUD simples, sem
validação de negócio própria além do que já é exercitado indiretamente pelos testes de `unitId`
inválido nos outros módulos).

**Pendências novas desta etapa:**

34. `organizations` e `units` não têm suíte própria (baixa prioridade — são os módulos mais simples,
    e sua validação cross-tenant já é exercitada indiretamente via `assertUnitBelongsToOrganization`
    nos testes de outros módulos).
35. Nenhum teste de frontend ainda (pendência recorrente de §10.10, não resolvida nesta rodada).
36. `Content-Type: text/html` para retornos primitivos é um padrão geral do Nest+Express, não
    específico deste endpoint — vale uma varredura futura (`grep` por `return this.\w+Service\.\w+`
    em controllers que não envolvam `Promise<objeto>`) se mais endpoints desse tipo forem
    adicionados, para não repetir o mesmo bug em outro lugar.

### 10.12 Fase 1 — Dockerfiles de produção testados de verdade (resolve pendência §10.1.3 item 4)

**Data:** 2026-09-17 · **Status:** ✅ concluído — **5 problemas reais encontrados e corrigidos**,
não só configuração. Os 4 Dockerfiles já existiam desde a Fase de fundação (§10.1), mas nunca tinham
sido efetivamente *buildados*: só o modo dev (node:22-alpine + `npm run dev` + bind mount) tinha sido
validado até agora. Esta fase buildou e rodou as imagens de produção de verdade, pela primeira vez.

#### Achado 1 — backend não buildava: `bcrypt` precisa compilar binding nativo, Alpine não tem build tools

Primeira tentativa de `docker build` no backend falhou em `npm ci`: `node-gyp` não achava Python
(`node:22-alpine` não traz `python3`/`make`/`g++` por padrão, e não existe binário pré-compilado do
`bcrypt` para `linux-musl`, só para `glibc`). **Corrigido**: `apk add --no-cache python3 make g++`
nos stages `deps` e `prod-deps` do `backend/Dockerfile`, antes de `npm ci`.

#### Achado 2 — imagem final do backend com 688MB por causa de uma devDependency vazando

Investigando o tamanho da imagem (`docker images`, 688MB), descobri que `node_modules/prisma`
(a CLI, ~67MB) estava presente na imagem final, mesmo com `npm ci --omit=dev` — junto com ~130MB de
dependências transitivas exclusivas dela (`effect`, `es-toolkit`, `fast-check`, `typescript`). **Causa
raiz** (confirmada lendo `node_modules/@prisma/client/package.json`): `@prisma/client` declara
`prisma` como **peer dependency opcional** (`peerDependenciesMeta.prisma.optional: true`) — o npm
7+ auto-instala peers opcionais mesmo com `--omit=dev`, porque o `package-lock.json` registra essa
resolução independente da flag de dev. **Corrigido**: `npm ci --omit=dev --omit=optional` no stage
`prod-deps`, e o `@prisma/client` gerado (que precisa mesmo estar presente) passou a ser copiado do
stage `build` (que tem a CLI de verdade via `npm ci` completo) em vez de regenerado no `prod-deps`.
Resultado: 767MB → **558MB** (confirmado via `docker images` antes/depois).

#### Achado 3 — a "correção" do Achado 2 quebrou a migration em produção

Depois de remover a CLI do `prisma` da imagem de runtime, `docker compose run --rm backend npx
prisma migrate deploy` falhou (`npx` tentando baixar `prisma@latest` da internet dentro do
container, sem sucesso) — consequência direta e esperada da otimização do Achado 2, não um bug novo.
**Corrigido**: novo stage `migrate` no `Dockerfile` (`FROM build AS migrate`), reaproveitando o
stage `build` (que já tem a CLI completa + `prisma/migrations/`) só para essa tarefa pontual — nunca
usado para servir tráfego, então seu tamanho maior não importa. Novo serviço `migrate` no
`docker-compose.prod.yml`.

#### Achado 4 — o serviço `backend` do compose buildava a imagem ERRADA (a pesada, não a enxuta)

Depois de adicionar o stage `migrate` **depois** de `runner` no Dockerfile, o serviço `backend` no
`docker-compose.prod.yml` (sem `target:` explícito) passou a buildar por padrão o **último** stage do
arquivo — que virou `migrate` (759MB), não `runner` (558MB) — já que o Docker usa o último stage como
alvo implícito quando nenhum é especificado. Encontrado comparando `docker images` do serviço
`backend` construído via `docker compose build` contra o build manual anterior (tamanho batia com
`migrate`, não com `runner`). **Corrigido**: `target: runner` explícito no serviço `backend` do
compose. Revalidado: imagem voltou a 558MB.

#### Achado 5 — `VITE_API_URL` nunca seria configurável em produção real

Os 3 frontends (Vite) embutem variáveis de ambiente **em tempo de build**, não de execução — os
Dockerfiles existentes faziam `COPY . .` + `RUN npm run build` sem nenhum mecanismo para receber essa
URL de fora, então qualquer deploy real (domínio de verdade, não `localhost`) ficaria com a API
incorreta embutida no bundle, sem jeito de corrigir sem editar código. **Corrigido**: `ARG
VITE_API_URL` + `ENV VITE_API_URL=$VITE_API_URL` antes do `RUN npm run build` nos 3 Dockerfiles, e
`build.args` correspondente nos 3 serviços do `docker-compose.prod.yml`. **Validado de verdade, não só
lido no código**: buildei a imagem do painel com `--build-arg VITE_API_URL=https://api.gingapp.com.br/api`
e confirmei via `grep` no JS compilado que a URL customizada realmente foi para dentro do bundle.

#### Achados menores (gaps de configuração, não bugs de build)

- `painel.gingapp.com.br` e `admin.gingapp.com.br` não tinham `.dockerignore` — sem isso, `COPY . .`
  copiaria o `node_modules` local (Windows) para dentro do container Linux, misturando binários
  incompatíveis com o que o `npm ci` do próprio container acabou de instalar. Criados os dois
  arquivos (mesmo conteúdo do `app.gingapp.com.br`, que já tinha).
- `.env.production` (o arquivo real que alguém criaria a partir de `.env.production.example`,
  contendo `POSTGRES_PASSWORD`/`JWT_SECRET` reais) **não estava coberto pelo `.gitignore`** — os
  padrões existentes só cobriam `.env`/`.env.local`/`.env.*.local`, nenhum deles casa com
  `.env.production` (sem sufixo `.local`). Corrigido antes de gerar qualquer arquivo real com esse
  nome — adicionado `.env.production`/`.env.*.production` ao `.gitignore`, com exceção explícita
  para `.env.production.example`.

#### O que foi criado

- `docker-compose.prod.yml` — orquestra os 4 serviços via **build de verdade** (não bind mount):
  Postgres sem porta exposta ao host (só acessível via `docker compose exec`), backend com `target:
  runner` explícito, os 3 frontends com `build.args.VITE_API_URL`, e o serviço `migrate` auxiliar.
- `.env.production.example` — documenta as variáveis obrigatórias (`POSTGRES_PASSWORD`, `JWT_SECRET`,
  `PLATFORM_ALLOWED_IPS`, `VITE_API_URL`).

#### Validação empírica final — stack de produção completa rodada do zero, de verdade

1. As 4 imagens buildadas individualmente primeiro (`docker build` direto), cada achado acima
   corrigido e revalidado antes de seguir para o próximo.
2. Stack completa subida via `docker compose -f docker-compose.prod.yml --env-file ... up -d --build`
   sob um namespace de projeto isolado (`-p gingapp-prod`, para não colidir com o ambiente de dev).
3. Migration real aplicada via o novo serviço `migrate` — funciona tanto disparada automaticamente
   pelo `up` (achado empírico, documentado) quanto isolada via `run --rm migrate`.
4. Seed rodado (só para esta validação local, nunca em produção real) via
   `run --rm migrate npx prisma db seed` (o stage `migrate` tem `ts-node`, herdado de `build`).
5. `GET /api/health` → `database: up`; `POST /api/auth/login` → `200` com JWT real; os 3 frontends
   (`painel`/`app`/`admin`) → `200`, título correto, SPA fallback funcionando (`try_files` do nginx),
   manifest/service worker do PWA servidos corretamente com `Cache-Control: no-cache`.
6. Confirmado visualmente no browser real (não só `curl`): a tela de login do PWA renderizou
   corretamente a partir do container nginx de produção.
7. Stack inteira derrubada com `down -v` ao final (containers, rede e volume removidos) — nenhum
   artefato de teste (imagens `gingapp-prod-*`, `.env.production` de teste) deixado no sistema.

**Pendências novas desta etapa:**

37. Nenhum reverse proxy/TLS configurado ainda — cada serviço expõe uma porta HTTP simples
    (`3000`/`8081`/`8082`/`8083`); um domínio real precisa de nginx/Caddy/Traefik na frente,
    com certificado (Let's Encrypt ou equivalente), antes de ir ao ar de verdade.
38. `admin`/`painel`/`app` ainda não têm `HEALTHCHECK` no Dockerfile (o backend também não tem —
    só o Postgres tem `healthcheck` no compose) — útil para orquestradores decidirem quando
    reiniciar um container travado.
39. Nenhuma estratégia de backup automático do volume `gingapp_prod_pgdata` documentada ainda
    (`projeto.txt` §99 pede isso explicitamente) — fica para quando houver um ambiente de produção
    real, não só este de validação local.
40. O serviço `migrate` roda em todo `docker compose up`, mesmo quando não há migration nova — é
    idempotente e rápido, mas alguém rodando isso num CI/CD mais rígido pode preferir separar esse
    passo do `up` normal (ex.: um job de deploy dedicado).

### 10.13 Fase 2 — Billing e planos dinâmicos (catálogo de planos, assinaturas, gateway stub)

**Data:** 2026-09-17 · **Status:** ✅ concluído — primeira fatia da Fase 2 (decisão do owner:
"Billing e planos dinâmicos", com gateway "Stub por agora (Recomendado)": modelo de domínio completo
+ `BillingGatewayService` trocável por um gateway real depois, sem integrar credenciais de nenhum
gateway ainda).

#### O que foi construído

- **Migration `add_subscription_gateway_fields`**: `Subscription.gatewayProvider` (default `"stub"`),
  `gatewayCustomerId`, `gatewaySubscriptionId` — os únicos campos que faltavam no schema (Plan/
  Subscription/SubscriptionEvent já existiam desde a fundação, mas sem nenhum módulo backend).
- **`BillingGatewayService`** (`backend/src/shared/billing/billing-gateway.interface.ts`): interface
  gateway-agnóstica (`createCustomer`/`createSubscription`/`cancelSubscription`) + `provider` (nome
  gravado em `Subscription.gatewayProvider`). Implementação atual: `StubBillingGatewayService` — zero
  chamada de rede, gera IDs determinísticos (`stub-cust-*`/`stub-sub-*`) e calcula
  `currentPeriodEnd` localmente (30 ou 365 dias conforme `billingPeriod`). Injetado via token
  `BILLING_GATEWAY_SERVICE` no `SharedModule` (global, ao lado do `PrismaService`) — trocar de gateway
  no futuro é só um novo `useClass`, nenhum consumidor referencia a classe concreta.
- **`PlansModule`** (`interface/http/plans/`): CRUD completo do catálogo, **primeiro uso real do
  `PlatformOnlyGuard`** (existia desde a fundação — §10.1 — nunca tinha sido aplicado a um
  controller). `DELETE` nunca apaga: desativa (`isActive = false`), mesma convenção de soft-delete de
  Student/Class/Teacher. Código de plano único, verificado explicitamente antes de create/update
  (`ConflictException` 409 em duplicata).
- **`SubscriptionsModule`** (`interface/http/subscriptions/`): PLATFORM-only para
  list/get/create/update/`:id/cancel`, com uma única exceção MEMBER-acessível (`GET /me`, escopada
  por `CurrentOrganization`, mesmo padrão de `StudentsService.findMine`). Toda mutação grava uma linha
  em `SubscriptionEvent` (`CREATED`/`UPDATED`/`CANCELED`, payload em JSON) — audit trail dedicado
  deste domínio, distinto do `AuditLog` genérico que já existia no schema. `create` bloqueia (409) uma
  segunda assinatura em aberto (`TRIALING`/`ACTIVE`/`PAST_DUE`) para a mesma organização.
- **Enforcement de `Plan.maxStudents`**: `StudentsService.create` agora chama
  `SubscriptionsService.findOpenForOrganization` antes de criar um aluno; se a organização tem
  assinatura aberta **e** o plano define `maxStudents`, conta alunos `ACTIVE` e bloqueia com 400
  (`BadRequestException`) ao atingir o limite. Sem assinatura aberta ou sem limite definido, nada
  muda — preserva o comportamento anterior para orgs de seed/teste.
- **`seed.ts`**: catálogo expandido de 1 para 4 planos — `UNICO` (legado/gratuito, mantido para a org
  piloto, sem limite), `ESSENCIAL` (R$49,90, 30 alunos, 1 unidade), `PROFISSIONAL` (R$99,90, 100
  alunos, 3 unidades), `ILIMITADO` (R$199,90, sem limite) — para ter dados realistas de teste.

#### Achados / dificuldades reais

- **`prisma generate` falhou com `EPERM` (rename do `.dll.node`)** logo após `prisma migrate dev` —
  já era um padrão conhecido nesta sessão (processos Node órfãos do host, não do container).
  Investigado via `Get-CimInstance Win32_Process` (não só `tasklist`, que não mostra command line):
  achados dois processos reais segurando o binário — `nest start --watch` (pid 42568) e um
  `dist/main` solto (pid 40420), sobras de sessões anteriores. **Corrigido**: `Stop-Process` nos dois,
  `prisma generate` rodou limpo na sequência. Nenhum processo do usuário fora do projeto foi tocado.
- **Prisma + TypeScript rejeitou `Record<string, unknown>` nos campos `Json`** (`Plan.features`,
  `SubscriptionEvent.payload`) — o tipo gerado pelo Prisma Client exige `Prisma.InputJsonValue`, não
  um `Record` genérico. **Corrigido**: cast explícito `as Prisma.InputJsonValue` nos 3 pontos de
  escrita (`plans.service.ts` x2, `subscriptions.service.ts` x1) — não havia convenção prévia no
  projeto para campos `Json`, esta é a primeira.

#### Validação empírica

1. Migration aplicada com `docker compose up -d postgres` + `npx prisma migrate dev` — **confirmada
   por uma via independente**: `psql -c '\d "Subscription"'` mostrando as 3 colunas novas antes de
   qualquer commit.
2. Seed rodado (`npx prisma db seed`) e os 4 planos confirmados via `psql` direto
   (`SELECT code, maxStudents, ... FROM "Plan"`), não só pelo log do script.
3. Backend subido local (`npm run start:dev`) e testado via `curl` real: `platform-login` → JWT →
   `GET /plans` retornando o catálogo completo.
4. **Suíte e2e nova** (`test/plans-subscriptions.e2e-spec.ts`, 14 casos, registrada em
   `package.json#scripts.test:e2e`): PlatformOnlyGuard bloqueando MEMBER (403) em `/plans` e
   `/subscriptions`; CRUD de planos com verificação direta no Postgres (nunca só a resposta HTTP);
   criação de assinatura chamando o gateway stub de verdade (`gatewayCustomerId`/
   `gatewaySubscriptionId` com o prefixo esperado); 409 em segunda assinatura aberta; `/subscriptions/
   me` escopado; **limite de plano end-to-end**: organização isolada assinando um plano
   `maxStudents=1` criado só para o teste, 1º aluno aceito, 2º bloqueado (400, mensagem conferida),
   contagem no banco confirmada inalterada; upgrade de plano (`PATCH`) liberando o 2º aluno depois;
   cancelamento chamando o gateway e bloqueando um 2º cancelamento (400). Fixtures (organização,
   usuário, planos, assinatura, eventos) limpas no `after()` na ordem certa por causa das FKs
   `RESTRICT` do schema (`SubscriptionEvent` → `Subscription` → `Plan`/`Organization`) — confirmado
   via `psql` que nada de `E2E-%`/`e2e-billing%` sobrou no banco após a suíte.
5. **Suíte e2e completa** rodada do zero (`npm run test:e2e`, todas as 15 specs + a nova):
   **97 testes, 97 passaram, 0 falhas** — nenhuma regressão nos módulos existentes.
6. Processo de dev iniciado manualmente para o smoke test foi encerrado ao final (evitar deixar mais
   um processo órfão, o mesmo padrão de bug já visto nesta sessão).

#### Frontend de billing (resolve pendência 41 desta seção)

Perguntado ao owner como seguir, já que o admin.gingapp.com.br inteiro (todas as views, não só
Plans) ainda era só placeholder e os tokens visuais reais do GestorPrint nunca tinham sido
extraídos (pendência em aberto desde o início do projeto) — decisão: **construir agora, com o
scaffold Tailwind atual**, sem bloquear billing por um retrabalho visual maior e separado.

- **`admin.gingapp.com.br`**: `PlansView.vue` (CRUD completo, mesmo padrão de tabela+modal de
  `AlunosView.vue` do painel — lista, criar, editar, desativar); `OrganizationsView.vue` (antes
  placeholder, agora lista real das organizações, mínima, só para dar acesso ao detalhe);
  `OrganizationDetailView.vue` (antes placeholder, agora com o bloco "Assinatura": plano atual,
  status, renovação, atribuir/trocar plano, cancelar assinatura).
- **`painel.gingapp.com.br`**: `ConfiguracoesView.vue` (antes placeholder, agora "Meu plano": plano
  atual, preço, renovação, barra de uso alunos ativos/limite do plano, aviso quando o limite é
  atingido).
- **Achado**: `nest start --watch` gera um processo filho `node dist/main` que **sobrevive** a
  `Stop-Process` no processo pai (`nest.js ... start --watch`) — o pai é só a CLI/watcher, o filho
  é quem de fato escuta a porta. Descoberto ao subir o backend para o teste em navegador: a porta
  3000 já estava em uso por um `dist/main` órfão de uma parada anterior (nesta mesma sessão) que só
  tinha matado o processo pai. **Mitigação usada**: sempre matar por `CommandLine -match 'backend'`
  (pega os dois, pai e filho), nunca só pelo padrão `nest.js.*start --watch`.
- **Validação empírica no navegador de verdade** (não só `curl`/build): com os 3 processos (backend
  + `admin` + `painel`, portas 3000/4175/4174) subidos limpos, testado ao vivo: login PLATFORM →
  `/plans` lista o catálogo → criar um plano de teste pela UI (confirmado na tabela) → `/organizations`
  → detalhe → trocar plano da "Grupo Ginga Brasil" para Essencial pela UI → `/painel/configuracoes`
  como MEMBER mostrando "Essencial, 1/30 alunos" com a barra de progresso verde renderizando
  corretamente → trocado de volta para "Plano Único" ao final. Plano de teste e estado da assinatura
  restaurados via `psql` depois (nenhum artefato de teste manual deixado no banco de dev).

**Pendências novas desta etapa:**

41. ~~Frontend de billing ainda não construído~~ — **resolvido nesta mesma etapa**, ver "Frontend de
    billing" acima (`PlansView.vue`, `OrganizationsView.vue`/`OrganizationDetailView.vue`,
    `ConfiguracoesView.vue`). Ainda falta o visual definitivo (tokens reais do GestorPrint — ver
    pendência histórica de design, nunca resolvida) e o restante do admin (Team, Audit, Settings,
    Announcements continuam placeholder).
42. Nenhum gateway de pagamento real integrado — `StubBillingGatewayService` é 100% simulado. Quando
    houver credenciais de sandbox (Asaas ou outro), criar uma nova classe implementando
    `BillingGatewayService` e trocar o `useClass` em `SharedModule` — nenhum outro código muda.
43. `SubscriptionsService.update`/`cancel` não notificam ninguém (nem `AnnouncementsService`, nem
    email) quando o status muda — um "PAST_DUE" ou "CANCELED" hoje só aparece se alguém for olhar
    `/subscriptions/me` ativamente.
44. Sem endpoint de "trial self-service" (assinatura `TRIALING` criada pelo próprio grupo sem
    intervenção da equipe PLATFORM) — toda criação de assinatura hoje é manual, pela equipe PLATFORM.
45. `GET /organizations` e `GET /subscriptions` não têm paginação real nem filtro por organização no
    backend — `OrganizationDetailView.vue` busca todas as organizações/assinaturas e filtra no
    cliente (aceitável na escala atual de dev, não escala para produção com muitos grupos).

### 10.14 Fase 2 — Feature Overrides + Platform Announcements ("SaaS Admin completo")

**Data:** 2026-09-17 · **Status:** ✅ concluído — segunda fatia da Fase 2 (decisão do owner, entre
4 frentes possíveis de Fase 2: "Feature overrides + Platform Announcements (Recomendado)").

#### O que foi construído

- **`FeatureOverridesModule`** (`interface/http/feature-overrides/`), aninhado em
  `/organizations/:organizationId/feature-overrides` (diferente do resto do projeto — recursos
  member-scoped tiram `organizationId` do JWT, mas este é PLATFORM-only e opera sobre a
  organização de qualquer grupo, escolhida na tela do admin, daí vir da URL). CRUD sobre o model
  `OrganizationFeatureOverride` (já existia no schema, sem módulo): `POST` faz **upsert** pela
  chave única `(organizationId, featureKey)` — reenviar a mesma `featureKey` atualiza em vez de
  duplicar. `DELETE` é **hard delete de verdade** (exceção deliberada ao padrão de soft-delete,
  mesmo espírito de `FinancialRecord`/`Event`): um override é só um flag pontual, sem valor de
  histórico. Documentado explicitamente no service: hoje nenhuma feature do produto lê esses
  overrides para aplicar o gate de fato — o módulo só gerencia o dado, para quando a primeira
  feature opcional existir.
- **`PlatformAnnouncementsModule`** (`interface/http/platform-announcements/`): avisos da equipe
  GingApp para os grupos — diferente de `Announcement` (comunicado interno de um grupo para os
  próprios membros). `targetOrganizationId` nulo = todos os grupos; preenchido = só aquele grupo.
  PLATFORM-only para list/get/create/update/delete, com uma exceção MEMBER-acessível
  (`GET /platform-announcements/mine`, escopada por `CurrentOrganization`, mesmo padrão de
  `/subscriptions/me`) — retorna só avisos `isActive`, já publicados (`publishedAt <= now` ou
  nulo) e não expirados (`expiresAt >= now` ou nulo). Ao publicar, distribui uma `Notification`
  por usuário ativo do público-alvo (reaproveita o mesmo mecanismo de
  `AnnouncementsService.notifyAudience`, adaptado para escopo de plataforma); não redistribui em
  edições, só na criação.
- **Frontend (`admin.gingapp.com.br`)**: `AnnouncementsView.vue` (antes placeholder, agora CRUD
  real — lista, criar com destinatário e data de expiração, encerrar); `OrganizationDetailView.vue`
  ganhou a seção "Feature overrides" (lista, adicionar, ativar/desativar, remover), substituindo o
  placeholder final da página.

#### Achados

- **Bug no próprio teste, não no código**: a suíte e2e nova (`test/platform-admin.e2e-spec.ts`)
  falhou em 2 dos 14 casos na primeira rodada — `expected 201, got 400`. Investigado via `curl`
  manual reproduzindo a chamada exata: `body: 'x'` (1 caractere) violava o `@MinLength(2)` do
  `CreatePlatformAnnouncementDto`. **Não era bug de validação real** (a mensagem de erro do
  próprio backend, `"body must be longer than or equal to 2 characters"`, apontava direto para a
  causa) — corrigido trocando para `'xx'` nos dados de teste. Lição: nunca assumir que um 400
  inesperado é o comportamento sob teste sem ler a mensagem de erro real.
- **Isolamento de teste**: o primeiro rascunho do teste de aviso "direcionado a outra organização"
  usava `targetOrganizationId: 1` (a organização real do seed, "Grupo Ginga Brasil") — o que teria
  criado `Notification` de teste nas contas reais do seed (mestre/professor/aluno/responsável),
  nunca limpas no `after()`. **Corrigido antes de rodar**: trocado para usar a própria organização
  isolada da suíte (org B) como alvo, e o `after()` limpa `Notification` por prefixo de título
  (`[e2e]`) em vez de por `userId`, cobrindo também os avisos **globais** de teste (que notificam
  todo mundo, inclusive o seed, por design).

#### Validação empírica

1. Backend compilado limpo (`npm run build`, 0 erros) na primeira tentativa.
2. **Suíte e2e nova** (`test/platform-admin.e2e-spec.ts`, 14 casos): 403 para MEMBER nas rotas
   platform-only de ambos os módulos; upsert de override confirmado (mesma `featureKey` duas vezes
   não duplica linha, `count` verificado via Prisma); hard delete confirmado (`findUnique` retorna
   `null` depois); aviso global notificando a organização isolada da suíte; aviso direcionado
   aparecendo só na organização-alvo (`GET mine`) e não em outra; `targetOrganizationId` inexistente
   → 400; aviso expirado não aparece em `mine`; `PATCH` não redistribui notificação (contagem
   comparada antes/depois); `DELETE` como soft-delete confirmado (`isActive=false`, registro
   persiste, some de `mine`). 2 falhas na primeira rodada (ver Achados), corrigidas e revalidadas.
3. **Suíte e2e completa** rodada do zero (`npm run test:e2e`, 17 specs): **111 testes, 111
   passaram, 0 falhas**.
4. Frontend (`admin.gingapp.com.br`) buildado limpo (`vue-tsc -b && vite build`).
5. **Validação ao vivo no navegador**: backend + admin subidos limpos (mesmo cuidado de matar
   processos por `CommandLine -match 'backend'`/`'admin.gingapp'`, não só o padrão do CLI, por
   causa do achado de processo filho órfão da §10.13); criado um aviso global pela UI (apareceu na
   tabela corretamente); na organização "Grupo Ginga Brasil", adicionado um feature override pela
   UI, confirmado no Network que o `POST`/`PATCH` batem no backend certo e o body retorna o valor
   esperado (`enabled: false` depois de clicar "Desativar" — um primeiro `get_page_text` capturou a
   página antes do reload assíncrono terminar, o que pareceu uma falha à primeira vista; refeito
   a leitura e confirmado que o estado estava correto — não era bug, era timing da própria
   verificação). Clique em "Remover" e "Cancelar assinatura" corretamente dispararam o `confirm()`
   nativo do navegador, que o ambiente automatizado recusa por padrão (comportamento esperado, não
   testável até o fim por esta via). Estado de teste limpo via `psql` ao final (override, aviso e
   as 5 notificações que ele gerou).

**Pendências novas desta etapa:**

46. Feature overrides não são lidos por nenhuma feature real ainda — o módulo gerencia o dado, mas
    não há nenhum código no produto que consulte `OrganizationFeatureOverride` para decidir
    liberar/bloquear algo. Quando a primeira feature opcional existir, ler daqui.
47. `PlatformAnnouncement`/`Notification` de avisos da plataforma não aparecem em lugar nenhum do
    `painel.gingapp.com.br` nem do `app.gingapp.com.br` (PWA) ainda — `GET /platform-announcements/
    mine` existe e funciona, mas nenhum frontend MEMBER o consome. Ficou fora do escopo desta etapa
    por decisão (owner pediu "escopo backend+admin, similar ao billing").
48. Sem paginação em `GET /platform-announcements` nem `GET .../feature-overrides` — mesmo
    problema já registrado na pendência 45 para organizations/subscriptions.

### 10.15 Fase 2 — Jornada do Capoeirista, parte 1: Check-in de presença + Certificados com QR Code

**Data:** 2026-09-17 · **Status:** ✅ concluído — primeira fatia da "Jornada do Capoeirista"
(decisão do owner, entre 3 frentes possíveis de Fase 2 restantes: "Jornada do capoeirista
(Recomendado)"). A frente completa tem 4 partes (projeto.txt §41/§42/§45/§51/§52): check-in,
certificados+QR, passaporte e calendário estadual — esta etapa entrega as duas primeiras;
passaporte e calendário estadual ficam para a próxima.

#### O que foi construído

- **Check-in de presença em eventos** (`EventsService.checkIn`, projeto.txt §41/§45: "Futuramente:
  Check-in" — implementado agora): novo endpoint `PATCH /events/:eventId/participants/:id/check-in`,
  restrito a MESTRE/PROFESSOR (nunca self-service, diferente de `addParticipant`), marca
  `EventParticipant.status = ATTENDED` — enum que já existia no schema desde a fundação, nunca
  usado por nenhum código até agora. Botão "Confirmar presença" adicionado ao modal de
  participantes do `EventosView.vue` (painel), some da lista de ações quando já `ATTENDED`.
- **Certificados com QR Code** (projeto.txt §52): migration `add_certificate_verification_code`
  adiciona `Certificate.verificationCode` (`String @unique @default(cuid())`) — o QR aponta pra
  esse código não-sequencial, nunca pro `id` (evita enumeração trivial de certificados). Novo
  `CertificatesModule`: CRUD org-scoped (`GET/POST/PATCH/DELETE /certificates`, `GET /certificates/
  me` para o próprio aluno/dependente, mesmo padrão de `StudentsService.findMine`) + um
  `PublicCertificatesController` **sem autenticação** (`GET /public/certificates/:code`) que
  retorna só o mínimo pra confirmar autenticidade (título, nome do aluno, nome da organização,
  data) — nunca `studentId`/`organizationId` internos. RBAC: recurso `certificates` adicionado à
  matriz do seed com o mesmo tratamento de `finance` (ALUNO/RESPONSAVEL sem `view` na listagem
  geral — vazaria certificados de outros alunos — só em `/certificates/me`). `DELETE` é hard delete
  de verdade (mesmo raciocínio de `Event`: sem campo status, e um certificado "cancelado" não devia
  continuar validando via QR).
- **Frontend**:
  - `painel.gingapp.com.br`: `CertificadosView.vue` (nova) — MESTRE/PROFESSOR emitem certificados
    (aluno + título + data opcional), lista com apagar.
  - `app.gingapp.com.br` (PWA, tema escuro): `JornadaView.vue` ganhou uma seção "Certificados"
    (reaproveita a mesma view que já mostrava a timeline de graduações) com um botão "QR Code" por
    certificado, abrindo um modal com o QR gerado no cliente (biblioteca `qrcode`, instalada nesta
    etapa) apontando pra uma URL própria do app (`/verificar/:code`), não direto pro JSON da API.
    Nova `CertificateVerificationView.vue`: página **pública** (rota `requiresAuth: false`, fora do
    `/app` autenticado — quem escaneia o QR de um certificado físico não tem conta GingApp)
    exibindo "Certificado autêntico" ou "não encontrado".

#### Achados

- Nenhum problema de execução nesta etapa (diferente das duas anteriores) — migration, build e
  suíte e2e passaram de primeira. Único ponto validado com atenção: `prisma migrate dev` recusou
  rodar em modo não-interativo (ambiente sem TTY) por causa do aviso de constraint única em
  `verificationCode` — mesmo com a tabela `Certificate` vazia (confirmado via `psql` antes:
  `count = 0`). **Contornado** gerando o SQL via `prisma migrate diff --script` (não-interativo),
  escrevendo o arquivo de migration manualmente na pasta com o timestamp correto, e aplicando via
  `prisma migrate deploy` (comando não-interativo, seguro para CI/deploy) — sem tocar no fluxo real
  de `migrate dev` para desenvolvimento futuro, só para este caso específico de warning-sem-risco.
- Confirmado (mais uma vez) o achado de processo órfão da §10.13: `nest start --watch` morto por
  `Stop-Process` no processo da CLI ainda deixa o `dist/main` filho escutando a porta — mitigação
  já em uso (matar por `CommandLine -match 'backend'`) funcionou de novo sem incidente.

#### Validação empírica

1. Migration aplicada e confirmada via `psql` (`\d "Certificate"`, coluna `verificationCode`
   presente com índice único) antes de qualquer commit.
2. Backend compilado limpo (`npm run build`) logo na primeira tentativa, incluindo o check-in.
3. **Suítes e2e estendidas**: `events.e2e-spec.ts` ganhou 2 casos (ALUNO bloqueado do check-in,
   MESTRE fazendo check-in com status `ATTENDED` confirmado via Prisma); nova
   `test/certificates.e2e-spec.ts` (10 casos) — emissão com graduação vinculada, `studentId`/
   `studentGraduationId` inválidos → 400, RBAC (`ALUNO` 403 na lista geral, 200 em `/me`,
   `PROFESSOR` 403 no delete pela matriz padrão), verificação pública com e sem código válido
   (confirmado que a resposta pública **não** inclui `studentId`/`organizationId`), delete
   confirmando que o código para de validar (`404` na verificação pública depois). **Suíte e2e
   completa rodada do zero**: **123 testes, 123 passaram, 0 falhas** — primeira rodada limpa desde
   a Fase 2 começar (as duas etapas anteriores tiveram bugs no próprio teste corrigidos antes do
   verde final; esta não precisou).
4. Frontend `app.gingapp.com.br` e `painel.gingapp.com.br` buildados limpos
   (`vue-tsc -b && vite build`) depois de adicionar as novas views/dependência (`qrcode`).
5. **Validação ao vivo no navegador**, backend + painel + PWA subidos limpos: no painel, emitido um
   certificado de teste pela UI para a Ana (confirmado na tabela); no mesmo evento de teste já
   existente no ambiente de dev, adicionado um participante e clicado "Confirmar presença" —
   status mudou para "Compareceu" e o botão de check-in sumiu (não pode confirmar de novo). No PWA,
   logado como o usuário ALUNO da Ana: seção "Certificados" na Jornada mostrando o certificado
   recém-emitido; clique em "QR Code" abriu o modal com a imagem do QR renderizada; extraído o
   código de verificação da resposta de rede e aberto `/verificar/:code` numa aba nova (sem
   reaproveitar sessão autenticada) — mostrou "Certificado autêntico" com os dados corretos; testado
   também um código inexistente na mesma rota → "Certificado não encontrado". Certificado de teste
   apagado via `psql` ao final (o clique no botão "Apagar" da UI dispara `confirm()` nativo, que o
   ambiente automatizado recusa por padrão, mesmo comportamento já visto em cancelamentos/remoções
   anteriores — não é uma falha, é a barreira de confirmação funcionando).

**Pendências novas desta etapa:**

49. Passaporte do Capoeirista (projeto.txt §51) ainda não construído — endpoint agregando
    estatísticas do aluno (aulas/rodas/eventos/graduações/certificados) e uma página pública
    compartilhável (o schema já tem `PublicProfile.isPublished` pronto pra isso). Fica para a
    próxima etapa desta mesma frente.
50. Calendário estadual/geral da capoeira (projeto.txt §42) ainda não construído — precisa de
    `stateId`/`cityId` no `Event` (a `Roda` já tem esses campos desde a fundação) e um endpoint
    público agregando Rodas + Eventos filtráveis por cidade/estado/tipo/data. Fica para a próxima
    etapa desta mesma frente.
51. `CertificadosView.vue` (painel) não oferece vincular um certificado a uma `StudentGraduation`
    específica na UI (o backend suporta via `studentGraduationId`, só não tem seletor na tela) —
    simplificação deliberada para não inflar o escopo desta etapa.
52. O `EventosView.vue` do painel não distingue visualmente `CONFIRMED` de `INVITED`/`DECLINED` na
    ação disponível — o botão "Confirmar presença" aparece pra qualquer status diferente de
    `ATTENDED`, incluindo `DECLINED`/`CANCELLED` (o backend aceita, mas fazer check-in de alguém
    que recusou/cancelou é um caso estranho que a UI não impede).

### 10.16 Fase 2 — Jornada do Capoeirista, parte 2: Passaporte do Capoeirista

**Data:** 2026-09-17 · **Status:** ✅ concluído — fecha a "Jornada do Capoeirista" (as 4 partes de
projeto.txt §41/§42/§45/§51/§52 agora somadas: check-in + certificados em §10.15, passaporte
nesta etapa). Só falta o **calendário estadual** (§42) pra fechar 100% da frente, registrado como
pendência à parte por ser uma feature distinta (calendário público, não Passaporte).

#### O que foi construído

- **Migration `add_public_profile_public_code`**: `PublicProfile.publicCode` (`String @unique
  @default(cuid())`), mesmo espírito de `Certificate.verificationCode` (§10.15) — o QR do
  Passaporte aponta pra esse código, nunca pro `id`.
- **`PassportModule`** (`interface/http/passport/`): `PassportService.getForStudent` agrega, num
  único payload, tudo que o mockup de projeto.txt §50 pede — identidade (nome, grupo, unidade,
  graduação atual) + contadores (aulas via `Attendance.present`, rodas via `RodaParticipant`,
  eventos via `EventParticipant.status=ATTENDED` — reaproveitando o check-in de §10.15 —,
  graduações, certificados). `GET /passport/me` (self-service, mesmo padrão de `StudentsService.
  findMine`) e `GET /public/passport/:code` (`@Public()`, sem autenticação) reaproveitam a mesma
  função de agregação.
- **Publicação com consentimento do responsável** (projeto.txt §53, PLANO_PROJETO.md §3.4: "para
  menores, exige consentByGuardianId preenchido — nunca opt-in automático"): `POST /passport/
  publish` resolve se quem chama é o próprio aluno ou um responsável cadastrado
  (`StudentGuardian.userId`); se o aluno for **menor de idade** (calculado a partir de
  `Student.birthDate`), **bloqueia publicação pelo próprio aluno mesmo estando logado** — só um
  responsável pode publicar o Passaporte de um menor, e só depois de consentir explicitamente via
  `PATCH /passport/guardian-consent`, que ativa `StudentGuardian.consentPublicProfile` — campo que
  já existia no schema desde a fundação, nunca lido nem escrito por nenhum código até agora.
- **Frontend (`app.gingapp.com.br`)**: `PerfilView.vue` ganhou a seção "Passaporte do Capoeirista"
  (estatísticas em grid, publicar/despublicar, QR Code) — para `RESPONSAVEL`, um botão extra
  "Autorizar e publicar" (consente + publica numa ação só). Nova `PassportVerificationView.vue`:
  página pública (`/verificar-passaporte/:code`, `requiresAuth: false`) reproduzindo o cartão do
  mockup de projeto.txt §50.

#### Achados — 2 bugs reais encontrados validando ao vivo, não só nos testes automatizados

- **Mensagens de erro do backend nunca chegavam na tela em `app.gingapp.com.br`**: o `api.ts` da
  PWA (diferente do `painel`/`admin`) não lia o corpo da resposta de erro, só jogava um genérico
  `"Erro 403 ao chamar /passport/publish"` — a mensagem específica do backend ("Aluno menor de
  idade: ...") nunca aparecia. Só percebido testando ao vivo no navegador (a suíte e2e do backend
  não passa por esse cliente HTTP, então nunca pegaria isso). **Corrigido**: `api.ts` agora lê
  `{ message }` da resposta, igual aos outros 2 apps.
- **`PATCH /passport/guardian-consent` retornava 200 com corpo vazio**, e o `request()` dos 3
  `api.ts` (código replicado nos 3 frontends) faz `.json()` incondicional em qualquer resposta que
  não seja `204` — corpo vazio com `200` quebra com `SyntaxError: Unexpected end of JSON input`,
  **silenciosamente absorvido** pelo catch genérico do componente, que mostrou "Não foi possível
  autorizar o perfil público" mesmo o consentimento tendo sido salvo com sucesso no banco (só
  descoberto comparando a resposta de rede real, que já mostrava `200 OK`, com o comportamento da
  tela). **Corrigido nos dois lados**: backend (`setGuardianConsent` agora retorna
  `{ consentPublicProfile }`) e nos 3 `api.ts` (usa `.text()` primeiro, só faz `JSON.parse` se o
  corpo não for vazio — cobre `204` **e** `200`/`201` com corpo vazio, não só o primeiro caso).
  Esse segundo achado só apareceu porque o fluxo foi testado **de ponta a ponta no navegador**
  (não só via `curl`/suíte e2e do backend, que nunca exercitam o cliente HTTP do frontend).

#### Validação empírica

1. Migration aplicada (mesmo procedimento não-interativo de §10.15: `migrate diff --script` +
   arquivo manual + `migrate deploy`) e confirmada via `psql` (`\d "PublicProfile"`, coluna
   `publicCode` com índice único) antes do commit.
2. Backend compilado limpo (`npm run build`) — inclusive depois da correção do
   `setGuardianConsent`.
3. **Suíte e2e nova** (`test/passport.e2e-spec.ts`, 10 casos) — reaproveita a fixture do seed que
   já modela o caso mais importante do zero (Ana é menor, `consentPublicProfile: false` por
   padrão): stats conferidos via Prisma; **próprio aluno menor bloqueado** de publicar (403);
   `PROFESSOR` sem vínculo de guardian bloqueado (403); responsável sem consentimento bloqueado
   (400); `PATCH guardian-consent` autoriza; publish com consentimento → 201 com `publicCode`;
   verificação pública com e sem código válido; `GET /passport/me` reflete `isPublished`;
   `unpublish` remove da verificação pública. `after()` restaura `consentPublicProfile: false` e
   remove o `PublicProfile` criado, devolvendo a fixture do seed ao estado documentado.
4. **Suíte e2e completa rodada do zero** (18 specs): **133 testes, 133 passaram, 0 falhas** — sem
   regressão, inclusive depois da correção do `setGuardianConsent` (rodada de novo após o fix,
   mesmo resultado).
5. Frontend (`app.gingapp.com.br`) buildado limpo antes **e depois** dos 2 fixes de `api.ts`.
6. **Validação ao vivo no navegador** (é o que revelou os 2 achados acima): logado como o ALUNO
   (Ana, menor) → estatísticas corretas (1 aula/1 roda/1 evento/2 graduações/0 certificados,
   batendo com o que foi criado manualmente em §10.15) → clique em "Compartilhar Passaporte" → 403
   com a mensagem certa depois do fix. Logado como a `RESPONSAVEL` (mãe) → mesmas estatísticas →
   "Autorizar e publicar" → depois do fix do corpo vazio, sucesso de ponta a ponta → QR Code
   renderizado → aba nova, sem sessão, abrindo `/verificar-passaporte/:code` → cartão público
   correto (nome, grupo, unidade, graduação, estatísticas) → código inválido → "Passaporte não
   encontrado" → "Despublicar" → passaporte público deixou de existir. Estado do banco restaurado
   via `psql` ao final (`PublicProfile` apagado, `consentPublicProfile` de volta a `false`).

**Pendências novas desta etapa:**

53. Calendário estadual/geral da capoeira (projeto.txt §42) — última peça da Jornada do
    Capoeirista, ainda não construída. Precisa de `stateId`/`cityId` no `Event` (a `Roda` já tem
    desde a fundação) e um endpoint público agregando Rodas + Eventos filtráveis por
    cidade/estado/tipo/data.
54. `PerfilView.vue` só mostra/publica o Passaporte do **primeiro** aluno vinculado
    (`students[0]`) — mesma simplificação já registrada em `JornadaView.vue` desde a fundação
    (RESOLVIDO no app React: `StudentSwitcher` em app-shell.tsx + `useMyStudent`/`useStudentScope`, escolha persistida por usuário em localStorage; testes em src/test/dependents.test.tsx. As views Vue legadas citadas aqui não existem mais.)
55. Sem endpoint/rota para o responsável **revogar** consentimento já dado
    (`consentPublicProfile: true → false`) separado de despublicar o Passaporte em si — hoje só dá
    pra desativar consentimento chamando `PATCH /passport/guardian-consent` diretamente (sem UI),
    já que `unpublish` não mexe no consentimento (decisão deliberada: permite republicar depois
    sem reconsentir).

### 10.17 Fase 2 — Jornada do Capoeirista, parte 3: Calendário estadual (fecha a Jornada)

**Data:** 2026-09-17 · **Status:** ✅ concluído — **fecha 100% a "Jornada do Capoeirista"**
(projeto.txt §41/§42/§45/§51/§52, as 4 partes do roadmap somadas em §10.15/§10.16/§10.17).

#### O que foi construído

- **`Event` ganhou `type`, `stateId`, `cityId`**: `type` é `String @default("OUTRO")` (não enum,
  de propósito — mesmo espírito de tag de categorização de `Notification.type`), com os valores
  de projeto.txt §43 (`BATIZADO/WORKSHOP/CAMPEONATO/FESTIVAL/ENCONTRO/FORMATURA/VIAGEM/
  AULA_ESPECIAL/OUTRO` — "RODA" fica de fora, já tem o model `Roda` dedicado). `stateId`/`cityId`
  espelham os mesmos campos que `Roda` já tinha desde a fundação. Migration
  `add_event_calendar_fields`.
- **`CalendarModule`** (`interface/http/calendar/`), `GET /calendar` público (sem autenticação):
  agrega `Roda` (já pública/cross-organização desde a fundação) + `Event` com **`isPublic=true`**
  de **qualquer organização** — diferente de `GET /events`, que é escopado a uma organização só.
  Cada item carrega `source: 'RODA'|'EVENTO'` (o `id` sozinho colide entre as duas tabelas).
  Filtros: `stateId`, `cityId`, `type` (`RODA` ou um `EVENT_TYPES`), `scope`
  (`today`/`week`/`month`, projeto.txt §42 — sem `scope`, mostra tudo a partir de hoje sem limite
  futuro). Reaproveita `/rodas/reference/states`/`/cities` para os selects — não duplica.
- **Frontend**:
  - `painel.gingapp.com.br`: `EventosView.vue` ganhou os campos Tipo/Estado/Cidade (mesmo padrão
    de cascata estado→cidade de `RodasView.vue`) no formulário de criar/editar, e uma coluna
    "Tipo" na tabela.
  - `app.gingapp.com.br`: `ComunidadeView.vue` deixou de ser um feed simples (`GET /rodas` +
    `GET /events`, que só trazia eventos do **próprio** grupo) e virou o Calendário de verdade —
    chama `GET /calendar`, com chips de período (Tudo/Hoje/Semana/Mês) e selects de
    tipo/estado/cidade (cidade em cascata), tudo reativo (`watch` recarrega a cada filtro
    mudado).

#### Achados

Nenhum bug de execução nesta etapa — migration, build e suíte e2e passaram de primeira (terceira
etapa seguida sem incidente, depois dos 2 achados de §10.16). Único ponto de atenção deliberado:
`Event.type` foi feito **String livre**, não um enum Prisma, para não precisar de nova migration
toda vez que uma categoria for ajustada — a validação de valores aceitos fica só na camada HTTP
(`@IsIn(EVENT_TYPES)` no DTO, mesma lista usada no filtro do calendário).

#### Validação empírica

1. Migration aplicada (mesmo procedimento não-interativo de §10.15/§10.16) e confirmada via
   `psql` (`\d "Event"`, colunas `type`/`stateId`/`cityId` com os índices e FKs certos) antes do
   commit.
2. Backend compilado limpo (`npm run build`) na primeira tentativa.
3. **Suíte e2e nova** (`test/calendar.e2e-spec.ts`, 9 casos) — cria Estado/Cidade isolados desta
   suíte (uf sintética, nunca colide com o "GO"/seed) para poder afirmar contagem exata: evento
   público com `type`/`stateId`/`cityId` criado e confirmado via Prisma; `type` default `OUTRO`
   quando omitido; `stateId` inexistente → 400; `GET /calendar` sem filtro traz a roda **e** o
   evento público, mas **nunca** um evento privado (`isPublic=false`) criado na mesma suíte;
   `type=RODA` só traz rodas; `type=WORKSHOP` só traz esse tipo; `stateId` isola exatamente os 2
   itens da suíte (`length === 2`, não só "contém"); `scope=today` corretamente exclui itens
   datados 3 dias no futuro; `scope`/`type` inválidos → 400. **Suíte e2e completa rodada do
   zero** (20 specs): **143 testes, 143 passaram, 0 falhas**.
4. Frontend (`painel`/`app.gingapp.com.br`) buildado limpo.
5. **Validação ao vivo no navegador**: no painel, criado um evento "Workshop de teste do
   calendario" com Tipo=Workshop, Estado=Goiás, Cidade=Goiânia, marcado como público — a cidade
   carregou certo assim que o estado foi selecionado (cascata funcionando). No PWA, aba
   Comunidade (agora "Calendário"): o workshop recém-criado apareceu junto com a `Roda Mensal —
   Valparaíso` do seed, cada um com ícone/rótulo de tipo certo e "Cidade - UF"; filtro
   `type=WORKSHOP` isolou só o workshop; filtro `type=RODA` isolou só as rodas. Evento de teste
   apagado via `psql` ao final.

**Pendências novas desta etapa:**

56. `GET /calendar` não pagina (`take: 100` fixo em cada fonte) — aceitável no volume atual, mas
    um calendário nacional de verdade com muitas organizações vai precisar de paginação/scroll
    infinito mais cedo que os outros módulos.
57. Sem endpoint de detalhe (`GET /calendar/:source/:id`) nem link pra ação (inscrever-se,
    confirmar presença) direto a partir do card do calendário — hoje é só visualização; pra
    interagir, o usuário ainda precisa ir em `/app/rodas` ou `/app/eventos` separadamente.
58. `EventosView.vue` (painel) e `ComunidadeView.vue` (PWA) duplicam o dicionário
    `EVENT_TYPE_LABEL`/`TYPE_LABEL` (mesmos 9 valores, escritos 2 vezes em projetos diferentes)
    — sem um pacote compartilhado entre os 3 frontends, isso vai se repetir a cada campo de
    categoria nova; candidato a um pacote `@gingapp/shared` no futuro.

### 10.18 Refino de UI/UX — remoção de emojis do app.gingapp.com.br (PWA)

**Data:** 2026-09-17 · **Status:** ✅ concluído — pedido direto do owner ("refino de UI Ux do
mobile, minimalista e sem icones emojis"), fora da sequência da Fase 2 (não é uma feature nova,
é polimento visual do que já existia).

#### O que foi feito

- **Auditoria completa** (agente de exploração, Sonnet) de todo `app.gingapp.com.br/src` —
  16 arquivos `.vue` verificados um a um por emoji em template/script. Achado: uso confinado a
  **3 arquivos** (`ComunidadeView.vue`, `HomeView.vue`, `FrequenciaView.vue`), nunca em
  `MobileLayout.vue` (que já usava ícones SVG em stroke-line desde a fundação — nenhum emoji ali).
- **Novo componente `AppIcon.vue`** (`components/icons/`): SSOT de ícones — um único `<svg>`
  parametrizado por `name`, replicando exatamente o estilo que só existia inline dentro de
  `MobileLayout.vue` (`viewBox 0 0 24 24`, `stroke-width 2`, `stroke="currentColor"`, linhas
  arredondadas — cor 100% herdada da classe Tailwind do elemento pai, nunca hardcoded no SVG).
  17 ícones: os 5 que já existiam (`home/compass/calendar/users/user`, portados de
  `MobileLayout.vue` para o componente compartilhado — refatoração, mesmo visual) + 12 novos
  (`drum/graduation/book/trophy/sparkles/chat/plane/flame/bell/check-circle/wallet/ticket`).
- **Trocas por arquivo**:
  - `MobileLayout.vue`: os 5 ícones inline (~35 linhas de SVG duplicado) viraram
    `<AppIcon :name="item.icon" />` — elimina a única duplicação de ícone do projeto.
  - `ComunidadeView.vue`: dicionário `TYPE_ICON` (10 emojis: 🥁🎓🏆🎉🤝✈️🥋📅) virou um dicionário
    de `IconName`, renderizado via `<AppIcon>` dentro do badge circular de cada item do
    calendário.
  - `HomeView.vue`: os 4 ícones dos atalhos rápidos (✓/$/★/◎ — nem todos emoji de verdade, mas
    símbolos ad-hoc fora do design system) viraram `check-circle/wallet/ticket/drum`; o sino de
    notificações (🔔) virou `<AppIcon name="bell">`; removido o "👋" decorativo do texto de
    saudação ("Olá, {nome}").
  - `FrequenciaView.vue`: removidos os glifos `✓`/`✗` prefixados no status de presença — decisão
    deliberada de **não** substituir por outro ícone aqui: a cor (`text-success`/`text-danger`)
    já comunica o status sozinha, um ícone a mais seria redundante nesse contexto específico
    (minimalismo = também saber quando NÃO usar um ícone).

#### Achados

Nenhum bug — troca mecânica e de baixo risco (só camada visual, nenhuma lógica de negócio
tocada). Único ponto de atenção: dois dos "ícones" trocados em `HomeView.vue` (`$` e `◎`) não
eram emoji de verdade, mas foram trocados do mesmo jeito por não pertencerem ao novo sistema de
ícones consistente — o pedido do owner era "minimalista", não só "sem emoji".

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`) depois de cada arquivo tocado.
2. Busca por emoji (`grep` com ranges Unicode de emoji) confirmou **zero ocorrências
   remanescentes** em qualquer `.vue`/`.ts` de `app.gingapp.com.br/src` fora de comentários de
   código não visíveis ao usuário (uma seta `→` em 2 comentários, sem relação com UI).
3. **Validação visual no navegador** (backend + PWA já rodando): Home (ícones de sino,
   frequência/financeiro/eventos/rodas, sem saudação com emoji), Calendário (ícone de tambor nas
   rodas), Frequência (status "Presente" só com cor, sem glifo) — todas renderizando os novos
   ícones SVG corretamente, visual consistente entre as 3 telas e com a bottom nav que já
   existia.

**Pendências novas desta etapa:**

59. O mesmo refino (remoção de símbolos ad-hoc, ícones SVG consistentes) não foi replicado em
    `painel.gingapp.com.br` nem `admin.gingapp.com.br` — o pedido do owner foi especificamente
    "mobile"; os outros 2 apps usam Tailwind puro (slate, sem ícones decorativos na maior parte
    das telas) e não têm o mesmo problema de emoji, mas também não têm um sistema de ícones
    (`AppIcon`) próprio ainda.

### 10.19 Redesign visual do app.gingapp.com.br — tema claro (mudança de direção do owner)

**Data:** 2026-09-17 · **Status:** ✅ concluído — o owner mudou de ideia sobre a identidade
visual do PWA: da referência dark mockup usada desde a fundação (§0) para uma referência nova,
um app de rastreamento de pet em tema **claro**, cards brancos arredondados com sombra suave e
bottom nav ícone+texto. Decisão explícita: copiar o **estilo visual**, não as funcionalidades
(mapa/GPS não fazem sentido aqui); paleta **verde/amarelo** escolhida no lugar de imitar as
cores exatas da referência ou manter o rosa/magenta do tema escuro anterior.

#### O que foi feito

- **`style.css`**: `@theme` inteiro reescrito — de um tema escuro (bg `#1a1625`, accent rosa
  `#ec4899`) para um tema claro (bg `#f4f5f7` cinza bem claro, surface `#ffffff`, accent verde
  `#22c55e`, texto quase-preto `#16181d`). A relação entre os tokens (bg < bg-elevated < surface
  < surface-hover em "proeminência") foi preservada — só os valores hex mudaram — o que
  significa que **nenhuma classe Tailwind precisou mudar em nenhuma view**: todo o app já usava
  classes semânticas (`bg-surface`, `text-text-muted`, `text-accent` etc.), nunca hex
  hardcoded, então a troca de tema inteira ficou concentrada em um arquivo só. `--color-warning`
  (`#f59e0b`, âmbar) já existia e cobre o "amarelo" da paleta pedida — não foi preciso criar um
  token novo.
- **Sombra de card nova**: tema escuro anterior não precisava de sombra (contraste bg/surface já
  bastava); tema claro precisa de elevação visível. Adicionada via uma regra CSS global
  (`.rounded-card(-lg).bg-surface { box-shadow: ... }`) em vez de editar cada view — pega todo
  card real (que combina `bg-surface` com um raio) sem afetar badges/pills pequenos que usam só
  `bg-surface`.
  `radius-card`/`radius-card-lg` aumentados (1.125rem/1.25rem → 1.25rem/1.5rem) pra bater mais
  com o arredondamento generoso da referência.
- **Metadados do PWA**: `theme-color` (meta tag + `manifest.theme_color`/`background_color` no
  `vite.config.ts`) e `apple-mobile-web-app-status-bar-style` (`black-translucent` →
  `default`) atualizados pro tema claro — sem isso, a barra de status do iOS e a cor do Chrome
  ficariam com o tom escuro antigo mesmo com o app renderizando claro.
- **2 hex hardcoded corrigidos**: `JornadaView.vue`/`PerfilView.vue` geravam o QR Code do
  certificado/passaporte com cores do tema escuro antigo escritas na mão (`dark: '#1a1625',
  light: '#f2eef8'`) — não eram lidas de nenhuma variável CSS, então não teriam mudado sozinhas.
  Atualizadas pra `dark: '#16181d', light: '#ffffff'` (preto quase puro em papel branco — máximo
  contraste pra leitura de QR, independente do accent do momento).

#### Achados

Nenhum bug — a arquitetura de tokens semânticos (nunca hex direto nas views, estabelecida desde
a fundação do projeto) fez o redesign inteiro ser, na prática, **um arquivo CSS + 4 valores
hardcoded encontrados por grep**, não uma reescrita de 13 telas. Confirma o valor de ter seguido
essa disciplina desde o início.

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`).
2. `grep` por hex/rgb/`shadow-` em todo `app.gingapp.com.br/src` confirmou só 2 arquivos com hex
   hardcoded (os dois do QR Code, corrigidos) — nenhum outro ponto escondido.
3. **Validação visual completa no navegador** (backend + PWA rodando), todas as telas
   principais: Login, Home (saudação, atalhos, avisos), Jornada (graduação + timeline),
   Calendário (chips de período, filtros, cards de roda/evento), Perfil (Passaporte com grid de
   estatísticas), Financeiro (badge "Em aberto" em âmbar), Aulas (badge "Confirmada" em verde),
   Rodas (botão pill "Quero participar"), Notificações, e a página pública
   `/verificar/:code` (estado "não encontrado") — todas renderizando o tema claro
   consistentemente, cards com sombra visível, sem nenhum resquício do tema escuro anterior.

**Pendências novas desta etapa:**

60. O QR Code do Passaporte/Certificado não foi revalidado visualmente pós-redesign (não havia
    um certificado/passaporte publicado no ambiente de dev no momento do teste) — a lógica de
    cor não mudou (só os 2 hex corrigidos), risco baixo, mas fica como item de verificação visual
    pendente na próxima vez que a tela for aberta com um QR de verdade.
61. `painel.gingapp.com.br` e `admin.gingapp.com.br` continuam no visual Tailwind slate genérico
    (pendência 41/59 já registradas) — o pedido desta etapa foi só "mobile"; um eventual
    alinhamento visual entre os 3 apps (ou uso deliberado de temas distintos por público) fica
    em aberto.

### 10.20 Redesign v2 do app.gingapp.com.br — layout e cards refeitos (feedback direto do owner)

**Data:** 2026-09-17 · **Status:** ✅ concluído — o owner rejeitou o resultado de §10.19 ("cara
muda tudo, melhores cards e tudo mais, outro layout. não gostei das telas que vc fez"). Antes de
tentar de novo às cegas, perguntado o que especificamente não funcionou: resposta foi "tudo
isso junto" (layout, cards e hierarquia visual) e "proponha algo do zero" (sem nova referência,
mais liberdade criativa). Diferente de §10.19 (só trocou tokens de cor), esta etapa reconstruiu a
estrutura visual de cada tela.

#### O que foi construído

- **4 componentes de UI novos** (`components/ui/`), SSOT pra parar de duplicar padrão em cada
  view:
  - `Badge.vue` — pill de status (4 tons: success/warning/danger/neutral), substitui o
    `"rounded-full px-2 py-0.5..."` que cada view escrevia na mão com uma cor diferente.
  - `StatTile.vue` — ícone num círculo colorido + valor + rótulo, com `to` opcional (vira
    `router-link`) e `surface` opcional (`surface`/`elevated`, pra nunca ficar "branco sobre
    branco" quando aninhado dentro de outro card branco).
  - `SectionHeader.vue` — título de seção + ação opcional à direita ("Ver tudo ›").
  - `EmptyState.vue` — ícone grande + mensagem, substitui os parágrafos soltos "Nenhum X ainda".
  - 5 ícones novos em `AppIcon.vue` (`megaphone`, `chevron-right`, `arrow-left`, `alert-circle`)
    pra cobrir os novos padrões (avisos, navegação em lista, erro).
- **Padrão de "hero card sólido"**: todo resumo de destaque (graduação atual na Home/Jornada,
  % de frequência, situação financeira) passou a ser um card com fundo **sólido** (accent verde,
  ou âmbar quando há pendência financeira) e texto branco, em vez de um card branco com texto
  colorido — muito mais hierarquia visual, primeira coisa que o olho vê na tela.
  `FinanceiroView.vue` inclusive ganhou lógica nova: soma os valores em aberto/atrasados e mostra
  como destaque (verde "Tudo em dia" quando zerado, âmbar com o valor quando há pendência) —
  informação que antes só existia implícita na lista.
- **Padrão de lista "ícone + conteúdo + indicador"**: todo item de lista (aulas, avisos,
  certificados, rodas, notificações, atalhos do Perfil) ganhou um ícone contextual num círculo
  colorido à esquerda — antes a maioria era só texto puro. Perfil trocou os links soltos por uma
  lista com chevron (`›`) igual um menu de configurações nativo.
  Botões de ação viraram pill (`rounded-full`) em vez de `rounded-card` — timeline/certificados/
  rodas/passaporte.
- **Tipografia mais bold**: todo `<h1>` de tela foi de `text-xl font-semibold` para
  `text-2xl font-bold` — títulos de página com mais peso visual, mais parecido com apps nativos
  modernos.
- **13 telas tocadas**: Home, Jornada, Comunidade/Calendário, Frequência, Financeiro, Aulas,
  Rodas, Notificações, Perfil, Login, e as 2 páginas públicas de verificação (Certificado e
  Passaporte) — cobertura completa, nenhuma tela ficou no estilo antigo.

#### Achados

Nenhum bug de execução — mas 1 ajuste de design encontrado **durante a própria implementação**
(antes de qualquer teste): `StatTile` teria ficado "branco sobre branco" nos dois lugares onde é
aninhado dentro de outro card branco (grid de estatísticas do Passaporte, em `PerfilView.vue` e
`PassportVerificationView.vue`) — resolvido com a prop `surface="elevated"` antes mesmo de rodar
o build, não um bug encontrado em produção.

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`) na primeira tentativa, apesar do volume de mudança
   (13 telas + 4 componentes novos).
2. **Validação visual completa no navegador**, todas as 13 telas, em **duas larguras**: preview
   padrão (800px) e **largura real de celular (375×812, via `resize_window` preset mobile)** —
   confirmado que o grid de 4 colunas dos atalhos da Home e o grid de 3 colunas das estatísticas
   do Passaporte cabem confortavelmente em tela de celular de verdade, não só no preview
   desktop-com-moldura usado até aqui.
3. Comparado visualmente antes/depois: hero cards sólidos (verde/âmbar) substituindo cards
   brancos com texto colorido, listas com ícone-círculo substituindo texto puro, badges via
   componente único em vez de classes repetidas — mudança visível em toda tela, não só ajuste
   de cor.

**Pendências novas desta etapa:**

62. QR Code do Certificado/Passaporte ainda não revalidado visualmente com os novos estilos de
    modal (pill buttons, overlay `bg-text/40`) contra um QR de verdade — mesma pendência 60,
    ainda em aberto.
63. `AvatarCarousel.vue` (carrossel de "Próximas aulas") não foi redesenhado nesta etapa — mantém
    o estilo de círculo com ring simples; não estava no escopo do feedback do owner, mas fica
    como candidato a um próximo refino de consistência visual.
64. Os novos componentes `components/ui/` (Badge, StatTile, SectionHeader, EmptyState) existem só
    em `app.gingapp.com.br` — `painel`/`admin` continuam sem um sistema de componentes
    equivalente (mesma pendência 61, agora maior: o gap de maturidade de design system entre os
    3 frontends aumentou).

### 10.21 Home vira feed com cards de imagem (referência: app de listagens estilo real estate)

**Data:** 2026-09-17 · **Status:** ✅ concluído — pedido do owner com print de referência (app de
listagens tipo imobiliária: cards grandes com foto, badge sobreposto, ícone de ação, linha de
ícones com specs). Decisão explícita do próprio owner: copiar o **estilo dos cards**, não a
funcionalidade de imóveis — adaptado para o domínio real do produto (Rodas, Eventos públicos,
Avisos do grupo).

#### O que foi construído

- **`FeedCard.vue`** (novo, `components/ui/`): card de capa com imagem OU, na ausência de
  `imageUrl` (nenhum `Roda`/`Event` tem foto ainda — não é regressão, nunca existiu), um
  placeholder degradê com o ícone do tipo bem grande — nunca uma imagem quebrada. Réplica direta
  da composição da referência: badge com bolinha colorida sobreposto no canto inferior esquerdo
  da imagem, botão circular (ícone de "abrir/navegar") sobreposto no canto superior direito,
  título + "preço" (aqui, a data) lado a lado abaixo da imagem, e uma linha de localização com
  ícone de pino.
- **`HomeView.vue` virou um feed de verdade**: removida a estrutura anterior (hero de graduação
  grande, carrossel "Próximas aulas", grid de atalhos grande, seção de avisos separada) — agora é
  cabeçalho compacto (saudação em itálico + nome do grupo + sino) → linha compacta de atalhos
  (Frequência/Financeiro/Eventos/Rodas, ícone pequeno) → abas de filtro (Tudo/Rodas/Eventos/
  Avisos, mesmo padrão de chip já usado no Calendário) → feed de `FeedCard` misturando **Avisos**
  do próprio grupo (`GET /announcements`) com **Rodas e Eventos públicos de qualquer organização**
  (reaproveita `GET /calendar`, já existia desde §10.17 — não foi preciso nenhum endpoint novo).
- **`AvatarCarousel.vue` removido**: ficou órfão depois que "Próximas aulas" saiu da Home (única
  tela que o usava) — apagado por completo em vez de deixar código morto (confirmado via grep
  que nenhum outro arquivo importava).
- **2 ícones novos** em `AppIcon.vue`: `external-link` (botão de ação no card) e `map-pin`
  (linha de localização).

#### Decisões de escopo (deliberadas, não esquecimento)

- O carrossel "Próximas aulas" (pessoal/privado do aluno) foi removido da Home — continua
  acessível em 1 toque via `/app/aulas` na bottom nav. Justificativa: o pedido do owner foi
  "a home seria uma tela de feed" — manter uma seção pessoal fora do feed misturada com conteúdo
  público (Rodas/Eventos/Avisos) prejudicaria a coerência do padrão de card único que a
  referência tem (todo item do feed é visualmente igual).
- A contagem de "confirmados" por Roda/Evento não aparece no card (o endpoint `/calendar`
  agregado não traz esse número por item — evitar N+1 queries) — só data/local/tipo, equivalente
  ao "sqft/beds/washroom" da referência mas com os dados que já existem sem custo extra de
  backend.

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`) de primeira.
2. `grep` confirmou `AvatarCarousel.vue` sem nenhum importador antes de apagar.
3. **Validação visual em largura real de celular (375×812)**: feed renderizando com o padrão
   exato da referência (imagem/placeholder + badge + botão de ação + título/data + localização);
   abas de filtro testadas (clique em "Rodas" isolou corretamente só os itens desse tipo,
   confirmado visualmente antes/depois do clique).
4. Observação (não é bug): no preview desktop largo (800px) do navegador embutido, a linha de
   4 atalhos compactos encosta na borda direita — a Home é uma tela de PWA mobile, nunca
   dimensionada pra 800px de largura numa instalação real; validado onde importa (375px real).

**Pendências novas desta etapa:**

65. `Event`/`Roda` não têm campo de imagem de capa no schema — todo card do feed usa o
    placeholder ilustrado hoje. Se o produto quiser fotos de verdade (mais fiel à referência),
    precisa de um campo `imageUrl` (mesmo padrão leve de `Student.photo`/`PublicProfile.photo`,
    sem upload de arquivo, só URL) + um jeito de o painel definir isso ao criar/editar.
66. O feed da Home mistura Avisos (ordenados por recência de publicação) com Rodas/Eventos
    (ordenados por data futura) em duas listas concatenadas, não uma ordenação cronológica única
    — decisão deliberada (os dois conceitos de "recente" — publicado agora vs. acontecendo em
    breve — não se comparam bem numa única chave de ordenação), mas vale reavaliar se o produto
    crescer a ponto de ter muitos itens de cada tipo.

### 10.22 `imageUrl` em Event/Roda — fotos de capa reais no feed (fecha a pendência 65)

**Data:** 2026-09-17 · **Status:** ✅ concluído — fecha a pendência 65 registrada em §10.21
("se o produto quiser fotos de verdade... precisa de um campo `imageUrl`"). Pedido direto do
owner logo em seguida ("sim, adiciona imageUrl e deixa o painel colar o link").

#### O que foi construído

- **`Event.imageUrl`/`Roda.imageUrl`** (`String?`, migration `add_event_roda_image_url`): mesmo
  padrão leve já usado em `Student.photo`/`PublicProfile.photo` — só URL, sem upload de arquivo
  nem storage próprio. `CreateEventDto`/`UpdateEventDto`/`CreateRodaDto`/`UpdateRodaDto` validam
  com `@IsUrl()` (rejeita string que não é URL, 400). `EventsService`/`RodasService` passam o
  campo adiante no create/update. `CalendarService` inclui `imageUrl` no `CalendarItem` (Roda e
  Event) — sem isso, o dado existiria no banco mas nunca chegaria no `/calendar` que os feeds
  consomem.
- **`painel.gingapp.com.br`**: `EventosView.vue` e `RodasView.vue` ganharam um campo "URL da
  imagem de capa (opcional)" no formulário de criar/editar, com nota explicando onde a imagem
  aparece.
- **PWA**: `FeedCard.vue` já suportava `imageUrl` desde §10.21 (só não tinha nenhum dado real pra
  mostrar) — `HomeView.vue` e `ComunidadeView.vue` agora repassam `item.imageUrl` do
  `/calendar`. Aproveitado pra **unificar** `ComunidadeView.vue`: antes do card de ícone+badge
  em linha (do redesign v2, §10.20), agora usa o mesmo `FeedCard` da Home — os dois feeds
  (Home e Calendário) têm exatamente a mesma linguagem visual agora, nunca dois estilos de card
  pro mesmo dado.

#### Validação empírica

1. Migration aplicada (mesmo procedimento não-interativo já padronizado) e confirmada via `psql`
   (`\d "Event"`, `\d "Roda"`, coluna `imageUrl` em ambas) antes do commit.
2. Backend compilado limpo. **Suíte e2e estendida** (`calendar.e2e-spec.ts`, +3 casos): evento
   criado com `imageUrl` confirmado via Prisma; `imageUrl` inválida (não é URL) → 400; `GET
   /calendar` retorna `imageUrl` de roda e evento corretamente. **Suíte completa revalidada**:
   **145 testes, 145 passaram, 0 falhas**.
3. Frontend (`painel` e `app.gingapp.com.br`) buildado limpo.
4. **Validação ao vivo no navegador**: editada a "Roda Mensal — Valparaíso" no painel com uma URL
   de imagem real (Unsplash); conferido no PWA que **Home** e **Calendário** passaram a mostrar a
   foto de verdade nesse card, enquanto a "Roda de Teste" (sem `imageUrl`) continuou mostrando o
   placeholder ilustrado — confirma que os dois caminhos (com/sem imagem) convivem sem quebrar
   nada. Estado do banco restaurado via `psql` ao final (roda do seed de volta a `imageUrl = NULL`,
   consistente com o que `seed.ts` declara).

**Pendências novas desta etapa:**

67. Sem preview da imagem no formulário do painel antes de salvar — o campo é só texto (URL),
    sem confirmar visualmente que o link aponta pra uma imagem de verdade antes de publicar.
68. Nenhuma validação de que a URL aponta pra uma imagem de verdade (só que é uma URL válida,
    via `@IsUrl()`) — uma URL de uma página HTML comum passaria na validação e quebraria o
    `<img>` do card (cairia silenciosamente pro placeholder do navegador, não pro placeholder
    ilustrado do `FeedCard`, já que este só ativa quando `imageUrl` é `null`/vazio).

### 10.23 Backfill de `imageUrl` nos dados existentes — cards sem foto de verdade

**Data:** 2026-09-17 · **Status:** ✅ concluído. Owner reportou "ta faltando imagens nos cards,
eventos rodas e etcs.." logo após o §10.22 fechar. Investigação (`psql` direto nas 3 linhas
existentes de `Roda`/`Event`) confirmou que **não era bug**: o código estava correto, mas
nenhum registro real tinha `imageUrl` preenchido ainda — inclusive a roda do `seed.ts`, restaurada
a `NULL` de propósito no fim do §10.22 pra bater com o que o seed declarava. Ou seja, todo card
caía no placeholder ilustrado por falta de dado, não por defeito.

Perguntado ao owner via AskUserQuestion como preferia resolver (popular dados de teste com fotos
vs. deixar ele cadastrar manualmente pelo painel vs. melhorar o placeholder) — escolheu **popular
os dados de teste agora** (recomendado).

#### O que foi feito

- **`seed.ts`**: a roda seed ("Roda Mensal — Valparaíso") ganhou um `imageUrl` fixo (foto real de
  capoeira do Unsplash) — daqui pra frente, um `db reset`/seed limpo já nasce com foto.
- **Backfill via `psql`** nas 3 linhas que já existiam no banco de dev antes do seed ter o campo:
  `Roda` #1 ("Roda Mensal — Valparaíso", a mesma do seed — atualizada pra bater com o que o
  `seed.ts` agora declara), `Roda` #2 ("Roda de Teste") e `Event` #2 ("Evento Acentuado") — cada
  uma com uma foto de capoeira distinta do Unsplash (busca `capoeira` no site, 3 fotos diferentes,
  confirmadas com `HEAD` request 200 antes de usar).
- Fotos escolhidas via busca real no unsplash.com (navegador), não inventadas — evita o problema
  do antigo `source.unsplash.com` (descontinuado/instável); usa a URL direta
  `images.unsplash.com/photo-<id>?q=80&w=800&auto=format&fit=crop`, mesmo padrão de tamanho já
  usado no teste manual do §10.22.

#### Validação empírica

1. `psql` direto confirmou as 3 linhas atualizadas com URLs distintas.
2. **Validação ao vivo no navegador** (servidores de dev já estavam de pé, reaproveitados): Home
   mostra os cards de "Roda Mensal — Valparaíso" e "Roda de Teste" com fotos reais de capoeira
   (pessoas jogando capoeira na rua, roda com atabaque) em vez do placeholder ilustrado.
   Calendário (`ComunidadeView`) mostra as mesmas duas rodas com foto — confirma que `FeedCard`
   compartilhado entre Home e Comunidade renderiza igual nos dois lugares. "Evento Acentuado" não
   apareceu no `/calendar` nesta checagem (esperado — só entra se `isPublic=true`; não é regressão
   deste backfill, é o filtro de visibilidade já existente do `/calendar`).

**Nota:** isto é backfill de **dados de ambiente de dev/teste**, não uma mudança de produto — em
produção, cada Roda/Event real só vai ter foto quando alguém colar a URL no painel (funcionalidade
entregue no §10.22). As pendências 67/68 do §10.22 continuam abertas.

### 10.24 Refino visual pós-feed: aviso sem imagem, tabs/menu deslizantes, card hero

**Data:** 2026-09-17 · **Status:** ✅ concluído. Feedback direto do owner logo após o §10.23,
quatro pontos num só pedido:

> "Cards de Aviso não precisa ser um card com imagem não faz sentido. e menu quero que seja
> redondo flutuante com animação de slide ao trocar. todos os filtros e tabs quero que sejam
> estilo Tabs redondo deslizantes tambem. os estilos dos cards quero melhor, imagem com filtro
> transparente por cima, e textos por cima sem um container branco por baixo."

#### O que foi construído

1. **`AnnouncementCard.vue`** (novo, `components/ui/`): card de Aviso sem imagem — ícone
   `megaphone` num círculo `bg-accent-soft`, título + corpo + horário relativo, `bg-surface`
   simples. Antes, Avisos usavam o mesmo `FeedCard` dos eventos/rodas e sempre caíam no
   placeholder ilustrado de imagem (não fazia sentido pra um item que é só texto). `HomeView.vue`
   agora decide por `item.kind === 'aviso'` qual dos dois cards renderizar dentro do mesmo loop do
   feed (`<template v-for>` com `v-if`/`v-else`).
2. **`SlidingTabs.vue`** (novo, `components/ui/`, genérico via `<script setup generic="T extends
   string">` pra preservar o tipo literal do `v-model`, ex.: `Scope`/`FeedFilter`, em vez de
   alargar pra `string`): pill de filtro com indicador deslizante — mede `offsetLeft`/`offsetWidth`
   do botão ativo (via refs, `nextTick`) e anima com `transition-all duration-300`, funciona com
   opções de largura desigual. **SSOT** de todo filtro/tab redondo do app: substituiu os dois loops
   manuais de `<button>` que existiam duplicados (`ComunidadeView.vue`'s `SCOPE_OPTIONS` e
   `HomeView.vue`'s `FILTERS`). Os `<select>` de tipo/estado/cidade do Calendário **não** foram
   convertidos — são dropdowns com listas longas (ex.: 27 estados), não cabem no paradigma de tabs;
   só os grupos de botão-pill existentes viraram `SlidingTabs`.
3. **`MobileLayout.vue`** — bottom nav virou um menu **flutuante redondo**: `fixed bottom-4`
   (antes era fixo colado embaixo, full-width, com borda), `rounded-full bg-surface shadow-lg`
   dentro de um `max-w-[22rem]` centralizado. Indicador de aba ativa é uma cápsula `bg-accent` que
   desliza via `transform: translateX(calc(index * 100%))` — como as 5 colunas são
   `grid-cols-5` (largura igual), não precisa medir pixel nenhum: `translateX(N * 100%)` desloca
   exatamente N larguras de coluna, só trocando o índice a cada navegação
   (`transition-transform duration-300`). `pb-24` do `<main>` virou `pb-28` pra dar espaço ao nav
   flutuante (que agora tem `bottom-4` de gap, diferente do nav anterior colado no rodapé).
4. **`FeedCard.vue`** — reformulado de "imagem em cima + painel branco embaixo" pra **hero card**:
   a imagem (ou o degradê+ícone de placeholder) ocupa o card inteiro (`h-48`), com um filtro escuro
   transparente por cima (`bg-gradient-to-t from-black/85 via-black/15 to-black/5`) pra dar
   contraste, e badge/título/meta/localização ficam posicionados diretamente sobre a imagem em
   texto branco (`absolute`, sem nenhum container `bg-surface` embaixo). Badge moveu de
   baixo-esquerda pra cima-esquerda (o rodapé agora é só texto). Placeholder sem imagem usa o
   mesmo esquema (degradê da paleta + ícone bem grande e translúcido + o mesmo filtro escuro por
   cima), pra manter os dois casos (com/sem foto) visualmente consistentes.

#### Validação empírica

1. Build do `app.gingapp.com.br` limpo (`vue-tsc -b && vite build`) — inclusive o genérico do
   `SlidingTabs` tipando corretamente contra `Scope` e `FeedFilter` sem precisar de `as` nem
   alargar pra `string` nos dois call-sites.
2. **Validação ao vivo no navegador** (dev server já estava de pé, reaproveitado): Home mostra
   Avisos como card de texto simples (sem imagem), filtro "Tudo/Rodas/Eventos/Avisos" com pílula
   verde deslizando ao trocar (clicado em "Eventos", pílula moveu e a lista filtrou — vazio porque
   não há evento público hoje, esperado), cards de Roda como hero com foto+filtro escuro+texto
   branco sobreposto (sem painel branco). Bottom nav flutuante confirmado em `/app` e
   `/app/comunidade` — cápsula verde desliza pra trás do ícone certo em cada rota (conferido via
   `read_page`, não só visual, depois de notar que um screenshot capturado a meio da transição CSS
   mostrava a cápsula ainda deslizando por cima do vizinho — não era bug, só timing do screenshot).
   Calendário com os mesmos cards hero, confirma que `FeedCard` continua compartilhado entre Home e
   Comunidade.
3. Não foram tocados: `.vue` do painel/admin (fora de escopo deste pedido, que era só sobre o PWA),
   `<select>` de tipo/estado/cidade do Calendário (decisão registrada acima), lógica de dados/API
   (mudança 100% visual, nenhum endpoint ou DTO tocado).

### 10.25 Hierarquia da saudação, fonte de destaque, verde mais suave, mais fluidez

**Data:** 2026-09-17 · **Status:** ✅ concluído. Quarto refinamento visual seguido, pedido do owner
num só balaço:

> "a saudação quero maior que o ginga brasil, tem que ser ao contrario, a fonte do ola ana e
> diferente uma fonte bonita. tambem quero mais fluides e animações melhores. os tons verdes to
> achando muito forte, quero mais fraco."

#### O que foi construído

1. **Hierarquia do header da Home invertida**: antes o nome da organização (`h1`, `text-xl
   font-bold`) era o elemento maior e a saudação (`Olá, Ana`) era um `p` pequeno em itálico acima
   dele. Agora é o oposto — nome da organização virou um label pequeno (`text-xs uppercase
   tracking-wide text-text-muted`) e a saudação virou o elemento grande (`text-4xl`).
2. **Fonte de destaque só pra saudação**: nova variável `--font-display: "Caveat", "Segoe Script",
   cursive` em `style.css`, carregada via `@import url(fonts.googleapis.com/...)` (Google Fonts,
   `Caveat` pesos 600/700 — script/manuscrita, dá um ar pessoal/caloroso, bem diferente da sans
   `Inter` usada no resto do app). Gera a utility `font-display` do Tailwind 4 automaticamente
   (tema `--font-*`). Único lugar que usa: `<h1>` da saudação na Home — o resto do app continua
   100% na sans.
   - **Gotcha resolvido:** o `@import` do Google Fonts colocado *depois* de `@import "tailwindcss"`
     gerava warning de build ("@import rules must precede all rules") porque o Vite/Lightning CSS
     expande o `@import "tailwindcss"` em várias regras antes de processar o import seguinte.
     Corrigido invertendo a ordem: `@import` da fonte **antes** de `@import "tailwindcss"`.
3. **Verde mais suave em todo o app**: `--color-accent` de `#22c55e` (green-500, saturado/vívido)
   pra `#3b9b5e` (mais dessaturado e um pouco mais escuro); `--color-accent-hover` de `#16a34a`
   pra `#2f7d4c`; `--color-success` (que já era um alias do accent) atualizado igual.
   `--color-accent-soft` recalculada pra mesma opacidade (~10%) sobre a nova cor-base. Como é tudo
   token central (`@theme` em `style.css`, nenhuma view tem hex hardcoded), a troca afeta o app
   inteiro sem tocar em nenhuma view. **Achado colateral:** o verde mais "fraco" pedido pelo owner
   na verdade tem *melhor* contraste com texto branco em cima (calculado via WCAG relative
   luminance: contraste branco-sobre-verde subiu de ~2.28:1 pro antigo `#22c55e` pra ~3.47:1 no
   novo `#3b9b5e`) — dessaturar + escurecer levemente resolveu "parece forte" e "acessibilidade"
   ao mesmo tempo, sem ter sido esse o objetivo original do pedido.
4. **Mais fluidez e animações**:
   - Nova curva de easing única (`--ease-fluid: cubic-bezier(0.22, 1, 0.36, 1)`, gera a utility
     `ease-fluid` do Tailwind 4 via tema `--ease-*`) — substitui o `ease-out`/`ease` padrão do
     navegador nas transições de destaque (indicador do `SlidingTabs`, cápsula do bottom nav).
   - **Transição de rota**: `router-view` do `MobileLayout.vue` envolvido num
     `<transition name="page" mode="out-in">` (API de slot do Vue Router 4) — fade + leve slide
     vertical (8px) ao trocar de tela pela bottom nav, 220ms.
   - **Entrada animada dos cards do feed**: nova utility `--animate-rise` (tema `--animate-*` do
     Tailwind 4, referencia `@keyframes rise-in` — fade + sobe 12px), aplicada em cada
     `FeedCard`/`AnnouncementCard` do loop via `class="animate-rise"` +
     `:style="{ animationDelay: \`${index * 60}ms\` }"` — efeito de entrada em cascata (stagger),
     em vez de tudo aparecer de uma vez. Usado em `HomeView.vue` e `ComunidadeView.vue`.
   - **Feedback de toque**: `active:scale-95`/`active:scale-90`/`active:scale-[0.98]` +
     `transition-transform` adicionados nos elementos tocáveis que ainda não tinham (botões de
     quick-link da Home, sino de notificação, `FeedCard` inteiro, botões do `SlidingTabs`, itens
     do bottom nav) — cada toque agora "afunda" visualmente em vez de mudar de estado
     instantaneamente. `AnnouncementCard` ficou de fora de propósito (não é clicável, não navega
     pra lugar nenhum).

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`), sem warnings — inclusive depois de corrigir a ordem
   do `@import` da fonte. Conferido no CSS gerado (`dist/assets/index-*.css`) que as 3 novas
   utilities (`ease-fluid`, `font-display`, `animate-rise`) e o `@font-face`/import do Caveat
   saíram no bundle final, não só no source.
2. **Validação ao vivo no navegador** (dev server reaproveitado): saudação "Olá, Ana" grande, em
   itálico manuscrito (Caveat), acima do label pequeno "GINGA-BRASIL"; verde visivelmente mais
   suave em toda a UI (pílula ativa do filtro, ícones de destaque, badge do card, cápsula do nav).
   Troca de rota pela bottom nav mostrou o fade+slide da página (capturado um screenshot a meio da
   transição, com a Jornada sumindo enquanto a cápsula do nav já deslizava pra Início — confirma
   as duas animações rodando em paralelo, não sequencial). Cards do feed reaparecem com opacidade
   baixa por um instante ao remontar a Home (fetch assíncrono de `/calendar`+`/announcements` +
   `animate-rise` em cascata) antes de assentar — comportamento esperado, não é regressão.
3. Não foram tocados: painel/admin (fora de escopo, só o PWA foi pedido), lógica de dados/API.

### 10.26 Imagens e estilo hero nas telas dedicadas de Rodas e Eventos

**Data:** 2026-09-17 · **Status:** ✅ concluído. Pedido do owner: "TELA de rodas e eventos tambem
adicionar a imagens e estilos" — as telas dedicadas `/app/rodas` e `/app/eventos` (acessadas pelos
quick-links da Home, diferentes do feed unificado Home/Comunidade) ainda estavam no estilo antigo
pré-redesign: `<article>` com `bg-surface p-5` plano, sem imagem nenhuma (o campo `imageUrl` do
§10.22 nunca tinha chegado nessas duas telas — só em `HomeView`/`ComunidadeView` via `/calendar`).

#### Por que não dava pra só reusar o `FeedCard` como estava

Rodas e Eventos têm ação de verdade (botão "Quero participar"/"Cancelar presença", contagem de
confirmados, descrição do evento) que o `FeedCard` do feed não precisa — lá o card inteiro é só um
link (`to`). Em vez de duplicar o markup do hero (imagem + degradê + badge + texto sobreposto) nas
duas views, **`FeedCard.vue` ganhou um slot default opcional**: o miolo da imagem virou uma `<div
class="relative h-48">` interna (antes essa altura fixa era do card inteiro), e um `<slot />` foi
adicionado depois dela, em fluxo normal — sem slot usado (Home/Comunidade), o card continua sendo
só a imagem hero, pixel-idêntico a antes. Com slot (Rodas/Eventos), o conteúdo extra (botão,
contagem, descrição) aparece abaixo da imagem, num `bg-surface` (aproveitando a mesma regra global
de sombra `.rounded-card-lg.bg-surface` do `style.css`, já que o card passou a ter essa classe).
**SSOT mantido** — zero duplicação do markup de hero entre as 3 telas que agora usam `FeedCard`.

**Correção colateral:** o ícone de "external-link" no canto superior direito (indicando "isso é um
link, toque pra abrir") aparecia sempre, mesmo quando o card não tinha `to` — no uso de
`ComunidadeView.vue` (que nunca passou `to`) isso já era inconsistente antes deste pedido, só
ninguém tinha notado. Corrigido: o ícone agora só aparece `v-if="to"`.

#### O que foi construído

- **`RodasView.vue`**: `imageUrl: string | null` adicionado à interface `Roda` (a resposta de
  `GET /rodas` já retornava o campo desde o §10.22 — só a view não lia). Card antigo trocado por
  `<FeedCard icon="drum" :image-url="roda.imageUrl" badge="Roda" ...>` com o botão de participação
  e "N confirmados" dentro do slot.
- **`EventosView.vue`**: mesma coisa — `imageUrl` na interface `Event`, `<FeedCard icon="ticket"
  :badge="evento.isPublic ? 'Evento público' : 'Evento'" ...>`, descrição + botão no slot. Estado
  vazio também trocado do parágrafo solto antigo pro `EmptyState` (mesmo componente já usado nas
  outras telas — mais uma pequena inconsistência de estilo antiga corrigida de graça).
- Entrada em cascata (`animate-rise` + `animationDelay` por índice, mesmo padrão do §10.25)
  aplicada nos cards de ambas as telas.

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`).
2. **Validação ao vivo no navegador**: `/app/rodas` e `/app/eventos` mostrando os cards hero com
   foto real, badge, botão de participação funcionando visualmente (estado "Cancelar presença"
   pra quem já confirmou presença, "Quero participar" pra quem não confirmou). Confirmado que o
   ícone de external-link não aparece mais em nenhum card sem `to` (Rodas, Eventos, Comunidade).
   **Achado durante a validação, não um bug de código:** o card do "Evento Acentuado" apareceu
   quase todo cinza — investigado (`naturalWidth`/`complete` da tag `<img>` via `javascript_tool`
   confirmaram que a imagem *carregou* normalmente) e a causa era a própria foto: uma das 3
   escolhidas no backfill do §10.23 é uma cena de praia com muito céu/mar claro no terço superior,
   que em um crop bem baixo e largo (`object-cover` num card de 192px de altura por quase 1000px
   de largura) mostra quase só o céu nublado. Trocado por outra foto de capoeira do mesmo banco de
   busca (berimbau em close, sujeito mais centralizado verticalmente) via `psql` direto — não
   precisou tocar em código, é dado de teste, mesma natureza do §10.23.
3. Não foram tocados: painel/admin, `AnnouncementCard` (não é usado nessas telas), lógica de
   dados/API (o `imageUrl` já existia no backend desde o §10.22; esta etapa só passou a exibi-lo
   nas duas telas que faltavam).

### 10.27 Correção: card de Rodas/Eventos tinha painel branco embaixo — não era o pedido

**Data:** 2026-09-17 · **Status:** ✅ concluído. Owner rejeitou o resultado do §10.26 na hora:

> "eu disse mesmo visual dos cards da home cara"

O §10.26 tinha adicionado imagem e um botão de ação nos cards de Rodas/Eventos, mas o botão (e a
contagem de confirmados) ficavam num rodapé `bg-surface p-4` **abaixo** da imagem — visualmente
diferente do card da Home/Comunidade, que não tem nenhum painel branco, só a imagem com o texto
sobreposto direto nela. O pedido original era "mesmo visual dos cards da home", não "imagem +
qualquer estilo" — reli o pedido anterior (§10.26: "TELA de rodas e eventos tambem adicionar a
imagens e estilos") e a interpretação errada foi tratar "estilos" como "algum estilo consistente",
quando o owner já tinha deixado claro no pedido anterior (§10.24) que o padrão da casa é **sem
container branco embaixo da imagem**.

#### Correção

- **`FeedCard.vue`**: removido o `<slot />` default (que renderizava abaixo da imagem, em
  `bg-surface`) — revertido pra estrutura do §10.24 (root é a própria imagem `h-48`, sem wrapper
  nem `bg-surface`). No lugar, um **slot nomeado `actions`** foi colocado *dentro* do bloco de
  texto sobreposto (depois da localização), então qualquer conteúdo passado nele herda o mesmo
  contexto visual (em cima do degradê escuro, texto branco) em vez de cair num container separado.
- **`RodasView.vue`**: contagem de confirmados e botão movidos pro `<template #actions>` — texto
  em branco/80% (`text-white/80`), botão em pílula `bg-accent` (não participando) ou `bg-white/20
  backdrop-blur-sm` (participando, mesmo tom translúcido do badge/external-link), tudo sobreposto
  na imagem.
- **`EventosView.vue`**: mesma coisa pro botão de participação. A descrição do evento (que também
  tinha ido pro rodapé branco no §10.26) foi **removida** da exibição do card — os cards da
  Home/Comunidade também não mostram descrição longa nenhuma, só título/data/local; manter a
  descrição exigiria ou um rodapé (o que o owner rejeitou) ou um bloco de texto grande sobreposto
  na imagem (poluiria o visual). Se a descrição fizer falta, é pendência em aberto pra perguntar
  ao owner como ele quer resolver (não decidido unilateralmente).

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`).
2. **Validação ao vivo no navegador**: `/app/rodas` e `/app/eventos` — botão de participação e
   contagem agora sobrepostos na imagem, card idêntico em estrutura ao da Home (mesma altura h-48,
   mesmo degradê, zero painel branco). Testado o toggle de participação de verdade num evento real
   ("Evento Acentuado": clicado "Cancelar presença" → virou "Quero participar" → clicado de novo
   pra voltar ao estado original) — confirma que mover o botão pro slot `actions` não quebrou
   nenhuma interação, só o estilo.
3. **Pendência nova:** 69. `EventosView.vue` deixou de mostrar a descrição do evento no card (era
   exibida no §10.26, removida nesta correção pra bater com o visual da Home) — perguntar ao owner
   se isso é aceitável ou se ele quer a descrição de volta de alguma forma (ex.: só num modal de
   detalhes, nunca no card em si).

### 10.28 Dropdowns estilizados + foto de perfil na Home

**Data:** 2026-09-17 · **Status:** ✅ concluído. Pedido do owner: "melhore os dropdowns mais
estilosos. tambem coloque a foto de perfil na home" — dois pedidos independentes na mesma
mensagem.

#### Dropdowns

Os três `<select>` de filtro do Calendário (`tipo`/`estado`/`cidade`, em `ComunidadeView.vue`)
eram `<select>` nativos crus (`rounded-card bg-surface`, sem mais nada) — apareciam com a seta e a
aparência default do navegador/SO, destoando do resto do app (pílulas, sombras suaves, ícones
próprios). Eram os **únicos** `<select>` de todo o PWA (confirmado por grep antes de mexer — nada
mais ficou de fora).

- **Novo ícone `chevron-down`** em `AppIcon.vue` (mesmo estilo dos outros, path `M6 9l6 6 6-6`).
- **Novo `SelectField.vue`** (`components/ui/`): envolve o `<select>` nativo (mantém teclado,
  acessibilidade e o picker mobile nativo de graça — não é um dropdown customizado do zero) só
  trocando a casca visual — `appearance-none` remove a seta do navegador, pílula `rounded-full
  bg-surface` (mesmo tom da trilha do `SlidingTabs`), ícone `chevron-down` próprio posicionado à
  direita, anel de foco `focus:ring-2 ring-accent/30`, opacidade reduzida quando `disabled`.
- `ComunidadeView.vue` atualizado pra usar `<SelectField>` nos 3 filtros — `v-model` continua
  funcionando igual (o componente emite `update:modelValue` no `@change` do select interno).

#### Foto de perfil na Home

`Student.photo` (campo que já existia no schema, mesma convenção leve de `Roda.imageUrl` — só
URL, sem upload) nunca era lido em lugar nenhum do PWA: nem a Home, nem o próprio `PerfilView.vue`
(que mostrava **sempre** um círculo com a inicial do nome, mesmo pra quem tinha foto cadastrada).

- **Novo `AvatarCircle.vue`** (`components/ui/`): mostra a foto real quando existe (`<img
  rounded-full object-cover>`), cai pro círculo com a inicial do nome (`bg-accent`, mesmo padrão
  que já existia hardcoded só dentro do `PerfilView.vue`) quando não há. Props `photo`, `name`,
  `size` — reusável em qualquer tamanho.
- **`HomeView.vue`**: `photo: string | null` adicionado à interface `Student` (endpoint `GET
  /students/me` já retornava o campo — só a view não lia, mesma situação do `imageUrl` antes do
  §10.22). Header ganhou o avatar (48px) à esquerda da saudação, dentro de um `router-link` pra
  `/app/perfil` — cabeçalho agora é avatar + [nome do grupo / saudação] de um lado, sino do outro.
- **`PerfilView.vue`** também atualizado pra usar `AvatarCircle` com a foto real (80px) no lugar do
  círculo de inicial hardcoded — não foi pedido explicitamente pro Perfil, mas fazia pouco sentido
  mostrar a foto na Home e continuar escondendo ela na própria tela de Perfil; decisão sinalizada
  aqui, não escondida.
- **Sem gestão de foto ainda** (nem no painel, nem autoatendimento) — mesma limitação que
  `Roda.imageUrl` tinha antes do painel ganhar o campo; registrado como pendência 70.

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`).
2. **Validação ao vivo no navegador**: dropdowns do Calendário testados via `form_input`
   (mudança de Estado pra "Goiás" disparou corretamente o carregamento de cidades e habilitou o
   select de Cidade — confirmado via `read_page`, não só visual) — a leitura inicial do
   screenshot pareceu mostrar o texto acinzentado mesmo sem estar desabilitado, then verificado via
   `getComputedStyle` que a cor do texto (`#16181d`, o token `--color-text`) e `disabled: false`
   estavam corretos nos três selects; era só artefato de renderização do screenshot, não um bug
   real (mesma categoria de falso-alarme já visto com timing de animação nesta sessão).
3. **Validação da foto de perfil**: backfill temporário de `Student.photo` (foto real de retrato
   via Unsplash, confirmada com `HEAD` 200 antes de usar) pro aluno de teste "Ana Capoeirista" —
   confirmado na Home e no Perfil mostrando a foto de verdade; depois `photo = NULL` de volta via
   `psql`, confirmado o fallback pro círculo com inicial "A" renderizando corretamente (esta foi
   uma validação pontual da minha parte, não um pedido de backfill permanente como o do §10.23 —
   por isso foi revertida ao final, e não mantida).
4. **Pendência nova:** 70. Não há como um aluno/responsável definir a própria foto de perfil ainda
   (nem no painel, nem autoatendimento no PWA) — o campo `photo` existe e agora é exibido, mas
   fica sempre vazio na prática até existir algum fluxo de upload/URL, igual ao que
   `Roda.imageUrl`/`Event.imageUrl` precisaram do painel pra virar utilizável de verdade (§10.22).

### 10.29 Redesign da tela de Jornada — cor real da graduação, timeline conectada

**Data:** 2026-09-17 · **Status:** ✅ concluído. Pedido do owner: "AGORA preciso que melhore a
tela de jornada" — pedido aberto (sem referência específica), então a leitura foi: trazer
`JornadaView.vue` pro mesmo nível visual do resto do app já redesenhado (Home, Comunidade,
Rodas, Eventos), que ela tinha ficado pra trás (ainda no estilo flat da era do redesign v2,
§10.20 — card de destaque bloco de cor sólida, lista simples sem conexão visual de "linha do
tempo" apesar do nome da seção).

#### Achado: `GraduationLevel.color` existia no schema e nunca era usado em lugar nenhum

Investigação antes de redesenhar: `GraduationLevel` tem um campo `color: String?` (confirmado via
`psql`: `Crua` = `#e5e5e5`, `Verde` = `#22c55e`, `Azul` = `#3b82f6` — cores reais das cordas já
cadastradas) que a tela nunca lia. O card "Graduação atual" usava sempre `bg-accent` (verde fixo,
igual pra qualquer graduação) e os pontos da timeline usavam sempre `bg-accent-soft`/`bg-bg-elevated`
genéricos — a cor de cada corda, que é justamente o dado mais identitário de uma graduação de
capoeira, não aparecia em lugar nenhum da tela que existe pra mostrar exatamente isso.

#### O que foi construído

1. **Card "Graduação atual"** agora usa `backgroundColor: currentGraduation.graduationLevel.color`
   (inline style, com fallback pra `var(--color-accent)` se `color` vier `null`) em vez de
   `bg-accent` fixo — com um `<div class="absolute inset-0 bg-black/30">` por cima, mesmo
   raciocínio do filtro escuro do `FeedCard` (§10.24): garante texto branco legível em cima de
   **qualquer** cor, inclusive uma bem clara como o cinza-quase-branco da "Crua" (sem o filtro, o
   texto branco ficaria ilegível nessa cor).
2. **Timeline com linha conectora de verdade**: cada nó agora é um anel colorido (`border-[3px]`
   na cor da graduação, fundo `bg-surface` — nunca preenchido sólido, pra não ter problema de
   contraste com o ícone dentro, que também usa a cor da graduação) ligado ao próximo por uma
   barrinha vertical (`w-0.5 flex-1 bg-border`, dentro de um `flex-col` — cresce automaticamente
   pra preencher o espaço até o próximo nó, sem medir pixel nenhum). Antes era só uma lista de
   linhas soltas dentro de um card, sem nenhuma conexão visual — não parecia de fato uma "linha do
   tempo".
3. Entrada em cascata (`animate-rise` + delay por índice, mesmo padrão do resto do app desde o
   §10.25) nos itens da timeline e nos certificados; feedback de toque (`active:scale-95`) nos
   botões "QR Code"/"Copiar link"/"Fechar" que ainda não tinham.

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`).
2. **Validação ao vivo no navegador**: aluno de teste com graduação "Azul" (`#3b82f6`) — card de
   destaque renderizou em azul com o filtro escuro por cima (texto branco legível), timeline
   mostrando o nó "Crua" com anel cinza-claro e "Azul" com anel azul, linha conectora entre os
   dois nós visível. Seção de certificados testada implicitamente (vazia pra esse aluno de teste —
   `v-if` escondeu a seção corretamente, sem erro).
3. Não foi criado nenhum backfill de dados pra esta etapa — as cores já existiam no banco desde
   antes (provavelmente do seed original do projeto, nunca tocadas nesta sessão).

### 10.30 Timeline da Jornada refeita no estilo de referência (grande, data à esquerda, linha tracejada)

**Data:** 2026-09-17 · **Status:** ✅ concluído. Logo após o §10.29, o owner colou um print de
referência (app de reserva de voos, listagem de horários com foto circular, linha vertical
tracejada com pontos laranja, data à esquerda) e pediu:

> "que tal a timeline, numa listagem de linha do tempo mesmo assim. so que maior bem grande mesmo
> de cima a baixo ta tela toda."

Ou seja: manter o conceito de timeline vertical do §10.29 (isso já estava certo — ele só quis
mais um ajuste de estilo, não uma reformulação), mas no layout específico da referência
(data à esquerda da linha, não à direita) e com escala bem maior (item bem mais alto/espaçado,
enchendo a tela toda com poucos itens, como no print).

#### O que mudou

- **Data movida pra esquerda da linha** (era à direita do conteúdo no §10.29): agora um grid de 3
  colunas (`grid-cols-[2.75rem_2rem_1fr]`) — data | trilho da linha | conteúdo. Data em duas
  linhas empilhadas (mês abreviado maiúsculo + ano), duas novas funções `formatMonthShort`/
  `formatYear` (a antiga `formatDate` combinava as duas num string só, virou código morto e foi
  removida).
- **Escala bem maior**: círculo do ícone foi de 36px (`h-9 w-9`) pra 56px (`h-14 w-14`); espaço
  vertical entre itens foi de `pb-5` (1.25rem) pra `pb-9` (2.25rem). Com isso, poucos itens (2-3)
  já ocupam a maior parte da tela, igual ao print de referência (5 itens enchendo a tela toda).
  Também tirado o `bg-surface p-4` que envolvia a lista inteira (rounded-card-lg) — a referência
  não tem esse container, a timeline "respira" direto contra o fundo da página.
- **Ponto na linha**: pequeno círculo colorido (cor da graduação) com um anel `ring-4 ring-surface`
  ao redor, criando o efeito de "furar" a linha tracejada — mesmo efeito visual do ponto laranja
  destacado do print.
- **Contraste do ícone resolvido com heurística de luminância**: como agora o círculo é bem maior
  e mais protagonista (parecido com a foto circular do print), o ícone precisa de contraste
  garantido em cima de QUALQUER cor de graduação — nova função `readableIconColor(hex)` calcula
  luminância relativa simplificada (sem correção gama, threshold 0.75) e escolhe ícone escuro
  (`#16181d`) ou branco (`#ffffff`). Testado com as 3 cores reais do banco: "Crua" `#e5e5e5`
  (luminância ~0.9) → ícone escuro; "Verde" `#22c55e` (~0.61) e "Azul" `#3b82f6` (~0.48) → ícone
  branco. Substitui a abordagem do §10.29 (anel colorido em fundo branco), que evitava o problema
  de contraste em vez de resolvê-lo — não dava mais pra usar essa abordagem com um círculo grande
  e preenchido como o do print.

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build` — pegou e corrigiu um `formatDate` órfão depois da
   troca pras duas funções novas).
2. **Validação ao vivo no navegador com 2 e com 3 itens**: com as 2 graduações reais do aluno de
   teste (Crua/Azul), confirma visual igual à referência. Pra testar o caso de 3 nós (a
   referência tem 5), inserida temporariamente uma 3ª `StudentGraduation` de teste ("Verde",
   entre as duas datas reais, via `psql` direto — precisou descobrir por tentativa que
   `StudentGraduation` exige `organizationId` e não tem coluna `updatedAt`, diferente do que eu
   assumi de início) — confirmado visualmente que o ícone da "Verde" ficou branco (contraste
   correto) e a linha tracejada conecta os 3 nós corretamente. **Registro de disciplina de dados**
   (mesmo padrão do §10.22/§10.23/§10.28): linha de teste **removida** via `psql` (`DELETE ... WHERE
   id = 17`) logo depois da validação — não é backfill permanente, era só pra ver 3 nós na tela.
3. Não foram tocados: card "Graduação atual" (o pedido era só sobre a timeline), certificados,
   lógica de dados/API.

### 10.31 Perfil redesenhado: capa + avatar sobreposto + redes sociais (auto-atendimento de verdade)

**Data:** 2026-09-17 · **Status:** ✅ concluído. Owner colou um print de referência (card de
perfil de designer: foto de capa/paisagem, avatar circular sobreposto na borda inferior da capa,
nome + tagline, ícones de redes sociais, stats, botão de contato) e pediu:

> "a tela de perfil quero assim neste estilo. tambem com fundo e poder adicionar foto de fundo, e
> botões das redes sociais."

Diferente dos pedidos de imagem anteriores (§10.22, Roda/Event — dado gerenciado pelo painel/
admin), aqui o owner pediu explicitamente **poder adicionar** a foto de capa — é dado pessoal do
próprio praticante, então precisa de auto-atendimento de verdade (o próprio usuário edita, sem
depender do painel), não só exibição de um campo populado por outra pessoa.

#### Backend — novo endpoint de auto-atendimento

- **Schema**: `Student.coverPhoto` (`String?`) e `Student.socialLinks` (`Json?`, objeto com chaves
  fixas `instagram`/`youtube`/`tiktok`/`facebook`/`whatsapp`, todas opcionais) — migration
  `add_student_cover_social` (mesmo procedimento manual não-interativo de sempre: `migrate diff
  --script` + pasta manual + `migrate deploy`; **gotcha da vez**: o timestamp gerado por `date
  +%Y%m%d%H%M%S` ficou **anterior** ao de uma migration já aplicada mais cedo nesta sessão —
  aparentemente o relógio do sistema tinha avançado e voltou, ou a sessão anterior rodou num
  horário adiantado; `migrate deploy` aplicou normalmente mesmo assim, sem reclamar de ordem).
- **Novo `PATCH /students/me/profile`** (`UpdateMyProfileDto`, campo novo
  `update-my-profile.dto.ts`) — o `PATCH /students/:id` existente exige `@CanAccess('students',
  'edit')` (só MESTRE/admin), então não servia pra um ALUNO comum editar o próprio registro.
  O novo endpoint **não passa por `@CanAccess`**: a segurança vem de só encontrar/editar o
  `Student` cujo `userId` bate com o token (mesmo raciocínio de `findMine`, usado desde o
  `GET /students/me`), igual peer-review de autorização por posse em vez de RBAC. Só aceita
  `photo`/`coverPhoto`/`socialLinks` — nunca os campos administrativos (`name`, `status`,
  `document`...), que continuam exclusivos do `PATCH /students/:id`. Um usuário sem `Student`
  próprio (ex.: RESPONSAVEL puro, só com dependentes) recebe 404 — este endpoint edita o PRÓPRIO
  perfil, nunca o de terceiros mesmo que dependentes.
- `SocialLinksDto` aninhado, validado com `@ValidateNested()` + `@Type(() => SocialLinksDto)`
  (primeiro uso desse padrão no projeto — `class-transformer`/`ValidationPipe({transform:true})`
  já estavam configurados globalmente, só nunca tinha sido preciso validar um objeto aninhado
  antes). Cada rede social validada com `@IsUrl()` — submeter `socialLinks` sempre **substitui** o
  objeto inteiro (o formulário do PWA sempre envia os 5 campos juntos, nunca um patch parcial).
- **3 novos testes e2e** em `students.e2e-spec.ts`: PATCH de sucesso (confirmado via Prisma,
  restaurado ao final por ser o Student do seed, não uma fixture da suíte), PATCH com URL inválida
  em `socialLinks` → 400 (nada gravado), PATCH como MESTRE (sem Student próprio) → 404. **Suíte
  completa revalidada: 148 testes, 148 passaram** (subiu de 145 — as 3 novas menos as antigas que
  já existiam batem com a matemática: 145 + 3 = 148).

#### PWA — header no estilo do print

- **`AppIcon.vue`**: 6 ícones novos — `pencil` (botão de editar) e 5 ícones de rede social
  (`instagram`, `facebook`, `whatsapp`, `youtube`, `tiktok`), todos versões **simplificadas em
  traço** no mesmo estilo do resto do conjunto (viewBox 24x24, stroke 2px) — não os logos oficiais
  pixel-a-pixel, o bastante pra reconhecer a plataforma num botão pequeno sem sair do sistema de
  ícones minimalista do app (nunca emoji, nunca logo colorido importado).
- **`PerfilView.vue`** reestruturado: capa (`h-40 rounded-card-lg`, foto real ou degradê da
  paleta) com filtro escuro sutil por cima (mesmo raciocínio de contraste do `FeedCard`/timeline
  da Jornada) e botão de lápis no canto superior direito; `AvatarCircle` (88px, anel `ring-bg`)
  sobreposto na borda inferior via posicionamento absoluto (`-bottom-11`); nome + cargo/organização
  abaixo; fileira de ícones de rede social (só renderiza os que têm link preenchido).
- **`myStudent` computed** — achado importante durante a implementação: `GET /students/me` pode
  retornar o Student do PRÓPRIO usuário **e/ou** dependentes (se for RESPONSAVEL), sem ordem
  garantida por índice. Usar `students[0]` pra "meu perfil" seria **errado** — pra um RESPONSAVEL
  sem Student próprio, `students[0]` seria um dependente, e mostrar/editar a capa dele como se
  fosse a "minha" seria um bug de identidade. Corrigido: `myStudent` filtra por
  `s.userId === auth.user?.id`, nunca por posição no array.
- **Modal de edição** (`isEditModalOpen`): campos de foto de perfil, foto de capa e os 5 links de
  rede social, populados a partir de `myStudent` ao abrir, enviados via `PATCH
  /students/me/profile` ao salvar, recarregando `students` depois — pencil button só aparece
  quando `myStudent` existe (RESPONSAVEL puro não vê a opção de editar um perfil que não tem).

#### Validação empírica

1. Backend: build limpo, suíte e2e completa 148/148.
2. Frontend: build limpo (`vue-tsc -b && vite build`).
3. **Validação ao vivo no navegador**, fluxo completo: abriu o modal, preencheu capa + Instagram +
   WhatsApp, salvou — confirmado que a primeira URL de capa "chutada" sem verificar quebrou (ícone
   de imagem quebrada), corrigido buscando uma foto real no Unsplash e confirmando com `HEAD` 200
   antes de usar (lição já aprendida antes nesta sessão, dessa vez escorregou por pressa — mesmo
   fluxo de correção de sempre). Depois da correção: capa, avatar e os 2 botões de rede social
   (só os 2 preenchidos, não os 5) renderizando exatamente como o print de referência. Confirmado
   também o estado vazio (sem capa/redes) voltando ao degradê + iniciais + sem fileira de botões,
   sem erro. Dados de teste restaurados a `NULL` via `psql` ao final — mesmo padrão de disciplina
   do §10.22/§10.23/§10.28/§10.30 (validação pontual, não backfill permanente).

**Pendência nova:** 71. Não há como **limpar** um campo já preenchido (só sobrescrever com outro
valor) — o DTO usa `@IsOptional()`, que só pula validação pra `undefined`/campo omitido, nunca
aceita `null` explícito pra "apagar". Mesma limitação de design já presente em `Roda.imageUrl`/
`Event.imageUrl` desde o §10.22, agora também em `Student.photo`/`coverPhoto`/`socialLinks` — se
virar um problema real de uso, precisa de um tratamento explícito de "limpar campo" (ex.: string
vazia tratada como null no service, em vez de omitida no payload).

### 10.32 Correção: a linha conectora da timeline parava antes do próximo ponto

**Data:** 2026-09-18 · **Status:** ✅ concluído. Owner colou um print zoomado da própria timeline
(§10.30) e apontou: "a linha do tempo ainda não ficou bem desenhada" — feedback direto sobre o que
já tinha sido entregue, não um novo pedido.

#### Causa raiz (achada por medição de pixel, não só olhando)

Reproduzido no navegador e medido via `getBoundingClientRect()` (não só visual — a screenshot
sozinha não deixava claro *por que* estava ruim): a linha tracejada conectora **parava ~50px antes
do próximo ponto**, deixando um vão sem conexão visual — e o ponto em si tinha um `ring-4
ring-surface` (branco) sobre um fundo `bg-bg` (cinza claro), criando uma pequena mancha
desalinhada de cor ao redor de cada nó.

**Causa:** o espaçamento vertical entre itens (`pb-9`) estava no `<li>` (fora do grid), enquanto a
linha conectora (`flex-1` dentro da coluna do ponto) só cresce até preencher a altura da PRÓPRIA
linha do grid — que é definida pela altura do conteúdo mais alto entre as 3 colunas daquela linha
(o círculo de 56px), **sem incluir o padding do `<li>`**, que fica fora da área que o CSS Grid
estica (`align-items: stretch` estica só as células da grid-row, não o padding do elemento pai).
Resultado: a linha crescia só dentro do círculo de conteúdo (~40-50px) e o `pb-9` (36px) inteiro
ficava sem nada desenhado — daí o vão.

#### Correção

1. **Espaçamento movido pra dentro da coluna de conteúdo**: `pb-9` saiu do `<li>` e entrou na div
   do círculo+texto (`:class="index === timeline.length - 1 ? '' : 'pb-9'"`); adicionado
   `items-stretch` explícito no grid do `<li>`. Com isso, a coluna de conteúdo fica mais alta (ela
   mesma incorpora o espaçamento), o grid estica as OUTRAS colunas (data, ponto/linha) pra
   acompanhar essa altura maior, e a linha (`flex-1`) agora cresce até encostar de verdade no
   próximo ponto — medido depois da correção: vão residual de ~14px (só a folga do próprio anel
   `ring-4`), contra ~50px antes.
2. **Linha tracejada → linha sólida**: `border-l-2 border-dashed` trocado por `w-0.5 rounded-full
   bg-border` — bordas tracejadas em traços de 2px renderizam de forma inconsistente/apagada entre
   navegadores (o "dash" fica curto demais pra ler como linha contínua); uma barra sólida fina é
   mais previsível e ficou mais nítida.
3. **`ring-surface` → `ring-bg`**: o anel ao redor do ponto agora usa a cor real do fundo da
   página (`--color-bg`, cinza clarinho) em vez de branco puro — antes criava uma mancha branca
   destacada sobre um fundo que não é branco (a timeline não tem mais o container `bg-surface` que
   envolvia tudo, removido no próprio §10.30).
4. Colunas um pouco mais compactas (`grid-cols-[2.5rem_1.5rem_1fr]`, `gap-1` em vez do `gap-2`
   anterior) — reduz o vão horizontal entre a data e o ponto, que também contribuía pra sensação de
   "desenho solto".

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`).
2. **Medição de pixel antes/depois** via `javascript_tool` (`getBoundingClientRect` do ponto e da
   linha) — não só uma inspeção visual, confirma numericamente que o vão fechou (~50px → ~14px).
3. **Validação visual com 2 e 3 nós** (3º inserido temporariamente via `psql`, mesmo procedimento
   do §10.30, removido logo depois — não é backfill permanente): linha contínua conectando os 3
   pontos sem quebra, cores de cada corda corretas no anel/linha intermediária.

### 10.33 Cores das graduações mais fracas — mistura com branco, não edição do dado cadastrado

**Data:** 2026-09-18 · **Status:** ✅ concluído. Pedido do owner: "deixe as cores das graduações
mais fracas" — mesmo espírito do §10.25 ("os tons verdes to achando muito forte, quero mais
fraco"), agora sobre as cores de `GraduationLevel.color` (Crua `#e5e5e5`, Verde `#22c55e`, Azul
`#3b82f6`) usadas no card de destaque e nos círculos da timeline da Jornada desde o §10.29.

#### Decisão: suavizar na exibição, não editar o dado cadastrado

Diferente do `--color-accent` do §10.25 (um token de tema do app, sem dono "de fora"), a cor de
uma `GraduationLevel` é **dado da organização** — representa a cor real da corda no sistema de
graduação daquele grupo de capoeira, editável pelo painel. Editar o valor cadastrado deixaria de
representar a cor real da corda, e só resolveria pras 3 graduações do seed atual — qualquer outra
organização que cadastrasse cores vívidas continuaria vendo cores fortes. Em vez disso, criada
**`softenColor(hex)`**: mistura a cor cadastrada com 35% de branco (mesma proporção pra qualquer
cor de entrada — não é um valor por-cor hardcoded), então funciona igual pra cor cadastrada por
qualquer organização, sempre suavizando na mesma medida, sem alterar o dado em si.

#### O que foi construído

- `softenColor()`: mistura RGB canal-a-canal (`valor*0.65 + 255*0.35`), devolve hex. Aplicada nos
  3 lugares que usam `graduationLevel.color` como `backgroundColor`: card "Graduação atual", ponto
  pequeno da timeline, círculo de 56px da timeline.
- **`readableIconColor()` passou a receber a cor JÁ suavizada**, não a crua — a decisão de
  ícone claro/escuro tem que bater com a cor de verdade renderizada na tela. Recalculado: Verde
  suavizado (`~#6fd996`) e Azul suavizado (`~#80aef9`) continuam com luminância abaixo do limiar
  de 0.75 → ícone branco continua correto; Crua suavizada (`~#eeeeee`) continua acima do limiar →
  ícone escuro continua correto. Nenhuma das 3 graduações do seed mudou de lado do limiar depois
  de suavizar, mas o cálculo agora está correto pra qualquer cor que uma organização cadastre no
  futuro (uma cor mais vívida poderia cruzar o limiar depois de suavizada, e a versão anterior
  teria calculado errado).

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`).
2. **Validação ao vivo no navegador**: "Azul" suavizado (`#3b82f6` → tom periwinkle mais claro) no
   card de destaque e na timeline, texto branco ainda legível (o filtro escuro do card e a lógica
   de contraste do círculo continuam garantindo isso independente de quão clara a cor suavizada
   fique). "Verde" testado com uma 3ª graduação temporária (mesmo procedimento de sempre — inserida
   via `psql`, removida depois de conferir visualmente): tom sage suave em vez do verde vívido
   original, claramente ainda reconhecível como verde. "Crua" (já quase branca) sem mudança visual
   perceptível, como esperado.

### 10.34 Fonte principal trocada para Nunito

**Data:** 2026-09-18 · **Status:** ✅ concluído. Pedido do owner: "mude a fonte para nunito,
https://fonts.google.com/specimen/Nunito".

`--font-sans` (token usado em todo o app, exceto a saudação da Home que usa `--font-display`/
Caveat desde o §10.25) trocado de `"Inter"` pra `"Nunito"`. **Achado**: `Inter` nunca tinha sido
carregada de verdade via `@import`/`<link>` — o token só citava o nome e dependia do navegador ter
a fonte instalada no sistema (fallback silencioso pra `Segoe UI`/`system-ui` quando não tinha).
Pra Nunito não cair na mesma armadilha, adicionada de verdade ao `@import` do Google Fonts que já
existia pra Caveat (`family=Nunito:wght@400;500;600;700;800` — os 4 primeiros pesos cobrem todo
uso real de `font-medium`/`font-semibold`/`font-bold` no app, confirmado por grep; 800 incluído de
folga pra qualquer heading futuro que use `font-extrabold`, ainda não usado).

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`), `Nunito` confirmada no CSS gerado.
2. **Validação ao vivo no navegador**: `getComputedStyle(document.body).fontFamily` confirma
   `"Nunito, ..."` aplicado; `document.fonts` (Font Loading API) confirma os 4 pesos usados
   (400/500/600/700) com `status: "loaded"` de verdade, não só declarados no CSS — a fonte
   carregou e está sendo usada, não caiu num fallback silencioso. Visualmente, texto do app com as
   terminações arredondadas características da Nunito, nitidamente diferente da Inter anterior.

### 10.35 Fonte da saudação trocada de Caveat pra Fraunces (serifada)

**Data:** 2026-09-18 · **Status:** ✅ concluído. Pedido do owner: "quero outra fonte no Ola! ana" —
sem especificar qual, então perguntado via `AskUserQuestion` (decisão de estilo, owner escolhe):
4 opções (Fraunces serifada elegante, Playfair Display serifada clássica, Quicksand rounded
display, Pacifico script alternativa). Escolhido **Fraunces** (a opção recomendada).

- `--font-display` trocado de `"Caveat", "Segoe Script", cursive` pra `"Fraunces", "Georgia",
  serif` — `@import` do Google Fonts atualizado (`Caveat` removida, `Fraunces:ital,wght@1,500;
  1,600;1,700` adicionada; só pesos itálicos, a única variação usada). `HomeView.vue`: `h1` da
  saudação ganhou as classes `italic font-semibold` (antes não precisava de `italic` explícito
  porque a Caveat já é inerentemente inclinada; a Fraunces é uma família com estilo reto E itálico
  separados, e só carregamos o itálico — sem a classe, o texto cairia no fallback serif do
  navegador por não achar nenhuma face reta da Fraunces).

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`).
2. **Validação ao vivo no navegador**: `getComputedStyle` do `h1` confirma `fontFamily: "Fraunces,
   Georgia, serif"`, `fontStyle: "italic"`, `fontWeight: "600"`; `document.fonts` confirma a face
   itálica 600 com `status: "loaded"` de verdade. Visualmente, "Olá, Ana" agora numa serifada
   elegante e inclinada, nitidamente diferente tanto da Nunito do resto do app quanto da Caveat
   script anterior.

### 10.36 Fonte da saudação trocada de Fraunces pra Sedgwick Ave

**Data:** 2026-09-18 · **Status:** ✅ concluído. Owner pediu direto, com o nome exato da fonte:
"poe essa fonte: Sedgwick Ave" — 3ª troca da fonte da saudação da Home nesta sessão (Caveat →
Fraunces §10.35 → Sedgwick Ave agora), cada vez só trocando o token/import, nunca o resto do
design (o `h1` continua isolado do restante do app via `--font-display`, então trocar de novo é
barato).

- `@import` do Google Fonts: `Fraunces` trocada por `Sedgwick+Ave` (família só com peso Regular
  400, sem itálico nem negrito — confirmado na página da fonte antes de usar, mesma disciplina de
  verificar antes de aplicar já usada nesta sessão pra imagens).
  `--font-display: "Sedgwick Ave", "Segoe Script", cursive`.
- **`HomeView.vue`**: classes `italic font-semibold` **removidas** do `h1` da saudação — eram
  necessárias especificamente pra Fraunces (família com faces reta/itálica separadas, só a
  itálica carregada). Sedgwick Ave só tem um peso/estilo; pedir itálico ou negrito que a família
  não tem faria o navegador **sintetizar** um itálico/negrito falso (distorcendo os traços,
  especialmente ruim em fonte manuscrita) em vez de simplesmente não aplicar.

#### Validação empírica

1. Build limpo (`vue-tsc -b && vite build`).
2. **Validação ao vivo no navegador**: `getComputedStyle` do `h1` confirma `fontFamily:
   "\"Sedgwick Ave\", \"Segoe Script\", cursive"`, `fontStyle: "normal"`, `fontWeight: "400"`;
   `document.fonts` confirma a face normal/400 com `status: "loaded"`. Visualmente, "Olá, Ana"
   numa manuscrita mais informal/despojada que a Fraunces anterior.

### 10.37 Auditoria backend × frontends (admin, painel, app) e correções

**Data:** 2026-10-10/11 · **Status:** ✅ concluído (commits `844a14b`, `e5df4cd` + fase 3 abaixo).
Pedido do owner: "no admin não to conseguindo criar um grupo assim como diversos endpoints não ta
funcionando, preciso de auditoria completa". Três agentes (Sonnet) auditaram admin, painel e app contra o
backend real (HTTP + navegador): ~160 chamadas, **0 divergências de contrato**, nenhum bloqueante.

#### O que NÃO foi reproduzido
- "Criar grupo" falha em produção: **não reproduzido** em desenvolvimento (37 `POST /organizations` = 201,
  fluxo "Novo grupo" no navegador OK). Hipóteses para produção (NÃO verificadas): limite global de 60
  req/min por IP (429 aleatório; corrigido, ver abaixo), imagens `:latest` antigas no servidor,
  `RolePermission` vazio (503), `TRUST_PROXY` errado. Se persistir, precisa da mensagem exata do erro.

#### Fase 1 (`844a14b`)
1. **ALTO — sem matrícula aluno↔turma** (API nem tela): frequência vinha vazia para turma/aluno criados
   pelo painel. Solução: `GET/POST/DELETE /classes/:id/students` (POST idempotente, DELETE = INACTIVE) +
   dialog "Alunos da turma" no painel.
2. Inscrição em evento duplicava; convidado não cancelava. Solução: idempotência por `studentId`; convidado
   grava `userId` e o próprio pode cancelar.
3. JWT continuava válido após inativar o professor. Solução: `JwtStrategy` exige vínculo ACTIVE.
4. Inteiro fora de INT4 → 500. Solução: `PrismaRangeFilter` global → 400.
5. `GET /organizations` cortava em 50. Solução: `limit/offset/q` + `X-Total-Count`.
6. Throttle global 60→600/min por IP (`GLOBAL_THROTTLE_LIMIT`).
- Não deu certo de primeira: e2e completo teve 5 falhas — eram **resíduos das auditorias no banco de dev**
  (comunicados `[audit…]`, graduações na aluna 1, professores inativos); limpei só esses ids e os 2 specs
  passaram (39/39). Lição: agentes de auditoria sujam o banco compartilhado; limpar antes do gate.

#### Fase 2 (`e5df4cd`)
Senha forte em `POST /teachers`; horário de turma HH:mm; `expiresAt` futuro em avisos da plataforma;
`@Max(INT4)`; mensagens de login em português; mensagens do mestre sem prefixo duplicado; admin (dica
Dev@12345 só em DEV, 429/400 legíveis, lista de grupos com aviso de total, plano limpa limites com `null`);
app (calendário sem N+1, `scope`, recados com limite e aviso, invalida calendário); `VITE_API_URL` padrão
`/api` no `docker-compose.prod.yml`. Gate: backend 50 unit + 455 e2e, admin 100, painel 324, app 78.
- Achado: `admin` já tinha teste quebrado no HEAD (`<img src="/logo.png">` do commit de identidade visual,
  68 testes rodando em vez de 94) → `transformAssetUrls:false` em `vitest.config.ts`.

#### Fase 3
Editar/desativar/reativar grupo (`PATCH /organizations/:id`, `POST :id/deactivate|reactivate`; grupo inativo
perde login e token); `GET /subscriptions?organizationId=`; senha forte na equipe PLATFORM; graduações
`PATCH/DELETE` (sistema, nível, graduação do aluno; sistema com histórico só inativa; nível concedido e
graduação com certificado = 409) + ações no painel.

#### Pendências (numeradas)
1. `npm audit` backend: `bcrypt` 5→6 (major; resolve `tar`/`node-pre-gyp`) e `prisma`/`@prisma/config`/
   `deepmerge-ts`; admin `source-map-js`. Painel e app: 0. Risco em runtime provavelmente baixo (instalação/CLI).
2. Nível e graduação sem status no schema (hoje 409/hard delete) — inativar exige migration.
3. Índice `lower(email)`, rodas legadas sem organização, AuditLog, 2FA, seletor de dependente (responsável
   com 2+ filhos), `RolePermission`/imagens em produção a conferir no servidor.

#### Fase 4 — dependências, índice, modo de teste rápido
- **npm audit:** admin 1→0 (`npm audit fix` sem force). Backend 6→3: `bcrypt` 5.1.1→6.0.0 (API igual: só
  `hash/compare/getRounds`; hash `$2b$10$` gerado no bcrypt 5 compara OK no 6 — teste permanente
  `backend/test/bcrypt-compat.spec.ts`) eliminou a crítica (`tar`). **Sem correção:** `prisma`/`@prisma/config`/
  `deepmerge-ts` (fixado em 7.1.5 pelo `@prisma/config@6.19.3`; corrige só com Prisma 7/8 ou `overrides`);
  é CLI de dev/migrate, não roda na API. NÃO validado: `npm ci` do bcrypt 6 em Alpine (sem docker local).
- **Índice** `User_email_lower_idx` em `lower("email")` (migration `20261011211037_add_user_email_lower_index`,
  não-unique), porque `email-lookup.ts` busca por `lower("email") = $1`.
- **Rodas sem organização:** investigado, sem bug de isolamento (rodas públicas por desenho; `organizationId`
  nulo nunca bate no `findOwned`); 0 nulos no banco de dev. Nada feito.
- **Seletor de dependente do app:** já existia (`StudentSwitcher`); a pendência 54 estava desatualizada.
- **Testes mais rápidos:** `npm run test:quick [-- filtro…]` (backend) = e2e sem checagem de tipos
  (ts-node transpile-only), sem migrate/seed e sem o spec de bootstrap: **181 s vs ~434 s**, 474 testes.
  Medido: o tempo dos testes em si é ~45 s (+96 s do bootstrap); o resto era type-check do ts-node. A suíte
  completa (`npm run test:e2e`) segue como gate antes de release; tipos são cobertos por `npm run build`.
  Processo: durante o desenvolvimento rodar só os specs tocados (`test:quick -- classes`), a rápida antes de
  commitar e a completa só antes de release.

### 10.38 Onda 1 de completude do sistema (inventário de 48 lacunas)

**Data:** 2026-10-11/12 · **Status:** ✅ concluído. Owner: "criar unidades diz 'somente consulta'… quero o sistema pronto em
todas as partes". Inventário em scratchpad `gaps.md`: **48 lacunas** (11 essenciais, 23 importantes, 14 desejáveis).

#### Causa-raiz de produção encontrada antes (cb41837)
O admin dava 404 em `/api/*` porque o nginx resolvia `backend` para o backend de OUTRO projeto do Easypanel (rede
compartilhada). Prova: `/api/health` sem `"database":"up"`. Solução: aliases únicos `gingapp-api`/`gingapp-db`.

#### Entregue (E01–E06, E09, demo)
- **E01** contas de aluno/responsável (`POST /students/:id/account`, CRUD `/students/:id/guardians`, troca obrigatória de senha no app).
- **E05 mínimo** reset de senha de professor/aluno/responsável pelo MESTRE (revoga sessões).
- **E02** CRUD de Unidades (matriz única, `Plan.maxUnits` aplicado, grupo novo nasce com Matriz, recurso `units` na matriz RBAC).
- **E03** 27 UFs + 495 cidades no bootstrap (idempotente). Faltam ~5.075 cidades (acrescentar em `prisma/br-locations.ts`).
- **E04** `PATCH /organizations/me` (MESTRE edita o próprio grupo; campos novos de perfil).
- **E06** professor responsável por turma + `POST /classes/:id/generate-lessons` (idempotente, ≤90 dias, advisory lock).
- **E09** notificações automáticas (aula cancelada/alterada, graduação, evento/roda novos, mensalidade vencida via `POST /finance/mark-overdue`).
- **Grupo demo** (`prisma/demo.ts`, `DEMO_GROUP=true` + `DEMO_PASSWORD`): 30 alunos, 3 unidades, aulas, financeiro, eventos etc.
- Gate: backend 52 unit + 611 e2e, admin 109, painel 392, app 82.

#### O que NÃO deu certo e a solução
- Agentes em paralelo sujaram o banco de dev (nome da org do seed, unidades de teste, senha do professor do seed, lançamento marcado
  OVERDUE por engano) → cada um reverteu o seu; specs passaram a fazer snapshot/limpeza no `after()`.
- `auth-password.e2e-spec` falhava no `after()` (`Unit_organizationId_fkey`) porque `createGroup` agora cria a Matriz → limpeza apaga
  as unidades antes da organização. O resumo do `node --test` mostrava 0 falhas mesmo assim (falha de hook): olhar os `not ok`.
- Git Bash falhou com erro de fork em chamadas longas → usar PowerShell.

#### Pendências (numeradas)
1. Painel/admin não forçam troca da senha provisória; a flag `mustChangePassword` não é imposta no servidor (JwtStrategy).
2. Inativar aluno não bloqueia o login dele; `Student.userId` é único (aluno em 2 grupos exige mudança de schema).
3. Job diário de `markOverdueAndNotify` (sem `@nestjs/schedule`); "esqueci a senha" por e-mail (precisa de SMTP).
4. Inativar unidade com alunos/turmas ativos não é bloqueado.
5. E07 cobrança de mensalidade ponta a ponta, E08 permissão por unidade, E10 termos/LGPD, E11 backup — próximas ondas.
6. Importantes: upload de imagens (volume local), CSV, relatórios reais, AuditLog, admin em português, refresh token, Web Push.

## E08 — Autorização por unidade (Onda 2)

**Estado: concluído (sem commit).** Helper único: `backend/src/shared/access/unit-scope.ts` (`UnitScopeService.resolve(user, orgId)` -> `number[] | 'ALL'`; filtros `unitScopeFilter`/`lessonScopeFilter`/`groupWideOrUnitFilter`; `assertUnitAccess`, `assertUnitTarget`, `assertUnitOwned`, `resolveWriteUnit`, `assertUnitUpdate`).

Decisões:
1. Só o PROFESSOR com 1+ registros em `UserUnitAccess` da organização fica restrito às unidades listadas. MESTRE, PLATFORM/super admin, ALUNO e RESPONSAVEL = sem restrição por unidade (o escopo de aluno/responsável continua por vínculo, rotas `/me`).
2. PROFESSOR SEM nenhum registro mantém o comportamento anterior (vê tudo), para não quebrar grupos existentes. O Mestre volta a liberar tudo com `PUT /teachers/:id/units { unitIds: [] }`. Atenção: o seed e o grupo demo dão `UserUnitAccess` aos professores, então eles passam a ser restritos.
3. Registro SEM unidade (aluno/turma/aula legados) continua visível e editável pelo professor restrito; aula sem `unitId` herda a unidade da turma. Evento/comunicado sem unidade = grupo inteiro: legível por todos, só o Mestre altera (403 para o restrito).
4. Leitura fora do escopo = 404 igual ao inexistente (lista e `X-Total-Count` usam o mesmo `where`); unidade de destino no corpo fora do escopo = 403; criação pelo restrito sem `unitId` assume a única unidade dele (ou 400 se tem várias); não pode mover para fora do escopo nem limpar a unidade.
5. Aplicado em: students (+ conta de acesso e responsáveis por id), classes (+ matrícula/geração de aulas), lessons, attendance, events, announcements, units (lista/leitura), dashboard, graduations por aluno e certificates. Fora: finance e notifications (outros agentes), passport/`/me` (por vínculo).
6. API: `GET/PUT /teachers/:id/units` (só Mestre; valida unidades do mesmo grupo; substitui o conjunto; Mestre como alvo = 400), `GET /teachers` e `GET /teachers/:id` devolvem `unitIds`. Painel: Professores -> coluna "Unidades" e ação "Unidades de atuação" (checkboxes).
7. Testes: `test/unit-scope.spec.ts` (puro), `test/unit-scope.e2e-spec.ts` (25 casos, grupo próprio). Ajustes em `announcements-notifications.e2e-spec.ts` (professor do seed agora restrito) e `teachers.e2e-spec.ts` (`unitIds`).

Pendências: (a) `/events/:id/participants` POST por professor restrito não confere a unidade do aluno inscrito; (b) `GET /calendar` (eventos públicos entre grupos) não aplica escopo; (c) professor do demo/seed restrito pode surpreender quem testa pelo painel; (d) sem cache do escopo (1 consulta extra por requisição do PROFESSOR).

### 10.39 Onda 2 de completude (cobranÃ§a, escopo por unidade, LGPD, backup)

**Data:** 2026-10-12 Â· **Status:** âœ… concluÃ­do. Gate: backend 80 unit + 688 e2e (`test:quick`) + 14 (bootstrap), admin 113, painel 402, app 88.

- **E07 cobranÃ§a**: `StudentBilling` (valor em centavos + dia 1..31), `FinancialRecord.competence/paymentMethod/paidCents` (unique aluno+mÃªs+tipo),
  `Organization.paymentInstructions`; geraÃ§Ã£o mensal idempotente, baixa/estorno/cancelamento, inadimplentes, recibo imprimÃ­vel (painel), "Como pagar" (app).
- **E08 escopo por unidade** (`shared/access/unit-scope.ts`): sÃ³ PROFESSOR com 1+ registros em `UserUnitAccess` fica restrito; sem registros vÃª tudo (compatÃ­vel);
  registros sem unidade seguem visÃ­veis (sÃ³ o MESTRE altera); fora do escopo = 404; `GET/PUT /teachers/:id/units`.
- **E10 LGPD**: textos MODELO em `backend/src/shared/legal/` (revisar com jurÃ­dico; preencher campos `[...]`), aceite versionado (`LEGAL_VERSION`), `/auth/me/export`,
  `/auth/me/delete-request`; o servidor sÃ³ barra sem aceite com `TERMS_ENFORCEMENT=true`.
- **E11 backup**: serviÃ§o `backup` no compose (pg_dump diÃ¡rio, retenÃ§Ã£o 14 dias, volume `gingapp_backups`) + `ops/backup/restore.sh`. **NÃƒO executado** (Docker local sem acesso ao Docker Hub): rodar `restore.sh verify` em staging.
- `mustChangePassword` imposto no servidor (JwtAuthGuard) e nas telas; aluno inativo/suspenso nÃ£o loga; cron diÃ¡rio 03:00 America/Sao_Paulo de mensalidade vencida (`OVERDUE_CRON=false` desliga; `@nestjs/schedule`).

#### O que NÃƒO deu certo e a soluÃ§Ã£o
- `demo-seed` esperava 6 turmas para o professor; com E08 ele vÃª sÃ³ as das suas unidades â†’ teste ajustado (0 < n < 6), MESTRE segue vendo as 6.
- Rodadas de testes dos agentes (mutaÃ§Ã£o, revalidaÃ§Ã£o) levavam 30+ min â†’ decisÃ£o do owner: testes simples. Novo `npm run test:quick -- --smoke` (essencial, dezenas de segundos).
- Meu primeiro script de gate falhou por sintaxe do PowerShell (`--` dentro de grupo) â†’ script em arquivo `.ps1`.

#### PendÃªncias (numeradas)
1. Dashboard e "Recebido" ainda somam `amountCents`, nÃ£o `paidCents`; recibo sÃ³ no painel (app nÃ£o tem).
2. `POST /events/:id/participants` por professor restrito nÃ£o confere a unidade do aluno; `GET /calendar` pÃºblico sem escopo.
3. Tela de pedidos de exclusÃ£o (LGPD) no admin; copiar dumps para fora do servidor e alerta de falha do backup; `restore.sh verify` em staging.
4. RevisÃ£o jurÃ­dica dos textos; admin sem "Meus dados".
5. Ainda do inventÃ¡rio: upload de imagens, CSV, relatÃ³rios reais, AuditLog (admin), admin em portuguÃªs, refresh token, Web Push, e-mail/esqueci a senha (SMTP), comunidade pÃºblica, eventos/rodas/comunicados mais ricos, certificado em PDF.

### 10.40 Upload de imagens em disco, sem servico externo (item I01 do inventario)

Estado: CONCLUIDO (sem commit). Backend + painel + app; testes: backend e2e `uploads.e2e-spec.ts` (7), vitest 3 (painel) + 2 (app).

O que foi feito
1. Backend: `POST /api/uploads` (multipart, campo `file`, autenticado, MEMBER) -> grava em disco (`UPLOADS_DIR`, padrao `./uploads`; no Docker `/app/uploads`, volume `gingapp_uploads`). Tipo checado por MAGIC BYTES (JPEG/PNG/WebP; SVG/HTML/texto => 415), limite 5 MB (413), `sharp` reprocessa (rotacao EXIF aplicada, EXIF/GPS removidos, maior lado <= 1600 px, saida WebP). Nome = uuid, nunca o do cliente. Tabela `Upload` (migration `add_uploads`: organizationId, userId, filename unico, mimeType, sizeBytes). Cota por grupo `UPLOAD_ORG_QUOTA_MB` (padrao 1024; 0 = sem limite) e rate limit 20/min por usuario e por IP (`UPLOAD_THROTTLE_LIMIT`).
2. `GET /api/uploads/:file` publico: so aceita o formato exato `<uuid>.(webp|jpg|png)` (path traversal impossivel), `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, CSP `default-src 'none'; sandbox`; sem listagem (GET /uploads = 404).
3. Validador compartilhado `IsImageRef` (shared/uploads/image-ref.ts): campos de imagem aceitam `/api/uploads/<uuid>.<ext>` OU URL http(s) completa. Aplicado em Student.photo (create/update), PATCH /students/me/profile (photo, coverPhoto), Organization.logo, Event.imageUrl, Roda.imageUrl.
4. Painel: `ImageUploader`/`ImageUploadField` (components/painel/image-upload-field.tsx) com envio, pre-visualizacao, Remover e URL manual opcional; usado em Aluno (campo Foto, novo), Configuracoes (Logomarca), Eventos e Rodas (capa). `lib/uploads.ts` (validacao no cliente, `imageSrc` prefixa a origem da API em dev).
5. App: `ImageUploadControl` (components/gingapp/image-upload.tsx) na tela Perfil (foto e capa), mantendo o campo de URL e o "Remover".
6. Infra: Dockerfile (runner sem `--omit=optional` para o binario nativo do sharp; pasta /app/uploads), compose easypanel + prod (volume), `.env.easypanel.example`, `docs/EASYPANEL.md` (secao 11) e backup diario tambem gera `gingapp-uploads-*.tgz`.

O que NAO deu certo / decisoes
1. Imagens substituidas ou removidas na tela NAO sao apagadas do disco (ficam orfas e contam na cota). Pendencia: job de limpeza.
2. Se o binario do sharp faltar na plataforma, o backend grava SEM reprocessar (log de aviso) - nao ocorre no Windows de dev (sharp 0.34.5 ok) e o lock traz o pacote musl para o Docker; a imagem Docker NAO foi buildada nem testada aqui (so `docker compose config` do easypanel foi validado).
3. Sem varredura de virus e sem CDN: o nginx dos fronts repassa /api (client_max_body_size 10m ja cobre os 5 MB).

### 10.41 Onda 3 de completude (upload, CSV/relatÃ³rios, auditoria, senha por e-mail, PDF)

**Data:** 2026-10-12 Â· **Status:** âœ… concluÃ­do. Gate: backend 98 unit + 745 e2e (`test:quick`) + 14 (bootstrap), admin 120, painel 432, app 97.

- **Upload de imagens** (sem serviÃ§o externo): `POST /uploads` (magic bytes, 5 MB, sharp â†’ WebP â‰¤1600px, sem EXIF), volume `gingapp_uploads`, cota por grupo; foto do aluno, logo, capa de eventos/rodas, perfil no app. Backup inclui `.tgz` das imagens.
- **CSV/relatÃ³rios:** `POST /students/import` (dryRun, â‰¤500 linhas, idempotente), exportaÃ§Ãµes CSV (`;`, BOM, anti-injeÃ§Ã£o de fÃ³rmula), pÃ¡gina RelatÃ³rios com dados reais (presenÃ§a, financeiro, alunos, graduaÃ§Ãµes).
- **Auditoria:** `AuditService.record` (SSOT, nunca lanÃ§a, filtra segredos), `GET /audit-logs` (plataforma) e `/audit-logs/me-group` (MESTRE), telas no admin e no painel; `FeatureGuard` (`@RequireFeature`) faz `Plan.features`/override bloquear `finance` e `certificates`; "Recebido" usa `paidCents`.
- **Senha por e-mail** (SMTP opcional, desligado por padrÃ£o): esqueci/redefinir senha, convite por e-mail; **certificado em PDF** (pdfkit + QR).

#### O que NÃƒO deu certo e a soluÃ§Ã£o
- `npm run test:quick -- --smoke` rodava a suÃ­te inteira: o npm 11 engole a flag â†’ aceita a palavra `smoke` (`npm run test:quick -- smoke` = 6 specs, 74 testes, 32 s).
- `demo-seed` falhou por envelhecimento (janela deslizante mantÃ©m o histÃ³rico; o teste assumia â‰¤61 dias) â†’ teste ajustado (sÃ³ limite superior fixo + janela recente coberta).
- Falhas intermitentes em specs de outros mÃ³dulos durante as rodadas dos agentes eram concorrÃªncia no mesmo banco de dev; no gate Ãºnico (sem agentes rodando) ficaram 0.
- Texto do PDF nÃ£o foi validado por nenhum agente (sem leitor de PDF); revisÃ£o visual feita pelo owner.

#### PendÃªncias (numeradas)
1. Imagens Ã³rfÃ£s (substituÃ­das/removidas) continuam em disco e contam na cota â†’ job de limpeza; `sharp` no Alpine e o `tar` do backup de uploads nÃ£o foram provados (sem Docker local).
2. Auditoria sÃ³ nas aÃ§Ãµes jÃ¡ chamadas (sem interceptor global); faltam turma, graduaÃ§Ã£o, certificado, comunicados; sem retenÃ§Ã£o/purga.
3. `PlatformSetting` e chaves de feature alÃ©m de `finance`/`certificates` continuam sem efeito; `User.twoFactorSecret` sem uso (2FA).
4. SMTP real e o fluxo de e-mail ponta a ponta no navegador nÃ£o testados; restore das imagens Ã© manual.
5. Ainda do inventÃ¡rio: web push, comunidade pÃºblica, eventos/rodas/comunicados mais ricos, check-in por QR, billing real da assinatura, cadastro self-service de grupo, refresh token, observabilidade/CI bloqueante.

### 10.42 Auditoria completa, retenção, imagens órfãs, 2FA TOTP e log de requisição (pendências 1-3 da §10.41)

**Data:** 2026-10-12 · **Status:** concluído, sem commit. Gate (rodadas isoladas desta frente): backend `build` limpo (dist e tsbuildinfo apagados antes) + `test:unit` 111/111 + `test:quick` dos specs afetados 156/156 + `smoke` 74/74; admin 132, painel 444, app 120 (lint/test/build verdes).

#### O que foi feito
1. **Auditoria faltante (SSOT `AuditService.record`):** novos códigos no catálogo `shared/audit/audit-actions.ts` — `CLASS_CREATE/UPDATE/INACTIVATE`, `GRADUATION_SYSTEM_CREATE/UPDATE/DELETE`, `GRADUATION_LEVEL_CREATE/UPDATE/DELETE`, `STUDENT_GRADUATION_CREATE/UPDATE/DELETE`, `CERTIFICATE_ISSUE/DOWNLOAD`, `ANNOUNCEMENT_CREATE/UPDATE`, `UPLOAD_CREATE`, `STUDENT_ACCOUNT_LINK`, `TWO_FACTOR_ENABLE/DISABLE/RECOVERY_USED/FAILURE`, `AUDIT_PURGE` (+ entidades). Gravados em `classes`, `graduations`, `certificates` (emitir e baixar o PDF autenticado), `announcements` (remover = `ANNOUNCEMENT_UPDATE` com `inactivated`), `uploads` e `student-access` (usuário já existente apenas vinculado grava `STUDENT_ACCOUNT_LINK`; usuário novo continua `STUDENT_ACCOUNT_CREATE`). `meta` só com ids e nomes de campos. Rótulos em português no admin (`utils/audit.ts`) e no painel (`atividade-api.ts`).
2. **Retenção da auditoria:** job semanal (domingo 04:00 America/Sao_Paulo, `@nestjs/schedule`) `AuditRetentionCronService` apaga `AuditLog` mais antigo que `AUDIT_RETENTION_DAYS` (padrão 365; 0 = nunca), em lotes de 5000, e grava `AUDIT_PURGE`. Desliga com `AUDIT_RETENTION_CRON=false` (testes rodam desligado).
3. **Imagens órfãs:** job semanal (domingo 05:00) `UploadsGcCronService`. Descobre as referências **pelo schema do Prisma** (`Prisma.dmmf`: toda coluna String/Json de toda tabela, exceto `Upload` e `AuditLog`, buscando `/api/uploads/<uuid>.<ext>`), então cobre `Student.photo/coverPhoto`, `Organization.logo`, `Event/Roda.imageUrl` e qualquer campo futuro sem manutenção. Apaga arquivo + linha `Upload` do que não é citado **e** tem mais de 24 h (linha: `createdAt`; arquivo sem linha: mtime); ignora nomes fora do padrão uuid. `UPLOADS_GC=false` desliga; `UPLOADS_GC=dry-run` só loga. `resolveUploadsDir()` virou SSOT em `shared/uploads/uploads-dir.ts`.
4. **2FA TOTP opt-in** (implementação RFC 6238 própria com `node:crypto`, sem dependência nova; QR gerado no backend com `qrcode` como data URL): `POST /auth/2fa/setup` (segredo pendente + URI + QR), `/enable {code}` (ativa, devolve 8 códigos de recuperação `xxxxx-xxxxx`), `/disable {password, code|recoveryCode}`, `/verify {challengeToken, code|recoveryCode}`. Com 2FA ativo, `login` e `platform-login` respondem 200 `{twoFactorRequired:true, challengeToken}` (JWT 5 min, `purpose:'2fa'`, assinado com segredo **derivado** — nunca vale como accessToken). `GET /auth/me` ganhou `twoFactorEnabled` e `recoveryCodesRemaining`. Segredo cifrado em repouso (AES-256-GCM, chave HKDF de `TWO_FACTOR_KEY` ou do `JWT_SECRET`), nunca devolvido depois do setup; códigos de recuperação só como HMAC-SHA256, uso único (remoção atômica); anti-replay por `twoFactorLastStep`; erro de código = 400 (nunca 401), 5 falhas em 15 min = 429 (contagem pela própria auditoria); throttle 10/min por IP (e por usuário nas rotas autenticadas). Migration `20261012050000_add_two_factor` (`twoFactorEnabled`, `twoFactorRecoveryHashes`, `twoFactorLastStep`).
5. **Telas do 2FA:** admin (login com 2º passo + `TwoFactorModal`, banner de incentivo), painel (login com 2º passo + diálogo "Duas etapas", aviso ao MESTRE), app (login com 2º passo + bloco no Perfil).
6. **Observabilidade mínima:** `requestLogMiddleware` — `X-Request-Id` em toda resposta (aceita o do proxy se curto e inofensivo; exposto no CORS) e, com `REQUEST_LOG=true`, uma linha JSON por requisição (`method`, **padrão** da rota, `status`, `ms`, `requestId`, `userId`, `ip`; sem corpo/querystring/cabeçalhos; `/api/health` fora). Documentado em `docs/EASYPANEL.md` seção 15, `backend/.env.example`, `.env.easypanel.example` e `docker-compose.easypanel.yml`.

#### O que NÃO deu certo e a solução
1. `prisma migrate dev --create-only` recusou (ambiente não interativo) e o schema já tinha mudanças não migradas de **outro agente** (índice único de `Roda`): gerar o diff arrastaria a frente alheia. **Solução:** migration escrita à mão só com as 3 colunas do 2FA.
2. **Erro de processo meu:** ao tentar tirar um BOM com `[IO.File]::WriteAllText` o arquivo da migration foi gravado **vazio**; o `migrate deploy` marcou a migration como aplicada com SQL vazio (colunas inexistentes). **Solução:** regravei o SQL (UTF-8 sem BOM), apliquei o SQL direto no Postgres via stdin, apaguei as linhas de `_prisma_migrations` dessa migration e rodei `migrate resolve --applied` para refazer o checksum; `migrate status` = "up to date" e as colunas conferidas em `information_schema`. Nenhum reset de banco.
3. `test/overdue-cron.spec.ts` (fiação do AppModule) passaria a falhar: o `JobsModule` agora só sai quando **os três** jobs estão desligados. **Solução:** o teste passa a zerar as três envs; `env-setup.ts` desliga `AUDIT_RETENTION_CRON`, `UPLOADS_GC` e `REQUEST_LOG`.
4. O teste da limpeza de imagens poderia apagar linhas reais do banco de desenvolvimento. **Solução:** o serviço aceita `organizationId` (escopo das linhas `Upload`) e o teste usa grupo/usuário/diretório temporários próprios; o da retenção recua o relógio (`now - 300 d`) para só as linhas marcadas da suíte serem elegíveis.

#### Decisões
1. Desafio 2FA com segredo JWT derivado + `purpose`, em vez de reutilizar o `JWT_SECRET`: impede usar o desafio como Bearer (coberto por teste: `GET /auth/me` com o desafio = 401).
2. `PLATFORM_ALLOWED_IPS` é aplicado só no `platform-login` (o desafio da plataforma só nasce depois dele); `/auth/2fa/verify` não repete a checagem.
3. `STUDENT_ACCOUNT_LINK` separado de `STUDENT_ACCOUNT_CREATE` para distinguir "vinculou usuário existente" de "criou conta".
4. Não revoga sessões ao ativar/desativar o 2FA (fora do escopo; refresh token também ficou de fora).

#### Pendências (numeradas)
1. **Sem reset de 2FA pela API:** quem perde o app e os 8 códigos depende de suporte zerar as colunas no banco. Falta ação "redefinir 2FA" para MESTRE (membros do grupo) e equipe PLATFORM (com auditoria).
2. Girar `JWT_SECRET` sem `TWO_FACTOR_KEY` deixa os segredos ilegíveis (503 no login desses usuários): em produção definir `TWO_FACTOR_KEY` agora e guardar a chave; não há rotina de re-cifragem.
3. Telas do 2FA e o login em dois passos só foram testados com a API simulada (vitest); fluxo ponta a ponta no navegador, com um autenticador real (Google Authenticator/Authy), não foi feito.
4. Retenção e limpeza de imagens nunca rodaram no relógio real (só chamadas diretas aos serviços); o `UPLOADS_GC=dry-run` na primeira execução em produção é recomendado. A busca por referências faz uma consulta por coluna texto/Json (~100+ por rodada semanal): aceitável hoje, revisar se o banco crescer muito.
5. O log de requisição não tem coletor/alertas (Sentry, Loki etc.); `GET /api/health` continua só com o estado do banco. CI bloqueante e Sentry seguem pendentes.
6. Auditoria ainda sem interceptor global: outras escritas (financeiro avulso, presença etc.) seguem só nas ações já instrumentadas; o PDF público de certificado (por QR) não audita o download.
7. A numeração 10.42 pode colidir com outra frente que esteja escrevendo no plano; renumerar se necessário.


### 10.43 Eventos com vagas/espera/status, rodas recorrentes, comunicados com alcance e check-in por QR (itens I09, I10, I12 e D01 do inventário)
**Estado:** backend concluído e testado; frontends (painel e app) no mesmo pacote. Sem commit. (A numeração 10.43 pode colidir com outra frente; renumerar se necessário.)

**Decisões**
1. **Eventos** (migration `20261012040000_add_event_capacity_roda_recurrence_announcement_scope`): `Event.capacity` (null = ilimitado), `priceCents` (informativo, sem pagamento online), `status` (`DRAFT|PUBLISHED|CANCELLED|CLOSED`; eventos antigos = PUBLISHED), `registrationDeadline` (vale só para o aluno; a equipe inscreve depois). `ParticipantStatus.WAITLIST` não ocupa vaga; ocupam vaga CONFIRMED e ATTENDED. Lotado => 409 com `code: EVENT_FULL`; `joinWaitlist: true` entra na fila. A decisão cabe/fila/lotado e a gravação rodam na mesma transação, com `SELECT ... FOR UPDATE` na linha do evento. Quando uma vaga abre (inscrição removida, status mudou, capacidade aumentou) o primeiro da fila (menor id) vira CONFIRMED e é notificado (`EVENT_WAITLIST_PROMOTED`). Cancelar (PATCH status CANCELLED) notifica os inscritos via NotificationsService (`EVENT_CANCELLED`) e grava `EVENT_CANCEL` na auditoria. Rascunho: 404 para quem não é MESTRE/PROFESSOR/plataforma; rascunho publicado depois dispara o "Novo evento". Calendário público e próximos eventos do dashboard só listam PUBLISHED/CLOSED. Listagens trazem `confirmedCount`, `waitlistCount`, `spotsLeft`.
2. **Rodas recorrentes**: escolhido gerar sob demanda (mais simples e coerente com o schema; cada ocorrência tem seus participantes) em vez de só calcular a próxima: `Roda.recurrence` (`NONE|WEEKLY|MONTHLY_WEEKDAY|MONTHLY_DAY`), `recurrenceUntil`, `parentRodaId` (auto-relação, `@@unique([parentRodaId, date])`). A regra é derivada de `Roda.date` no fuso America/Sao_Paulo ("toda 1ª sexta" = n-ésimo dia da semana do mês, a 5ª cai na última; dia 31 limita ao fim do mês). `POST /rodas/:id/generate-occurrences {count 1..12, padrão 3}` cria as próximas filhas (copia título, local, coordenadas, imagem) e é idempotente (checagem + skipDuplicates). Não há cron. `DELETE /rodas/:id?series=true` apaga a série; sem o parâmetro as filhas viram avulsas (FK SET NULL). O calendário traz `inSeries` e `recurrenceRule`.
3. **Comunicados**: `Announcement.classId`, `stateUf`, `audienceRole` (opcionais, combinam por E com `unitId`; "público" = papel do grupo; visibilidade fora do grupo/anônima ficou de fora por quebrar o modelo multi-tenant atual). Notificação: `announcement-audience.ts` refina o público da unidade (SSOT em NotificationsService). O membro só vê o comunicado se estiver matriculado na turma (ele ou dependente), tiver unidade na UF e tiver o papel; a equipe vê tudo. A turma é validada no escopo de unidade do professor restrito (400 se fora).
4. **Check-in por QR**: sem tabela. Token = `<E|L><id>-<10 chars>` com HMAC-SHA256 de subchave derivada do JWT_SECRET sobre (tipo, id, grupo); o grupo entra no HMAC. "Expiração" = janela do próprio evento/aula (evento: 2h antes a 6h depois do início; aula: 2h antes do início a 2h depois do fim, horário de São Paulo); fora dela, 409 mesmo com token correto. `GET /events/:id/checkin-token` (events.edit) e `GET /attendance/lessons/:id/checkin-token` (attendance.create) devolvem token + QR (data URL) com a URL `APP_URL/checkin?token=...`. `POST /events/:id/checkin-self` e `POST /attendance/self-checkin`: aluno próprio ou dependente (`studentId`), só inscrito confirmado (evento) / matriculado (aula), idempotente, auditoria (`EVENT_CHECKIN_SELF`, `LESSON_CHECKIN_SELF`) e notificação ao aluno. Se o professor já marcou falta, o check-in vira presença.

**Testes (backend)**: `test/checkin-recurrence.spec.ts` (unidade) e e2e `events-capacity`, `checkin-self`, `rodas-recurrence`, `announcement-reach`.
**Pendências:** (1) cobrança online da inscrição (D03); (2) a lotação simultânea foi provada por lógica (FOR UPDATE), não por teste de concorrência; (3) comunicado agendado continua notificando na criação (comportamento anterior); (4) o QR/token por evento não gira (reimpressão idêntica é intencional); quem vazar o código dentro da janela pode fazer check-in de quem está inscrito.

### 10.44 Onda 4 de completude: mapa da comunidade, eventos ricos, 2FA, Web Push (gate)

**Data:** 2026-10-12 Â· **Status:** âœ… concluÃ­do (mapa real NÃƒO visto: depende da chave do Google). Gate: backend 122 unit + 795 e2e rÃ¡pido (+1 corrigido) + 14 bootstrap, admin 132, painel 460, app 135.

- **Mapa** (`/comunidade` â†’ toggle Lista|Mapa): `GET /map/config`, `GET /map/places` (UNIT/CLASS/EVENT/RODA), `POST /map/geocode`; lat/lng em Unit/Event/Roda, `Organization.mapVisible`; Google Maps lazy (loader + clusterer), pins por tipo, filtros, "perto de mim". Duas chaves: navegador (referrer) e servidor (geocoding).
- **Eventos/rodas/comunicados** (Â§10.43): vagas e lista de espera, preÃ§o, status, recorrÃªncia de rodas, alcance de comunicados, check-in por QR.
- **SeguranÃ§a/ops** (Â§10.42): auditoria completa + retenÃ§Ã£o, GC de imagens, 2FA TOTP, log de requisiÃ§Ã£o. **Web Push** opcional (VAPID).

#### O que NÃƒO deu certo e a soluÃ§Ã£o
- `member-privacy` reprovou `/api/push/*` (rotas novas fora da allowlist de leitura do aluno) â†’ incluÃ­das na allowlist (sÃ£o do prÃ³prio usuÃ¡rio / config pÃºblica).
- Um agente rodou `git stash` no repo inteiro por ~10 s: restaurado sem conflito (stash vazio, nenhuma alteraÃ§Ã£o perdida no gate).
- Migrations geradas Ã  mÃ£o em vÃ¡rios casos (`--create-only` nÃ£o roda sem terminal interativo); uma ficou vazia por BOM e foi corrigida com `migrate resolve`.

#### PendÃªncias (numeradas)
1. Mapa real nunca visto: criar chave do navegador + Map ID + chave de servidor no Google Cloud; testar pins/cluster/clique depois do deploy.
2. `TWO_FACTOR_KEY` precisa ser definido e guardado em produÃ§Ã£o; nÃ£o hÃ¡ reset de 2FA pela API.
3. Push real e jobs semanais (retenÃ§Ã£o, GC) nunca rodaram no relÃ³gio real: comeÃ§ar com `UPLOADS_GC=dry-run`.
4. Mapa nÃ£o mostra vagas/fila; sem tela de detalhe de evento/roda/grupo no app; token do QR nÃ£o gira.
5. Fora de escopo: refresh token, CI bloqueante, pagamento online, billing real da assinatura, cadastro self-service de grupo.

### 10.45 Fechamento das pendÃªncias pequenas + mapa validado com a chave real

**Data:** 2026-10-12 Â· **Status:** âœ… concluÃ­do. Gate: backend 122 unit + 801 e2e rÃ¡pido + 14 bootstrap, admin 138, painel 467, app 137.

- **Mapa real VISTO** (app local + backend com `GOOGLE_MAPS_API_KEY`): tiles, clusters em GoiÃ¢nia/AnÃ¡polis/BrasÃ­lia, 17 locais na lista, cartÃ£o com tÃ­tulo/descriÃ§Ã£o/endereÃ§o, zoom ao selecionar. Grupo demo sem logo â†’ pin com iniciais.
- Reset de 2FA (`POST /auth/2fa/reset/:userId`; super admin qualquer um, MESTRE sÃ³ professor/aluno do grupo; MESTRE nÃ£o reseta MESTRE), tela "Pedidos LGPD" no admin (`/data-deletion-requests`, DONE nÃ£o apaga nada), avatar de aluno nas listas, quantidade de ocorrÃªncias das rodas, vagas/lista de espera/capa no cartÃ£o do mapa.
- Check-in QR: token continua determinÃ­stico (sem rotaÃ§Ã£o); documentado exibir na tela e nÃ£o imprimir fixo (`docs/EASYPANEL.md` Â§16).

#### PendÃªncias (numeradas)
1. Chave do Google: restringir por referrer (`https://app.gingapp.com.br/*`) e Ã s APIs Maps JavaScript/Geocoding; chave de servidor separada para geocodificar endereÃ§os.
2. Flake nÃ£o reproduzido em `audit.spec`/`two-factor.spec` (1 de 5 execuÃ§Ãµes): provÃ¡vel borda de passo TOTP.
3. Avatar ainda ausente em frequÃªncia/financeiro/certificados; "Ver detalhes" no mapa oculto (sem tela de detalhe).
4. Sem prova em produÃ§Ã£o: build Docker (sharp/bcrypt 6 no Alpine), backup `restore.sh verify`, push real, SMTP real, jobs semanais.

### 10.46 Push por Firebase (FCM), logo corrigida, aluno em vÃ¡rios grupos

**Data:** 2026-10-12 Â· **Status:** âœ… concluÃ­do (FCM real NÃƒO provado). Gate: backend 125 unit + 823 e2e rÃ¡pido + 14 bootstrap, admin 138, painel 469, app 150.

- **FCM** como transporte principal (`firebase-admin` no backend, `firebase` lazy no app, `firebase-messaging-sw.js` com escopo prÃ³prio); Web Push VAPID continua como fallback; `GET /push/config` devolve `provider`; `POST /push/test`; foreground via `onMessage` (toast + sino). VariÃ¡veis `FIREBASE_*` (docs Â§13b).
- **Logo minÃºscula**: causa = `.brand img {35x35}` vencia as classes Tailwind; corrigido no app e no painel (sidebar 160â€“180px, login 219x44); Ã­cones PWA maskable e apple-touch com fundo branco.
- **Aluno em vÃ¡rios grupos**: `Student.userId` deixou de ser Ãºnico (`@@unique([organizationId, userId])`); 409 "jÃ¡ ligado a outro aluno" sÃ³ dentro do mesmo grupo; Passaporte nÃ£o soma rodas de outro grupo.

#### O que NÃƒO deu certo e a soluÃ§Ã£o
- `two-factor.spec` falhava ~1 em 5: checava `!includes('42')` mas o `requestId` UUID Ã s vezes contÃ©m "42" â†’ checa `/students/42` (12/12 estÃ¡vel).
- `npm run build` do app falhou uma vez no `tsc` por teste de outra frente (corrigido pelo prÃ³prio agente do FCM antes do gate).

#### PendÃªncias (numeradas)
1. Preencher o Firebase no Easypanel e testar o aviso de teste (push real, app fechado, iOS nunca provados).
2. Login com 2+ vÃ­nculos onde um estÃ¡ bloqueado por aluno inativo ignora o slug pedido (decisÃ£o de produto: 401?); exportaÃ§Ã£o LGPD nÃ£o lista perfis pÃºblicos (leitura por `userId` nunca gravado).
3. `npm audit`: 4 altas no app (`@grpc/grpc-js`, via `firebase`, nÃ£o usado) e 4 no backend (`sharp`).
4. CabeÃ§alho mobile do painel sem logo e com ~8px de estouro horizontal; admin sem layout responsivo.

### 10.47 Ginga Rank (backend): pontos, ligas, rankings, temporadas

**Data:** 2026-10-12 · **Status:** ✅ backend concluído, sem commit (app e painel são de outros agentes). Gate: build OK, 141 unit, `test:quick` completo 842/842 (19 novos do ranking), `member-privacy` + ranking 28/28, smoke 74/74.

- **Dados:** migration `20261012150000_add_ginga_rank` (`PointEvent`, `RankingProfile`, `Achievement`, `SeasonResult` + enum `PointEventType`). Pontos **derivados** das tabelas de origem por `RankingService.syncStudent` (idempotente: cria/corrige/remove pela chave única `studentId+type+refType+refId`), chamado em segundo plano (`queueSync`, nunca derruba a ação) após chamada, check-in de aula/evento, graduação, certificado, roda e presença de evento marcada pela equipe. Job noturno 02:30 e fechamento mensal 03:00 do dia 1 (`RANKING_CRON`), `npm run ranking:backfill` e no boot do Docker (`RANKING_BACKFILL`).
- **API:** `GET /ranking/students|groups|me|seasons|hall-of-fame|group-overview`, `PUT /ranking/me/settings` (contrato em `ranking.controller.ts` / `dto/ranking.dto.ts`; docs §17 do EASYPANEL).
- **Decisões:** consentimento do menor = `StudentGuardian.consentPublicProfile` (Passaporte), sem campo novo; cidade/UF de um aluno = sede do grupo (`Organization.city/state`); `mapVisible` = "aparece em rankings abertos" no ranking de grupos (não filtra alunos); streak = +5 × (semanas seguidas − 1), teto 25; consistência mensal só em mês encerrado; aluno não pode se inscrever como `ATTENDED` (403) — antes qualquer aluno conseguia, o que viraria pontos grátis.
- **Demo:** `seed:demo` cria opt-in aberto para 6 adultos e 1 menor com consentimento; o backfill deu **26 alunos ativos, 25 com pontos, 397 pontos, 42 conquistas, 10 temporadas fechadas** no grupo demo.

#### O que NÃO deu certo e a solução
- O backfill standalone falhou ao subir o contexto Nest (`UserThrottlerGuard` sem `ThrottlerModule`): o módulo do script importa `ThrottlerModule.forRoot` com limite alto.
- `overdue-cron.spec` (fiação do `AppModule`) passou a falhar porque `RANKING_CRON` também liga o agendador: o spec agora desliga os 4 jobs.
- O 1º rascunho do e2e assumia `rankDelta = null` para quem tem pontos na temporada anterior (é `0`): o dado do teste passou a ser determinístico (graduação no 1º dia do mês anterior).

#### Pendências (numeradas)
1. Push de ranking cai na categoria `announcements` (`pushCategoryOf`) e abre `/notificacoes`: falta categoria/URL própria no app.
2. Recálculo noturno é sequencial por aluno (5 em paralelo): para milhares de alunos medir o tempo antes de aumentar a base.
3. Rodas futuras só pontuam no recálculo noturno; graduação/evento alterados direto no banco idem.
4. Textos do Passaporte/app devem avisar que o consentimento do responsável também libera o aluno nos rankings abertos.


### Fotos (turma/unidade/professor), aulas contínuas e chamada rápida (backend) - 2026-10-12

**Estado:** concluído (sem commit). Migration `20261012170000_photos_and_continuous_lessons`.

#### O que deu certo
- `Class.photo`, `Unit.photo` (novas) e `User.photo` (já existia; vale em todos os grupos), todas validadas por `IsImageRef` (aceita `null`/`''` para limpar via `blankImageToNull`). `PATCH /auth/me/profile {photo}` para o próprio usuário.
- Contrato de leitura: `/classes*` e `/classes/me` com `photo`, `unit{id,name,photo}`, `teacher{id,name,photo}`; `/units` com `photo`; `/teachers*` com `photo` no topo; `/lessons*` com `class`, `unit` e `teacher` (da aula ou, na falta, da turma); roster com `photo` do aluno; mapa (CLASS/UNIT) com `imageUrl`.
- Aulas contínuas: `Class.autoGenerateLessons` (padrão true), gerador único `class-lessons-generator.ts`, `ClassLessonsRollingService.ensureHorizon` (LESSONS_HORIZON_DAYS=60), job 01:30 SP (`LESSONS_CRON`), disparo ao criar/editar turma; `generate-lessons` sem `to` liga o modo contínuo.
- `GET /attendance/quick-sessions` (aulas de hoje em SP, escopo de unidade, `attendance:view`).
- Números: `test:unit` 146 ok; `test:quick` completo 869 ok (3 specs novos + 1 unit); demo (org 883) de 13 para 53 aulas futuras, até 2026-12-11, 2ª execução cria 0.

#### O que NÃO deu certo e a solução
- A migration escrita com BOM (PowerShell `Set-Content -Encoding utf8`) falhou no Postgres: regravada sem BOM + `migrate resolve --rolled-back`.
- `class-lessons-generate.e2e-spec` quebrou (turma criada com dia da semana agora gera aulas sozinha): o spec cria as turmas com `autoGenerateLessons:false`; `{}`/`{from}` deixaram de ser 400 (viram modo contínuo).
- `teachers.e2e-spec` (chaves do item) ganhou `photo`; `overdue-cron.spec` agora desliga os 5 jobs.

#### Pendências (numeradas)
1. Mudar dia/horário de uma turma não reescreve nem cancela as aulas futuras já geradas (só as novas saem certas).
2. Turmas existentes migram com `autoGenerateLessons=true`: o primeiro job cria aulas à frente em todas as que têm dia da semana.
3. Foto do professor é `User.photo` (global): o Mestre edita via `PATCH /teachers/:id`, o próprio usuário via `PATCH /auth/me/profile`.

### Cordas multicoloridas, modelos de graduação e Hierarquia do grupo (backend) - 2026-10-12

**Estado:** concluído (sem commit). Migration `20261012190000_graduation_rope_styles` (aplicada com `migrate deploy`).

#### Contrato (o que painel e app consomem)
- `GraduationLevel.style` (enum `RopeStyle`: `SOLID` | `SPLIT` dividida/listras verticais | `BRAIDED` trançada/listras diagonais, padrão SOLID) e `colors String[]` (1 a 3 hex `#RRGGBB`, a ordem importa). `color` continua existindo como cor PRIMÁRIA (`= colors[0]`). Backfill: níveis antigos viram SOLID com `colors=[color]` (hex em maiúsculas, `#RGB` expandido; `color` nulo/texto livre vira cinza neutro `#9CA3AF`).
- Escrita (`POST /graduations/systems/:id/levels`, `PATCH /graduations/levels/:id`): `style` + `colors` (400 se SOLID != 1 cor, SPLIT/BRAIDED fora de 2-3, hex inválido, cores CONSECUTIVAS iguais, campo desconhecido); `color` legado aceito (sozinho vira SOLID; se `colors` vier junto, `colors` vence). No PATCH, enviar só `style` ou só `colors` reaproveita o resto do estado atual (e valida o conjunto).
- Leitura: TODO lugar que mostra a corda devolve `{id, name, order, color, style, colors}` (superconjunto do registro): `GET /graduations`, `/graduations/systems`, `/graduations/systems/:systemId` (novo), respostas de create/update de nível, `GET /graduations/students/:id` (`graduationLevel`), create/update de graduação, `GET /passport/me` (e o público) em `currentGraduation` (agora `{id,name,order,color,style,colors}`), `GET /certificates`, `/certificates/:id`, `/certificates/me` (novo `studentGraduation:{id,graduatedAt,graduationLevel{...}}|null`), `GET /reports/graduations` (`byLevel[]` ganhou `style`/`colors`) e a exportação LGPD (`/auth/me/export`).
- `POST /graduations/levels/:id/duplicate` (graduations.create): cópia no fim da ordem (maior order + 1), nome `<nome> (cópia)`, mesma corda; 201 com o nível.
- `PUT /graduations/systems/:id/levels/reorder` `{order:[levelId...]}` (graduations.edit): ids do MAIS BAIXO para o mais alto, exatamente os níveis do sistema (senão 400). Os valores de `order` já usados são redistribuídos na nova sequência (preserva lacunas e o valor que dá pontos no Ginga Rank), em transação com ordens temporárias negativas (unique sistema+ordem); quem tem graduação em nível que mudou de ordem é re-sincronizado no ranking. Resposta: o sistema com os níveis na nova ordem.
- `GET /graduations/templates` (qualquer MEMBER; estático; sem marca de grupo): 5 modelos `[{code, name, description, levels:[{name, style, colors}]}]` (`cores-simples-tradicional` 15 níveis, `cores-classicas-10-graus`, `infantil-cores`, `divididas`, `trancadas`) em `graduations/graduation-templates.ts`. `POST /graduations/systems/from-template {code, name?}` (graduations.create) cria sistema + níveis (order 1..N) numa transação; código inexistente 404. Limite anti-abuso: no máximo 30 níveis por sistema (create e duplicate, 400). Não existe limite de plano para sistemas de graduação: vale só a permissão `graduations.create`.
- `GET /graduations/hierarchy?studentId=` (qualquer MEMBER autenticado; `Cache-Control: private, max-age=30`): `{group:{id,name,logoUrl|null}, system:{id,name}|null, masters:[{id,displayName,photo|null,level|null}], teachers:[{id,displayName,photo|null,level|null,isMyTeacher}], levels:[{id,name,order,color,style,colors,count,isMine,students:[{studentId,displayName,photo|null,isMe}]}] (MAIOR order primeiro; máx. 12 alunos por nível, o próprio aluno sempre incluído e primeiro), me:{studentId,displayName,photo|null,level|null,order|null}|null, higherCount, totalStudents}`. Sistema exibido = o do nível atual do aluno (se ativo), senão o primeiro sistema ativo com níveis. Nível atual do aluno = graduação mais recente (data, depois id). `count` = alunos ATIVOS naquele nível; `higherCount` = alunos ativos em níveis de order maior no sistema exibido; `totalStudents` = TODOS os alunos ativos do grupo. Privacidade como o ranking de grupo: só alunos ACTIVE do mesmo grupo, `displayName` = nome curto ("Nome S.") ou apelido do RankingProfile, foto = `Student.photo`; mestres/professores com nome e foto públicos (`User.name`/`User.photo`), `level` só quando há `Student` ativo ligado ao mesmo `userId` com graduação; `isMyTeacher` = professor responsável (`Class.teacherUserId`) de turma ATIVA em que o aluno está matriculado. `studentId` conferido por `resolveLink` (sem vínculo/inexistente/outro grupo = o mesmo 404); staff sem aluno ligado recebe `me: null`.
- Demo (`prisma/demo.ts`, idempotente): o sistema de 8 cordas virou Crua, Verde, Verde/Amarela (SPLIT), Amarela, Amarela/Azul (BRAIDED), Azul, Azul/Branca (SPLIT), Verde/Amarela/Azul (BRAIDED, 3 cores); só converte cordas ainda `SOLID` de 1 cor (corda editada à mão não é tocada); títulos dos certificados de graduação acompanham o nome novo.

#### O que deu certo
- Unit `graduation-rope.spec.ts` (8 testes: regras por estilo, hex, linha legada, invariantes dos modelos) e e2e `graduations-rope` (20) e `graduations-hierarchy` (12), mais `member-privacy` (varredura de todas as rotas GET com as 2 rotas novas na allowlist) e `demo-seed` (conversão idempotente).

#### O que NÃO deu certo e a solução
- O spec `graduations-manage` esperava `color` gravado como veio (`#fff`); agora `color` é normalizado para `#RRGGBB` maiúsculo e vira corda SOLID (`#FFFFFF`): o teste foi atualizado.
- O spec do demo esperava a 4ª corda "Azul"; com o novo sistema é "Amarela" (lisa): ajustado.

#### Pendências (numeradas)
1. A migration padroniza para maiúsculas as cores já gravadas (inclusive as do grupo `ginga-brasil` do seed).
2. Trocar a ordem de um sistema com muitos alunos dispara a re-sincronização do Ginga Rank (fire-and-forget, serializada por aluno).
3. Sistema com mais de 30 níveis (legado) não consegue ser reordenado pelo endpoint (o limite vale também para `reorder`).

### Ficha única do capoeirista — Fase 1 (backend + painel + app) - 2026-10-12

**Estado:** Fase 1 concluída (sem commit). Desenho completo, contrato exato, fases 2–5, migração, rollback, riscos e LGPD em
[`docs/FICHA_UNICA.md`](docs/FICHA_UNICA.md). Migration `20261012210000_person_ficha_unica` (aplicada com `migrate deploy`).

#### O que deu certo
- `Person` (identidade global: código `GING-XXXX-XXXX` com verificador, CPF só cifrado AES-256-GCM + hash HMAC + 4 últimos,
  `userId` único, `mergedIntoId`) e `Student.personId` (nullable nesta fase). Cifra AES-GCM extraída para
  `shared/security/aes-gcm.ts` (SSOT, agora usada também pelo 2FA); validador de CPF movido para `shared/security/person-document.ts`.
- Cadastro sem duplicar em `POST /students` e no CSV (409 `PERSON_ALREADY_IN_GROUP` / `PERSON_EXISTS_ELSEWHERE` com preview
  mínimo / `POSSIBLE_DUPLICATE` + `confirmNew`; 400 `INVALID_CPF` etc.), criança pelo CPF do responsável + nascimento,
  "mesmo login = mesma pessoa" ao criar o acesso (mescla automática), PATCH do CPF com conflitos 409.
- `GET /students/:id/ficha` (equipe, só matrículas do grupo), `GET /people/me/ficha` e `/people/me/code` (própria pessoa /
  dependente), `GET /people/duplicates` e `POST /people/merge` (super admin). Auditoria `PERSON_*`.
- Backfill `npm run person:backfill` + boot (`PERSON_BACKFILL`). Banco de dev: **40 matrículas → 40 fichas criadas, 0 por
  login, 0 por CPF, 2 documentos não-CPF, 0 conflitos, 0 duplicatas, 0 restantes**; 2ª execução: 0 processadas (idempotente);
  `--auto` dispensado (0 sem ficha).
- Painel: CPF com máscara/validação, CPF do responsável e código no cadastro, diálogos dos 409, botão Ficha, CSV com colunas
  novas. App: cartão "Meu código GingApp" (copiar + QR).
- Gates: backend build limpo OK, `test:unit` 162/162, `test:quick` completo **914/914** (76 specs), conjunto pedido 214/214,
  smoke 74/74, `person-ficha` 12/12; painel lint OK, 534/534, build OK; app lint OK, 208/208, build limpo OK.

#### O que NÃO deu certo e a solução
- 1ª execução do e2e novo: 11/12 — o teste supunha que nome+nascimento no MESMO grupo nunca bloqueia, mas já havia a
  ficha confirmada do outro grupo (sugestão correta). Teste reordenado; 12/12.
- Specs antigos que criam aluno pela API e apagam só o `Student` deixam `Person` órfã (91 no banco de dev após a suíte).
  Corrigido o cleanup de `students-import-export` e de `report-fixtures` (apagam as fichas sem matrícula); as órfãs criadas
  nesta sessão foram removidas do banco de dev. Demais specs continuam podendo deixar órfãs (sem efeito funcional).

#### Pendências (numeradas)
1. Fase 2 (transferência) é urgente: até lá, quem tem ficha em outro grupo não pode ser cadastrado no grupo novo (409).
2. Admin (Vue) sem tela de duplicatas/mescla (só API).
3. Exportação LGPD (`/auth/me/export`) ainda não inclui a Person; procedimento de exclusão/anonimização da Person.
4. `Student.document` legado continua em claro e visível à equipe; `Student.personId` ainda nullable (NOT NULL na F2).
5. Definir `PERSON_DOC_KEY`/`PERSON_DOC_PEPPER` no Easypanel ANTES do deploy e nunca trocar.
6. Specs antigos podem deixar `Person` órfã no banco de dev (limpeza geral opcional).

### Ficha única — Fase 2: transferência entre grupos (backend + painel + app) - 2026-10-12

**Estado:** concluída (sem commit). Contrato exato, regras e riscos em [`docs/FICHA_UNICA.md`](docs/FICHA_UNICA.md) §4.
Migration `20261012230000_transfers` (aplicada com `migrate deploy`).

#### O que deu certo
- `TransferRequest`/`TransferContest`/`EnrollmentShare` + `Student.leftAt/leftReason`; `TransfersService` (pedido idempotente com
  trava `FOR UPDATE` na Person, decisão pela pessoa ou responsável do menor, contestação informativa, aprovação em uma transação:
  matrícula nova + login/responsáveis no grupo novo + origem FORMER + shares), `TransferCronService` 04:15 (`TRANSFER_CRON`),
  auditoria `TRANSFER_*`, notificações aos dois grupos e à pessoa.
- Ficha: `sharedFromOtherGroups` (frequência por turma, graduações, certificados; nunca financeiro) e `until/leftReason`.
- Higiene: `PATCH /people/me`, CPF legado mascarado em `/students*` (CSV completo só p/ MESTRE), Person (+ transferências) na
  exportação LGPD, 409 `PERSON_EXISTS_ELSEWHERE` com `transferAvailable:true`.
- Painel: "Solicitar transferência" no conflito, página Transferências (MESTRE), histórico compartilhado na ficha, CPF mascarado
  sem reenvio. App: tela `/transferencias` (aprovar/recusar com explicação, responsável decide pelo menor), selo, edição de
  apelido/telefone.
- Gates: backend build limpo OK, `test:unit` 163/163, `test:quick` completo **924/924** (77 specs), conjunto pedido 224 (1 falha
  corrigida, ver abaixo), smoke 74/74, `transfers` 10/10; painel lint OK, 546/546, build OK; app lint OK, 217/217, build OK.

#### O que NÃO deu certo e a solução
- `transfers` 1ª execução 7/10: `toUnit` nulo na resposta do POST (faltava carregar a unidade: corrigido) e o token do grupo
  antigo passou a dar 401 depois da aprovação — comportamento correto (a matrícula de origem vira FORMER e a regra existente de
  aluno inativo barra o vínculo ALUNO); o teste passou a usar o token do grupo novo.
- `member-privacy` (MESTRE lê alunos) esperava o documento cru na lista; agora sai mascarado: teste ajustado.
- `person-ficha` esperava `transferAvailable:false`: ajustado para `true` + `transfer`.
- `Student.personId NOT NULL` adiado (seed/demo/specs criam aluno sem ficha; sem prova da contagem em produção).

#### Pendências (numeradas)
1. Adulto sem login não consegue aprovar (pedido expira); faltam convite/acesso guiado.
2. Sem "desfazer transferência"/revogar compartilhamento por tela; sem fluxo para treinar em dois grupos ao mesmo tempo.
3. Push `TRANSFER_*` abre `/notificacoes` (sem categoria própria).
4. Painel: limpar o CPF pela edição deixou de ser possível (campo vazio = não mexer).
5. `Student.personId NOT NULL` e remoção do CPF em claro do banco (Fase futura).

### Ficha única — Fase 3: cargos acumuláveis (backend + painel + app) - 2026-10-12

**Estado:** concluída (sem commit). Decisões, contrato exato e riscos em [`docs/FICHA_UNICA.md`](docs/FICHA_UNICA.md) §5.
Migration `20261013010000_staff_roles` (aplicada com `migrate deploy`; bootstrap rodado no banco de dev: 26 linhas novas da matriz).

#### O que deu certo
- `OrgRole` + `INSTRUTOR`/`MONITOR` (menor impacto: matriz/guards/token inalterados), `StaffRole`, `PersonRole` (histórico),
  `GraduationRoleRule`, `RoleSuggestionNotice`, `Student.isStaff`; migration materializou 12 cargos (7 MESTRE, 5 PROFESSOR)
  sem mudar acesso. `JwtStrategy` relê o papel do banco (conceder/revogar vale na hora).
- Matriz 6×13=78: INSTRUTOR nunca exclui/sem financeiro/graduação e certificado só leitura; MONITOR só leitura + chamada.
  Escopo por unidade para PROFESSOR/INSTRUTOR/MONITOR; INSTRUTOR/MONITOR podem ser responsáveis de turma.
- `RolesService` (grant/revoke/sugestões/regras/aviso 1x), `npm run roles:backfill` + boot (`ROLES_BACKFILL`): no banco de dev
  12 matrículas de aluno `isStaff` criadas para a equipe (2ª execução: 0; `--auto` dispensado). Demo: regras MONITOR≥4,
  INSTRUTOR≥6, PROFESSOR≥8; aluno3 Instrutor e aluno2 Monitor (2ª execução do demo: nada a criar).
- Leitura: `/teachers` com `roles[]`+`student`, `/students` com `staffRoles` e `?role=`, ficha com `roles`, `/auth/me` com `roles`.
- Painel: tela Equipe com selos, Promover/Revogar, Sugestões, Cargos por corda, filtro e selos em Alunos, menu de
  INSTRUTOR/MONITOR. App: selo de cargo no Perfil/Jornada e atalho para o painel.
- Gates: backend build limpo OK, `test:unit` 164/164, `test:quick` completo **932/932** (78 specs), conjunto pedido com
  bootstrap 226/226 (17 specs), smoke 74/74, `staff-roles` 8/8; painel lint OK, 575/575, build OK; app lint OK, 223/223, build OK.

#### O que NÃO deu certo e a solução
- 1ª rodada completa (920/924): com a equipe matriculada como aluno, `students` (MESTRE "sem Student próprio") e o perfil
  próprio passaram a usar o RESPONSAVEL do seed; `teachers` (chaves do item com `roles`/`student`) e `units-crud` (matriz com 6
  papéis) ajustados. `bootstrap` (oráculo 52→78 linhas) e `demo-seed` (equipe 4→6) ajustados.
- O demo promovia aluno1 (a vitrine do app como ALUNO): trocado para aluno3 (Instrutor).
- `graduations-rope` falhava entre 21h e 24h (graduação em UTC caía no dia seguinte ao "hoje" de SP do relatório): o teste
  passou a usar a data civil de SP (falha preexistente, não da Fase 3).
- `spec` novo: `GET /teachers` devolve array (não `items`) — corrigido no teste.

#### Pendências (numeradas)
1. MONITOR faz chamada de qualquer turma do seu escopo de unidade (sem checagem "só as turmas dele").
2. Painel: botões de criação (Novo aluno/turma/aula) ainda aparecem para MONITOR (o backend responde 403).
3. Equipe criada pela tela Equipe só ganha matrícula de aluno no próximo boot/backfill.
4. Listas, dashboard, relatórios e ranking do grupo passam a incluir a equipe como alunos (intencional; avaliar filtro `isStaff`).

### Ficha única — Fases 4 (ocorrências) e 5 (equivalência de cordas) - 2026-10-12/13

**Estado:** concluídas (sem commit). Contrato exato, regras e pendências finais em [`docs/FICHA_UNICA.md`](docs/FICHA_UNICA.md)
§6, §7 e §7b. Migration `20261013030000_occurrences_equivalences` (aplicada com `migrate deploy`; só adiciona).

#### O que deu certo
- `Occurrence` + `OccurrencesService`: só o MESTRE do grupo escreve, lê e retrata; o MESTRE do grupo novo lê as dos grupos
  anteriores só na ficha compartilhada (retratadas fora; leitura auditada `OCCURRENCE_READ_SHARED`); a pessoa/responsável
  vê com o motivo e contesta 1x; expulsão pode encerrar a matrícula (`leftReason EXPELLED`). Aviso `OCCURRENCE_REGISTERED`.
- `LevelEquivalence` + `GraduationEquivalencesService`: sugestão por posição relativa, só corda compartilhada, reconhecer
  cria a graduação no grupo novo (data de origem, nota "Reconhecida de...", idempotente); a reconhecida pontua só na matrícula
  nova (a de origem é Ex-aluno e fica fora dos rankings) e alimenta sugestão de cargo/Hierarquia/Jornada.
- "Quem decide pela pessoa" virou SSOT (`people/person-deciders.ts`), usado por transferências e ocorrências.
- Painel: seção Ocorrências (só MESTRE; expulsão com confirmação forte; retratar), "Ocorrências em outros grupos" (leitura,
  aviso de confidencialidade), "Reconhecer corda" com RopeSwatch e a sugestão. App: "Minhas ocorrências" (contestar) e
  Jornada com "Corda de origem" / "Reconhecida pelo grupo".
- Gates: backend build limpo OK, `test:unit` 165/165, `test:quick` completo **938/938** (79 specs), conjunto pedido com
  bootstrap 194/194 (15 specs), smoke 74/74, `occurrences-equivalences` 6/6; painel lint OK, 588/588, build OK; app lint OK,
  235/235, build OK.

#### O que NÃO deu certo e a solução
- Nada falhou no backend nesta fase (o spec novo passou de primeira; a varredura `member-privacy` só ganhou
  `/api/people/me/occurrences` na allowlist). Na UI: o app quebrou 3 testes da Jornada (falta de QueryClient no mock) e o
  painel teve um erro de tipo em `style` — corrigidos pelos agentes antes do gate.
- `routeTree.gen.ts` do app foi editado à mão pelo agente e regenerado pelo build (diff esperado).

#### Pendências (numeradas)
1. Owner decidir a retenção das ocorrências (proposta em FICHA_UNICA §6; hoje sem purga).
2. Sem tela de ocorrências do PRÓPRIO grupo fora da ficha (lista geral/relatório) e sem anexos.
3. Equivalências: sem tela de gestão em massa (só por aluno na ficha) e sem revogação de equivalência declarada.
4. Pendências gerais da ficha única: FICHA_UNICA §7b.
### Ficha única — pendências A–F (convite guiado, duplicatas, monitor, anonimização, dados do painel, UI) - 2026-10-12/13

**Estado:** concluídas (sem commit). Contrato, regras e limites em [`docs/FICHA_UNICA.md`](docs/FICHA_UNICA.md) §12. Migration
`20261014000000_approval_links_anonymization` (aplicada com `migrate deploy`; só adiciona).

#### O que deu certo
- **A** Link de aprovação de uso único (`TransferApprovalToken`, SHA-256, expira com o pedido, regenerável) para adulto sem
  login; rotas públicas `GET/POST /public/transfer-approval/:token[/approve|decline]` com throttle forte; aprovar cria o
  `User` e aprova na mesma transação; e-mail extra se SMTP ativo; app `/aprovar-transferencia`; painel copia/WhatsApp/gera link.
- **B** Admin Vue: tela "Duplicatas" (lista, lado a lado, mesclar com aviso de irreversível, erros 409 em pt-BR).
- **C** MONITOR só chama turmas dele (`Class.teacherUserId`) ou aulas atribuídas (`Lesson.teacherUserId`): `GET /attendance`,
  roster, marcar, chamada rápida e QR; fora disso 404. Painel: botões de criar/editar por `useCan`; matriz espelhada com teste.
- **D** `POST /data-deletion-requests/:id/anonymize` (super admin, `confirm:true`): anonimiza Person/matrículas/login numa
  transação, mantém frequência/graduações/financeiro/ocorrências (sem motivo); revoga sessões; marca DONE; auditoria. Admin:
  botão "Anonimizar" com confirmação forte.
- **E** `classNames` e `currentCord` na lista de alunos (2 consultas em lote) e `studentCount` por nível (1 consulta).
- **F** Logo no cabeçalho mobile e estouro horizontal corrigido (medido 375/375 nas 18 rotas; antes até +39px); avatar em
  Financeiro, Certificados e Inadimplentes (backend passou a enviar `photo`/`studentPhoto`/`organizationLogoUrl`).
- Gates: backend build limpo OK; `test:unit` 165/165; `test:quick` completo **949/949** (83 specs; 4 novos: 
  `transfer-approval-link` 4, `monitor-attendance` 3, `list-extras` 2, `anonymization` 2); smoke 74/74; admin test 144/144 +
  build OK (sem script de lint); painel lint OK, 608/608, build OK; app lint OK, 241/241, build OK.

#### O que NÃO deu certo e a solução
1. `npx prisma generate` deu EPERM ao renomear o `query_engine-windows.dll.node` porque há uma API de dev (`node dist/main.js`,
   porta 3100) rodando fora desta sessão; parar o processo não foi autorizado. Os tipos/JS do client foram gerados e a engine
   é a mesma versão, então build e testes passaram; **reinicie a API de dev/rode `prisma generate` ao parar o processo** para
   regenerar a engine por completo.
2. `GET /finance` tinha teste de contrato `student = {id,name}`; o campo `photo` foi acrescentado de propósito e o teste
   ajustado (`finance.e2e-spec.ts`).
3. `students-import-export` falhou 3 testes numa rodada (`PERSON_EXISTS_ELSEWHERE` para o CPF fixo do spec): sobra de ficha
   com esse CPF de execução anterior interrompida; sem relação com o código. Passou isolado e na suíte completa (949/949).
4. Heredocs longos no shell quebraram (e depois o `bash` do Git deu erro de Cygwin); os scripts foram escritos por arquivo.

#### Pendências (numeradas)
1. Regenerar a engine do Prisma (item 1 acima) e reiniciar a API de dev.
2. Definir `APP_URL` em produção (o link de aprovação sai sem domínio se faltar) e, se quiser o envio por e-mail, o SMTP.
3. Owner: política de retenção/purga das ocorrências (a anonimização as mantém sem motivo).
4. Continuam: `Student.personId NOT NULL`, remover CPF em claro de `Student.document`, desfazer transferência / desmesclar.
5. O MONITOR continua vendo (leitura) todas as turmas do escopo; só a chamada foi restrita.

---

## Correções do QA integrado (2026-10-12/13) — médios M1–M4 e baixos B1–B8, B10

Origem: relatório de QA integrado (navegador + backend real). Sem commit; trabalho de outros agentes na árvore preservado.

#### O que deu certo
- **M1 Estrutura do sistema de graduação só do MESTRE.** `MestreOnlyGuard` nos endpoints de ESTRUTURA de `graduations.controller.ts`
  (POST/PATCH/DELETE `systems`, `systems/from-template`, níveis create/reorder/update/duplicate/delete). `role-rules` PUT e
  `equivalences` já eram MESTRE-only. PROFESSOR/INSTRUTOR continuam graduando aluno (`/graduations/students/...`, pela matriz).
  Painel esconde Novo sistema/Novo nível/Editar/Duplicar/Reordenar/Remover/Criar a partir de modelo para quem não é MESTRE.
  Testes: `graduations-manage` (PROFESSOR 403 em sistema/nível/from-template/duplicate; MESTRE 201/200), `graduations-rope` (reorder PROFESSOR 403).
- **M2 Ações compactas.** `RowActions` (ícones com `title`/`aria-label` + menu "⋯") e `DataTable` com nome fixo à esquerda e Ações à direita
  (rola dentro do card). Alunos (Tabela), Equipe/Professores e Turmas, sem perder ação nem permissão.
- **M3 Aulas no período atual.** `GET /lessons?order=asc|desc|nearest` (nearest = hoje e futuras crescentes, depois passadas da mais recente;
  sem `order` = comportamento antigo). Painel: Aulas abre em -7/+30 dias com opção "Todas"; select "Aula" da Frequência usa a janela,
  `order=nearest`, limite 60 e "Mostrar todas". Teste e2e `lessons` (nearest + paginação entre faixas) e unitário da janela.
- **M4 Admin** `OrganizationDetailView` reativo ao `:id` (computed + watch imediato, descarta resposta atrasada); testes.
- **B1** "Close" → "Fechar" (dialog/sheet do app e do painel; o admin não tem esses componentes). **B2/#6** helper de plural pt-BR
  (`lib/plural.ts` no app e painel, `utils/plural.ts` no admin) aplicado nos "(s)" e "1 alunos/presentes". **B3** rodapé do FormDialog fixo com corpo rolável;
  nomes da régua quebram linha (`line-clamp-2` + `title`). **B4** `GET /students?order=name|recent` (padrão da API continua `recent`; o painel envia `order=name`);
  teste e2e `students`. **B5** textos de vazio da Ficha (o `Section` nunca caía no fallback). **B6** Home/Jornada: o hook já seguia o aluno ativo
  (`useGraduations(student?.id)`); corrigido o rótulo ("Graduação de <nome>" para dependente). **B8** cartão da Home sem truncar.
- **B7 Ligas do ranking** renomeadas só no nome de exibição: Semente, Broto, Ginga, Roda, Axé, Mandinga, Lenda (códigos CRUA…PRETA e cores iguais) em
  `ranking-rules.ts`, app `lib/ranking.ts`, notificação de liga e testes.
- **B9/B10 Admin:** removido o texto "serão implementados nas próximas fases"; tabela de Auditoria em `overflow-x-auto` com colunas fixas.
- **Limpeza do DB de DEV** (`localhost:15432`, script descartável `D:\tmp\e2e-cleanup.cjs`, transação, DRY antes): antes 27 grupos / 16 planos / 20 users /
  791 notificações `[e2e`; depois 3 grupos (`demo`, `ginga-brasil`, `[audit] Grupo 224735` — intocados) / 4 planos reais / 15 users / 0 `[e2e`.
  Apagados: 24 grupos e2e, 12 planos "Plano E2E", 5 users `@e2e-team.local`, 791 notificações, 4 alunos + 4 pessoas + 4 cargos + 4 unidades + 4 memberships.

#### O que NÃO deu certo / observações
1. Heredoc/escape no shell corrompeu uma edição do `lessons.e2e-spec.ts` (revertida só a minha alteração e refeita com Edit).
2. Verificação visual a 1280/375 px não feita (só lint/build/testes e classes); vale uma olhada humana na tabela de Equipe e no diálogo "Novo nível".
3. O admin não tem script de lint.

#### Pendências
1. Revisão visual no navegador (item 2 acima). 2. A orgs `[audit] Grupo 224735` (sessão de auditoria) não foi apagada por ser ambígua.
3. Specs e2e ainda deixam resíduos por falta de limpeza própria (`authpwd`, `dto-hardening`, planos "Plano E2E cargos"); repetir o script de limpeza quando preciso.
