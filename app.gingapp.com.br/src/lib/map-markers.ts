import { initials, toDate } from "@/lib/format";
import { PLACE_META, dateBadge, type MapPlace, type PlaceType } from "@/lib/map";
import { imageSrc } from "@/lib/uploads";

/**
 * Construção dos marcadores (DOM e SVG puros, sem Google): o "pin de foto" HTML do AdvancedMarkerElement e o
 * mesmo desenho em SVG para o marcador clássico (fallback quando não há Map ID). O pin é um quadrado de cantos
 * arredondados com borda (branca; dourada em "Meu grupo"; da cor do tipo quando selecionado), a foto/logo do local
 * dentro e uma cauda triangular embaixo — a PONTA da cauda é a âncora (aponta exatamente a coordenada). Sem foto:
 * o mesmo formato sobre a cor do tipo, com iniciais (grupo), dia/mês (evento) ou o ícone do tipo (treino/roda).
 * Todo texto de usuário entra por textContent / escape de XML — nunca por innerHTML.
 */

/* Glifos 24x24 (traço branco) — constantes estáticas, sem dados de usuário. */
const GLYPH_CLOCK = '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/>';
// Berimbau: arco, corda e cabaça.
const GLYPH_RODA =
  '<path d="M8 3C3.2 9 3.2 15 8 21"/><path d="M8 3v18"/><path d="M8 15.5h3.6"/><circle cx="16" cy="15.5" r="4.3" fill="#fff" stroke="none"/><path d="M13.5 4.5l5 7"/>';
const GLYPH_CALENDAR =
  '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';

function glyphSvg(glyph: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${glyph}</svg>`;
}

const GLYPH_BY_TYPE: Record<Exclude<PlaceType, "EVENT" | "UNIT">, string> = {
  CLASS: GLYPH_CLOCK,
  RODA: GLYPH_RODA,
};

/** Selo do tipo (mini ícone no canto do pin com foto): o grupo é o pin "puro", sem selo. */
const GLYPH_SEAL: Record<Exclude<PlaceType, "UNIT">, string> = {
  CLASS: GLYPH_CLOCK,
  EVENT: GLYPH_CALENDAR,
  RODA: GLYPH_RODA,
};

const GOLD = "#e8b923";

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

/** Foto do pin: a capa do evento/roda (`imageUrl`) e, na falta, o logo do grupo — a mesma regra do cartão do local. */
export function markerPhotoUrl(place: MapPlace): string | null {
  return place.imageUrl || place.organization.logoUrl || null;
}

/** Texto acessível do pin ("Evento: Batizado 2026 — Grupo X"). */
export function markerLabel(place: MapPlace): string {
  return `${PLACE_META[place.type].singular}: ${place.title}${place.type === "UNIT" ? "" : ` — ${place.organization.name}`}`;
}

/** Conteúdo do pin SEM foto: iniciais (grupo), dia/mês (evento) ou ícone do tipo (treino/roda), sobre a cor do tipo. */
function appendFallback(badge: HTMLElement, place: MapPlace) {
  if (place.type === "UNIT") {
    badge.appendChild(el("span", "gm-pin-initials", initials(place.organization.name)));
  } else if (place.type === "EVENT") {
    const date = dateBadge(place, toDate);
    badge.appendChild(el("span", "gm-pin-month", date?.month ?? "EVT"));
    badge.appendChild(el("strong", "gm-pin-day", date?.day ?? "•"));
  } else {
    const icon = el("span", "gm-pin-glyph");
    icon.innerHTML = glyphSvg(GLYPH_BY_TYPE[place.type], 24);
    badge.appendChild(icon);
  }
}

/**
 * "Pin de foto" HTML: `.gm-pin` > `.gm-pin-badge` (quadrado arredondado com a foto/fallback) [+ `.gm-pin-seal` do tipo
 * quando há foto e não é grupo] + `.gm-pin-tail` (cauda; ÚLTIMO filho = base do elemento = âncora do
 * AdvancedMarkerElement, que apoia o centro da base do conteúdo na coordenada).
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
  const tail = el("span", "gm-pin-tail");
  tail.setAttribute("aria-hidden", "true");
  let seal: HTMLElement | null = null;

  const showFallback = () => {
    badge.replaceChildren();
    badge.classList.add("is-fallback");
    root.classList.remove("has-photo");
    seal?.remove();
    seal = null;
    appendFallback(badge, place);
  };

  const photo = markerPhotoUrl(place);
  if (photo) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.src = imageSrc(photo);
    img.addEventListener("error", showFallback);
    badge.appendChild(img);
    root.classList.add("has-photo");
    if (place.type !== "UNIT") {
      seal = el("span", "gm-pin-seal");
      seal.innerHTML = glyphSvg(GLYPH_SEAL[place.type], 12);
    }
  } else {
    showFallback();
  }

  root.appendChild(badge);
  if (seal) root.appendChild(seal);
  root.appendChild(tail);
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

export function classicClusterIcon(count: number): ClassicIcon {
  const size = Math.min(64, 40 + Math.round(Math.log10(Math.max(1, count)) * 12));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="31" fill="#1b5e43" fill-opacity=".22"/><circle cx="32" cy="32" r="23" fill="#1b5e43" stroke="#fff" stroke-width="2.5"/>` +
    `<text x="32" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="${count > 99 ? 15 : 18}" font-weight="800" fill="#fff">${count > 999 ? "999+" : count}</text></svg>`;
  return { url: dataUrl(svg), width: size, height: size, anchorX: size / 2, anchorY: size / 2 };
}

