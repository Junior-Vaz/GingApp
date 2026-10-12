import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowUpRight, MapPin, Clock, Users, CalendarDays, Check, Share2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useEncounterParticipation, type Encounter } from "@/lib/queries";
import { capitalize, fmt, toDate } from "@/lib/format";
import { eventSituation } from "@/lib/event-info";
import { EventFacts } from "./event-facts";

export function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <span className="date-label">
        <CalendarDays size={14} /> {capitalize(fmt(new Date(), "EEEE, dd 'de' MMMM"))}
      </span>
    </div>
  );
}

type SectionTo = "/" | "/aulas" | "/eventos" | "/notificacoes" | "/comunidade" | "/jornada" | "/rodas";

export function SectionHeading({ title, to, label = "Ver todos" }: { title: string; to?: SectionTo; label?: string }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {to && (
        <Link to={to}>
          {label}
          <ArrowUpRight />
        </Link>
      )}
    </div>
  );
}

/** Estados de carregamento / erro / vazio com o mesmo visual do protótipo. */
export function StateMessage({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <div className={`empty-state ${tone === "error" ? "text-destructive" : ""}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

/**
 * Rodapé de listas paginadas: diz quantos itens estão na tela de quantos existem (total do servidor)
 * e oferece "Carregar mais" enquanto houver mais — a lista nunca é truncada em silêncio.
 */
export function LoadMore({
  shown,
  total,
  hasMore,
  loading,
  onMore,
  noun,
}: {
  shown: number;
  total: number | null;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  noun: string;
}) {
  if (!hasMore && (total === null || total <= shown)) return null;
  return (
    <div className="flex flex-col items-center gap-2 py-4" data-testid="load-more">
      <p className="text-xs text-muted-foreground" role="status">
        {total !== null ? `Mostrando ${shown} de ${total} ${noun}` : `Mostrando ${shown} ${noun}`}
      </p>
      {hasMore && (
        <Button variant="outline" size="sm" disabled={loading} onClick={onMore}>
          {loading ? "Carregando…" : "Carregar mais"}
        </Button>
      )}
    </div>
  );
}

function timeLabel(iso: string): string | null {
  const date = toDate(iso);
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 ? null : fmt(date, "HH:mm");
}

function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function EventCard({ event }: { event: Encounter }) {
  const [open, setOpen] = useState(false);
  // Contagem/"inscrito"/inscrever: SSOT em queries.ts (compartilhado com o cartão do mapa da comunidade).
  const { count, canJoin, joined, waitlisted, full, join, joinWaitlist, pending } = useEncounterParticipation(event, open);
  const closedNow = event.source === "EVENTO" && eventSituation(event)?.closed === true;
  const date = toDate(event.date);
  const time = timeLabel(event.date);
  const place = [event.place, event.city].filter(Boolean).join(", ");

  function calendar() {
    const text = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:gingapp-${event.key}\r\nDTSTAMP:${icsStamp(new Date())}\r\nDTSTART:${icsStamp(date)}\r\nSUMMARY:${event.title}\r\nLOCATION:${place}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "gingapp-evento.ics";
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Evento adicionado ao arquivo de calendário.");
  }

  async function share() {
    const text = `${event.title} — ${capitalize(fmt(date, "EEEE, dd 'de' MMMM"))}${time ? `, ${time}` : ""}.${place ? ` ${place}.` : ""}`;
    try {
      if (navigator.share) await navigator.share({ title: event.title, text });
      else {
        await navigator.clipboard.writeText(text);
        toast.success("Informações copiadas!");
      }
    } catch {
      toast.info("Compartilhamento cancelado.");
    }
  }

  return (
    <>
      <article className="event-card">
        <div className="event-image">
          <img src={event.image} alt={event.title} width={1024} height={768} loading="lazy" />
          <span className={`badge ${event.type === "BATIZADO" ? "badge-warm" : ""}`}>{event.typeLabel}</span>
          <div className="date-block">
            <strong>{fmt(date, "dd")}</strong>
            <span>{fmt(date, "MMM").replace(".", "").toUpperCase()}</span>
          </div>
        </div>
        <div className="event-body">
          <h3>{event.title}</h3>
          {event.place && (
            <div className="detail-line">
              <MapPin />
              {event.place}
            </div>
          )}
          <div className="detail-line">
            <Clock />
            {capitalize(fmt(date, "EEEE"))}
            {time ? ` • ${time}` : ""}
          </div>
          <EventFacts event={event} />
          <div className="event-footer">
            <div className="attendees">{count !== undefined && count > 0 && <span>{count} na roda</span>}</div>
            <Button
              variant={joined ? "soft" : "ghost"}
              size="sm"
              className="text-primary text-[10px] h-7 px-1"
              onClick={() => setOpen(true)}
            >
              {joined ? (waitlisted ? "Na lista de espera" : "Confirmado") : "Ver detalhes"}
              {joined ? <Check /> : <ArrowUpRight />}
            </Button>
          </div>
        </div>
      </article>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{event.title}</DialogTitle>
          <DialogDescription>
            {event.typeLabel}
            {event.city ? ` · ${event.city}` : ""}
          </DialogDescription>
          <img className="modal-image" src={event.image} alt={event.title} width={1024} height={768} />
          <div>
            <div className="detail-line">
              <CalendarDays />
              {capitalize(fmt(date, "EEEE, dd 'de' MMMM 'de' yyyy"))}
              {time ? ` • ${time}` : ""}
            </div>
            {place && (
              <div className="detail-line">
                <MapPin />
                {place}
              </div>
            )}
            {count !== undefined && (
              <div className="detail-line">
                <Users />
                {count} {count === 1 ? "participante" : "participantes"}
              </div>
            )}
            <EventFacts event={event} />
            {event.description && (
              <p className="text-sm text-muted-foreground leading-relaxed mt-4">{event.description}</p>
            )}
          </div>
          {waitlisted && (
            <p className="text-sm font-semibold" role="status">
              Você está na lista de espera
            </p>
          )}
          {canJoin && (joined || !closedNow) && (
            <Button
              onClick={!joined && full ? joinWaitlist : join}
              variant={!joined && full ? "outline" : "default"}
              disabled={pending}
            >
              {joined ? <Check /> : <Users />}
              {waitlisted
                ? "Sair da lista de espera"
                : joined
                  ? "Cancelar participação"
                  : full
                    ? "Entrar na lista de espera"
                    : "Quero participar"}
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={calendar}>
              <Download />
              Calendário
            </Button>
            <Button variant="outline" className="flex-1" onClick={share}>
              <Share2 />
              Compartilhar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
