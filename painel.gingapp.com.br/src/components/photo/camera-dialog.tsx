import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, Loader2, RefreshCw, SwitchCamera, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  captureFrame,
  listFacingSupport,
  mapCameraError,
  openCamera,
  stopCamera,
  streamIsMirrored,
} from "@/lib/photo/camera";
import { CAPTURE_FAILED_MESSAGE } from "@/lib/photo/messages";
import type { CameraError, CameraFacing } from "@/lib/photo/types";

export interface CameraDialogProps {
  open: boolean;
  /** Fechar sem foto (botão "Cancelar", X, Esc ou clique fora). As trilhas da câmera já foram paradas. */
  onClose: () => void;
  /**
   * Foto tirada na hora (JPEG sem espelhar) OU arquivo escolhido no fallback nativo (`capture="user"`).
   * O fluxo normal segue para o recorte.
   */
  onCapture: (photo: Blob) => void;
  /** Câmera inicial (padrão: frontal). */
  initialFacing?: CameraFacing;
  /** Chamado quando o diálogo termina de fechar: quem abriu devolve o foco ao botão de origem (`event.preventDefault()`). */
  onCloseAutoFocus?: (event: Event) => void;
}

type Status = "starting" | "live" | "paused" | "captured" | "error";

/**
 * Câmera na própria tela: pré-visualização quadrada com moldura redonda, botão de captura grande, troca frontal/traseira
 * (só quando há mais de uma câmera) e fechar. Sem suporte/permissão/HTTPS => mensagem clara + seletor nativo
 * (`<input type="file" accept="image/*" capture="user">`). Privacidade: as trilhas PARAM ao fechar, ao desmontar, depois
 * de capturar e quando a aba fica oculta (`visibilitychange`); a imagem nunca sai do navegador.
 */
export function CameraDialog({
  open,
  onClose,
  onCapture,
  initialFacing = "user",
  onCloseAutoFocus,
}: CameraDialogProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* Só monta o corpo (e, portanto, só liga a câmera) com o diálogo aberto. */}
      <DialogContent
        ref={contentRef}
        className="sm:max-w-md"
        data-testid="camera-dialog"
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        onOpenAutoFocus={(event) => {
          // Foca o botão principal (captura ou fallback) em vez do "X": quem abre a câmera quer tirar a foto.
          const target = contentRef.current?.querySelector<HTMLElement>("[data-autofocus]");
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <CameraBody onClose={onClose} onCapture={onCapture} initialFacing={initialFacing} />
      </DialogContent>
    </Dialog>
  );
}

