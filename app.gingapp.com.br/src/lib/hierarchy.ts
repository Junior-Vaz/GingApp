import type { Hierarchy, HierarchyLevel, HierarchyPerson, HierarchyTeacher } from "@/lib/queries";

/* ---------- Escolha Linha do tempo | Hierarquia (lembrada no navegador) ---------- */

export type JourneyView = "timeline" | "hierarchy";
const VIEW_KEY = "gingapp.journey.view";

export function readJourneyView(): JourneyView {
  try {
    return localStorage.getItem(VIEW_KEY) === "hierarchy" ? "hierarchy" : "timeline";
  } catch {
    return "timeline";
  }
}

export function storeJourneyView(view: JourneyView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* modo privado / armazenamento bloqueado: a escolha só vale nesta sessão */
  }
}

/* ---------- Texto ---------- */

/** "Camila de Souza Lima" -> "Camila L." (nome curto para listas de alunos). */
export function shortName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0] ?? "—";
  const last = parts[parts.length - 1] ?? "";
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}

/** Posição do aluno na escada de cordas (para "N acima", "faltam N níveis"). */
export interface Progress {
  /** Índice do meu nível em `levels` (0 = o mais alto); -1 = sem nível. */
  mineIndex: number;
  /** Quantos níveis existem acima do meu. */
  levelsAbove: number;
  next: HierarchyLevel | null;
  top: HierarchyLevel | null;
  /** Alunos em níveis mais baixos que o meu. */
  belowCount: number;
}

export function progressOf(h: Hierarchy): Progress {
  const mineIndex = h.levels.findIndex((l) => l.isMine);
  const top = h.levels[0] ?? null;
  const next = mineIndex > 0 ? (h.levels[mineIndex - 1] ?? null) : null;
  const belowCount = mineIndex < 0 ? 0 : h.levels.slice(mineIndex + 1).reduce((sum, l) => sum + l.count, 0);
  return { mineIndex, levelsAbove: Math.max(0, mineIndex), next, top, belowCount };
}

/* ---------- Layout da árvore (coordenadas do "mundo" do canvas) ---------- */

export const PERSON_W = 156;
export const PERSON_H = 188;
export const LEVEL_W = 300;
export const LEVEL_H = 132;
export const MINE_W = 348;
export const MINE_H = 262;
export const ROOT_W = 280;
export const ROOT_H = 84;
export const BELOW_W = 300;
export const BELOW_H = 116;
const GAP_Y = 70;
const GAP_X = 22;
const ROW_MAX = 5;

export type NodeKind = "root" | "master" | "teacher" | "level" | "mine" | "below";

export interface LayoutNode {
  key: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  person?: HierarchyPerson | HierarchyTeacher;
  level?: HierarchyLevel;
  /** Nó do aluno ativo ("mine") sem nível: só a pessoa. */
  me?: Hierarchy["me"];
  /** Índice de entrada (atraso da animação). */
  order: number;
}

export interface LayoutEdge {
  key: string;
  d: string;
  /** "mine": ramo do meu professor/meu nível (realçado); "dim": abaixo de mim. */
  tone: "normal" | "mine" | "dim";
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  /** Centro do nó "mine" (ou null). */
  mine: { x: number; y: number; w: number; h: number } | null;
}

/** Linha de uma folha até o "barramento" (rampa com canto suave). */
function downPath(px: number, pb: number, jy: number, r = 18): string {
  if (Math.abs(px) < 1) return `M${px} ${pb}V${jy}`;
  const rr = Math.max(0, Math.min(r, Math.abs(px), jy - pb));
  const s = px > 0 ? -1 : 1;
  return `M${px} ${pb}V${jy - rr}Q${px} ${jy} ${px + s * rr} ${jy}H0`;
}

/** Do barramento até o topo de um filho (canto suave). */
function upPath(cx: number, jy: number, ct: number, r = 18): string {
  if (Math.abs(cx) < 1) return `M0 ${jy}V${ct}`;
  const rr = Math.max(0, Math.min(r, Math.abs(cx), ct - jy));
  const s = cx > 0 ? 1 : -1;
  return `M0 ${jy}H${cx - s * rr}Q${cx} ${jy} ${cx} ${jy + rr}V${ct}`;
}

/**
 * Monta a árvore DE CIMA PARA BAIXO centrada em x=0: raiz (grupo) -> mestres -> professores (em linhas de até 5)
 * -> níveis do mais alto até o MEU (destacado) -> bloco esmaecido "N alunos abaixo de você". Sem nível meu
 * (aluno sem graduação) mostra todos os níveis e um nó "você" ao final. Funções puras: testáveis sem DOM.
 */
