import { useEffect, useRef, useState } from "react";
import { Maximize, Printer, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { fmt, toDate } from "@/lib/format";
import { checkinWhen, DATE_TIME_FORMAT, useCheckinToken, type CheckinKind } from "./checkin-api";

interface Props {
  kind: CheckinKind;
  id: number;
}

/**
 * Tela de QR de check-in (evento) / presença (aula) para projetar ou imprimir. O aluno lê o QR no app
 * ou digita o código curto. O servidor só aceita o check-in dentro da janela opensAt..closesAt.
 */
export function CheckinQrPage({ kind, id }: Props) {
  const query = useCheckinToken(kind, id);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void stageRef.current?.requestFullscreen?.();
  }

  const heading = kind === "evento" ? "QR de check-in do evento" : "QR de presença da aula";

  if (query.isLoading) {
    return <Skeleton className="mx-auto h-96 w-full max-w-xl" data-testid="checkin-loading" />;
  }
  if (query.error || !query.data) {
    return (
      <div className="mx-auto max-w-xl space-y-3 rounded-lg border bg-card p-8 text-center" data-testid="checkin-error">
        <p className="text-sm text-destructive" role="alert">
          {errorMessage(query.error, "Não foi possível gerar o QR de check-in.")}
        </p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const data = query.data;
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <QrCode className="size-6" aria-hidden /> {heading}
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> Imprimir
          </Button>
          <Button variant="outline" onClick={toggleFullscreen}>
            <Maximize /> {fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          </Button>
        </div>
      </div>
      <p className="no-print mb-4 text-sm text-muted-foreground" data-testid="checkin-hint">
        Este código não muda enquanto o check-in {kind === "evento" ? "do evento" : "da aula"} estiver aberto. Prefira
        exibir o QR na tela durante {kind === "evento" ? "o evento" : "a aula"} (tela cheia) em vez de fixar uma cópia
        impressa.
      </p>

      <div
        ref={stageRef}
        className="checkin-printable mx-auto flex w-full max-w-2xl flex-col items-center gap-4 rounded-lg border bg-white p-6 text-center text-black [&:fullscreen]:max-w-none [&:fullscreen]:justify-center [&:fullscreen]:rounded-none"
      >
        <h2 className="text-3xl font-extrabold tracking-tight" data-testid="checkin-title">
          {data.title}
        </h2>
        <p className="text-lg" data-testid="checkin-when">
          {checkinWhen(data)}
        </p>
        <img
          src={data.qrDataUrl}
          alt="QR Code de check-in"
          className="aspect-square w-full max-w-md"
          style={{ imageRendering: "pixelated" }}
        />
        <div>
          <p className="text-sm uppercase tracking-wide text-neutral-600">Ou digite o código</p>
          <p className="font-mono text-6xl font-black tracking-[0.2em]" data-testid="checkin-code">
            {data.token}
          </p>
        </div>
        <p className="text-sm text-neutral-700" data-testid="checkin-window">
          Check-in aberto de {fmt(toDate(data.opensAt), DATE_TIME_FORMAT)} até {fmt(toDate(data.closesAt), DATE_TIME_FORMAT)}.
        </p>
      </div>
    </>
  );
}
