import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { initials } from "@/lib/format";
import { imageSrc } from "@/lib/uploads";
import { cn } from "@/lib/utils";

/**
 * Miniatura redonda de uma turma / unidade / professor / aluno. Mostra a foto (`photo`: caminho de /uploads ou URL
 * http(s)); sem foto — ou se a imagem falhar ao carregar — cai para o `icon` (logo/ícone da entidade) ou, sem ele,
 * para as iniciais do nome. Decorativa: o nome sempre aparece em texto ao lado, por isso a imagem não tem `alt`.
 */
export function EntityAvatar({
  name,
  photo,
  icon: Icon,
  className,
}: {
  name: string;
  photo?: string | null | undefined;
  icon?: LucideIcon | undefined;
  className?: string | undefined;
}) {
  const src = imageSrc(photo?.trim());
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <span
      data-testid="entity-avatar"
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xs font-bold text-primary",
        className,
      )}
    >
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : Icon ? (
        <Icon className="size-1/2" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
