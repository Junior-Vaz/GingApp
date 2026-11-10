import { useEffect, useState } from "react";
import { initials } from "@/lib/format";
import { imageSrc } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { isAcceptablePhotoUrl } from "./helpers";

/**
 * Miniatura do atleta. SEGURANÇA: a URL só entra num `<img src>` se for `https://` ou um upload do GingApp (nunca
 * `javascript:`/`data:`), com `referrerPolicy="no-referrer"` (não vaza o endereço do painel) e `alt` vazio (o nome já
 * aparece em texto ao lado). Sem foto aceita, ou se a imagem falhar, mostra as iniciais.
 */
export function CompetitorPhoto({ name, photoUrl, className }: { name: string; photoUrl: string | null; className?: string }) {
  const src = isAcceptablePhotoUrl(photoUrl) ? imageSrc(photoUrl) : "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span
      aria-hidden="true"
      data-testid="competitor-photo"
      className={cn("inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xs font-bold text-primary", className)}
    >
      {src && !failed ? (
        <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
