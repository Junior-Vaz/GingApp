import { useId, useState } from "react";
import { useFormContext, type FieldValues, type Path } from "react-hook-form";
import { PhotoPicker } from "@/components/photo/photo-picker";
import { FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notifyError } from "@/lib/crud";
import { DEFAULT_MAX_BYTES } from "@/lib/photo/types";
import { imageSrc, isImageRef, uploadImage } from "@/lib/uploads";

/** Teto do arquivo de logo/capa/banner depois da compressão (maior que o de rosto: tem mais detalhe e texto). */
export const WIDE_IMAGE_MAX_BYTES = 800 * 1024;

interface ImageUploaderProps {
  value: string;
  onChange: (value: string) => void;
  /** Rótulo do campo. */
  label: string;
  description?: string;
  /** Texto alternativo da pré-visualização. */
  previewAlt?: string;
  /**
   * `square` = FOTO DE PESSOA (aluno, professor): câmera + recorte quadrado, sem link manual.
   * `wide` (padrão) = logo/capa/banner: só compressão antes do envio, com o link manual opcional.
   */
  shape?: "wide" | "square";
  disabled?: boolean;
  invalid?: boolean;
}

/**
 * Campo de imagem reutilizável, em cima do `PhotoPicker`: a imagem é preparada NO NAVEGADOR (recorte e/ou compressão, o
 * que acaba com o 413/5 MB) e enviada por POST /uploads como `foto.webp`. O valor continua sendo uma string: o caminho
 * `/api/uploads/<arquivo>` devolvido pelo envio (ou, só em `wide`, uma URL http(s) colada no campo de link).
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
  const linkId = useId();
  const [uploading, setUploading] = useState(false);
  const person = shape === "square";
  const current = value.trim();
  const shown = current !== "" && isImageRef(current) ? imageSrc(current) : null;

  async function handlePhoto(photo: Blob | null) {
    if (photo === null) {
      onChange("");
      return;
    }
    setUploading(true);
    try {
      onChange(await uploadImage(photo));
    } catch (error) {
      notifyError(error, "Não foi possível enviar a imagem. Tente novamente.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2" data-testid="image-uploader">
      <PhotoPicker
        value={shown}
        onChange={(photo) => void handlePhoto(photo)}
        shape={shape}
        camera={person}
        label={label}
        previewAlt={previewAlt}
        busy={uploading}
        disabled={disabled}
        invalid={invalid}
        maxBytes={person ? DEFAULT_MAX_BYTES : WIDE_IMAGE_MAX_BYTES}
        description={
          description ??
          (person
            ? "Opcional. Tire a foto na hora ou envie uma imagem: ela é recortada em quadrado e reduzida antes do envio."
            : "Opcional. Envie uma imagem (ela é reduzida automaticamente) ou cole o link de uma imagem já hospedada.")
        }
      />
      {!person && (
        <div className="space-y-1">
          <Label htmlFor={linkId} className="sr-only">
            Link da imagem: {label}
          </Label>
          <Input
            id={linkId}
            placeholder="ou cole o link: https://..."
            inputMode="url"
            value={value}
            aria-invalid={invalid || undefined}
            disabled={disabled || uploading}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
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
