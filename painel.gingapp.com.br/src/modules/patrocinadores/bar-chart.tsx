import { formatInt } from "./sponsor-utils";

interface BarChartProps {
  title: string;
  points: ReadonlyArray<{ label: string; value: number }>;
  /** Classe de texto do Tailwind: a barra usa currentColor. */
  colorClass: string;
  testId: string;
}

const WIDTH = 640;
const HEIGHT = 160;
const LEFT = 36;
const BOTTOM = 18;
const TOP = 8;

/** Gráfico de barras simples em SVG (sem biblioteca). Cada barra tem <title> com o valor; a tabela equivalente fica ao lado. */
export function BarChart({ title, points, colorClass, testId }: BarChartProps) {
  const max = Math.max(0, ...points.map((p) => p.value));
  const innerW = WIDTH - LEFT;
  const innerH = HEIGHT - BOTTOM - TOP;
  const slot = innerW / Math.max(1, points.length);
  const barW = Math.max(1, Math.min(28, slot * 0.7));
  const n = points.length;
  const tickIdx = n === 0 ? [] : Array.from(new Set([0, Math.floor((n - 1) / 2), n - 1]));
  const summary = `${title}: ${String(n)} dias, máximo de ${formatInt(max)} em um dia.`;

  return (
    <figure className="m-0" data-testid={testId}>
      <figcaption className="mb-1 text-sm font-medium">{title}</figcaption>
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className={`h-auto w-full ${colorClass}`}
        role="img"
        aria-label={summary}
        preserveAspectRatio="xMidYMid meet"
      >
        <line x1={LEFT} x2={WIDTH} y1={TOP + innerH} y2={TOP + innerH} stroke="#94a3b8" strokeWidth={1} />
        <line x1={LEFT} x2={WIDTH} y1={TOP} y2={TOP} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="3 3" />
        <text x={LEFT - 4} y={TOP + 4} textAnchor="end" fontSize={10} fill="#475569">
          {formatInt(max)}
        </text>
        <text x={LEFT - 4} y={TOP + innerH} textAnchor="end" fontSize={10} fill="#475569">
          0
        </text>
        {points.map((p, i) => {
          const h = max > 0 ? (p.value / max) * innerH : 0;
          return (
            <rect
              key={p.label}
              x={LEFT + i * slot + (slot - barW) / 2}
              y={TOP + innerH - h}
              width={barW}
              height={h}
              fill="currentColor"
              rx={1.5}
              data-value={p.value}
            >
              <title>{`${p.label}: ${formatInt(p.value)}`}</title>
            </rect>
          );
        })}
        {tickIdx.map((i) => (
          <text key={i} x={LEFT + i * slot + slot / 2} y={HEIGHT - 4} textAnchor="middle" fontSize={10} fill="#475569">
            {points[i]?.label}
          </text>
        ))}
      </svg>
    </figure>
  );
}
