import { Cake, Check, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import {
  birthdayShortName,
  formatBirthdayDate,
  useBirthdaysWeek,
  useCongratulate,
  type BirthdayWeekItem,
} from "@/lib/birthdays";
import { Avatar } from "./avatar";

function BirthdayCard({
  item,
  pending,
  onCongratulate,
}: {
  item: BirthdayWeekItem;
  pending: boolean;
  onCongratulate: (item: BirthdayWeekItem) => void;
}) {
  const shortName = birthdayShortName(item);
  return (
    <li
      className="flex w-32 shrink-0 snap-start flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-3 text-center"
      data-testid={`birthday-card-${item.personId}`}
    >
      <Avatar name={item.name} src={item.photo} size={48} decorative />
      <strong className="w-full truncate text-sm leading-tight" title={item.name}>
        {shortName}
      </strong>
      <span className="text-xs text-muted-foreground" data-testid="birthday-when">
        {item.isToday ? "Hoje 🎉" : formatBirthdayDate(item)}
      </span>
      {item.congratulatedByMe ? (
        <Button
          type="button"
          variant="soft"
          size="sm"
          className="mt-auto min-h-11 w-full"
          disabled
          aria-label={`Você já parabenizou ${shortName}`}
        >
          <Check aria-hidden="true" />
          Parabenizado ✓
        </Button>
      ) : item.canCongratulate ? (
        <Button
          type="button"
          variant="default"
          size="sm"
          className="mt-auto min-h-11 w-full"
          disabled={pending}
          aria-label={`Parabenizar ${shortName}`}
          onClick={() => onCongratulate(item)}
        >
          <PartyPopper aria-hidden="true" />
          {pending ? "Enviando…" : "Parabenizar"}
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Faixa "Aniversariantes da semana" (GET /birthdays/week): cartoes compactos com rolagem horizontal
 * DENTRO da faixa (a pagina nao estoura). Se nao ha ninguem, carrega ou falha, nao renderiza nada
 * (sem erro visivel). O proprio usuario aparece sem botao; quem ja foi parabenizado mostra "Parabenizado".
 */
export function BirthdaysStrip({ className = "" }: { className?: string }) {
  const week = useBirthdaysWeek();
  const congratulate = useCongratulate();
  const items = week.data?.items ?? [];
  if (items.length === 0) return null;

  const pendingId = congratulate.isPending ? congratulate.variables : null;

  function handle(item: BirthdayWeekItem) {
    congratulate.mutate(item.personId, {
      onSuccess: ({ already }) => {
        const name = birthdayShortName(item);
        if (already) toast.info(`Você já parabenizou ${name}.`);
        else toast.success(`Parabéns enviado para ${name}!`);
      },
      onError: (error) => toast.error(errorMessage(error, "Não foi possível enviar os parabéns agora.")),
    });
  }

  return (
    <section className={`min-w-0 max-w-full ${className}`.trim()} aria-labelledby="birthdays-strip-title" data-testid="birthdays-strip">
      <h2 id="birthdays-strip-title" className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Cake className="size-4" aria-hidden="true" />
        Aniversariantes da semana
      </h2>
      <ul
        className="flex max-w-full snap-x gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]"
        aria-label="Aniversariantes dos próximos dias"
      >
        {items.map((item) => (
          <BirthdayCard key={item.personId} item={item} pending={pendingId === item.personId} onCongratulate={handle} />
        ))}
      </ul>
    </section>
  );
}
