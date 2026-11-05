# Contrato — Ginga Rank (lado do aluno): extrato, meta, evolução, conquistas e "Como funciona"

Fonte única entre backend (`backend/src/interface/http/ranking/*`) e app (`app.gingapp.com.br/src/*ranking*`).
Escopo decidido pelo dono: **só o aluno** (nada de painel agora): extrato de pontos, meta do mês, conquistas (mais, com níveis,
raridade e vitrine) e **um lugar que explica como o rank funciona**. Em caso de dúvida este documento vence; divergência = avisar.

**Acrescentado pelo dono no meio do trabalho: "check-ins diários também"** → §6 (Check-in diário do app: 1 toque por dia, vale POUCO
de propósito para o treino continuar valendo muito mais; sem pressão de "perder sequência").

Princípios que NÃO mudam: pontos são DERIVADOS das tabelas de origem (`RankingService.syncStudent`, idempotente); mensalidade/
financeiro NUNCA gera ponto; menores seguem as regras de privacidade e consentimento atuais; nenhuma regra de pontos muda neste
trabalho (só se EXPLICA e se MOSTRA o que já existe) — exceto o catálogo de conquistas, que cresce.

Todas as rotas novas: token de MEMBER; `?studentId=` opcional = dependente do usuário (MESMA regra e 403/404 da rota `GET /ranking/me`).

## 1. Rotas novas

### `GET /ranking/rules` — regras e textos (SSOT para a tela "Como funciona")
Sem dados pessoais; qualquer membro. Devolve as constantes REAIS de `ranking-rules.ts` (a tela nunca duplica números):
```ts
interface RankingRules {
  points: { classAttendance: number; streakStep: number; streakMax: number; eventAttendance: number; rodaParticipation: number;
            monthlyConsistency: number; graduationPerLevel: number; certificate: number;
            dailyCheckin: number; dailyWeekBonus: number };
  limits: { maxClassPointsPerDay: number; consistencyMinRate: number /* 0.8 */; consistencyMinLessons: number /* 4 */;
            dailyWeekTarget: number /* 5 */; dailyMonthCapDays: number /* 20 */ };
  leagues: { code: string; name: string; color: string; minPoints: number }[];
  categories: { code: 'GENERAL'|'TRAINING'|'RODAS'|'EVENTS'; label: string; description: string }[];
  bands: { code: 'KIDS'|'YOUTH'|'ADULT'; label: string }[];        // KIDS até 12, YOUTH 13–17, ADULT 18+
  achievements: { code: string; name: string; description: string; family: string; tier: 'BRONZE'|'SILVER'|'GOLD'|null }[];
  seasons: { lengthLabel: 'mensal'; timezone: 'America/Sao_Paulo' };
}
```

### `GET /ranking/me/points?season=YYYY-MM|ALL&limit=&offset=` — extrato
`limit` 1..50 (padrão 20), `offset` >= 0, `season` padrão `ALL`. Ordem: `occurredAt` desc, `id` desc. Cabeçalho `X-Total-Count`.
```ts
interface PointStatementItem {
  id: number;
  type: 'CLASS_ATTENDANCE'|'STREAK_BONUS'|'EVENT_ATTENDANCE'|'RODA_PARTICIPATION'|'MONTHLY_CONSISTENCY'|'GRADUATION'|'CERTIFICATE'|'DAILY_CHECKIN'|'DAILY_WEEK_BONUS';
  points: number;
  occurredAt: string;            // ISO
  season: string;                // 'YYYY-MM'
  label: string;                 // pt-BR legível, montado no servidor (ver abaixo)
}
interface PointStatement { items: PointStatementItem[]; total: number; seasonTotals: { season: string; points: number }[] /* todas as temporadas do aluno, desc, máx 24 */ ; allTimePoints: number }
```
`label` (sem dados de terceiros): check-in diário → `Check-in do dia <dd/mm>` ; semana em dia → `Semana em dia (<n> check-ins)` ; aula → `Aula: <turma>` ; evento → `Evento: <título>` ; roda → `Roda: <título>` ; sequência → `Bônus de sequência (<n>ª semana seguida)`
(n = semanas consecutivas até aquela semana) ; mês → `Mês consistente: <mês por extenso>/<ano>` ; graduação → `Graduação: <nível>` ; certificado → `Certificado: <título>`.
Origem apagada/ilegível = rótulo genérico do tipo ("Aula", "Evento"…), NUNCA erro. Sem N+1 (uma consulta por tipo, em lote).

