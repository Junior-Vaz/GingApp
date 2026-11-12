import { useEffect, useMemo, useState, type ReactNode } from "react";
import { initials } from "@/lib/format";
import { useObjectUrl } from "@/lib/photo/use-object-url";
import { imageSrc } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { useCompetitorPhotoBlob } from "./api";
import { initialsBackground, ringColorForGroup } from "./colors";
import { isAcceptablePhotoUrl } from "./helpers";
import { PhotoScopeContext, usePhotoScope, type PhotoScopeValue } from "./photo-scope";
import type { OperatorCompetitor } from "./types";

const SIZE: Record<"xs" | "sm" | "md" | "lg" | "xl", string> = {
  xs: "size-6 text-[9px]",
  sm: "size-8 text-[11px]",
  md: "size-10 text-xs",
  lg: "size-12 text-sm",
  xl: "size-16 text-lg",
};

/** O que identifica a foto PRÓPRIA do atleta (o resto vem do escopo da categoria). */
export type OwnPhotoRef = Pick<OperatorCompetitor, "id" | "hasOwnPhoto" | "photoVersion">;

interface CompetitorPhotoProps {
  name: string;
  /** Foto do ALUNO (`/api/uploads/...`), quando o atleta é aluno. */
  photoUrl: string | null;
  /** Atleta (para a foto PRÓPRIA, baixada com autenticação). Sem ele, só `photoUrl`. */
  own?: OwnPhotoRef | null | undefined;
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
 * SEGURANÇA: a URL do aluno só entra num `<img src>` se for `https://` ou um upload do GingApp (nunca `javascript:`/`data:`),
 * com `referrerPolicy="no-referrer"` e `alt` vazio (o nome já aparece em texto ao lado). A foto PRÓPRIA é uma rota privada:
 * baixa com o token, vira Blob URL (revogada ao desmontar) e nunca é uma URL de rede. Sem foto, ou se falhar, mostra as iniciais.
 */
export function CompetitorPhoto({ name, photoUrl, own, group, id, size = "md", ring = true, className }: CompetitorPhotoProps) {
  const scope = usePhotoScope();
  const fallback = initials(name);
  const content =
    own?.hasOwnPhoto && scope ? (
      <OwnImage own={own} scope={scope} fallback={<StudentOrInitials photoUrl={null} fallback={fallback} />} />
    ) : (
      <StudentOrInitials photoUrl={photoUrl} fallback={fallback} />
    );
  return (
    <span
      aria-hidden="true"
      data-testid="competitor-photo"
      style={{
        background: initialsBackground(id ?? 0, group),
        ...(ring ? { boxShadow: `0 0 0 2px var(--card), 0 0 0 4px ${ringColorForGroup(group)}` } : {}),
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary font-extrabold tracking-tight text-white",
        SIZE[size],
        className,
      )}
    >
      {content}
    </span>
  );
}

/** Foto do aluno por `photoUrl` (se aceitável) ou as iniciais. */
function StudentOrInitials({ photoUrl, fallback }: { photoUrl: string | null; fallback: ReactNode }) {
  const src = isAcceptablePhotoUrl(photoUrl) ? imageSrc(photoUrl) : "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src === "" || failed) return <>{fallback}</>;
  return <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />;
}

/** Foto própria: blob autenticado (cache por `photoVersion`) -> Blob URL; carregando/erro = iniciais. */
function OwnImage({ own, scope, fallback }: { own: OwnPhotoRef; scope: PhotoScopeValue; fallback: ReactNode }) {
  const query = useCompetitorPhotoBlob(scope.eventId, scope.categoryId, own.id, own.photoVersion, true);
  const url = useObjectUrl(query.data);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return <>{fallback}</>;
  return <img src={url} alt="" className="size-full object-cover" data-own-photo="true" onError={() => setFailed(true)} />;
}

/** Diz aos avatares de dentro de qual evento/categoria buscar a foto própria dos atletas. */
export function PhotoScope({ eventId, categoryId, children }: PhotoScopeValue & { children: ReactNode }) {
  const value = useMemo(() => ({ eventId, categoryId }), [eventId, categoryId]);
  return <PhotoScopeContext.Provider value={value}>{children}</PhotoScopeContext.Provider>;
}
