import { ImageUploadField } from "@/components/painel/image-upload-field";

/** Campo `imageUrl` da capa (roda/evento): envio de arquivo (POST /uploads) com pré-visualização + URL manual opcional. */
export function ImageUrlField() {
  return (
    <ImageUploadField<{ imageUrl: string }>
      name="imageUrl"
      label="Imagem de capa (URL)"
      previewAlt="Pré-visualização da capa"
      description="Opcional. Envie uma imagem (JPEG, PNG ou WebP até 5 MB) ou cole o link de uma imagem já hospedada."
    />
  );
}