/* ---------- Pin de foto em SVG (marcador clássico sem Map ID) ---------- */

// Fonte de sistema: um SVG usado como imagem não enxerga as fontes web da página.
const SVG_FONT = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/**
 * Geometria do pin de foto (px, tamanho normal): imagem 56x68 com o quadrado de 48 px (x 4..52, y 3..51), cauda de 10 px
 * e margem para a sombra. A ÂNCORA é a ponta da cauda: (28, 61).
 */
export const PIN_ICON = { width: 56, height: 68, tipX: 28, tipY: 61, badge: 48 } as const;
/** Escala do pin selecionado. */
export const PIN_SELECTED_SCALE = 1.15;

const pinCache = new Map<string, ClassicIcon>();

/**
 * Ícone do pin de foto (quadrado de cantos arredondados + cauda): borda branca (dourada em "Meu grupo"; da cor do tipo
 * quando selecionado), foto/logo recortada dentro e sombra. `logo` é a foto já embutida (data URL); sem ela, o fallback
 * por tipo sobre a cor do tipo (iniciais do grupo, dia/mês do evento, ícone do treino/roda). Com foto, treino/roda/evento
 * ganham um mini selo do tipo no canto. O selecionado fica 15% maior. O anchor é a ponta da cauda.
 * Cacheado por (tipo, meu grupo, selecionado, foto, texto do fallback).
 */
