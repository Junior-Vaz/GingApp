import { useEffect, useState } from "react";
import { initials } from "@/lib/format";
import { imageSrc } from "@/lib/uploads";
import { cn } from "@/lib/utils";

/**
 * Foto do aluno (`Student.photo`) em miniatura redonda; sem foto (ou se a imagem falhar ao carregar) mostra as
 * iniciais do nome. Decorativo: o nome do aluno sempre aparece em texto ao lado, por isso a imagem não tem `alt`.
 */
export function StudentAvatar({
  name,
  photo,
  className,
}: {
  name: string;
  photo?: string | null | undefined;
  className?: string;
}) {
  const src = imageSrc(photo?.trim());
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <span
      data-testid="student-avatar"
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xs font-bold text-primary",
        className,
      )}
    >
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
