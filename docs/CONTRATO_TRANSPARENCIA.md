# Contrato — Transparência da plataforma (Frente B, Fase 1): livro-caixa no admin + página pública `/transparencia`

Origem: `docs/PLANO_MONETIZACAO_PATROCINIO_E_APOIO.md` (B1–B5, fase B-F1). Pedido do dono: "pode seguir com a transparência".
Escopo desta fase: **só dados lançados manualmente**. NÃO há pagamento, Pix, apoiador, selo nem "esconder patrocinadores" (isso é B-F2).
Objetivo: a plataforma é gratuita e o dono quer mostrar, todo mês, quanto custa e de onde vem o dinheiro, em português simples.

## 1. Regras de ouro
1. **Nenhum dado pessoal** na página pública nem na API pública: só totais por categoria/mês. A `description` de um lançamento (pode citar fornecedor ou pessoa) é **privada do admin**: NUNCA sai no endpoint público.
2. **Só mês publicado é público.** Lançamento de mês não publicado nunca aparece (nem agregado).
3. **Mês publicado é congelado:** criar/editar/excluir lançamento cujo mês está publicado = 409 `MONTH_PUBLISHED` (despublicar primeiro). Ao publicar, o servidor grava um **retrato** (alunos ativos, grupos ativos, meta do mês) para o número público não mudar depois.
4. Valores sempre em **centavos inteiros** (`amountCents`), nunca float. O percentual é calculado no servidor com inteiros.
5. Só **super admin** escreve (lançar, editar, excluir, publicar, despublicar, configurar). Qualquer usuário PLATFORM lê. Toda escrita é **auditada** (id, mês, categoria, valor; sem texto livre de `description` no log de auditoria além do id).
6. A página pública não depende de login e não coloca nada em URL/query. Nenhum IP/User-Agent é lido ou guardado ao servir.

## 2. Modelo de dados (migration `20261107000000_transparency`, escrita à mão, sem BOM)
- `LedgerEntry`: `id`, `type` (`RECEITA`|`DESPESA`), `category` (ver 2.1), `amountCents Int` (1..1_000_000_000), `occurredOn Date`, `month String` (`YYYY-MM`, derivado de `occurredOn` no servidor, indexado), `description String` (1..300, privada), `createdByUserId Int`, `createdAt`, `updatedAt`. Índices `(month)`, `(month, type)`.
- `TransparencyMonth`: `month String @id` (`YYYY-MM`), `publishedAt DateTime`, `publishedByUserId Int`, `note String?` (≤ 500, pública, texto do dono), retrato: `activeStudents Int`, `activeGroups Int`, `goalCents Int`. Existir a linha = mês publicado.
- `TransparencySetting` (singleton, `id = 1`): `monthlyGoalCents Int @default(0)`, `openingReserveCents Int @default(0)` (saldo/reserva antes do primeiro mês publicado; nunca negativo), `entityName String?` (≤ 120: quem recebe/opera, ex.: "Associação X"), `introText String?` (≤ 600), `surplusText String?` (≤ 600, "para onde vai o excedente"), `updatedByUserId`, `updatedAt`.
- 2.1 Categorias (lista fechada; o par tipo×categoria é validado):
  - DESPESA: `HOSPEDAGEM` (servidores), `MAPAS`, `ARMAZENAMENTO_BACKUP`, `NOTIFICACOES`, `EMAIL`, `DOMINIO`, `FERRAMENTAS`, `PESSOAS_SUPORTE`, `IMPOSTOS_TARIFAS`, `OUTROS_DESPESA`.
  - RECEITA: `APOIO` (reservada; hoje lançada à mão), `PATROCINIO`, `EDITAIS_OUTROS`.
  - Rótulos em português ficam no servidor (SSOT) e vão na resposta: `{ category, label, cents }`.