### `GET /ranking/me/evolution?granularity=WEEK|MONTH&count=` — evolução
`count` 4..26 (padrão 12). Devolve da mais antiga para a mais nova, SEMPRE com `count` pontos (zero quando não houve ponto):
```ts
interface EvolutionPoint { key: string /* WEEK: segunda 'YYYY-MM-DD'; MONTH: 'YYYY-MM' */; points: number; cumulative: number; lessons: number /* aulas presentes contadas */ }
interface Evolution { granularity: 'WEEK'|'MONTH'; points: EvolutionPoint[]; bestWeek: { key: string; points: number } | null; currentStreakWeeks: number; bestStreakWeeks: number }
```
`cumulative` = pontos de todos os tempos até o fim do período. Semana = segunda a domingo (America/Sao_Paulo, mesma `weekStart` das regras).

### `GET /ranking/me/goal` — meta do mês e próxima liga
```ts
interface MonthGoal {
  season: string;                              // mês corrente 'YYYY-MM' (SP)
  lessonsPlanned: number;                      // aulas ATIVAS do mês nas turmas do aluno (matrícula ativa), inclusive as que ainda virão
  lessonsDone: number;                         // aulas do mês até hoje com chamada feita
  present: number;                             // presenças contadas no mês
  neededForBonus: number;                      // presenças necessárias para o bônus do mês = ceil(consistencyMinRate * lessonsPlanned), mín. consistencyMinLessons; 0 se não há aulas planejadas
  remainingForBonus: number;                   // max(0, neededForBonus - present)
  canStillReach: boolean;                      // present + aulas ainda por vir >= neededForBonus
  bonusPoints: number;                         // POINTS.MONTHLY_CONSISTENCY
  hasGoal: boolean;                            // false = sem aulas planejadas no mês (a tela mostra "sem meta este mês")
  league: { current: {code,name,color}; next: {code,name,color,minPoints} | null; pointsToNext: number; progressPct: number };
}
```
Honestidade: o bônus real só é concedido com o mês ENCERRADO (regra atual); a tela diz isso. `lessonsPlanned` conta só aulas ativas
(cancelada não conta), sem dupla contagem quando a mesma aula serve a mais de uma matrícula.

### `GET /ranking/me/achievements` — todas as conquistas, ganhas ou não
```ts
interface AchievementView {
  code: string; name: string; description: string; family: string; tier: 'BRONZE'|'SILVER'|'GOLD'|null; icon: string; /* chave de ícone p/ o app */
  earned: boolean; earnedAt: string | null;
  progress: { current: number; target: number } | null;     // null quando não é contável (ex.: Mês perfeito)
  rarityPct: number | null;                                  // % dos alunos ATIVOS do grupo que a têm (0..100, 1 casa); null se o grupo tem < 10 alunos ativos
}
interface AchievementsResponse { items: AchievementView[]; showcase: string[]; earnedCount: number; totalCount: number }
```
Ordem: por família, depois nível. `showcase` = códigos escolhidos (§3).

## 2. Catálogo de conquistas (de 6 para ~28)
Os 6 códigos atuais NÃO mudam (`SEQ_4W`, `FIRST_GRADUATION`, `RODA_10`, `EVENT_5`, `PERFECT_MONTH`, `CENTURION`). Novos, derivados em
`derivePoints` (função pura; `earnedAt` = data em que o requisito foi atingido; o recálculo diário e o `syncStudent` concedem
retroativamente — NÃO enviar notificação em massa por conquistas retroativas: só notificar as ganhas nos últimos 7 dias):
| Família (`family`) | Códigos novos (nível) e regra |
|---|---|
| `PRESENCA` | `AULAS_25` (bronze: 25 aulas), `CENTURION` (existente, prata: 100), `AULAS_250` (ouro: 250), `AULAS_500` (ouro: 500), `AULAS_1000` (ouro: 1000) — contagem = aulas presentes CONTADAS |
| `SEQUENCIA` | `SEQ_4W` (existente, bronze), `SEQ_8W` (prata), `SEQ_12W` (ouro), `SEQ_26W` (ouro), `SEQ_52W` (ouro) — semanas consecutivas |
| `MES` | `PERFECT_MONTH` (existente, ouro), `CONSISTENT_3M` (prata: 3 meses seguidos com bônus de consistência), `CONSISTENT_6M` (ouro: 6 seguidos) |
| `RODAS` | `RODA_1` (bronze), `RODA_10` (existente, prata), `RODA_25` (ouro), `RODA_50` (ouro) |
| `EVENTOS` | `EVENT_1` (bronze), `EVENT_5` (existente, prata), `EVENT_15` (ouro), `EVENT_30` (ouro) |
| `JORNADA` | `FIRST_GRADUATION` (existente, bronze), `GRADUATIONS_3` (prata), `GRADUATIONS_5` (ouro), `CERTIFICATES_3` (prata: 3 certificados) |
| `TEMPO` | `YEARS_1` (bronze), `YEARS_2` (prata), `YEARS_5` (ouro) — desde a PRIMEIRA data conhecida do aluno no grupo (matrícula/primeira presença, o que for mais antiga e existir); `COMEBACK` (prata: voltou a treinar — uma presença depois de >= 30 dias sem nenhuma) |
Se algum requisito não for derivável com os dados existentes, CORTAR a conquista e relatar (não inventar dado). `icon`: chave
curta estável por família (`presenca`, `sequencia`, `mes`, `rodas`, `eventos`, `jornada`, `tempo`) — o app mapeia para ícone lucide.
Raridade e `progress.current/target` vêm dos mesmos contadores da derivação (uma fonte só; nada de recontar à parte).

