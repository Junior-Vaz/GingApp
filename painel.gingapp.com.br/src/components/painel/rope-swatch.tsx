import { useId } from "react";
import { cn } from "@/lib/utils";
import { HEX_COLOR, NO_COLOR, TIP_RATIO, ropeLabel, validTip, type RopeStyle } from "@/lib/rope";

type Size = "sm" | "md" | "lg";
/** [lado curto, lado longo] em px da corda na vertical. */
const DIMENSIONS: Record<Size, [number, number]> = { sm: [10, 34], md: [18, 64], lg: [36, 150] };

interface RopeSwatchProps {
  style: RopeStyle;
  colors: string[];
  /** Ponta de CIMA/primeira (#RRGGBB): trecho de ~20% do comprimento na extremidade, sem sobrepor o padrão do corpo. */
  tipStart?: string | null | undefined;
  /** Ponta de BAIXO/última (#RRGGBB). Independente de 	ipStart (pode haver só uma). */
  tipEnd?: string | null | undefined;
  orientation?: "vertical" | "horizontal";
  size?: Size;
  /** Brilho/sombra sutil de corda cilíndrica (padrão: ligado). */
  shine?: boolean;
  /** Oculta do leitor de tela (use quando o nome da corda já está escrito ao lado). */
  decorative?: boolean;
  className?: string;
}

/**
 * Corda desenhada em SVG a partir de { style, colors }:
 * SOLID = cor cheia; SPLIT = faixas iguais ao longo da corda (2 ou 3 cores); BRAIDED = listras diagonais
 * repetidas (corda trançada, 2 ou 3 cores alternadas). Corda COM PONTAS: 	ipStart/	ipEnd pintam as duas
 * extremidades (~20% do comprimento cada, TIP_RATIO) numa cor própria; o corpo (style/colors) ocupa só o trecho
 * entre as pontas, e um fio fino separa ponta e corpo. Só as extremidades externas são arredondadas (clipPath).
 * Ids de pattern/clipPath/gradient únicos por useId.
 */
export function RopeSwatch({
  style,
  colors,
  tipStart,
  tipEnd,
  orientation = "vertical",
  size = "md",
  shine = true,
  decorative = false,
  className,
}: RopeSwatchProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [short, long] = DIMENSIONS[size];
  const palette = colors.length > 0 ? colors.map((c) => (HEX_COLOR.test(c) ? c : NO_COLOR)) : [NO_COLOR];
  const radius = Math.min(short * 0.38, 7);
  const horizontal = orientation === "horizontal";
  const svgWidth = horizontal ? long : short;
  const svgHeight = horizontal ? short : long;
  const clipId = `${uid}-clip`;
  const braidId = `${uid}-braid`;
  const shineId = `${uid}-shine`;
  const stripe = Math.max(2.4, short * 0.34); // espessura (perpendicular) de cada listra trançada
  const count = palette.length;
  const startColor = validTip(tipStart);
  const endColor = validTip(tipEnd);
  const tipLength = Math.round(long * TIP_RATIO * 10) / 10;
  const bodyTop = startColor ? tipLength : 0;
  const bodyBottom = endColor ? long - tipLength : long;
  const bodyHeight = bodyBottom - bodyTop;

  const body =
    style === "BRAIDED" && count > 1 ? (
      <>
        <defs>
          <pattern
            id={braidId}
            patternUnits="userSpaceOnUse"
            width={stripe * count}
            height={stripe * count}
            patternTransform="rotate(-60)"
          >
            {palette.map((color, index) => (
              <rect key={index} data-stripe="" x={index * stripe} y={0} width={stripe} height={stripe * count} fill={color} />
            ))}
          </pattern>
        </defs>
        <rect data-braid="" x={0} y={bodyTop} width={short} height={bodyHeight} fill={`url(#${braidId})`} />
      </>
    ) : style === "SPLIT" && count > 1 ? (
      palette.map((color, index) => (
        <rect key={index} data-stripe="" x={(short / count) * index} y={bodyTop} width={short / count + 0.4} height={bodyHeight} fill={color} />
      ))
    ) : (
      <rect data-stripe="" x={0} y={bodyTop} width={short} height={bodyHeight} fill={palette[0]} />
    );

  const tips = (
    <>
      {startColor && <rect data-tip="start" x={0} y={0} width={short} height={tipLength} fill={startColor} />}
      {endColor && <rect data-tip="end" x={0} y={bodyBottom} width={short} height={tipLength} fill={endColor} />}
      {startColor && (
        <line data-tip-divider="" x1={0} x2={short} y1={bodyTop} y2={bodyTop} stroke="#000" strokeOpacity={0.35} strokeWidth={1} />
      )}
      {endColor && (
        <line data-tip-divider="" x1={0} x2={short} y1={bodyBottom} y2={bodyBottom} stroke="#000" strokeOpacity={0.35} strokeWidth={1} />
      )}
    </>
  );

  return (
    <svg
      data-rope=""
      data-style={style}
      data-tips={startColor || endColor ? "" : undefined}
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : ropeLabel({ style, colors, tipStart: startColor, tipEnd: endColor })}
      aria-hidden={decorative ? true : undefined}
      className={cn("shrink-0", className)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={short} height={long} rx={radius} />
        </clipPath>
        <linearGradient id={shineId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.2" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.24" />
        </linearGradient>
      </defs>
      <g transform={horizontal ? `translate(${long} 0) rotate(90)` : undefined}>
        <g clipPath={`url(#${clipId})`}>
          {body}
          {tips}
          {shine && <rect data-shine="" x={0} y={0} width={short} height={long} fill={`url(#${shineId})`} />}
        </g>
        <rect x={0.5} y={0.5} width={short - 1} height={long - 1} rx={radius} fill="none" stroke="#000" strokeOpacity={0.28} />
      </g>
    </svg>
  );
}
