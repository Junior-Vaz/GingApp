import { useCallback, useEffect, useId, useState } from "react";
import QRCode from "qrcode";
import { Copy, ExternalLink, Eye, EyeOff, MonitorPlay, MonitorUp, QrCode, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { copyText } from "@/modules/formularios/share";
import { useRotateToken, useSetPublic } from "./api";
import { liveUrl } from "./helpers";
import type { TournamentSummary } from "./types";

/** Tamanho "de TV" em que o telão é desenhado dentro da pré-visualização (depois reduzido por `transform: scale`). */
const PREVIEW_W = 1280;
const PREVIEW_H = 720;

/** Largura atual do elemento (ResizeObserver); `0` até medir. */
function useElementWidth(): [(node: HTMLElement | null) => void, number] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [useCallback((n: HTMLElement | null) => setNode(n), []), width];
}

/**
 * Cartão do telão público: ligar/desligar, link (copiar), "Abrir telão", "Abrir em modo TV", QR, "Gerar novo link" e uma
 * pré-visualização reduzida do telão. A pré-visualização é um `<iframe>` do próprio app (o nginx do app não envia
 * X-Frame-Options nem CSP frame-ancestors, então o navegador deixa embutir); só carrega quando o operador pede e só com o
 * telão ligado. NÃO existe contador de espectadores: o backend não o fornece.
 */
export function TournamentCard({ eventId, tournament, canEdit }: { eventId: number; tournament: TournamentSummary; canEdit: boolean }) {
  const setPublic = useSetPublic(eventId);
  const rotate = useRotateToken(eventId);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [measure, boxWidth] = useElementWidth();
  const switchId = useId();
  const url = liveUrl(tournament.publicToken);
  const tvUrl = liveUrl(tournament.publicToken, true);
  const on = tournament.publicEnabled;
  const scale = boxWidth > 0 ? boxWidth / PREVIEW_W : 0.3;

  useEffect(() => {
    let alive = true;
    setQr(null);
    setQrFailed(false);
    QRCode.toDataURL(url, { margin: 2, width: 320, errorCorrectionLevel: "M" })
      .then((value) => alive && setQr(value))
      .catch(() => alive && setQrFailed(true));
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <section aria-label="Telão público" className="grid grid-cols-1 gap-4 rounded-2xl border bg-card p-4 shadow-sm" data-testid="tournament-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-extrabold">
          <MonitorPlay className="size-5 text-primary" aria-hidden /> Telão público
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-extrabold tracking-wide",
              on ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", on ? "bg-emerald-600" : "bg-muted-foreground")} aria-hidden />
            {on ? "NO AR" : "FORA DO AR"}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <Label htmlFor={switchId} className="text-sm">
            {on ? "Ligado" : "Desligado"}
          </Label>
          <Switch id={switchId} checked={on} disabled={!canEdit || setPublic.isPending} onCheckedChange={(next) => setPublic.mutate(next)} aria-label="Telão público ligado" />
        </div>
      </div>

      <p className="text-sm text-muted-foreground" data-testid="tournament-privacy">
        Quem tiver o link vê a chave ao vivo, sem login: nomes, grupo, graduação, placares e fotos (de menores, só com a autorização marcada).
      </p>
      {!on && <p className="text-sm font-medium text-amber-700 dark:text-amber-400">O telão está desligado: o link abaixo só funciona depois de ligar.</p>}

      <div className="grid grid-cols-1 gap-1.5">
        <Label htmlFor="tournament-live-link">Link do telão</Label>
        <div className="flex gap-2">
          <Input id="tournament-live-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 text-xs" />
          <Button type="button" variant="outline" size="icon" aria-label="Copiar link do telão" onClick={() => void copyText(url)}>
            <Copy />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
        <Button asChild variant="default" size="lg" className="h-12 lg:h-10">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink /> Abrir telão
          </a>
        </Button>
        <Button asChild variant="outline" size="lg" className="h-12 lg:h-10">
          <a href={tvUrl} target="_blank" rel="noopener noreferrer">
            <MonitorUp /> Abrir em modo TV
          </a>
        </Button>
        {canEdit && (
          <Button type="button" variant="ghost" size="lg" className="h-12 lg:h-10" disabled={rotate.isPending} onClick={() => setConfirmRotate(true)}>
            <RefreshCw /> Gerar novo link
          </Button>
        )}
      </div>

      <details className="group rounded-xl border bg-muted/30 p-3" open={typeof window !== "undefined" && window.matchMedia?.("(min-width: 1024px)").matches ? true : undefined}>
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold">
          <QrCode className="size-4" aria-hidden /> QR Code e pré-visualização
        </summary>
        <div className="grid grid-cols-1 gap-4 pt-3 lg:grid-cols-[auto_1fr]">
          <div className="grid place-items-center">
            {qr ? (
              <img src={qr} alt="QR Code do telão" width={144} height={144} className="size-36 rounded-md border bg-white p-1" />
            ) : qrFailed ? (
              <p role="alert" className="max-w-36 text-xs text-destructive">Não foi possível gerar o QR Code. Copie o link.</p>
            ) : (
              <Skeleton className="size-36" />
            )}
          </div>
          <div className="grid grid-cols-1 content-start gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Pré-visualização do telão</p>
              <Button type="button" variant="outline" size="sm" aria-pressed={preview} onClick={() => setPreview((v) => !v)} disabled={!on}>
                {preview ? <EyeOff /> : <Eye />} {preview ? "Ocultar pré-visualização" : "Mostrar pré-visualização"}
              </Button>
            </div>
            {!on ? (
              <p className="text-xs text-muted-foreground">Ligue o telão para ver a pré-visualização.</p>
            ) : preview ? (
              <div className="grid grid-cols-1 gap-1">
                <div ref={measure} className="relative w-full max-w-md overflow-hidden rounded-lg border bg-black" style={{ aspectRatio: `${String(PREVIEW_W)} / ${String(PREVIEW_H)}` }} data-testid="telao-preview">
                  <iframe
                    title="Pré-visualização do telão (modo TV)"
                    src={tvUrl}
                    sandbox="allow-scripts allow-same-origin"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    tabIndex={-1}
                    className="pointer-events-none absolute left-0 top-0 border-0"
                    style={{ width: PREVIEW_W, height: PREVIEW_H, transform: `scale(${String(scale)})`, transformOrigin: "0 0" }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">A pré-visualização é o telão de verdade, em miniatura (conta como mais uma tela conectada).</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Veja como o público enxerga a chave sem sair do painel.</p>
            )}
          </div>
        </div>
      </details>

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Gerar novo link do telão?"
        description="O link e o QR Code atuais param de funcionar na hora: quem está assistindo será desconectado e precisará do novo link."
        confirmLabel="Gerar novo link"
        onConfirm={async () => {
          try {
            await rotate.mutateAsync();
          } catch {
            /* o toast já mostrou a mensagem do erro */
          }
        }}
      />
    </section>
  );
}