Famílias/códigos do check-in diário (§6), contadores sobre os dias de check-in: família `DIARIO` (ícone `diario`): `DAILY_7` (bronze: 7 check-ins),
`DAILY_30` (prata: 30), `DAILY_100` (ouro: 100) e `WEEK_OK_4` (prata: 4 semanas em dia SEGUIDAS).

## 3. Vitrine (até 3 conquistas no perfil)
- Prisma: `RankingProfile.showcase String[] @default([])` (migration nova escrita à mão, sem BOM).
- `PUT /ranking/me/settings` aceita `showcase?: string[]` (0..3 códigos únicos, TODOS já ganhos pelo aluno; senão 400 `ACHIEVEMENT_NOT_EARNED`;
  fora de 0..3 ou duplicado = 400). NÃO dispara a regra de consentimento do responsável (só o `optInPublic` dispara).
- `GET /ranking/me` e `GET /ranking/me/achievements` devolvem `showcase`. Itens da lista `GET /ranking/students` ganham `showcase: string[]`
  (códigos) APENAS para entradas que já são visíveis pelas regras de visibilidade atuais.

## 4. App (aluno/responsável) — tela Ranking
Duas áreas novas dentro de `/ranking` (rota/abas, sem quebrar a tela atual de classificação):
1. **Meu progresso** (por aluno ativo/dependente selecionado): anel da **meta do mês** (`/me/goal`; "8 de 12 aulas · faltam 2 para o bônus de +50";
   estado sem meta; nota "o bônus é concedido quando o mês fecha"), **próxima liga** (barra + pontos que faltam), **sequência** atual e melhor,
   **gráfico de evolução** (barras SVG simples semanais/mensais com alternância, sem biblioteca nova), **extrato** ("Como ganhei meus pontos":
   lista paginada com "Ver mais", filtro de temporada, total por temporada).
2. **Conquistas**: grade com TODAS (ganhas coloridas por nível bronze/prata/ouro; bloqueadas esmaecidas com barra de progresso `current/target`),
   raridade ("só 4% do grupo tem"), detalhe ao tocar, e seleção da **vitrine (até 3)** com salvar; a vitrine aparece no perfil/progresso do aluno.
3. **Como funciona** (botão "Como funciona?" no topo do Ranking, folha ou página): seções montadas com `GET /ranking/rules` (NUNCA números fixos no
   front): como ganhar pontos (tabela), limite diário, sequência semanal (exemplo numérico), mês consistente (80% e mínimo de aulas), ligas (lista com cores e
   mínimos), categorias, faixas etárias, temporadas mensais, conquistas (níveis e raridade), **privacidade** (ranking do grupo mostra todos os ativos; os
   abertos só com opt-in; apelido; menor só com consentimento do responsável) e **perguntas frequentes** (mensalidade não dá ponto; falta não tira ponto;
   por que meu ponto não apareceu — a chamada precisa estar registrada; o que é temporada). Texto curto, em português simples, pensado para criança e responsável.
- Ícones lucide (sem emojis); medalhas bronze/prata/ouro por cor; respeitar reduced-motion; botões >= 44 px; acessível.

## 6. Check-in diário do app (novo)
**Ideia:** uma vez por dia o aluno toca em "Check-in de hoje" (um "Salve!" ao app). Vale pouco de propósito (treino real vale muito mais) e NÃO
cria pressão de "perder sequência": a meta é semanal ("5 de 7 dias"), não uma corrente que quebra.

**Regras (constantes novas em `ranking-rules.ts`, SSOT, expostas em `/ranking/rules`):**
- `POINTS.DAILY_CHECKIN = 1` por dia com check-in; no máximo `DAILY_MONTH_CAP_DAYS = 20` dias pontuam por temporada (mês); os demais dias ainda
  contam para a semana e para as conquistas, só não somam ponto.
