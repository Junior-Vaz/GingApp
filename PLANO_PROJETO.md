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
