import type { CSSProperties } from "react";

import { initials } from "@/lib/format";
import { useImage } from "@/lib/use-image";

/** Cores de fundo das iniciais (todas escuras o bastante para texto branco, contraste >= 4.5). */
const INITIALS_COLORS = ["#1b5e43", "#2f6f8f", "#8a4f9e", "#b0533a", "#6b7a1f", "#a1455f", "#46628c", "#7a5a2b"];

/** Cor ESTÁVEL por nome (mesmo nome = mesma cor, em qualquer tela). */
function initialsColor(name: string | null | undefined): string {
  const text = (name ?? "").trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return INITIALS_COLORS[hash % INITIALS_COLORS.length] ?? "#1b5e43";
}


export interface AvatarProps {
  /** Nome da pessoa (iniciais, cor estável e rótulo de acessibilidade). */
  name: string | null | undefined;
  /** Foto (URL http(s) ou caminho de upload `/api/uploads/...`). Vazia/quebrada = iniciais. */
  src?: string | null | undefined;
  /** Diâmetro em px (número) ou qualquer valor CSS (ex.: `var(--size)`). */
  size?: number | string;
  /** Anel colorido ao redor (liga do ranking). */
  ringColor?: string | undefined;
  /** Moldura metálica do pódio (usa `--frame` do contêiner). */
  frame?: boolean;
  /** Selo do grupo no canto inferior direito: aparece se houver logo OU nome do grupo. */
  groupLogoUrl?: string | null | undefined;
  groupName?: string | null | undefined;
  /** Avatar só decorativo (o nome já está escrito ao lado): fica fora da árvore de acessibilidade. */
  decorative?: boolean;
  className?: string;
  /** Rótulo de acessibilidade próprio (padrão: "Foto de <nome>, grupo <grupo>"). */
  label?: string;
  /** Letras do selo sem logo (padrão: 2 em avatares >= 56px, senão 1; com `size` em CSS, 1). */
  badgeLetters?: 1 | 2;
  title?: string;
}

/** Selo redondo do grupo (logo; sem logo ou com imagem quebrada, iniciais do grupo). */
function GroupBadge({ name, logoUrl, large }: { name: string | null | undefined; logoUrl: string | null | undefined; large: boolean }) {
  const image = useImage(logoUrl);
  const label = initials(name);
  return (
    <span className="gx-av-badge" data-testid="avatar-group-badge" style={image.src ? undefined : { background: initialsColor(name) }}>
      {image.src ? (
        <img src={image.src} alt="" loading="lazy" onError={image.onError} />
      ) : (
        <span className="gx-av-badge-ini">{large ? label : label.slice(0, 1)}</span>
      )}
    </span>
  );
}

/**
 * Avatar ÚNICO do app: foto (com fallback para iniciais coloridas e estáveis se faltar ou falhar), anel opcional
 * (liga do ranking / moldura do pódio) e selo redondo do grupo sobreposto no canto inferior direito (~38% do diâmetro).
 * O selo só existe quando há dado do grupo.
 */
export function Avatar({
  name,
  src,
  size = 40,
  ringColor,
  frame = false,
  groupLogoUrl,
  groupName,
  decorative = false,
  className = "",
  label: customLabel,
  badgeLetters,
  title,
}: AvatarProps) {
  const photo = useImage(src);
  const hasGroup = Boolean(groupLogoUrl) || Boolean(groupName?.trim());
  const person = (name ?? "").trim();
  const label = customLabel ?? [photo.src ? `Foto de ${person || "usuário"}` : person || "Usuário", hasGroup && groupName ? `grupo ${groupName}` : ""]
    .filter(Boolean)
    .join(", ");
  const style = {
    "--av": typeof size === "number" ? `${size}px` : size,
    ...(ringColor ? { "--ring": ringColor } : {}),
  } as CSSProperties;
  const kind = frame ? "has-frame" : ringColor ? "has-ring" : "";

  return (
    <span
      className={`gx-av ${kind} ${className}`.trim()}
      style={style}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      title={title}
      data-testid="avatar"
    >
      <span className="gx-av-disc" style={photo.src ? undefined : { background: initialsColor(name) }}>
        {photo.src ? (
          <img src={photo.src} alt="" loading="lazy" onError={photo.onError} />
        ) : (
          <span className="gx-av-ini">{initials(name)}</span>
        )}
      </span>
      {hasGroup && <GroupBadge name={groupName} logoUrl={groupLogoUrl} large={(badgeLetters ?? (typeof size === "number" && size >= 56 ? 2 : 1)) === 2} />}
    </span>
  );
}
