import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useTemplate } from "./api";
import { CertificateCanvas } from "./certificate-canvas";
import { sampleVariables, toWireLayout } from "./layout-utils";
import { PAGE_PT, type CertificateLayout, type Orientation } from "./types";

/** Miniatura de um desenho: o MESMO canvas em modo leitura. */
export function LayoutThumb({ layout, className }: { layout: CertificateLayout; className?: string }) {
  const user = useSessionUser();
  const variables = useMemo(() => sampleVariables(user?.organizationName), [user?.organizationName]);
  const wire = useMemo(() => toWireLayout(layout), [layout]);
  return <CertificateCanvas layout={wire} variables={variables} groupLogo={user?.organizationLogoUrl ?? null} className={className} />;
}

/**
 * Miniatura de um modelo salvo. A lista (GET /certificate-templates) vem SEM o desenho, então cada cartão busca o
 * modelo (GET /certificate-templates/:id, em cache) para desenhar a miniatura.
 */
export function TemplateThumb({ id, orientation, className }: { id: number; orientation: Orientation; className?: string }) {
  const query = useTemplate(id);
  if (query.data) return <LayoutThumb layout={query.data.layout} {...(className ? { className } : {})} />;
  const page = PAGE_PT[orientation];
  return (
    <div
      className={cn("w-full overflow-hidden rounded-sm bg-muted/60 ring-1 ring-border", className)}
      style={{ aspectRatio: `${String(page.w)} / ${String(page.h)}` }}
      data-testid="thumb-fallback"
      role="img"
      aria-label={query.error ? "Miniatura indisponível" : "Carregando miniatura"}
    >
      {!query.error && <Skeleton className="size-full rounded-none" />}
    </div>
  );
}