## 3. API da plataforma (admin; prefixo `/platform-finance`; `PlatformOnlyGuard`, escrita com `SuperAdminGuard`)
Listas como no resto do projeto: corpo = array + total em `X-Total-Count`.
- `GET /platform-finance/entries?month=YYYY-MM&type=&category=&q=&limit=&offset=` (ordem: `occurredOn` desc, `id` desc). Item: `{ id, type, category, categoryLabel, amountCents, occurredOn: "YYYY-MM-DD", month, description, locked: boolean (mês publicado), createdAt }`.
- `POST /platform-finance/entries` `{ type, category, amountCents, occurredOn, description }` → 201 item. Data futura além do fim do mês corrente = 400. Mês publicado = 409 `MONTH_PUBLISHED`. Par tipo×categoria inválido = 400.
- `PATCH /platform-finance/entries/:id` (mesmos campos, parciais; mudar `occurredOn` para outro mês também checa o mês de destino), `DELETE /platform-finance/entries/:id` → 204. Inexistente = 404.
- `GET /platform-finance/entries.csv?month=` → CSV (ponto e vírgula/UTF-8 BOM como os outros CSV do projeto via `sendCsv`; anti formula-injection na `description`).
- `GET /platform-finance/months` → `{ items: [...] }` dos últimos 24 meses que têm lançamento OU estão publicados, mais o mês corrente, desc. Item: `{ month, published: boolean, publishedAt|null, note|null, revenueCents, expenseCents, balanceCents, entries: number, expensesByCategory[], revenueByCategory[], liveActiveStudents|null, liveActiveGroups|null, snapshot: { activeStudents, activeGroups, goalCents } | null }`. Mês não publicado calcula ao vivo; publicado devolve o retrato.
- `POST /platform-finance/months/:month/publish` `{ note? }` → 201 mês. Regras: só mês **já encerrado** (anterior ao mês corrente em America/Sao_Paulo; senão 400 `MONTH_NOT_CLOSED`), com **pelo menos 1 lançamento** (senão 400 `MONTH_EMPTY`); já publicado = 409. Grava o retrato (alunos ativos = `Student.status ACTIVE` em organizações GROUP, o MESMO critério de `PlatformDashboardService`, SSOT: extrair/reaproveitar o contador; grupos = organizações GROUP ativas; `goalCents` = meta vigente).
- `POST /platform-finance/months/:month/unpublish` → 204 (volta a editar; auditado).
- `GET /platform-finance/settings` e `PUT /platform-finance/settings` (`monthlyGoalCents` 0..1_000_000_000, `openingReserveCents` 0..1_000_000_000, textos opcionais com limites acima; texto vazio = null). Mudar a meta NÃO altera meses já publicados (têm retrato).
- `GET /platform-finance/preview` → exatamente o corpo que o endpoint público devolveria hoje (para o admin conferir antes de publicar).

## 4. API pública (sem login) — `GET /transparency`
`@Public()`, `Cache-Control: public, max-age=300`, throttle por IP generoso (ex.: 60/min), sem auditoria, sem log de usuário/IP. Formato:
```json
{
  "generatedAt": "2026-11-07T12:00:00.000Z",
  "entityName": "Associação X" ,
  "introText": "…", "surplusText": "…",
  "monthlyGoalCents": 300000,
  "reserveCents": 123400,
  "months": [
    {
      "month": "2026-10", "publishedAt": "…", "note": "…" ,
      "revenueCents": 280000, "expenseCents": 250000, "balanceCents": 30000,
      "revenueBySource": [{ "category": "PATROCINIO", "label": "Patrocínios", "cents": 280000 }],
      "expensesByCategory": [{ "category": "HOSPEDAGEM", "label": "Hospedagem e servidores", "cents": 150000 }],
      "activeStudents": 1200, "activeGroups": 30,
      "costPerActiveStudentCents": 208,
      "goalCents": 300000, "goalCoveragePct": 93
    }
  ]
}
```
- `months`: até **12** meses publicados, do mais recente para o mais antigo. Sem nenhum mês publicado: `months: []` (a página mostra "ainda não publicamos o primeiro mês", com o texto de intenção, nunca erro).
- `costPerActiveStudentCents` = `round(expenseCents / activeStudents)`; `null` se `activeStudents` = 0. `goalCoveragePct` = `round(revenueCents * 100 / goalCents)` (inteiro, pode passar de 100); `null` se `goalCents` = 0.
- `reserveCents` = `openingReserveCents` + soma de `(revenue - expense)` de **todos** os meses publicados (não só os 12), podendo ficar negativo.
- Listas `revenueBySource`/`expensesByCategory` ordenadas por valor desc, só categorias com valor > 0.
- **Nunca** aparecem: `description`, ids de lançamento, quem lançou, data do lançamento, contagem de lançamentos.

