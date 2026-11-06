import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  barFillPct,
  coverageSentence,
  fetchTransparency,
  formatBRL,
  formatInt,
  monthLabel,
  sharePct,
  type TransparencyCategory,
  type TransparencyMonth,
  type TransparencyReport,
} from "@/lib/transparency";
import { Brand } from "./app-shell";
import { CountUp } from "./count-up";

/**
 * Página pública /transparencia (docs/CONTRATO_TRANSPARENCIA.md, seção 6): quanto custa manter a plataforma e de onde vem o
 * dinheiro, mês a mês, em português simples. Funciona sem login. NÃO há nenhum pedido de pagamento aqui.
 * As animações são as leves já existentes (.stagger, .progress-fill, CountUp) e caem na regra global de prefers-reduced-motion.
 */

const CARD = "rounded-lg border border-border bg-card p-5";

/** Barra horizontal decorativa: o valor sempre está escrito ao lado (a barra é só reforço visual). */
function Bar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "warning" | "muted" }) {
  const color = tone === "warning" ? "bg-warning" : tone === "muted" ? "bg-muted-foreground/40" : "bg-primary";
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className={`progress-fill h-full rounded-full ${color}`} style={{ width: `${barFillPct(pct)}%` }} />
    </div>
  );
}

function Stat({ label, value, hint, testId, tone }: { label: string; value: string; hint?: string; testId: string; tone?: "negative" }) {
  return (
    <div className="rounded-md bg-muted/50 p-3" data-testid={testId}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0">
        <span className={`block text-xl font-extrabold tabular-nums ${tone === "negative" ? "text-destructive" : ""}`}>{value}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}

function balanceHint(balanceCents: number): string {
  if (balanceCents > 0) return "Sobrou neste mês";
  if (balanceCents < 0) return "Faltou neste mês";
  return "Ficou no zero a zero";
}

/** Card do mês mais recente: receita, despesa, saldo, custo por aluno ativo e a barra "% da meta coberta". */
export function LatestMonthCard({ month }: { month: TransparencyMonth }) {
  const pct = month.goalCoveragePct;
  const cost = month.costPerActiveStudentCents;
  return (
    <section className={CARD} aria-labelledby="tp-latest-title" data-testid="tp-latest">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Mês mais recente</p>
      <h2 id="tp-latest-title" className="mt-1 text-xl font-extrabold">
        {monthLabel(month.month)}
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <Stat label="Receita (o que entrou)" value={formatBRL(month.revenueCents)} testId="tp-revenue" />
        <Stat label="Despesa (o que saiu)" value={formatBRL(month.expenseCents)} testId="tp-expense" />
        <Stat
          label="Saldo do mês"
          value={formatBRL(month.balanceCents)}
          hint={balanceHint(month.balanceCents)}
          testId="tp-balance"
          {...(month.balanceCents < 0 ? { tone: "negative" as const } : {})}
        />
        <Stat
          label="Custo por aluno ativo"
          value={cost === null ? "—" : formatBRL(cost)}
          hint={
            cost === null
              ? "Sem alunos ativos neste mês, não há como calcular"
              : `${formatInt(month.activeStudents)} ${month.activeStudents === 1 ? "aluno ativo" : "alunos ativos"} em ${formatInt(month.activeGroups)} ${month.activeGroups === 1 ? "grupo" : "grupos"}`
          }
          testId="tp-cost-per-student"
        />
      </dl>

      <div className="mt-5" data-testid="tp-coverage">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold">% da meta coberta</span>
          <strong className="text-lg tabular-nums" data-testid="tp-coverage-value">
            {pct === null ? "—" : <CountUp id="transparencia-cobertura" value={pct} suffix="%" />}
          </strong>
        </div>
        <div className="mt-2">
          {/* % acima de 100: barra cheia e o número real ao lado. */}
          <Bar pct={pct ?? 0} tone={pct !== null && pct > 100 ? "warning" : "primary"} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground" data-testid="tp-coverage-text">
          {coverageSentence(pct, month.goalCents)}
        </p>
      </div>

      {month.note && <p className="mt-4 whitespace-pre-line border-l-2 border-border pl-3 text-sm text-muted-foreground">{month.note}</p>}
    </section>
  );
}

/** Lista de categorias com barra (para onde vai / de onde vem). O valor e a participação estão escritos: a barra é só reforço. */
export function CategoryBars({
  title,
  id,
  subtitle,
  items,
  emptyText,
  testId,
  tone,
}: {
  title: string;
  id: string;
  subtitle: string;
  items: TransparencyCategory[];
  emptyText: string;
  testId: string;
  tone?: "primary" | "warning";
}) {
  const total = items.reduce((sum, item) => sum + item.cents, 0);
  return (
    <section className={CARD} aria-labelledby={id} data-testid={testId}>
      <h2 id={id} className="text-lg font-extrabold">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="m-0 mt-4 grid list-none gap-3.5 p-0">
          {items.map((item) => {
            const share = sharePct(item.cents, total);
            return (
              <li key={item.category} data-testid="tp-category">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">{item.label}</span>{" "}
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatBRL(item.cents)} <span className="font-normal text-muted-foreground">({share}%)</span>
                  </span>
                </div>
                <div className="mt-1.5">
                  <Bar pct={share} {...(tone ? { tone } : {})} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Reserva da plataforma (pode ser negativa: o texto diz, a cor só reforça). */
export function ReserveCard({ reserveCents }: { reserveCents: number }) {
  const negative = reserveCents < 0;
  return (
    <section className={CARD} aria-labelledby="tp-reserve-title" data-testid="tp-reserve">
      <h2 id="tp-reserve-title" className="text-lg font-extrabold">
        Reserva da plataforma
      </h2>
      <p className={`mt-2 text-2xl font-extrabold tabular-nums ${negative ? "text-destructive" : ""}`} data-testid="tp-reserve-value">
        {formatBRL(reserveCents)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        É a soma do que sobrou (ou faltou) em todos os meses publicados, a partir da reserva inicial.
        {negative ? " Está negativa: até aqui os gastos passaram do que entrou." : ""}
      </p>
    </section>
  );
}

/** Histórico dos meses publicados (até 12): receita e despesa lado a lado, na mesma escala. */
export function HistoryList({ months }: { months: TransparencyMonth[] }) {
  const scale = Math.max(1, ...months.flatMap((m) => [m.revenueCents, m.expenseCents]));
  return (
    <section className={CARD} aria-labelledby="tp-history-title" data-testid="tp-history">
      <h2 id="tp-history-title" className="text-lg font-extrabold">
        Histórico dos meses
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Até os últimos 12 meses publicados, do mais recente para o mais antigo.</p>
      <ol className="m-0 mt-4 grid list-none gap-4 p-0">
        {months.map((m) => (
          <li key={m.month} data-testid="tp-history-item" data-month={m.month}>
            <div className="flex items-baseline justify-between gap-3">
              <strong className="text-sm">{monthLabel(m.month)}</strong>
              <span className={`text-sm font-semibold tabular-nums ${m.balanceCents < 0 ? "text-destructive" : ""}`}>
                Saldo {formatBRL(m.balanceCents)}
              </span>
            </div>
            <div className="mt-1.5 grid gap-1">
              <Bar pct={(m.revenueCents * 100) / scale} />
              <Bar pct={(m.expenseCents * 100) / scale} tone="muted" />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Receita {formatBRL(m.revenueCents)} · Despesa {formatBRL(m.expenseCents)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Texto do dono sobre o destino do excedente (`surplusText`). */
export function SurplusCard({ text }: { text: string }) {
  return (
    <section className={CARD} aria-labelledby="tp-surplus-title" data-testid="tp-surplus">
      <h2 id="tp-surplus-title" className="text-lg font-extrabold">
        E se sobrar dinheiro?
      </h2>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{text}</p>
    </section>
  );
}

/** Estado vazio: nenhum mês publicado ainda (nunca é erro). */
export function EmptyState() {
  return (
    <section className={CARD} aria-labelledby="tp-empty-title" data-testid="tp-empty">
      <h2 id="tp-empty-title" className="text-lg font-extrabold">
        Ainda não publicamos o primeiro mês
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Assim que o primeiro mês fechar, os números aparecem aqui: quanto custou manter o GingApp, de onde veio o dinheiro e quanto
        sobrou. Tudo em português simples, todo mês.
      </p>
    </section>
  );
}

/** O conteúdo da página já com os dados validados (separado da busca para poder ser testado com qualquer resposta). */
export function TransparencyView({ report }: { report: TransparencyReport }) {
  const latest = report.months[0];
  return (
    <>
      {report.entityName && (
        <p className="m-0 text-sm" data-testid="tp-entity">
          <span className="text-muted-foreground">Responsável pela plataforma: </span>
          <strong>{report.entityName}</strong>
        </p>
      )}
      {report.introText && (
        <p className="m-0 whitespace-pre-line text-sm leading-relaxed" data-testid="tp-intro">
          {report.introText}
        </p>
      )}
      {latest ? (
        <div className="stagger grid gap-4" data-testid="tp-content">
          <LatestMonthCard month={latest} />
          <CategoryBars
            title="Para onde vai o dinheiro"
            id="tp-expenses-title"
            subtitle={`O que saiu em ${monthLabel(latest.month)}, por tipo de gasto.`}
            items={latest.expensesByCategory}
            emptyText="Nenhuma despesa publicada neste mês."
            testId="tp-expenses"
            tone="warning"
          />
          <CategoryBars
            title="De onde vem"
            id="tp-revenue-title"
            subtitle={`O que entrou em ${monthLabel(latest.month)}, por origem.`}
            items={latest.revenueBySource}
            emptyText="Nenhuma receita publicada neste mês."
            testId="tp-revenues"
          />
          {report.reserveCents !== null && <ReserveCard reserveCents={report.reserveCents} />}
          {report.surplusText && <SurplusCard text={report.surplusText} />}
          <HistoryList months={report.months} />
        </div>
      ) : (
        <div className="stagger grid gap-4" data-testid="tp-content">
          <EmptyState />
          {report.surplusText && <SurplusCard text={report.surplusText} />}
        </div>
      )}
    </>
  );
}

/** Página pública: moldura das páginas legais + busca de GET /transparency (sem token). */
export function TransparencyPage() {
  const query = useQuery({ queryKey: ["transparency"], queryFn: fetchTransparency, retry: false, staleTime: 60_000 });
  const report = query.data;
  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-background py-10" style={{ paddingInline: "var(--page-gutter)" }}>
      <Link to="/login" search={{ redirect: undefined }} className="no-underline">
        <Brand large />
      </Link>
      <main className="w-full max-w-2xl" aria-labelledby="tp-title">
        <div className="grid gap-4">
          <header>
            <h1 id="tp-title" className="text-2xl font-extrabold">
              Transparência: para onde vai o dinheiro
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              O GingApp é gratuito. Todo mês mostramos aqui quanto custa mantê-lo e de onde vem o dinheiro.
            </p>
          </header>

          {query.isLoading && (
            <div role="status" aria-live="polite" data-testid="tp-loading">
              <span className="sr-only">Carregando os números…</span>
              <div className="skeleton-shimmer h-44 rounded-lg bg-muted" aria-hidden="true" />
            </div>
          )}

          {query.isError && (
            <div role="alert" className={CARD} data-testid="tp-error">
              <p className="m-0 text-sm text-destructive">Não foi possível carregar os números agora. Confira sua conexão e tente de novo.</p>
              <Button className="mt-3" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
                {query.isFetching && <Loader2 className="animate-spin" />}
                Tentar de novo
              </Button>
            </div>
          )}

          {report && <TransparencyView report={report} />}

          {report && (
            <p className="m-0 text-xs text-muted-foreground" data-testid="tp-updated">
              Atualizado todo mês · valores publicados pela equipe
            </p>
          )}
        </div>

        <nav className="mt-8 flex flex-wrap gap-4 border-t border-border pt-4 text-xs" aria-label="Outras páginas">
          <Link to="/termos" className="underline">
            Termos de Uso
          </Link>
          <Link to="/privacidade" className="underline">
            Política de Privacidade
          </Link>
          <Link to="/login" search={{ redirect: undefined }} className="underline">
            Voltar ao login
          </Link>
        </nav>
      </main>
    </div>
  );
}

/** Link do rodapé da tela de login (fora de `legal-links` para não mexer nos dois links legais existentes). */
export function TransparencyLink() {
  return (
    <p className="mt-1 text-center text-xs text-muted-foreground" data-testid="transparency-link">
      <Link to="/transparencia" className="underline">
        Transparência: para onde vai o dinheiro
      </Link>
    </p>
  );
}
