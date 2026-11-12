import { useEffect, useState } from "react";
import { initials } from "@/lib/format";
import { imageSrc } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { initialsBackground, ringColorForGroup } from "./colors";
import { isAcceptablePhotoUrl } from "./helpers";

const SIZE: Record<"xs" | "sm" | "md" | "lg" | "xl", string> = {
  xs: "size-6 text-[9px]",
  sm: "size-8 text-[11px]",
  md: "size-10 text-xs",
  lg: "size-12 text-sm",
  xl: "size-16 text-lg",
};

interface CompetitorPhotoProps {
  name: string;
  photoUrl: string | null;
  /** Grupo do atleta: dá a cor do anel e do fundo das iniciais. */
  group?: string | null | undefined;
  /** Id do atleta (cor estável das iniciais quando não há grupo). */
  id?: number | undefined;
  size?: keyof typeof SIZE | undefined;
  /** Anel na cor do grupo (padrão: ligado). */
  ring?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Avatar do atleta, no padrão do telão: anel na cor do grupo e iniciais com gradiente do grupo quando não há foto.
 * SEGURANÇA: a URL só entra num `<img src>` se for `https://` ou um upload do GingApp (nunca `javascript:`/`data:`),
 * com `referrerPolicy="no-referrer"` (não vaza o endereço do painel) e `alt` vazio (o nome já aparece em texto ao
 * lado). Sem foto aceita, ou se a imagem falhar, mostra as iniciais.
 */
export function CompetitorPhoto({ name, photoUrl, group, id, size = "md", ring = true, className }: CompetitorPhotoProps) {
  const src = isAcceptablePhotoUrl(photoUrl) ? imageSrc(photoUrl) : "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showImage = src !== "" && !failed;
  return (
    <span
      aria-hidden="true"
      data-testid="competitor-photo"
      style={{
        ...(showImage ? {} : { background: initialsBackground(id ?? 0, group) }),
        ...(ring ? { boxShadow: `0 0 0 2px var(--card), 0 0 0 4px ${ringColorForGroup(group)}` } : {}),
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary font-extrabold tracking-tight text-white",
        SIZE[size],
        className,
      )}
    >
      {showImage ? (
        <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
