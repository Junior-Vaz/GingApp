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

const GLYPH_CALENDAR =
  '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';
const GLYPH_HOME = '<path d="M3 11.5 12 3.5l9 8"/><path d="M5.5 10v10.5h4.5v-6h4v6h4.5V10"/>';

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

/** Título do balão por tipo: evento/roda/treino = título (nome da turma); grupo/unidade = nome do grupo. */
export function balloonTitle(place: MapPlace): string {
  return (place.type === "UNIT" ? place.organization.name : place.title) || place.title;
}

/** Corta o nome em ~20 caracteres com reticências. */
export function truncateName(text: string, max = 20): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
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
  // Nome em balãozinho sob o pin (mesma regra de título/truncamento do ícone clássico).
  root.appendChild(el("span", "gm-pin-name", truncateName(balloonTitle(place))));
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

/* ---------- Balão (marcador clássico sem Map ID): logo + nome + selo do tipo, cauda para o local ---------- */

const GLYPH_SEAL: Record<PlaceType, string> = {
  UNIT: GLYPH_HOME,
  CLASS: GLYPH_CLOCK,
  EVENT: GLYPH_CALENDAR,
  RODA: GLYPH_RODA,
};
// Fonte de sistema: um SVG usado como imagem não enxerga as fontes web da página; medir e desenhar com a mesma pilha.
const SVG_FONT = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const BALLOON_FONT_SIZE = 12.5;
const GOLD = "#e8b923";
const AVATAR_COLORS = ["#1b5e43", "#2a6f97", "#b4472f", "#7a4fa3", "#a65e0a", "#0f766e", "#9b2c5b", "#4b5fa8"];

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Largura do texto na MESMA fonte do SVG (canvas 2D); sem canvas (SSR/teste) estima por caractere. */
function textWidth(text: string): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement("canvas").getContext("2d");
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx) {
    measureCtx.font = `700 ${BALLOON_FONT_SIZE}px ${SVG_FONT}`;
    const width = measureCtx.measureText(text).width;
    if (width > 0) return width;
  }
  return text.length * BALLOON_FONT_SIZE * 0.58;
}

function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? "#1b5e43";
}

const balloonCache = new Map<string, ClassicIcon>();

/**
 * Ícone do balão: pílula branca (borda branca; dourada em "Meu grupo"; da cor do tipo quando selecionado) com
 * círculo do logo do grupo (ou iniciais coloridas), nome truncado e mini-selo do tipo; cauda embaixo — o anchor
 * é a ponta da cauda. `logo` é o logo já embutido (data URL); sem ele, iniciais. Cacheado por (logo, nome, tipo, isMine).
 */
export function balloonIcon(
  place: MapPlace,
  options: { selected?: boolean; logo?: string | null } = {},
): ClassicIcon {
  const selected = options.selected === true;
  const logo = options.logo ?? null;
  const name = truncateName(balloonTitle(place));
  const key = `${place.type}|${place.isMine ? 1 : 0}|${selected ? 1 : 0}|${name}|${place.organization.name}|${logo ? place.organization.logoUrl : "-"}`;
  const hit = balloonCache.get(key);
  if (hit) return hit;

  const color = PLACE_META[place.type].color;
  const ring = place.isMine ? GOLD : selected ? color : "#ffffff";
  const bodyH = 34;
  const top = 4;
  const left = 5;
  const cx = left + 4 + 13;
  const cy = top + bodyH / 2;
  const textX = cx + 13 + 7;
  const bodyW = Math.ceil(textX - left + textWidth(name) + 13);
  const width = bodyW + left * 2;
  const height = 50;
  const mid = width / 2;
  const r = bodyH / 2;
  const bottom = top + bodyH;
  const path =
    `M${left + r} ${top}H${left + bodyW - r}A${r} ${r} 0 0 1 ${left + bodyW - r} ${bottom}` +
    `H${mid + 7}L${mid} ${bottom + 8}L${mid - 7} ${bottom}H${left + r}A${r} ${r} 0 0 1 ${left + r} ${top}Z`;

  const ini = escapeXml(initials(place.organization.name));
  const avatar = logo
    ? `<clipPath id="c"><circle cx="${cx}" cy="${cy}" r="12"/></clipPath><circle cx="${cx}" cy="${cy}" r="13" fill="#fff" stroke="${color}" stroke-width="2"/>` +
      `<image href="${logo}" x="${cx - 12}" y="${cy - 12}" width="24" height="24" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>`
    : `<circle cx="${cx}" cy="${cy}" r="13" fill="${avatarColor(place.organization.name)}" stroke="${color}" stroke-width="2"/>` +
      `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="${SVG_FONT}" font-size="${ini.length > 1 ? 10.5 : 12}" font-weight="800" fill="#fff">${ini}</text>`;
  const sealX = cx + 9;
  const sealY = cy + 10;
  const seal =
    `<circle cx="${sealX}" cy="${sealY}" r="7.5" fill="${color}" stroke="#fff" stroke-width="1.8"/>` +
    `<g transform="translate(${sealX - 5} ${sealY - 5}) scale(0.42)" stroke="#fff" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${GLYPH_SEAL[place.type]}</g>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><filter id="s" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.5" flood-color="#0b2318" flood-opacity=".32"/></filter></defs>` +
    `<path d="${path}" fill="#fff" stroke="${ring}" stroke-width="2.5" stroke-linejoin="round" filter="url(#s)"/>` +
    `${avatar}${seal}` +
    `<text x="${textX}" y="${cy + 4.4}" font-family="${SVG_FONT}" font-size="${BALLOON_FONT_SIZE}" font-weight="700" fill="#1d2b24">${escapeXml(name)}</text></svg>`;
  const scale = selected ? 1.12 : 1;
  const icon: ClassicIcon = {
    url: dataUrl(svg),
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    anchorX: Math.round(mid * scale),
    anchorY: Math.round((bottom + 8) * scale),
  };
  if (balloonCache.size > 1500) balloonCache.clear();
  balloonCache.set(key, icon);
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

/** Reduz o logo a 56x56 (recorte quadrado): 500 ícones com o logo cru em base64 pesariam MBs. Sem canvas, devolve o original. */
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
    canvas.width = canvas.height = 56;
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 56, 56);
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

/** Baixa o logo do grupo (`/api/uploads/...` ou URL externa). CORS/erro/não-imagem => null (o balão usa iniciais). */
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

/** Só para testes: esquece logos e ícones em cache. */
export function resetMarkerCaches(): void {
  logoState.clear();
  logoLoading.clear();
  balloonCache.clear();
}
