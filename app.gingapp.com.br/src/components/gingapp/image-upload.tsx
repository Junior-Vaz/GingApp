import { useState } from "react";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/photo/photo-picker";
import { errorMessage } from "@/lib/api";
import { imageSrc, isImageRef, uploadImage } from "@/lib/uploads";

/**
 * Envio de imagem pelo app com `PhotoPicker`: foto de pessoa (`square`) = enviar ou tirar na hora + recorte; capa (`wide`) =
 * só compressão. A imagem sai do aparelho já reduzida (WebP, até ~400 KB), então o limite de 5 MB deixou de aparecer para
 * quem escolhe uma foto grande do celular. O fluxo de dados é o de sempre: POST /uploads e `onChange` recebe o caminho
 * `/api/uploads/...`. Fica acima do campo de URL manual (opcional), que continua existindo; "Remover" limpa o valor.
 */
export function ImageUploadControl({
  value,
  onChange,
  label,
  shape = "square",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Texto do título e da pré-visualização: "foto", "foto de capa". */
  label: string;
  shape?: "square" | "wide";
}) {
  const [uploading, setUploading] = useState(false);
  /** A imagem recém-preparada fica na tela enquanto envia; se o envio falhar volta a foto anterior (e um aviso). */
  const [pending, setPending] = useState<Blob | null>(null);
  const current = value.trim();
  const stored = current !== "" && isImageRef(current) ? imageSrc(current) : null;

  async function handlePhoto(photo: Blob | null) {
    if (photo === null) {
      setPending(null);
      onChange("");
      return;
    }
    setPending(photo);
    setUploading(true);
    try {
      onChange(await uploadImage(photo));
      setPending(null);
    } catch (error) {
      setPending(null);
      toast.error(errorMessage(error, "Não foi possível enviar a imagem. Tente novamente."));
    } finally {
      setUploading(false);
    }
  }

  const title = shape === "wide" ? "Imagem de capa" : "Foto do perfil";
  return (
    <div className="mb-2 mt-4" data-testid={`upload-${label}`}>
      <PhotoPicker
        label={title}
        previewAlt={`Pré-visualização: ${label}`}
        value={pending ?? stored}
        onChange={(photo) => void handlePhoto(photo)}
        shape={shape}
        camera={shape === "square"}
        busy={uploading}
        description={shape === "wide" ? "A imagem é reduzida automaticamente antes do envio." : "Escolha da galeria ou tire agora; você ajusta o enquadramento antes de enviar."}
      />
    </div>
  );
}
