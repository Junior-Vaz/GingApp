import { useEffect, useId, useRef, useState } from "react";
import { ImageOff, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useFormContext, type FieldValues, type Path } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notifyError } from "@/lib/crud";
import { UPLOAD_ACCEPT, imageSrc, isImageRef, uploadImage, validateImageFile } from "@/lib/uploads";
import { cn } from "@/lib/utils";

interface ImageUploaderProps {
  value: string;
  onChange: (value: string) => void;
  /** Rótulo do campo (liga ao campo de URL manual). */
  label: string;
  description?: string;
  /** Texto alternativo da pré-visualização. */
  previewAlt?: string;
  /** "wide" = capa (faixa larga); "square" = foto/logo. */
  shape?: "wide" | "square";
  disabled?: boolean;
  invalid?: boolean;
}

/**
 * Campo de imagem reutilizável: botão "Enviar imagem" (POST /uploads, JPEG/PNG/WebP até 5 MB) com
 * pré-visualização e "Remover", e o campo de URL manual continua disponível (opcional) logo abaixo.
 * O valor é uma string: o caminho `/api/uploads/<arquivo>` devolvido pelo envio ou uma URL http(s).
 */
export function ImageUploader({
  value,
  onChange,
  label,
  description,
  previewAlt = "Pré-visualização da imagem",
  shape = "wide",
  disabled,
  invalid,
}: ImageUploaderProps) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = imageSrc(value.trim());
  const showPreview = value.trim() !== "" && isImageRef(value.trim());
  useEffect(() => setFailed(false), [src]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const invalidFile = validateImageFile(file);
    if (invalidFile) return notifyError(new Error(invalidFile), invalidFile);
    setUploading(true);
    try {
      onChange(await uploadImage(file));
    } catch (error) {
      notifyError(error, "Não foi possível enviar a imagem. Tente novamente.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = ""; // permite escolher o mesmo arquivo de novo
    }
  }

  return (
    <div className="space-y-2" data-testid="image-uploader">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex flex-wrap items-start gap-3">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40",
            shape === "wide" ? "h-28 w-full sm:w-52" : "size-24",
          )}
        >
          {showPreview && !failed ? (
            <img src={src} alt={previewAlt} className="size-full object-cover" onError={() => setFailed(true)} />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            aria-label="Escolher arquivo de imagem"
            data-testid="image-file-input"
            tabIndex={-1}
            disabled={disabled || uploading}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
            {uploading ? "Enviando…" : value ? "Trocar imagem" : "Enviar imagem"}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" disabled={disabled || uploading} onClick={() => onChange("")}>
              <Trash2 /> Remover
            </Button>
          )}
        </div>
      </div>
      {showPreview && failed && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="image-failed">
          <ImageOff className="size-4" /> Não foi possível carregar a imagem.
        </p>
      )}
      <Input
        id={inputId}
        placeholder="ou cole o link: https://..."
        inputMode="url"
        value={value}
        aria-invalid={invalid || undefined}
        disabled={disabled || uploading}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {description ?? "Opcional. JPEG, PNG ou WebP até 5 MB, ou o link de uma imagem já hospedada."}
      </p>
    </div>
  );
}

interface ImageUploadFormFieldProps<T extends FieldValues> extends Omit<ImageUploaderProps, "value" | "onChange" | "invalid"> {
  name: Path<T>;
}

/** `ImageUploader` ligado a um campo (string) do react-hook-form, com a mensagem de erro do schema. */
export function ImageUploadField<T extends FieldValues>({ name, ...props }: ImageUploadFormFieldProps<T>) {
  const form = useFormContext<T>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          <ImageUploader
            {...props}
            value={typeof field.value === "string" ? field.value : ""}
            onChange={(v) => field.onChange(v)}
            invalid={!!fieldState.error}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