export function buildLayout(h: Hierarchy): Layout {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  let y = 0;
  let order = 0;
  let prev: { nodes: LayoutNode[]; tone: LayoutEdge["tone"] } | null = null;
  let maxHalf = ROOT_W / 2;

  const connect = (parents: LayoutNode[], children: LayoutNode[], tone: LayoutEdge["tone"], tag: string) => {
    if (parents.length === 0 || children.length === 0) return;
    const pBottom = Math.max(...parents.map((p) => p.y + p.h));
    const cTop = Math.min(...children.map((c) => c.y));
    const jy = pBottom + (cTop - pBottom) / 2;
    parents.forEach((p, i) => edges.push({ key: `${tag}-p${i}`, d: downPath(p.x + p.w / 2, p.y + p.h, jy), tone }));
    children.forEach((c, i) =>
      edges.push({
        key: `${tag}-c${i}`,
        d: upPath(c.x + c.w / 2, jy, c.y),
        tone: c.kind === "teacher" && (c.person as HierarchyTeacher | undefined)?.isMyTeacher ? "mine" : tone,
      }),
    );
  };

  const place = (items: Omit<LayoutNode, "x" | "y" | "order">[], tone: LayoutEdge["tone"], tag: string, link = true): LayoutNode[] => {
    const w = items.reduce((sum, n) => sum + n.w, 0) + GAP_X * (items.length - 1);
    maxHalf = Math.max(maxHalf, w / 2);
    let x = -w / 2;
    const rowH = Math.max(...items.map((n) => n.h));
    const placed = items.map((n) => {
      const node: LayoutNode = { ...n, x, y, order: order++ };
      x += n.w + GAP_X;
      return node;
    });
    nodes.push(...placed);
    if (link && prev) connect(prev.nodes, placed, tone, tag);
    prev = { nodes: placed, tone };
    y += rowH + (link ? GAP_Y : GAP_X + 6);
    return placed;
  };

  // raiz: grupo + sistema
  place([{ key: "root", kind: "root", w: ROOT_W, h: ROOT_H }], "normal", "root", false);

  const masters = h.masters.map((p) => ({ key: `m${p.id}`, kind: "master" as const, w: PERSON_W, h: PERSON_H, person: p }));
  for (let i = 0; i < masters.length; i += ROW_MAX) place(masters.slice(i, i + ROW_MAX), "normal", "ms", i === 0);

  const teachers = h.teachers.map((p) => ({ key: `t${p.id}`, kind: "teacher" as const, w: PERSON_W, h: PERSON_H, person: p }));
  for (let i = 0; i < teachers.length; i += ROW_MAX) place(teachers.slice(i, i + ROW_MAX), "normal", "ts", i === 0);

  const mineIndex = h.levels.findIndex((l) => l.isMine);
  const shown = mineIndex < 0 ? h.levels : h.levels.slice(0, mineIndex + 1);
  let mine: Layout["mine"] = null;
  shown.forEach((level, i) => {
    const isMine = level.isMine;
    const [node] = place(
      [{ key: `l${level.id}`, kind: isMine ? "mine" : "level", w: isMine ? MINE_W : LEVEL_W, h: isMine ? MINE_H : LEVEL_H, level, me: isMine ? h.me : null }],
      isMine ? "mine" : "normal",
      `lv${i}`,
    );
    if (isMine && node) mine = { x: node.x, y: node.y, w: node.w, h: node.h };
  });

  if (mineIndex >= 0) {
    const lower = h.levels.slice(mineIndex + 1);
    if (lower.length > 0) place([{ key: "below", kind: "below", w: BELOW_W, h: BELOW_H }], "dim", "below");
  } else if (h.me) {
    const [node] = place([{ key: "me", kind: "mine", w: MINE_W, h: 190, me: h.me }], "mine", "me");
    if (node) mine = { x: node.x, y: node.y, w: node.w, h: node.h };
  }

  const width = maxHalf * 2 + 80;
  return { nodes, edges, width, height: Math.max(0, y - GAP_Y) + 40, mine };
}

/* ---------- Pan / zoom (transform CSS: translate(x,y) scale(s), origem no canto superior esquerdo) ---------- */

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2.2;

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Zoom por `factor` mantendo FIXO o ponto (cx, cy) da tela (centro do viewport nos botões, cursor/pinça nos gestos). */
export function zoomAt(t: Transform, factor: number, cx: number, cy: number): Transform {
  const scale = clampScale(t.scale * factor);
  const k = scale / t.scale;
  return { scale, x: cx - (cx - t.x) * k, y: cy - (cy - t.y) * k };
}

/** Transform que leva o centro de `rect` (coordenadas do mundo) ao centro do viewport, na escala dada. */
export function centerOn(rect: { x: number; y: number; w: number; h: number }, viewport: { w: number; h: number }, scale: number): Transform {
  const s = clampScale(scale);
  return { scale: s, x: viewport.w / 2 - (rect.x + rect.w / 2) * s, y: viewport.h / 2 - (rect.y + rect.h / 2) * s };
}

/** Escala que enquadra um retângulo do mundo no viewport (com margem), limitada a 1 para não ampliar demais. */
export function fitScale(rect: { w: number; h: number }, viewport: { w: number; h: number }, margin = 32, cap = 1): number {
  const sx = (viewport.w - margin * 2) / Math.max(1, rect.w);
  const sy = (viewport.h - margin * 2) / Math.max(1, rect.h);
  return clampScale(Math.min(cap, sx, sy));
}

export const cssTransform = (t: Transform): string => `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
