import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImageOff, ImagePlus, Loader2, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraDialog } from "@/components/photo/camera-dialog";
import { CropDialog } from "@/components/photo/crop-dialog";
import { photoErrorMessage, PHOTO_ERROR_MESSAGES } from "@/lib/photo/messages";
import { prepareImage } from "@/lib/photo/prepare-image";
import { MAX_INPUT_BYTES, PHOTO_ACCEPT, type PhotoShape } from "@/lib/photo/types";
import { useObjectUrl } from "@/lib/photo/use-object-url";
import { cn } from "@/lib/utils";

export interface PhotoPickerProps {
  /** Foto atual: URL (já pronta para `<img src>`, ex.: `imageSrc(...)`) ou o Blob devolvido por `onChange`. */
  value?: string | Blob | null | undefined;
  /** Foto nova PRONTA para envio (recortada e comprimida por `prepareImage`) ou `null` ao remover. */
  onChange: (photo: Blob | null) => void;
  /** `square` (padrão) = foto de pessoa: câmera + recorte quadrado 800x800; `wide` = logo/capa: só compressão. */
  shape?: PhotoShape | undefined;
  /** Mostra "Tirar foto" (padrão: sim). Ignorado em `wide` (sem câmera). */
  camera?: boolean | undefined;
  /** Teto do arquivo final em bytes (padrão 400 KB). */
  maxBytes?: number | undefined;
  /** Rótulo do campo. */
  label: string;
  /** Texto de ajuda sob os botões. */
  description?: string | undefined;
  disabled?: boolean | undefined;
  /** Erro de validação do formulário: realça a pré-visualização e marca `aria-invalid`. */
  invalid?: boolean | undefined;
  /** Envio em andamento (do chamador): bloqueia os botões e mostra "Enviando…". */
  busy?: boolean | undefined;
  /** Texto alternativo da pré-visualização. */
  previewAlt?: string | undefined;
  /** Falha ao preparar a foto (a mensagem pt-BR já aparece no campo; aqui é só para telemetria/toast opcional). */
  onError?: ((error: unknown) => void) | undefined;
  className?: string | undefined;
}

const CHECKERBOARD = {
  backgroundImage:
    "conic-gradient(rgba(127,127,127,0.12) 25%, transparent 0 50%, rgba(127,127,127,0.12) 0 75%, transparent 0)",
  backgroundSize: "16px 16px",
} as const;

type Stage =
  | { kind: "idle" }
  | { kind: "camera" }
  | { kind: "crop"; source: Blob; origin: "upload" | "camera" };

const isEmptyValue = (value: PhotoPickerProps["value"]): boolean =>
  value === undefined || value === null || value === "";

/**
 * Campo de foto: "Enviar foto" e "Tirar foto" (câmera na tela) -> recorte -> `onChange(blob)` já preparado
 * (WebP, quadrado 800x800 e <= `maxBytes`). Com `shape="wide"` só comprime (sem câmera nem recorte).
 * A imagem original nunca é enviada e nada fica guardado no navegador além da pré-visualização (Blob URL revogada).
 */
