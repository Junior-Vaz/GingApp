import { useEffect, useId, useRef, useState } from "react";
import { ImageOff, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { photoErrorMessage } from "@/lib/photo/messages";
import { prepareImage } from "@/lib/photo/prepare-image";
import { UPLOAD_ACCEPT } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { sponsorImageSrc, sponsorsErrorMessage, uploadSponsorImage } from "./api";
import {
  SPONSOR_IMAGE_COMPRESS_TARGET_BYTES,
  SPONSOR_IMAGE_MAX_BYTES,
  SPONSOR_IMAGE_RECOMMENDED,
  validateSponsorImageFile,
} from "./sponsor-utils";

interface SponsorImageFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** "wide" = imagem de fundo do slide; "square" = logo. */
  shape?: "wide" | "square";
  hint?: string;
  disabled?: boolean;
  error?: string | undefined;
  testId?: string;
}

/**
 * Imagem do patrocinador: upload do GRUPO (POST /uploads) com pré-visualização e "Remover". Imagem acima de 250 KB é
 * COMPRIMIDA no navegador (alvo 240 KB, mantendo a proporção) antes de enviar; só quando nem assim cabe, mostra o erro
 * claro. Formato fora de JPEG/PNG/WebP é recusado com mensagem. Não aceita link externo: o servidor só aceita imagens
 * enviadas pelo próprio grupo. Imagem que já cabe (<= 250 KB) vai como está (preserva a transparência de logos em PNG).
 */
export function SponsorImageField({ label, value, onChange, shape = "wide", hint, disabled, error, testId = "sponsor-image" }: SponsorImageFieldProps) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const src = sponsorImageSrc(value);
  useEffect(() => setFailed(false), [src]);
  const shownError = localError ?? error;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    // O peso NÃO barra aqui (a compressão resolve): só o formato e o arquivo vazio.
    const invalid = validateSponsorImageFile({ type: file.type, size: Math.min(file.size, SPONSOR_IMAGE_MAX_BYTES) });
    if (invalid) {
      setLocalError(invalid);
      toast.error(invalid);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setLocalError(null);
    setUploading(true);
    try {
      let toSend: Blob = file;
      if (file.size > SPONSOR_IMAGE_MAX_BYTES) {
        setCompressing(true);
        try {
          toSend = await prepareImage(file, { shape: "wide", maxBytes: SPONSOR_IMAGE_COMPRESS_TARGET_BYTES });
        } catch (e) {
          // Não coube nem na menor dimensão: erro claro (o servidor recusaria o arquivo grande).
          const message =
            (e as { code?: unknown } | null)?.code === "ENCODE_FAILED"
              ? `Não foi possível reduzir a imagem para menos de ${String(SPONSOR_IMAGE_MAX_BYTES / 1024)} KB. Use uma imagem menor ou mais simples (recomendado ${String(SPONSOR_IMAGE_RECOMMENDED.width)}×${String(SPONSOR_IMAGE_RECOMMENDED.height)} px).`
              : photoErrorMessage(e);
          setLocalError(message);
          toast.error(message);
          return;
        } finally {
          setCompressing(false);
        }
      }
      onChange(await uploadSponsorImage(toSend));
    } catch (e) {
      const message = sponsorsErrorMessage(e, "Não foi possível enviar a imagem. Tente novamente.");
      setLocalError(message);
      toast.error(message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = ""; // permite escolher o mesmo arquivo de novo
    }
  }

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-2" data-testid={testId}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-start gap-3">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40",
            shape === "wide" ? "h-24 w-full sm:w-44" : "size-20",
          )}
        >
          {src && !failed ? (
            <img src={src} alt={`Pré-visualização: ${label}`} className="size-full object-cover" onError={() => setFailed(true)} />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            id={id}
            type="file"
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            data-testid={`${testId}-file`}
            disabled={disabled || uploading}
            aria-describedby={`${hintId}${shownError ? ` ${errorId}` : ""}`}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
            {compressing ? "Reduzindo…" : uploading ? "Enviando…" : value ? "Trocar imagem" : "Enviar imagem"}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || uploading}
              aria-label={`Remover imagem: ${label}`}
              onClick={() => {
                setLocalError(null);
                onChange("");
              }}
            >
              <Trash2 /> Remover
            </Button>
          )}
        </div>
      </div>
      {src && failed && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ImageOff className="size-4" /> Não foi possível carregar a imagem.
        </p>
      )}
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint ??
          `JPEG, PNG ou WebP (recomendado ${String(SPONSOR_IMAGE_RECOMMENDED.width)}×${String(SPONSOR_IMAGE_RECOMMENDED.height)} px). Imagens acima de ${String(SPONSOR_IMAGE_MAX_BYTES / 1024)} KB são reduzidas automaticamente.`}
      </p>
      {shownError && (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {shownError}
        </p>
      )}
    </div>
  );
}
