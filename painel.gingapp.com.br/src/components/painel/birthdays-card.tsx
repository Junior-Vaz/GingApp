import type { ReactNode } from "react";
import { Cake } from "lucide-react";
import { Link, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { useBirthdaySummary } from "@/modules/aniversariantes/api";
import type { BirthdayItem } from "@/modules/aniversariantes/types";
import { dayMonthLabel } from "@/modules/aniversariantes/utils";
import { plural } from "@/lib/plural";

/** Quantos nomes aparecem por bloco; o resto vira "+N" e a lista completa fica na página. */
const VISIBLE = 5;

const asList = (value: unknown): BirthdayItem[] => (Array.isArray(value) ? (value as BirthdayItem[]) : []);

/** Link para a página: usa o roteador quando existe (SPA) e um <a> comum quando o cartão é renderizado fora dele. */
function PageLink({ children }: { children: ReactNode }) {
  const router = useRouter({ warn: false }) as unknown;
  return router ? (
    <Link to="/aniversariantes" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
      {children}
    </Link>
  ) : (
    <a href="/aniversariantes" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
      {children}
    </a>
  );
}

function NameList({ items, showDate }: { items: BirthdayItem[]; showDate: boolean }) {
  const rest = items.length - VISIBLE;
  return (
    <ul className="divide-y">
      {items.slice(0, VISIBLE).map((item) => (
        <li key={`${item.personId}-${item.kind}`} className="flex items-center gap-2.5 py-2 text-sm">
          <EntityAvatar name={item.name} photo={item.photo} className="size-8" />
          <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
          {showDate && <span className="shrink-0 text-xs text-muted-foreground">{dayMonthLabel(item)}</span>}
        </li>
      ))}
      {rest > 0 && <li className="py-2 text-xs text-muted-foreground">+{rest} na página de aniversariantes</li>}
    </ul>
  );
}

/** Cartão "Aniversariantes" do painel inicial: quem faz aniversário hoje e nos próximos 7 dias (GET /birthdays/summary). */
export function BirthdaysCard() {
  const { data, isLoading, error, refetch } = useBirthdaySummary();
  const today = asList(data?.today);
  const next = asList(data?.next7Days);

  return (
    <Card className="flex flex-col gap-3 p-5" data-testid="birthdays-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cake className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-bold">Aniversariantes</h2>
        </div>
        <PageLink>Ver todos</PageLink>
      </div>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : error ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Não foi possível carregar os aniversariantes.
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <section aria-label="Aniversariantes de hoje">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Hoje{today.length > 0 ? ` (${today.length})` : ""}
            </h3>
            {today.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Ninguém faz aniversário hoje.</p>
            ) : (
              <NameList items={today} showDate={false} />
            )}
          </section>
          <section aria-label="Aniversariantes dos próximos 7 dias">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Próximos 7 dias{next.length > 0 ? ` (${next.length})` : ""}
            </h3>
            {next.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Nenhum aniversário nos próximos 7 dias.</p>
            ) : (
              <NameList items={next} showDate />
            )}
          </section>
          {typeof data?.monthTotal === "number" && (
            <p className="text-xs text-muted-foreground">{plural(data.monthTotal, "aniversariante")} neste mês</p>
          )}
        </>
      )}
    </Card>
  );
}
