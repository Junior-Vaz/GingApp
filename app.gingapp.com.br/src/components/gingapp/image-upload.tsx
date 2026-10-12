import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { UPLOAD_ACCEPT, imageSrc, isImageRef, uploadImage, validateImageFile } from "@/lib/uploads";

/**
 * Envio de imagem pelo app (POST /uploads: JPEG/PNG/WebP até 5 MB) com pré-visualização. Fica acima do
 * campo de URL manual (opcional), que continua existindo. `onChange` recebe o caminho `/api/uploads/...`.
 */
export function ImageUploadControl({
  value,
  onChange,
  label,
  shape = "square",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Texto do botão e da pré-visualização: "foto", "foto de capa". */
  label: string;
  shape?: "square" | "wide";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [failedSrc, setFailedSrc] = useState("");
  const src = imageSrc(value.trim());
  const showPreview = value.trim() !== "" && isImageRef(value.trim()) && failedSrc !== src;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setUploading(true);
    try {
      onChange(await uploadImage(file));
    } catch (error) {
      toast.error(errorMessage(error, "Não foi possível enviar a imagem. Tente novamente."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="mb-2 flex items-center gap-3" data-testid={`upload-${label}`}>
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 ${
          shape === "wide" ? "h-20 w-36" : "size-20"
        }`}
      >
        {showPreview ? (
          <img src={src} alt={`Pré-visualização: ${label}`} className="size-full object-cover" onError={() => setFailedSrc(src)} />
        ) : (
          <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        aria-label={`Arquivo de ${label}`}
        tabIndex={-1}
        disabled={uploading}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
        {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
        {uploading ? "Enviando…" : `Enviar ${label}`}
      </Button>
    </div>
  );
}
