import { useState } from "react";
import { initials } from "@/lib/format";
import { colorForId } from "@/lib/chaveamento/colors";
import { imageSrc } from "@/lib/uploads";

export interface AvatarProps {
  /** Id do atleta (cor estável das iniciais). */
  id: number;
  name: string;
  /** Foto pública: o servidor só manda quando o atleta é adulto ou tem a foto autorizada. null = iniciais. */
  photoUrl: string | null;
  /** Diâmetro em px. */
  size?: number;
  className?: string;
}

function PhotoOrInitials({ id, name, photoUrl, size }: Required<Pick<AvatarProps, "id" | "name" | "size">> & { photoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = photoUrl && !failed ? imageSrc(photoUrl) : "";
  return (
    <span
      className="cv-avatar"
      data-testid="cv-avatar"
      data-kind={src ? "photo" : "initials"}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)), ...(src ? {} : { background: colorForId(id) }) }}
    >
      {src ? (
        // Foto de terceiro: sem referrer (a URL da página carrega o token do link) e com `alt` vazio (o nome já está escrito ao lado).
        <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}

/**
 * Avatar do atleta: foto quando `photoUrl`; senão (ou se a imagem quebrar) as iniciais numa cor estável por id.
 * É decorativo (o nome sempre aparece escrito ao lado), então fica fora da árvore de acessibilidade.
 */
export function Avatar({ id, name, photoUrl, size = 32, className }: AvatarProps) {
  return (
    <span className={`cv-avatar-slot ${className ?? ""}`.trim()} aria-hidden="true">
      {/* `key` reinicia o estado de erro quando a foto muda. */}
      <PhotoOrInitials key={photoUrl ?? ""} id={id} name={name} photoUrl={photoUrl} size={size} />
    </span>
  );
}
