import { Repeat } from "lucide-react";
import type { Encounter } from "@/lib/queries";
import { eventSituation, priceLabel, recurrenceText, spotsLabel, waitlistLabel } from "@/lib/event-info";

/**
 * Resumo discreto de um encontro: vagas, preco (informativo), situacao (cancelado/encerrado/prazo),
 * lista de espera e, nas rodas, o selo de recorrencia. Cada item so aparece se o servidor informou o dado.
 */
export function EventFacts({ event }: { event: Encounter }) {
  const isEvent = event.source === "EVENTO";
  const spots = isEvent ? spotsLabel(event) : null;
  const price = isEvent ? priceLabel(event) : null;
  const situation = isEvent ? eventSituation(event) : null;
  const waitlist = isEvent ? waitlistLabel(event) : null;
  const recurrence = event.source === "RODA" ? recurrenceText(event) : null;

  if (!spots && !price && !situation && !waitlist && recurrence === null) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]" data-testid="event-facts">
      {situation && (
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${
            situation.closed ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
          }`}
        >
          {situation.label}
        </span>
      )}
      {spots && (
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${
            spots === "Lotado" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"
          }`}
        >
          {spots}
        </span>
      )}
      {price && <span className="rounded-full bg-muted px-2 py-0.5 text-foreground">{price}</span>}
      {waitlist && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{waitlist}</span>}
      {recurrence !== null && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-semibold text-primary">
          <Repeat size={11} aria-hidden="true" />
          Roda recorrente{recurrence ? ` · ${recurrence}` : ""}
        </span>
      )}
    </div>
  );
}
