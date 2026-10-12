import { initials, toDate } from "@/lib/format";
import { PLACE_META, dateBadge, type MapPlace, type PlaceType } from "@/lib/map";
import { imageSrc } from "@/lib/uploads";

/**
 * Construção dos marcadores (DOM e SVG puros, sem Google): o pin HTML do AdvancedMarkerElement e o
 * ícone SVG do marcador clássico (fallback quando não há Map ID). Todo texto de usuário entra por
 * textContent / escape de XML — nunca por innerHTML.
 */

/* Glifos 24x24 (traço branco) — constantes estáticas, sem dados de usuário. */
const GLYPH_CLOCK = '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/>';
// Berimbau: arco, corda e cabaça.
const GLYPH_RODA =
  '<path d="M8 3C3.2 9 3.2 15 8 21"/><path d="M8 3v18"/><path d="M8 15.5h3.6"/><circle cx="16" cy="15.5" r="4.3" fill="#fff" stroke="none"/><path d="M13.5 4.5l5 7"/>';
const GLYPH_PIN =
  '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>';

function glyphSvg(glyph: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${glyph}</svg>`;
}

const GLYPH_BY_TYPE: Record<Exclude<PlaceType, "EVENT">, string> = {
  UNIT: GLYPH_PIN,
  CLASS: GLYPH_CLOCK,
  RODA: GLYPH_RODA,
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Logo do grupo em círculo; sem logo (ou se a imagem falhar) cai nas iniciais. */
function logoNode(place: MapPlace, className: string): HTMLElement {
  const wrap = el("span", className);
  const fallback = () => {
    wrap.textContent = initials(place.organization.name);
    wrap.classList.add("is-initials");
  };
  if (place.organization.logoUrl) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.src = imageSrc(place.organization.logoUrl);
    img.addEventListener("error", () => {
      img.remove();
      fallback();
    });
    wrap.appendChild(img);
  } else {
    fallback();
  }
  return wrap;
}

/** Texto acessível do pin ("Evento: Batizado 2026 — Grupo X"). */
export function markerLabel(place: MapPlace): string {
  return `${PLACE_META[place.type].singular}: ${place.title}${place.type === "UNIT" ? "" : ` — ${place.organization.name}`}`;
}

/**
 * Pin HTML por tipo: grupo = logo em círculo com borda verde; evento = cartão com dia/mês; roda =
 * berimbau; treino = relógio. Eventos/rodas/treinos levam o logo do grupo num selinho no canto.
 */
export function createPinElement(
  place: MapPlace,
  options: { highlightMine?: boolean } = {},
): HTMLElement {
  const meta = PLACE_META[place.type];
  const root = el("div", `gm-pin gm-pin-${place.type.toLowerCase()}`);
  root.style.setProperty("--pin", meta.color);
  if (place.isMine && options.highlightMine !== false) root.classList.add("is-mine");
  root.setAttribute("role", "button");
  root.tabIndex = 0;
  root.setAttribute("aria-label", markerLabel(place));
  root.title = place.title;

  const badge = el("span", "gm-pin-badge");
  if (place.type === "UNIT") {
    badge.appendChild(logoNode(place, "gm-pin-logo"));
  } else if (place.type === "EVENT") {
    const date = dateBadge(place, toDate);
    badge.appendChild(el("span", "gm-pin-month", date?.month ?? "EVENTO"));
    badge.appendChild(el("strong", "gm-pin-day", date?.day ?? "•"));
  } else {
    const icon = el("span", "gm-pin-glyph");
    icon.innerHTML = glyphSvg(GLYPH_BY_TYPE[place.type], 22);
    badge.appendChild(icon);
  }
  root.appendChild(badge);
  if (place.type !== "UNIT") root.appendChild(logoNode(place, "gm-pin-mini"));
  root.appendChild(el("span", "gm-pin-tail"));
  return root;
}

/** Cluster: círculo verde com contador; cresce (com teto) e escurece com a quantidade. */
export function createClusterElement(count: number, large: boolean): HTMLElement {
  const root = el(
    "div",
    `gm-cluster${large ? " is-large" : ""}`,
    count > 999 ? "999+" : String(count),
  );
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", `${count} locais agrupados`);
  const size = Math.min(60, 38 + Math.round(Math.log10(Math.max(1, count)) * 12));
  root.style.width = `${size}px`;
  root.style.height = `${size}px`;
  return root;
}

/* ---------- Fallback: marcador clássico com ícone SVG (sem Map ID) ---------- */

const escapeXml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c,
  );

const dataUrl = (svg: string) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

export interface ClassicIcon {
  url: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

/** Ícone SVG do pin clássico: gota colorida + glifo (relógio/berimbau), dia/mês (evento) ou iniciais (grupo). */
export function classicPinIcon(place: MapPlace, selected = false): ClassicIcon {
  const color = PLACE_META[place.type].color;
  const scale = selected ? 1.25 : 1;
  const width = Math.round(40 * scale);
  const height = Math.round(52 * scale);
  let inner: string;
  if (place.type === "EVENT") {
    const date = dateBadge(place, toDate);
    inner =
      `<text x="20" y="14.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="${color}">${escapeXml(date?.month ?? "EVT")}</text>` +
      `<text x="20" y="28" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="800" fill="#1d2b24">${escapeXml(date?.day ?? "•")}</text>`;
  } else if (place.type === "UNIT") {
    inner = `<text x="20" y="25.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="800" fill="${color}">${escapeXml(initials(place.organization.name))}</text>`;
  } else {
    // O glifo é branco; aqui vai sobre um círculo da cor do tipo.
    inner = `<circle cx="20" cy="19" r="12.5" fill="${color}"/><g transform="translate(8.5 7.5) scale(0.95)" stroke="#fff" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH_BY_TYPE[place.type]}</g>`;
  }
  const ring = place.isMine ? "#e8b923" : "#ffffff";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 40 52">` +
    `<path d="M20 50C20 50 3 33 3 19a17 17 0 0 1 34 0c0 14-17 31-17 31z" fill="${color}" stroke="${ring}" stroke-width="2"/>` +
    `<circle cx="20" cy="19" r="14" fill="#fff"/>${inner}</svg>`;
  return { url: dataUrl(svg), width, height, anchorX: width / 2, anchorY: height - 1 };
}

export function classicClusterIcon(count: number): ClassicIcon {
  const size = Math.min(64, 40 + Math.round(Math.log10(Math.max(1, count)) * 12));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="31" fill="#1b5e43" fill-opacity=".22"/><circle cx="32" cy="32" r="23" fill="#1b5e43" stroke="#fff" stroke-width="2.5"/>` +
    `<text x="32" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="${count > 99 ? 15 : 18}" font-weight="800" fill="#fff">${count > 999 ? "999+" : count}</text></svg>`;
  return { url: dataUrl(svg), width: size, height: size, anchorX: size / 2, anchorY: size / 2 };
}