export function PhotoPicker({
  value,
  onChange,
  shape = "square",
  camera = true,
  maxBytes,
  label,
  description,
  disabled = false,
  invalid = false,
  busy = false,
  previewAlt,
  onError,
  className,
}: PhotoPickerProps) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** Botão que abriu o fluxo: o foco volta para ele quando o último diálogo fecha. */
  const originRef = useRef<HTMLElement | null>(null);
  const alive = useRef(true);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [produced, setProduced] = useState<Blob | null>(null);
  const [urlFailed, setUrlFailed] = useState(false);
  const [announce, setAnnounce] = useState("");

  const square = shape === "square";
  const withCamera = square && camera;
  const locked = disabled || busy || processing;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Controlado quando `value` é informado; sem `value`, mostra a última foto gerada aqui.
  const shown = value !== undefined ? value : produced;
  const shownBlob = shown instanceof Blob ? shown : null;
  const blobUrl = useObjectUrl(shownBlob);
  const src = shownBlob ? blobUrl : typeof shown === "string" && shown !== "" ? shown : null;
  const hasValue = !isEmptyValue(shown);
  useEffect(() => setUrlFailed(false), [src]);

  function fail(failure: unknown, message?: string) {
    setError(message ?? photoErrorMessage(failure));
    onError?.(failure);
  }

  function deliver(photo: Blob) {
    setProduced(photo);
    setError(null);
    setAnnounce("Foto pronta.");
    onChange(photo);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    setError(null);
    if (file.size > MAX_INPUT_BYTES) {
      fail(new Error("TOO_LARGE_INPUT"), PHOTO_ERROR_MESSAGES.TOO_LARGE_INPUT);
      return;
    }
    if (square) {
      setStage({ kind: "crop", source: file, origin: "upload" });
      return;
    }
    // `wide` (logo/capa): sem recorte, só reduz e comprime.
    setProcessing(true);
    try {
      const photo = await prepareImage(file, {
        shape: "wide",
        ...(maxBytes === undefined ? {} : { maxBytes }),
      });
      if (alive.current) deliver(photo);
    } catch (failure) {
      if (alive.current) fail(failure);
    } finally {
      if (alive.current) setProcessing(false);
    }
  }

  function remove() {
    setProduced(null);
    setError(null);
    setAnnounce("Foto removida.");
    onChange(null);
  }

  function chooseAnother(origin: "upload" | "camera") {
    if (origin === "camera") {
      setStage({ kind: "camera" });
      return;
    }
    setStage({ kind: "idle" });
    fileRef.current?.click(); // ainda dentro do clique do usuário
  }

  /** Os diálogos não têm "trigger" do Radix: devolvemos o foco ao botão de origem, mas só no fim do fluxo (não entre câmera e recorte). */
  const returnFocus = (event: Event) => {
    if (stage.kind !== "idle") return;
    const origin = originRef.current;
    if (origin?.isConnected) {
      event.preventDefault();
      origin.focus();
    }
  };

  const uploadLabel = square ? "Enviar foto" : "Enviar imagem";
  const describedBy =
    [description ? `${uid}-desc` : null, error ? `${uid}-error` : null].filter(Boolean).join(" ") ||
    undefined;
  const cropSource = stage.kind === "crop" ? stage.source : null;

  return (
    <div className={cn("space-y-2", className)} data-testid="photo-picker" data-shape={shape}>
      <p className="text-sm font-medium leading-none" id={`${uid}-label`}>
        {label}
      </p>
      <div
        className="flex flex-wrap items-start gap-3"
        role="group"
        aria-labelledby={`${uid}-label`}
        aria-describedby={describedBy}
      >
        <div
          className={cn(
            "relative flex shrink-0 items-center justify-center overflow-hidden border bg-muted/40",
            square ? "size-24 rounded-full" : "h-28 w-full rounded-md sm:w-52",
            invalid && "border-destructive ring-2 ring-destructive/30",
          )}
          data-testid="photo-preview"
          data-invalid={invalid ? "true" : undefined}
          // Logo/capa: fundo xadrez discreto para a transparência ficar visível.
          style={square ? undefined : CHECKERBOARD}
          data-checkerboard={square ? undefined : "true"}
        >
          {src && !urlFailed ? (
            <img
              src={src}
              alt={previewAlt ?? `Pré-visualização: ${label}`}
              className={cn("size-full", square ? "object-cover" : "object-contain")}
              onError={() => setUrlFailed(true)}
            />
          ) : src && urlFailed ? (
            <ImageOff
              className="size-6 text-muted-foreground"
              aria-label="Não foi possível carregar a imagem"
            />
          ) : square ? (
            <User className="size-8 text-muted-foreground" aria-hidden />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
          )}
          {(busy || processing) && (
            <div className="absolute inset-0 grid place-items-center bg-background/70" aria-hidden>
              <Loader2 className="size-6 motion-safe:animate-spin" />
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex min-w-0 gap-2",
            square ? "flex-col items-stretch sm:flex-row sm:flex-wrap sm:items-start" : "flex-wrap",
          )}
        >
          <input
            ref={fileRef}
            type="file"
            accept={PHOTO_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label={`Escolher arquivo: ${label}`}
            data-testid="photo-file-input"
            disabled={locked}
            onChange={(event) => void handleFile(event)}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-11"
            disabled={locked}
            data-testid="photo-upload"
            aria-invalid={invalid || undefined}
            onClick={(event) => {
              originRef.current = event.currentTarget;
              fileRef.current?.click();
            }}
          >
            {processing ? <Loader2 className="motion-safe:animate-spin" /> : <ImagePlus />}
            {busy ? "Enviando…" : processing ? "Preparando…" : uploadLabel}
          </Button>
          {withCamera && (
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-11"
              disabled={locked}
              data-testid="photo-camera"
              onClick={(event) => {
                originRef.current = event.currentTarget;
                setError(null);
                setStage({ kind: "camera" });
              }}
            >
              <Camera /> Tirar foto
            </Button>
          )}
          {hasValue && (
            <Button
              type="button"
              variant="ghost"
              className="h-11 md:h-11"
              disabled={locked}
              data-testid="photo-remove"
              onClick={remove}
            >
              <Trash2 /> Remover
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p
          className="text-sm text-destructive"
          id={`${uid}-error`}
          role="alert"
          aria-live="assertive"
          data-testid="photo-error"
        >
          {error}
        </p>
      )}
      {description && (
        <p className="text-xs text-muted-foreground" id={`${uid}-desc`}>
          {description}
        </p>
      )}
      <p className="sr-only" aria-live="polite" data-testid="photo-status">
        {busy ? "Enviando a foto." : processing ? "Preparando a foto." : announce}
      </p>

      {withCamera && (
        <CameraDialog
          open={stage.kind === "camera"}
          onClose={() => setStage({ kind: "idle" })}
          onCloseAutoFocus={returnFocus}
          onCapture={(photo) => setStage({ kind: "crop", source: photo, origin: "camera" })}
        />
      )}
      {square && (
        <CropDialog
          open={stage.kind === "crop"}
          source={cropSource}
          {...(maxBytes === undefined ? {} : { maxBytes })}
          onConfirm={(photo) => {
            setStage({ kind: "idle" });
            deliver(photo);
          }}
          onCancel={() => setStage({ kind: "idle" })}
          onCloseAutoFocus={returnFocus}
          onChooseAnother={() => chooseAnother(stage.kind === "crop" ? stage.origin : "upload")}
        />
      )}
    </div>
  );
}
