import { useId } from "react";

import { normalizeRope, ROPE_TIP_RATIO, ropeLabel, type RopeSpec } from "@/lib/rope";

export type { RopeSpec, RopeStyle } from "@/lib/rope";

export interface RopeProps extends RopeSpec {
  /** vertical (padrão): comprimento = altura; horizontal: comprimento = largura. */
  orientation?: "vertical" | "horizontal";
  /** Comprimento em px (eixo da corda). */
  length?: number;
  /** Espessura em px. */
  thickness?: number;
  className?: string;
  /** Corda só decorativa (o nome já está escrito ao lado). */
  decorative?: boolean;
  /** Rótulo próprio (padrão: descrição gerada pelas cores). */
  label?: string;
}

/** Ângulo (graus) do padrão trançado: faixas a ~60° do eixo da corda, como as cordas reais. */
const BRAID_ANGLE_VERTICAL = -60;
const BRAID_ANGLE_HORIZONTAL = 30;

/**
 * Corda de capoeira desenhada em SVG: SOLID = cor cheia; SPLIT = 2/3 faixas iguais ao longo do comprimento;
 * BRAIDED = listras diagonais repetidas (trançada) alternando 2/3 cores. Opcionalmente `tipStart`/`tipEnd` pintam as
 * duas pontas (~20% do comprimento cada) por cima das extremidades, com uma linha fina separando ponta e corpo; os
 * cantos arredondados vêm do recorte externo (só nas extremidades). Brilho sutil.
 */
export function Rope({
  orientation = "vertical",
  length = 64,
  thickness = 16,
  className = "",
  decorative = false,
  label,
  ...spec
}: RopeProps) {
  const uid = useId().replace(/:/g, "");
  const rope = normalizeRope(spec);
  const vertical = orientation === "vertical";
  const w = vertical ? thickness : length;
  const h = vertical ? length : thickness;
  const radius = Math.min(thickness / 2, 8);
  const clipId = `rope-clip-${uid}`;
  const shineId = `rope-shine-${uid}`;
  const patId = `rope-braid-${uid}`;
  const n = rope.colors.length;
  // Pontas pintadas: cada uma ocupa ~20% do comprimento; o corpo (e seu padrão) só desenha no trecho do meio.
  const tipLen = Math.max(2, Math.round(length * ROPE_TIP_RATIO));
  const startLen = rope.tipStart ? tipLen : 0;
  const endLen = rope.tipEnd ? tipLen : 0;
  const bodyId = `rope-body-${uid}`;
  const bodyStart = startLen;
  const bodySize = length - startLen - endLen;
  const tipRect = (color: string, from: number, size: number, testId: string) => (
    <rect
      data-testid={testId}
      x={vertical ? 0 : from}
      y={vertical ? from : 0}
      width={vertical ? w : size}
      height={vertical ? size : h}
      fill={color}
    />
  );
  const tipLine = (at: number) => (
    <rect
      data-testid="rope-tip-line"
      x={vertical ? 0 : at - 0.5}
      y={vertical ? at - 0.5 : 0}
      width={vertical ? w : 1}
      height={vertical ? 1 : h}
      fill="#000"
      opacity={0.3}
    />
  );
  const aria = label ?? ropeLabel(spec);

  let body: React.ReactNode;
  if (rope.style === "BRAIDED") {
    // Cada cor ocupa `band` px medidos perpendicularmente às listras; o ladrilho repete a sequência.
    const band = Math.max(3, Math.round(thickness * 0.5));
    body = (
      <>
        <defs>
          <pattern
            id={patId}
            width={band * n}
            height={band * n}
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${vertical ? BRAID_ANGLE_VERTICAL : BRAID_ANGLE_HORIZONTAL})`}
          >
            {rope.colors.map((c, i) => (
              <rect key={i} x={i * band} y={0} width={band + 0.4} height={band * n} fill={c} data-testid="rope-stripe" />
            ))}
            {/* fio escuro entre faixas: dá o relevo de fios trançados */}
            {rope.colors.map((_, i) => (
              <rect key={`l${i}`} x={i * band} y={0} width={0.9} height={band * n} fill="#000" opacity={0.2} />
            ))}
          </pattern>
        </defs>
        <rect width={w} height={h} fill={`url(#${patId})`} data-testid="rope-braided" />
      </>
    );
  } else if (rope.style === "SPLIT") {
    body = rope.colors.map((c, i) => (
      <rect
        key={i}
        data-testid="rope-band"
        x={vertical ? (w / n) * i : 0}
        y={vertical ? 0 : (h / n) * i}
        width={vertical ? w / n + 0.4 : w}
        height={vertical ? h : h / n + 0.4}
        fill={c}
      />
    ));
  } else {
    body = <rect width={w} height={h} fill={rope.colors[0]} data-testid="rope-solid" />;
  }

  return (
    <svg
      className={`gx-rope ${className}`.trim()}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : aria}
      aria-hidden={decorative ? true : undefined}
      data-style={rope.style}
      data-orientation={orientation}
      data-colors={rope.colors.join(",")}
      data-tip-start={rope.tipStart ?? undefined}
      data-tip-end={rope.tipEnd ?? undefined}
      focusable="false"
    >
      <defs>
        {(startLen > 0 || endLen > 0) && (
          <clipPath id={bodyId}>
            <rect
              x={vertical ? 0 : bodyStart}
              y={vertical ? bodyStart : 0}
              width={vertical ? w : bodySize}
              height={vertical ? bodySize : h}
            />
          </clipPath>
        )}
        <clipPath id={clipId}>
          <rect width={w} height={h} rx={radius} ry={radius} />
        </clipPath>
        {/* brilho sutil: luz no centro da espessura e sombra nas bordas */}
        <linearGradient id={shineId} x1="0" y1="0" x2={vertical ? 1 : 0} y2={vertical ? 0 : 1}>
          <stop offset="0" stopColor="#000" stopOpacity="0.2" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <g clipPath={startLen > 0 || endLen > 0 ? `url(#${bodyId})` : undefined}>{body}</g>
        {rope.tipStart && tipRect(rope.tipStart, 0, startLen, "rope-tip-start")}
        {rope.tipEnd && tipRect(rope.tipEnd, length - endLen, endLen, "rope-tip-end")}
        {rope.tipStart && tipLine(startLen)}
        {rope.tipEnd && tipLine(length - endLen)}
        <rect width={w} height={h} fill={`url(#${shineId})`} />
      </g>
      <rect width={w - 1} height={h - 1} x={0.5} y={0.5} rx={radius} ry={radius} fill="none" stroke="#000" strokeOpacity="0.16" />
    </svg>
  );
}