function CameraBody({
  onClose,
  onCapture,
  initialFacing,
}: {
  onClose: () => void;
  onCapture: (photo: Blob) => void;
  initialFacing: CameraFacing;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(false);
  const fallbackRef = useRef<HTMLInputElement | null>(null);
  const shutterRef = useRef<HTMLButtonElement | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<CameraError | null>(null);
  const [facing, setFacing] = useState<CameraFacing>(initialFacing);
  const [mirrored, setMirrored] = useState(initialFacing === "user");
  const [canSwitch, setCanSwitch] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  /** Para a câmera. `keepFrame`: deixa o último quadro congelado na tela (efeito "obturador") enquanto o recorte abre. */
  const release = useCallback((keepFrame = false) => {
    stopCamera(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video && !keepFrame) video.srcObject = null;
  }, []);

  // Abre a câmera. O `cancelled` cobre a corrida "fechou/trocou enquanto a permissão estava sendo pedida": o stream que
  // chegar depois é parado na hora (senão a luz da câmera ficaria acesa sem ninguém olhando).
  useEffect(() => {
    let cancelled = false;
    void openCamera({ facing })
      .then((stream) => {
        if (cancelled || pausedRef.current) {
          stopCamera(stream);
          return;
        }
        streamRef.current = stream;
        setMirrored(streamIsMirrored(stream, facing));
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void Promise.resolve(video.play?.()).catch(() => undefined);
        }
        void listFacingSupport().then((support) => {
          if (!cancelled) setCanSwitch(support.canSwitch);
        });
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setError(mapCameraError(failure));
        setStatus("error");
      });
    return () => {
      cancelled = true;
      release();
    };
  }, [facing, attempt, release]);

  // Aba oculta => para a câmera (privacidade e bateria). Ao voltar, a pessoa retoma com um toque.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      pausedRef.current = true;
      release();
      setStatus((current) => (current === "error" || current === "captured" ? current : "paused"));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [release]);

  // O botão de captura nasce desabilitado (a câmera ainda abre): quando fica pronto e o foco não está em nenhum controle, vai para ele.
  useEffect(() => {
    if (status !== "live") return;
    const shutter = shutterRef.current;
    if (!shutter) return;
    const active = document.activeElement;
    if (!active || active === document.body || active === shutter.closest("[role=dialog]"))
      shutter.focus();
  }, [status]);

  function restart(nextFacing?: CameraFacing) {
    pausedRef.current = false;
    setError(null);
    setCaptureError(null);
    setStatus("starting");
    if (nextFacing && nextFacing !== facing) setFacing(nextFacing);
    else setAttempt((n) => n + 1);
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || status !== "live" || capturing) return;
    setCapturing(true);
    setCaptureError(null);
    try {
      const frame = await captureFrame(video);
      // Câmera desliga já: não precisa ficar ligada durante o recorte.
      pausedRef.current = true;
      release(true);
      setStatus("captured");
      onCapture(frame);
    } catch (failure) {
      setCaptureError(
        failure instanceof Error && failure.message ? failure.message : CAPTURE_FAILED_MESSAGE,
      );
    } finally {
      setCapturing(false);
    }
  }

  function onFallbackChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // permite escolher/tirar de novo a mesma foto
    if (file) onCapture(file);
  }

  const showFallback = status === "error";
  const live = status === "live";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Tirar foto</DialogTitle>
        <DialogDescription>
          Enquadre o rosto dentro do círculo e toque no botão grande.
        </DialogDescription>
      </DialogHeader>

      <div className="mx-auto w-[min(100%,48dvh)]">
        <div
          className="relative aspect-square w-full overflow-hidden rounded-xl bg-black"
          data-testid="camera-viewport"
        >
          {status !== "error" && (
            <video
              ref={videoRef}
              className="absolute inset-0 size-full object-cover"
              style={mirrored ? { transform: "scaleX(-1)" } : undefined}
              autoPlay
              playsInline
              muted
              aria-label="Pré-visualização da câmera"
              data-testid="camera-video"
              data-mirrored={mirrored ? "true" : "false"}
              onLoadedMetadata={() => setStatus("live")}
              onPlaying={() => setStatus("live")}
            />
          )}

          {live && (
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {/* Moldura redonda: o escuro fora do círculo mostra o que sobra do recorte quadrado. */}
              <div className="absolute inset-[5%] rounded-full border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.5)]" />
            </div>
          )}

          {status === "starting" && (
            <div
              className="absolute inset-0 grid place-items-center text-white"
              role="status"
              data-testid="camera-starting"
            >
              <span className="flex items-center gap-2 text-sm">
                <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden /> Abrindo a
                câmera…
              </span>
            </div>
          )}

          {status === "paused" && (
            <div
              className="absolute inset-0 grid place-items-center gap-3 bg-black/80 p-4 text-center text-white"
              data-testid="camera-paused"
            >
              <div className="grid justify-items-center gap-3">
                <p className="text-sm">Câmera desligada.</p>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 md:h-11"
                  onClick={() => restart()}
                >
                  <RefreshCw /> Ligar a câmera
                </Button>
              </div>
            </div>
          )}

          {status === "error" && error && (
            <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-muted p-4 text-center">
              <div className="grid justify-items-center gap-3">
                <TriangleAlert className="size-8 text-destructive" aria-hidden />
                <p
                  className="text-sm text-foreground"
                  role="alert"
                  aria-live="assertive"
                  data-testid="camera-error"
                  data-code={error.code}
                >
                  {error.message}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {captureError && (
        <p
          className="text-sm text-destructive"
          role="alert"
          aria-live="assertive"
          data-testid="camera-capture-error"
        >
          {captureError}
        </p>
      )}

      {showFallback ? (
        <div className="grid gap-2">
          <input
            ref={fallbackRef}
            type="file"
            accept="image/*"
            capture="user"
            className="sr-only"
            tabIndex={-1}
            aria-label="Tirar foto com a câmera do aparelho"
            data-testid="camera-fallback-input"
            onChange={onFallbackChange}
          />
          <Button
            type="button"
            className="h-11 md:h-11"
            data-autofocus=""
            onClick={() => fallbackRef.current?.click()}
          >
            <Camera /> Usar a câmera do aparelho
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-11"
              onClick={() => restart()}
            >
              <RefreshCw /> Tentar de novo
            </Button>
            <Button type="button" variant="ghost" className="h-11 md:h-11" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            className="h-11 justify-self-start md:h-11"
            onClick={onClose}
          >
            Cancelar
          </Button>
          <button
            ref={shutterRef}
            type="button"
            aria-label="Tirar foto"
            data-testid="camera-shutter"
            data-autofocus=""
            disabled={!live || capturing}
            onClick={() => void capture()}
            className="grid size-[72px] place-items-center rounded-full border-4 border-primary bg-background p-1 outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 motion-safe:transition-transform motion-safe:active:scale-95"
          >
            <span className="grid size-full place-items-center rounded-full bg-primary text-primary-foreground">
              {capturing ? (
                <Loader2 className="size-6 motion-safe:animate-spin" aria-hidden />
              ) : (
                <Camera className="size-6" aria-hidden />
              )}
            </span>
          </button>
          {canSwitch ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 justify-self-end md:size-11"
              aria-label={facing === "user" ? "Usar a câmera traseira" : "Usar a câmera frontal"}
              data-testid="camera-switch"
              disabled={status === "starting" || capturing}
              onClick={() => restart(facing === "user" ? "environment" : "user")}
            >
              <SwitchCamera />
            </Button>
          ) : (
            <span aria-hidden />
          )}
        </div>
      )}

      <p className="sr-only" aria-live="polite" data-testid="camera-live-status">
        {live ? "Câmera pronta." : status === "starting" ? "Abrindo a câmera." : ""}
      </p>
    </>
  );
}
