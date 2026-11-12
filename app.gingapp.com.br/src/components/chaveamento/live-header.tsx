import { useCallback, useEffect, useState } from "react";
import type { ConnectionStatus } from "@/lib/chaveamento/connection";
import type { FullscreenControl } from "@/lib/chaveamento/hooks";
import { useMediaQuery, usePageVisible } from "@/lib/chaveamento/page-state";
import { shareLink } from "@/lib/chaveamento/share";
import { ClockIcon, CompressIcon, ExpandIcon, LogoMark, MatIcon, PlayIcon, ShareIcon, WifiOffIcon } from "./icons";
import { QrCode } from "./qr-code";

/** Indicador de conexão: selo AO VIVO (vermelho, pulsante), "Reconectando…" ou "Sem conexão" com ícone (nunca só cor). `polling` também é "ao vivo". */
export function StatusPill({ status, offline = false }: { status: ConnectionStatus; offline?: boolean }) {
  const reconnecting = status === "reconnecting" || offline;
  return (
    <span className="cv-status" role="status" data-status={reconnecting ? "reconnecting" : status} data-testid="cv-status">
      {reconnecting ? <WifiOffIcon className="cv-status-icon" /> : <span className="cv-dot" aria-hidden="true" data-steady={status === "polling" ? "1" : undefined} />}
      {offline ? "Sem conexão" : reconnecting ? "Reconectando…" : "AO VIVO"}
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
  const visible = usePageVisible();
  useEffect(() => {
    if (!enabled || !visible) return; // aba oculta: sem timer de pé
    setTime(read());
    const timer = setInterval(() => setTime(read()), 15_000);
    return () => clearInterval(timer);
  }, [enabled, visible]);
  return time;
}

export interface LiveHeaderProps {
  organizationName: string;
  eventTitle: string;
  eventDate: string;
  location: string | null;
  status: ConnectionStatus;
  /** O aparelho está sem rede. */
  offline?: boolean;
  tv: boolean;
  fullscreen: FullscreenControl;
  /** Link do QR do telão (sem categoria). */
  shareUrl: string;
  /** Link do botão "Compartilhar" (a categoria que está na tela). Padrão: `shareUrl`. */
  shareLinkUrl?: string;
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

/** "Compartilhar" (folha do aparelho ou cópia do link); o aviso "Link copiado" some sozinho. */
function ShareButton({ title, url }: { title: string; url: string }) {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 2_600);
    return () => clearTimeout(timer);
  }, [notice]);
  const onClick = useCallback(() => {
    void shareLink({ title, url }).then((result) => {
      if (result === "copied") setNotice("Link copiado");
      else if (result === "failed") setNotice("Não foi possível copiar o link");
    });
  }, [title, url]);
  return (
    <>
      <button type="button" className="cv-btn cv-share" onClick={onClick} data-testid="cv-share" aria-label="Compartilhar o link deste campeonato">
        <ShareIcon aria-hidden="true" />
        <span className="cv-btn-label">Compartilhar</span>
      </button>
      {notice !== null && (
        <p className="cv-toast" role="status" data-testid="cv-toast">
          {notice}
        </p>
      )}
    </>
  );
}

/**
 * Cabeçalho tipo emissora: marca, grupo organizador, título do evento, fase atual, selo AO VIVO, relógio, compartilhar, tela
 * cheia e QR do link. No celular é compacto (marca + organizador + selo + compartilhar, título embaixo; sem QR, que serve
 * para quem está diante da TV); a tela cheia só aparece onde faz sentido (paisagem, tablet, notebook).
 */
export function LiveHeader({ organizationName, eventTitle, eventDate, location, status, offline = false, tv, fullscreen, shareUrl, shareLinkUrl, rotationPaused, onResumeRotation, stageLabel = null }: LiveHeaderProps) {
  const date = formatDate(eventDate);
  const meta = [date, location].filter(Boolean).join(" · ");
  const clock = useClock(tv);
  // O QR serve a quem está diante da TV (ou a um notebook/desktop com mouse); no celular nem é montado.
  const wide = useMediaQuery("(min-width: 1100px) and (hover: hover) and (pointer: fine)");
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
        <StatusPill status={status} offline={offline} />
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
        {!tv && <ShareButton title={eventTitle} url={shareLinkUrl ?? shareUrl} />}
        {fullscreen.supported && (
          <button type="button" className="cv-btn cv-fs-btn" onClick={fullscreen.toggle} aria-pressed={fullscreen.active}>
            {fullscreen.active ? <CompressIcon aria-hidden="true" /> : <ExpandIcon aria-hidden="true" />}
            <span className="cv-btn-label">{fullscreen.active ? "Sair da tela cheia" : "Tela cheia"}</span>
          </button>
        )}
        {(tv || wide) && (
          <div className="cv-qr-box">
            <QrCode value={shareUrl} size={tv ? 72 : 68} label="QR code do link para acompanhar no celular" />
            <span className="cv-qr-cap">{tv ? "Acompanhe no celular" : "Link"}</span>
          </div>
        )}
      </div>
    </header>
  );
}
