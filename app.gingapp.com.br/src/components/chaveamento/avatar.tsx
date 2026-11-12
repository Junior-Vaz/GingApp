import { useState, type CSSProperties } from "react";
import { initials } from "@/lib/format";
import { initialsBackground, ringColorForGroup } from "@/lib/chaveamento/colors";
import { imageSrc } from "@/lib/uploads";

export interface AvatarProps {
  /** Id do atleta (cor estável das iniciais quando não há grupo). */
  id: number;
  name: string;
  /** Foto pública: o servidor só manda quando o atleta é adulto ou tem a foto autorizada. null = iniciais. */
  photoUrl: string | null;
  /** Grupo do atleta: define o matiz do anel (e do gradiente das iniciais). Sem grupo = anel neutro. */
  group?: string | null;
  /** Diâmetro em px. */
  size?: number;
  /** Anel na cor do grupo (cartão de atleta). Padrão: sim. */
  ring?: boolean;
  /** Troca o anel por um dourado (campeão). */
  gold?: boolean;
  className?: string;
}

type InnerProps = Required<Pick<AvatarProps, "id" | "name" | "size" | "ring" | "gold">> & { photoUrl: string | null; group: string | null };

function PhotoOrInitials({ id, name, photoUrl, group, size, ring, gold }: InnerProps) {
  const [failed, setFailed] = useState(false);
  const src = photoUrl && !failed ? imageSrc(photoUrl) : "";
  const ringWidth = Math.max(2, Math.round(size * 0.065));
  const style: CSSProperties & Record<string, string | number> = {
    width: size,
    height: size,
    fontSize: Math.max(12, Math.round(size * 0.4)),
    ...(src ? {} : { background: initialsBackground(id, group) }),
  };
  if (ring) {
    style["--cv-ring"] = gold ? "#f5c542" : ringColorForGroup(group);
    style["--cv-ring-w"] = `${ringWidth}px`;
  }
  return (
    <span className="cv-avatar" data-testid="cv-avatar" data-kind={src ? "photo" : "initials"} data-ring={ring ? "1" : undefined} data-gold={gold ? "1" : undefined} style={style}>
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
 * Avatar do atleta: foto (recortada em `cover`) quando `photoUrl`; senão (ou se a imagem quebrar) as iniciais num gradiente do
 * grupo. O anel tem a cor do grupo. É decorativo (o nome sempre aparece escrito ao lado), então fica fora da árvore de acessibilidade.
 */
export function Avatar({ id, name, photoUrl, group = null, size = 32, ring = true, gold = false, className }: AvatarProps) {
  return (
    <span className={`cv-avatar-slot ${className ?? ""}`.trim()} aria-hidden="true">
      {/* `key` reinicia o estado de erro quando a foto muda. */}
      <PhotoOrInitials key={photoUrl ?? ""} id={id} name={name} photoUrl={photoUrl} group={group} size={size} ring={ring} gold={gold} />
    </span>
  );
}
