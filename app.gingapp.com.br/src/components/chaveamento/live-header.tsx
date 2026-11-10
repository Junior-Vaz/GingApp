import { Maximize2, Minimize2, Play } from "lucide-react";
import type { ConnectionStatus } from "@/lib/chaveamento/connection";
import type { FullscreenControl } from "@/lib/chaveamento/hooks";
import { QrCode } from "./qr-code";

/** Indicador de conexão: texto + ponto (nunca só cor). `polling` também é "ao vivo" (atualiza a cada 3 s). */
export function StatusPill({ status }: { status: ConnectionStatus }) {
  const reconnecting = status === "reconnecting";
  return (
    <span className="cv-status" role="status" data-status={status} data-testid="cv-status">
      <span className="cv-dot" aria-hidden="true" data-steady={status === "polling" ? "1" : undefined} />
      {reconnecting ? "Reconectando…" : "AO VIVO"}
    </span>
  );
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

/** Barra superior: grupo, título do evento, indicador AO VIVO/reconectando, tela cheia e QR do link. */
export function LiveHeader({ organizationName, eventTitle, eventDate, location, status, tv, fullscreen, shareUrl, rotationPaused, onResumeRotation }: LiveHeaderProps) {
  const date = formatDate(eventDate);
  const meta = [date, location].filter(Boolean).join(" · ");
  return (
    <header className="cv-header">
      <div className="cv-header-text">
        {organizationName !== "" && <p className="cv-org">{organizationName}</p>}
        <h1 className="cv-title">{eventTitle}</h1>
        {meta !== "" && <p className="cv-meta">{meta}</p>}
      </div>
      <div className="cv-header-actions">
        <StatusPill status={status} />
        {tv && rotationPaused && (
          <button type="button" className="cv-btn" onClick={onResumeRotation}>
            <Play aria-hidden="true" /> Retomar rodízio
          </button>
        )}
        {tv && !rotationPaused && (
          <span className="cv-rot-note" aria-hidden="true">
            <span>Rodízio automático</span>
          </span>
        )}
        {fullscreen.supported && (
          <button type="button" className="cv-btn" onClick={fullscreen.toggle} aria-pressed={fullscreen.active}>
            {fullscreen.active ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            <span>{fullscreen.active ? "Sair da tela cheia" : "Tela cheia"}</span>
          </button>
        )}
        <div className="cv-qr-box">
          <QrCode value={shareUrl} size={tv ? 104 : 72} label="QR code do link para acompanhar no celular" />
          <span className="cv-qr-cap">{tv ? "Acompanhe no celular" : "Link"}</span>
        </div>
      </div>
    </header>
  );
}
