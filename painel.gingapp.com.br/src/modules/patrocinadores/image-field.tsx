import { useEffect, useId, useRef, useState } from "react";
import { ImageOff, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UPLOAD_ACCEPT } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { sponsorImageSrc, sponsorsErrorMessage, uploadSponsorImage } from "./api";
import { SPONSOR_IMAGE_MAX_BYTES, SPONSOR_IMAGE_RECOMMENDED, validateSponsorImageFile } from "./sponsor-utils";

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
 * Imagem do patrocinador: upload do GRUPO (POST /uploads) com pré-visualização e "Remover". Recusa NO NAVEGADOR arquivo
 * acima de 250 KB ou que não seja JPEG/PNG/WebP (com mensagem). Não aceita link externo: o servidor só aceita imagens enviadas
 * pelo próprio grupo.
 */
export function SponsorImageField({ label, value, onChange, shape = "wide", hint, disabled, error, testId = "sponsor-image" }: SponsorImageFieldProps) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const src = sponsorImageSrc(value);
  useEffect(() => setFailed(false), [src]);
  const shownError = localError ?? error;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const invalid = validateSponsorImageFile(file);
    if (invalid) {
      setLocalError(invalid);
      toast.error(invalid);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setLocalError(null);
    setUploading(true);
    try {
      onChange(await uploadSponsorImage(file));
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
            {uploading ? "Enviando…" : value ? "Trocar imagem" : "Enviar imagem"}
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
          `JPEG, PNG ou WebP, até ${String(SPONSOR_IMAGE_MAX_BYTES / 1024)} KB (recomendado ${String(SPONSOR_IMAGE_RECOMMENDED.width)}×${String(SPONSOR_IMAGE_RECOMMENDED.height)} px).`}
      </p>
      {shownError && (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {shownError}
        </p>
      )}
    </div>
  );
}
