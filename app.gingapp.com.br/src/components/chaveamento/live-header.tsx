import { useEffect, useState } from "react";
import type { ConnectionStatus } from "@/lib/chaveamento/connection";
import type { FullscreenControl } from "@/lib/chaveamento/hooks";
import { ClockIcon, CompressIcon, ExpandIcon, LogoMark, MatIcon, PlayIcon, WifiOffIcon } from "./icons";
import { QrCode } from "./qr-code";

/** Indicador de conexão: selo AO VIVO (vermelho, pulsante) ou "Reconectando…" com ícone (nunca só cor). `polling` também é "ao vivo". */
export function StatusPill({ status }: { status: ConnectionStatus }) {
  const reconnecting = status === "reconnecting";
  return (
    <span className="cv-status" role="status" data-status={status} data-testid="cv-status">
      {reconnecting ? <WifiOffIcon className="cv-status-icon" /> : <span className="cv-dot" aria-hidden="true" data-steady={status === "polling" ? "1" : undefined} />}
      {reconnecting ? "Reconectando…" : "AO VIVO"}
    </span>
  );
}

/** Hora local (HH:MM), atualizada a cada 15 s; o intervalo é cancelado ao desmontar. */
function useClock(enabled: boolean): string {
  const read = (): string => {
    try {
      return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    } catch {
      return "";
    }
  };
  const [time, setTime] = useState(read);
  useEffect(() => {
    if (!enabled) return;
    setTime(read());
    const timer = setInterval(() => setTime(read()), 15_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return time;
}

export interface LiveHeaderProps {
  organizationName: string;
  eventTitle: string;
  eventDate: string;
  location: string | null;
  status: ConnectionStatus;
  tv: boolean;
  fullscreen: FullscreenControl;
  shareUrl: string;
  /** Só no modo telão: o rodízio está pausado porque alguém tocou numa aba. */
  rotationPaused: boolean;
  onResumeRotation: () => void;
  /** Fase em andamento da categoria exibida ("Semifinais", "Final"...); null = não mostra. */
  stageLabel?: string | null;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(date);
  } catch {
    return "";
  }
}

/** Cabeçalho tipo emissora: marca, grupo organizador, título do evento, fase atual, selo AO VIVO, relógio, tela cheia e QR do link. */
export function LiveHeader({ organizationName, eventTitle, eventDate, location, status, tv, fullscreen, shareUrl, rotationPaused, onResumeRotation, stageLabel = null }: LiveHeaderProps) {
  const date = formatDate(eventDate);
  const meta = [date, location].filter(Boolean).join(" · ");
  const clock = useClock(tv);
  return (
    <header className="cv-header">
      <div className="cv-brand">
        <LogoMark className="cv-logo" size={tv ? 44 : 34} />
        <div className="cv-header-text">
          {organizationName !== "" && (
            <p className="cv-org">
              {organizationName}
              {meta !== "" && <span className="cv-org-meta"> · {meta}</span>}
            </p>
          )}
          <h1 className="cv-title">{eventTitle}</h1>
          {meta !== "" && <p className="cv-meta">{meta}</p>}
        </div>
      </div>
      <div className="cv-header-actions">
        {stageLabel && (
          <span className="cv-stage-chip" data-testid="cv-stage-chip">
            <MatIcon aria-hidden="true" /> {stageLabel}
          </span>
        )}
        <StatusPill status={status} />
        {tv && clock !== "" && (
          <span className="cv-clock" aria-hidden="true">
            <ClockIcon /> {clock}
          </span>
        )}
        {tv && rotationPaused && (
          <button type="button" className="cv-btn" onClick={onResumeRotation}>
            <PlayIcon aria-hidden="true" /> Retomar rodízio
          </button>
        )}
                {fullscreen.supported && (
          <button type="button" className="cv-btn" onClick={fullscreen.toggle} aria-pressed={fullscreen.active}>
            {fullscreen.active ? <CompressIcon aria-hidden="true" /> : <ExpandIcon aria-hidden="true" />}
            <span>{fullscreen.active ? "Sair da tela cheia" : "Tela cheia"}</span>
          </button>
        )}
        <div className="cv-qr-box">
          <QrCode value={shareUrl} size={tv ? 72 : 68} label="QR code do link para acompanhar no celular" />
          <span className="cv-qr-cap">{tv ? "Acompanhe no celular" : "Link"}</span>
        </div>
      </div>
    </header>
  );
}