export function photoPinIcon(
  place: MapPlace,
  options: { selected?: boolean; logo?: string | null } = {},
): ClassicIcon {
  const selected = options.selected === true;
  const logo = options.logo ?? null;
  const date = place.type === "EVENT" ? dateBadge(place, toDate) : null;
  const ini = initials(place.organization.name);
  const fallbackKey = place.type === "UNIT" ? ini : place.type === "EVENT" ? `${date?.month}|${date?.day}` : "";
  const photoKey = logo ? (markerPhotoUrl(place) ?? "-") : "-";
  const key = `${place.type}|${place.isMine ? 1 : 0}|${selected ? 1 : 0}|${photoKey}|${fallbackKey}`;
  const hit = pinCache.get(key);
  if (hit) return hit;

  const color = PLACE_META[place.type].color;
  const ring = place.isMine ? GOLD : selected ? color : "#ffffff";
  const { width, height, tipX, tipY, badge } = PIN_ICON;
  const x0 = 4;
  const y0 = 3;
  const x1 = x0 + badge;
  const y1 = y0 + badge;
  const r = 14;
  const outer =
    `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}` +
    `H${tipX + 8}L${tipX} ${tipY}L${tipX - 8} ${y1}H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`;
  // Miolo (foto/fallback) recuado 3 px da borda; raio 11.
  const ix = x0 + 3;
  const iy = y0 + 3;
  const is = badge - 6;
  const cx = ix + is / 2;
  const cy = iy + is / 2;

  let inner: string;
  if (logo) {
    inner =
      `<clipPath id="c"><rect x="${ix}" y="${iy}" width="${is}" height="${is}" rx="11"/></clipPath>` +
      `<rect x="${ix}" y="${iy}" width="${is}" height="${is}" rx="11" fill="#fff"/>` +
      `<image href="${logo}" x="${ix}" y="${iy}" width="${is}" height="${is}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>`;
  } else {
    inner = `<rect x="${ix}" y="${iy}" width="${is}" height="${is}" rx="11" fill="${color}"/>`;
    if (place.type === "UNIT") {
      const size = ini.length > 1 ? 17 : 20;
      inner += `<text x="${cx}" y="${cy + size * 0.35}" text-anchor="middle" font-family="${SVG_FONT}" font-size="${size}" font-weight="800" fill="#fff">${escapeXml(ini)}</text>`;
    } else if (place.type === "EVENT") {
      inner +=
        `<text x="${cx}" y="${cy - 5}" text-anchor="middle" font-family="${SVG_FONT}" font-size="9.5" font-weight="700" letter-spacing=".6" fill="#fff">${escapeXml(date?.month ?? "EVT")}</text>` +
        `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="${SVG_FONT}" font-size="20" font-weight="800" fill="#fff">${escapeXml(date?.day ?? "•")}</text>`;
    } else {
      inner += `<g transform="translate(${cx - 13.2} ${cy - 13.2}) scale(1.1)" stroke="#fff" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH_BY_TYPE[place.type]}</g>`;
    }
  }
  // Foto + tipo que não é grupo: mini selo do tipo no canto superior direito.
  const sealX = x1 - 3;
  const sealY = y0 + 6;
  const seal =
    logo && place.type !== "UNIT"
      ? `<circle cx="${sealX}" cy="${sealY}" r="8.5" fill="${color}" stroke="#fff" stroke-width="2"/>` +
        `<g transform="translate(${sealX - 6} ${sealY - 6}) scale(0.5)" stroke="#fff" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${GLYPH_SEAL[place.type]}</g>`
      : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><filter id="s" x="-25%" y="-20%" width="150%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0b2318" flood-opacity=".38"/></filter></defs>` +
    `<path d="${outer}" fill="${ring}" stroke="${ring}" stroke-width="1" stroke-linejoin="round" filter="url(#s)"/>` +
    `${inner}${seal}</svg>`;
  const scale = selected ? PIN_SELECTED_SCALE : 1;
  const icon: ClassicIcon = {
    url: dataUrl(svg),
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    anchorX: Math.round(tipX * scale),
    anchorY: Math.round(tipY * scale),
  };
  if (pinCache.size > 1500) pinCache.clear();
  pinCache.set(key, icon);
  return icon;
}

/* ---------- Logo embutido (base64) para o SVG: fetch -> blob -> FileReader, com cache por URL ---------- */

const logoState = new Map<string, string | null>(); // string = pronto; null = falhou
const logoLoading = new Map<string, Promise<string | null>>();

/** Logo já baixado (data URL), `null` se falhou/sem logo, `undefined` se ainda não tentado. */
export function cachedLogo(url: string | null | undefined): string | null | undefined {
  return url ? logoState.get(url) : null;
}

/** blob -> data URL base64 (FileReader; se o ambiente recusar o Blob, cai no arrayBuffer). */
async function readAsDataUrl(blob: Blob): Promise<string> {
  try {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${blob.type};base64,${btoa(binary)}`;
  }
}

/** Reduz a foto a 96x96 (recorte quadrado): 500 ícones com a imagem crua em base64 pesariam MBs. Sem canvas, devolve o original. */
async function downscale(dataUrl: string): Promise<string> {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("timeout")), 4000);
      img.onload = () => {
        window.clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("img"));
      };
      img.src = dataUrl;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) return dataUrl;
    canvas.width = canvas.height = 96;
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 96, 96);
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

/** Baixa a foto do local (`/api/uploads/...` ou URL externa). CORS/erro/não-imagem => null (o pin usa o fallback por tipo). */
export function loadLogo(url: string): Promise<string | null> {
  const pending = logoLoading.get(url);
  if (pending) return pending;
  const task = (async () => {
    try {
      const response = await fetch(imageSrc(url), { mode: "cors", credentials: "omit" });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) return null;
      return await downscale(await readAsDataUrl(blob));
    } catch {
      return null;
    }
  })().then((result) => {
    logoState.set(url, result);
    return result;
  });
  logoLoading.set(url, task);
  return task;
}

/** Só para testes: esquece fotos e ícones em cache. */
export function resetMarkerCaches(): void {
  logoState.clear();
  logoLoading.clear();
  pinCache.clear();
}