- `POINTS.DAILY_WEEK_BONUS = 5`: semana (segunda a domingo, SP) com `DAILY_WEEK_TARGET = 5` ou mais dias de check-in; concedido SÓ com a semana
  ENCERRADA (como o bônus mensal), uma vez por semana. Teto prático ≈ 20 + 4×5 = 40 pontos/mês por check-in diário.
- Categoria: entra em `GENERAL` (todos os tipos) e NÃO entra em `TRAINING`/`RODAS`/`EVENTS`.
- Dia = data civil de America/Sao_Paulo calculada NO SERVIDOR (o app nunca envia a data). 1 por aluno por dia (idempotente). Só aluno ATIVO.
- Os pontos são DERIVADOS como os demais: nova tabela de origem `DailyCheckin` e `derivePoints` ganha `source.dailyCheckins`
  (função pura; `syncStudent` busca a tabela). Tipos novos: `PointEventType.DAILY_CHECKIN` (refType `Day`, refId `YYYY-MM-DD`) e
  `DAILY_WEEK_BONUS` (refType `Week`, refId segunda `YYYY-MM-DD`).

**Prisma (migration NOVA, escrita à mão, sem BOM; `ALTER TYPE ... ADD VALUE` em arquivo/etapa que NÃO use o valor na mesma transação):**
`model DailyCheckin { id, organizationId, studentId (FK Student onDelete Cascade), day String /* 'YYYY-MM-DD' */, createdAt }`,
`@@unique([studentId, day])`, `@@index([organizationId, day])`; enum `PointEventType` ganha `DAILY_CHECKIN` e `DAILY_WEEK_BONUS`.
O `Student` anonimizado/removido leva os check-ins junto (cascade; conferir o fluxo de LGPD/anonimização existente).

**Rotas** (token de MEMBER; `?studentId=` = dependente, mesma regra do `me`; só aluno ATIVO):
- `GET /ranking/me/daily-checkin` →
  ```ts
  interface DailyCheckinStatus {
    today: string;                 // 'YYYY-MM-DD' (SP)
    checkedInToday: boolean;
    weekDays: number;              // check-ins na semana corrente
    weekTarget: number;            // 5
    weekDone: boolean;             // weekDays >= weekTarget
    monthDays: number;             // check-ins no mês corrente
    monthCapDays: number;          // 20
    last7: { day: string; done: boolean }[];   // os últimos 7 dias, do mais antigo ao de hoje
  }
  ```
- `POST /ranking/me/daily-checkin` (sem corpo; campo extra = 400) → 200 `{ ...DailyCheckinStatus, alreadyCheckedIn: boolean, pointsToday: number }`
  (`pointsToday` = 1 se este check-in pontuou, 0 se já existia ou o teto do mês foi atingido). Idempotente (concorrência segura pelo unique). Throttle 30/min
  por usuário. Depois de gravar: `ranking.queueSync(studentId)` (fire-and-forget) para os pontos aparecerem. Nenhuma localização nem dado do aparelho.
- Antifraude: 1 por dia por aluno (unique), data só do servidor, sem pontos por dia futuro; o teto mensal e o peso baixo impedem "subir de liga só tocando".

**App:** cartão "Check-in de hoje" em "Meu progresso" (botão grande "Salve! Check-in de hoje", 7 bolinhas dos últimos 7 dias, "3 de 5 dias nesta
semana", mensagem de +1 ponto ou "hoje já valeu"; sem culpa quando falha um dia) e uma LINHA discreta na Home ("Check-in de hoje" + botão) só quando o
Ranking está acessível e ainda não foi feito hoje (não empilhar com os outros cartões da Home: linha fina, sem competir com o cartão de instalar/GPS).
Sucesso com micro-animação (respeitar reduced-motion) e invalida as queries do rank (`/me`, `/me/points`, `/me/goal`, `/me/evolution`, `/me/achievements`).
Extrato mostra os pontos do check-in; "Como funciona" explica (vale pouco, o treino vale muito mais, meta semanal, teto do mês).
Menores: sem mensagem de "você perdeu a sequência"; nada de notificação diária insistente (nenhuma push nova neste escopo).

## 5. Segurança / privacidade / limites
- Tudo filtrado por `organizationId` do token e pelo(s) aluno(s) do usuário (dependente só do próprio responsável); id alheio = mesmo 404/403 do `me`.
- Extrato e evolução NUNCA expõem outros alunos. Raridade é agregada (sem identificar ninguém) e oculta em grupo pequeno (< 10 ativos).
- `label` do extrato só com dados do próprio grupo e do próprio aluno.
- Sem mudança nas regras de pontos, ligas, travas anti-fraude ou privacidade existentes. Nenhum ponto por pagamento.
- Consultas indexadas e limitadas (limit <= 50, count <= 26); sem varrer tabelas inteiras por requisição.
