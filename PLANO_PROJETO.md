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
