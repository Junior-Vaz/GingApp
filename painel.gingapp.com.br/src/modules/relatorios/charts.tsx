import type { ReactNode } from "react";

/**
 * Gráficos leves, só SVG/CSS (sem biblioteca): a página de Relatórios precisa carregar rápido, imprimir bem e não
 * depender de medidas do navegador. Cores via variáveis do tema.
 */

export interface ColumnDatum {
  label: string;
  value: number;
}

/** Colunas verticais (série temporal curta). `format` formata o valor no topo da coluna e no tooltip. */
export function ColumnChart({
  data,
  ariaLabel,
  format = (n) => String(n),
  color = "var(--primary)",
}: {
  data: ColumnDatum[];
  ariaLabel: string;
  format?: (value: number) => string;
  color?: string;
}) {
  const width = Math.max(240, data.length * 56);
  const height = 170;
  const top = 18;
  const bottom = 26;
  const plot = height - top - bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = width / Math.max(1, data.length);
  const barWidth = Math.min(36, slot * 0.6);
  return (
    <div className="overflow-x-auto">
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} className="h-44 min-w-full" style={{ width }}>
        <line x1="0" x2={width} y1={top + plot} y2={top + plot} stroke="var(--border)" />
        {data.map((d, i) => {
          const h = (d.value / max) * plot;
          const x = i * slot + (slot - barWidth) / 2;
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
              <rect x={x} y={top + plot - h} width={barWidth} height={Math.max(h, d.value > 0 ? 1 : 0)} rx="3" fill={color} />
              <text x={x + barWidth / 2} y={top + plot - h - 4} textAnchor="middle" fontSize="10" fill="var(--foreground)">
                {d.value > 0 ? format(d.value) : ""}
              </text>
              <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface StackPart {
  key: string;
  label: string;
  color: string;
}

/** Colunas empilhadas (ex.: financeiro por mês: recebido / a receber / em atraso). */
export function StackedColumnChart({
  data,
  parts,
  ariaLabel,
  format = (n) => String(n),
}: {
  data: Array<{ label: string; values: Record<string, number> }>;
  parts: StackPart[];
  ariaLabel: string;
  format?: (value: number) => string;
}) {
  const width = Math.max(240, data.length * 64);
  const height = 190;
  const top = 12;
  const bottom = 26;
  const plot = height - top - bottom;
  const totals = data.map((d) => parts.reduce((sum, p) => sum + (d.values[p.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const slot = width / Math.max(1, data.length);
  const barWidth = Math.min(40, slot * 0.6);
  return (
    <div>
      <div className="overflow-x-auto">
        <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} className="h-48 min-w-full" style={{ width }}>
          <line x1="0" x2={width} y1={top + plot} y2={top + plot} stroke="var(--border)" />
          {data.map((d, i) => {
            const x = i * slot + (slot - barWidth) / 2;
            let y = top + plot;
            return (
              <g key={d.label}>
                <title>{`${d.label}: ${parts.map((p) => `${p.label} ${format(d.values[p.key] ?? 0)}`).join(" · ")}`}</title>
                {parts.map((p) => {
                  const h = ((d.values[p.key] ?? 0) / max) * plot;
                  y -= h;
                  return h > 0 ? <rect key={p.key} x={x} y={y} width={barWidth} height={h} fill={p.color} /> : null;
                })}
                <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <Legend parts={parts} />
    </div>
  );
}

export function Legend({ parts }: { parts: StackPart[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {parts.map((p) => (
        <li key={p.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
          {p.label}
        </li>
      ))}
    </ul>
  );
}

export interface BarItem {
  key: string | number;
  label: ReactNode;
  value: number;
  /** Texto à direita (padrão: o valor). */
  valueLabel?: string;
  color?: string;
}

/** Barras horizontais em CSS (ranking: por unidade, faixa etária, nível...). */
export function BarList({ items, ariaLabel, empty = "Sem dados no período." }: { items: BarItem[]; ariaLabel: string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul aria-label={ariaLabel} className="space-y-2">
      {items.map((item) => (
        <li key={item.key} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">{item.valueLabel ?? item.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color ?? "var(--primary)" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
