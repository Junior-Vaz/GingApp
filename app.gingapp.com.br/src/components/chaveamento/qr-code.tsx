import { useMemo } from "react";
import QRCode from "qrcode";

/**
 * QR do link do telão, desenhado como SVG a partir da matriz de módulos da lib `qrcode` (sem canvas e sem HTML injetado).
 * Falha ao gerar (texto grande demais etc.) = não mostra nada.
 */
export function QrCode({ value, size = 96, label }: { value: string; size?: number; label: string }) {
  const cells = useMemo(() => {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
      const n = qr.modules.size;
      const data = qr.modules.data;
      const out: string[] = [];
      for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) if (data[y * n + x]) out.push(`M${x} ${y}h1v1h-1z`);
      }
      return { n, d: out.join("") };
    } catch {
      return null;
    }
  }, [value]);
  if (!cells) return null;
  const quiet = 2;
  const box = cells.n + quiet * 2;
  return (
    <svg className="cv-qr" width={size} height={size} viewBox={`${-quiet} ${-quiet} ${box} ${box}`} role="img" aria-label={label} shapeRendering="crispEdges" data-testid="cv-qr">
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#fff" />
      <path d={cells.d} fill="#000" />
    </svg>
  );
}
