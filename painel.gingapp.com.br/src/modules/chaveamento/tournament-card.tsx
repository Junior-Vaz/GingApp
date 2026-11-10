import { useEffect, useId, useState } from "react";
import QRCode from "qrcode";
import { Copy, ExternalLink, MonitorPlay, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/modules/formularios/share";
import { useRotateToken, useSetPublic } from "./api";
import { liveUrl } from "./helpers";
import type { TournamentSummary } from "./types";

/**
 * Cartão do telão público: link (copiar/abrir), QR, ligar/desligar e "Gerar novo link". Explica em uma linha o que o
 * telão expõe (decisão do dono, contrato 0.3: menores só com foto autorizada).
 */
export function TournamentCard({ eventId, tournament, canEdit }: { eventId: number; tournament: TournamentSummary; canEdit: boolean }) {
  const setPublic = useSetPublic(eventId);
  const rotate = useRotateToken(eventId);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const switchId = useId();
  const url = liveUrl(tournament.publicToken);
  const tvUrl = liveUrl(tournament.publicToken, true);

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
    <section aria-label="Telão público" className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-[1fr_auto]" data-testid="tournament-card">
      <div className="grid content-start gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <MonitorPlay className="size-5" aria-hidden /> Telão público
          </h2>
          <div className="flex items-center gap-2">
            <Label htmlFor={switchId} className="text-sm">
              {tournament.publicEnabled ? "Ligado" : "Desligado"}
            </Label>
            <Switch
              id={switchId}
              checked={tournament.publicEnabled}
              disabled={!canEdit || setPublic.isPending}
              onCheckedChange={(on) => setPublic.mutate(on)}
              aria-label="Telão público ligado"
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="tournament-privacy">
          Quem tiver o link vê a chave ao vivo, sem login: nomes, grupo, graduação, placares e fotos (de menores, só com a autorização marcada).
        </p>
        {!tournament.publicEnabled && (
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            O telão está desligado: o link abaixo só funciona depois de ligar.
          </p>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="tournament-live-link">Link do telão</Label>
          <Input id="tournament-live-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyText(url)}>
            <Copy /> Copiar link
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Abrir telão
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={tvUrl} target="_blank" rel="noopener noreferrer">
              <MonitorPlay /> Modo telão (TV)
            </a>
          </Button>
          {canEdit && (
            <Button type="button" variant="ghost" size="sm" disabled={rotate.isPending} onClick={() => setConfirmRotate(true)}>
              <RefreshCw /> Gerar novo link
            </Button>
          )}
        </div>
      </div>
      <div className="grid place-items-center">
        {qr ? (
          <img src={qr} alt="QR Code do telão" width={144} height={144} className="size-36 rounded-md border bg-white p-1" />
        ) : qrFailed ? (
          <p role="alert" className="max-w-36 text-xs text-destructive">Não foi possível gerar o QR Code. Copie o link.</p>
        ) : (
          <Skeleton className="size-36" />
        )}
      </div>
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