## 5. Admin (Vue) — item "Financeiro" (`/financeiro`, `src/views/Finance*View.vue`)
- Menu e rota para toda a equipe PLATFORM (leitura); botões de escrita só para super admin (e o servidor é a barreira real).
- Abas: **Meses** (tabela dos meses com receita, despesa, saldo, situação; abrir mês → lista de lançamentos, "Publicar mês" com observação opcional, "Despublicar"; aviso claro "ao publicar, os números ficam públicos e o mês trava"), **Lançamentos** (filtros mês/tipo/categoria, criar/editar/excluir, valor digitado em reais com máscara → centavos, CSV), **Configurações** (meta mensal, reserva inicial, entidade, textos), **Prévia** (renderiza o que o público verá, a partir de `/platform-finance/preview`).
- Lançamento de mês publicado aparece travado (cadeado) com a dica de despublicar.

## 6. App — página pública `/transparencia` (`src/routes/transparencia.tsx`, fora de `_app`, como `termos`/`privacidade`)
- Mesma moldura das páginas públicas existentes; funciona sem login e instalada como PWA. Texto em português simples, números grandes: card "Mês mais recente" (receita, despesa, saldo, **custo por aluno ativo**, barra "% da meta coberta"), "Para onde vai o dinheiro" (barras por categoria), "De onde vem" (por origem), **histórico de 12 meses** (lista/barras), reserva, `surplusText`, `entityName`, aviso "Atualizado todo mês · valores publicados pela equipe". Estado vazio amigável. Sem nenhum pedido de pagamento. Acessibilidade: barras com texto equivalente.
- Links de entrada: **Perfil** ("Transparência: para onde vai o dinheiro") e rodapé da tela de login; e na folha "Por que vejo isso?" do patrocinador (link "Veja como a plataforma se sustenta"). A rota não pode virar página protegida.
- Formatação em BRL (`Intl.NumberFormat`), mês por extenso em pt-BR sem depender de fuso do aparelho (`"2026-10"` → "outubro de 2026" por cálculo, não por `new Date`).

## 7. Testes obrigatórios (cada agente roda só o seu; o gate completo é meu)
- **Backend (unit + e2e):** par tipo×categoria; centavos inteiros; travar mês publicado (criar/editar/mover/excluir = 409); `MONTH_NOT_CLOSED`, `MONTH_EMPTY`, publicar 2x; retrato imutável (mudar meta/alunos depois não altera mês publicado); `reserveCents` somando todos os meses publicados; custo por aluno (0 alunos = null) e `goalCoveragePct` (meta 0 = null); só 12 meses; **privacidade: o corpo público não contém nenhuma `description` lançada** (usar texto-sentinela e procurar em todo o JSON) nem campos proibidos; só super admin escreve (admin comum de PLATFORM = 403, não-platform = 403, sem token = 401 em `/platform-finance`; `/transparency` sem token = 200); CSV anti-injeção; auditoria sem texto livre; concorrência simples (2 publicações simultâneas → 1 vence, 1 recebe 409).
- **Admin:** máscara de reais↔centavos, travas por papel, aviso de publicação, formato real dos corpos.
- **App:** a página renderiza a **resposta real capturada do backend** sem adaptação, estado vazio, `costPerActiveStudentCents` null, `goalCoveragePct` > 100, reserva negativa, mês por extenso sem `Date`, sem login.
- **Conferência cruzada (eu):** o JSON real do `GET /transparency` e do `GET /platform-finance/months` vira fixture nos testes do app e do admin.

## 8. Fora do escopo (B-F2/F3, não construir)
Pix/cobrança/webhook, apoiador, mural, selo, conquista `APOIO`, recibo por e-mail, recorrência, "esconder patrocinadores", relatório trimestral em PDF, lista de patrocinadores autorizados, votação de roteiro.
