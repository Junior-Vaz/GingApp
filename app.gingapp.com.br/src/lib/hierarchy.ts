import type { Hierarchy, HierarchyLevel, HierarchyTeacher } from "@/lib/queries";
import { legacyBadge, type Badge } from "@/lib/roles";

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

/** Cartão de pessoa ÚNICO (mestre, professor, instrutor, aluno e "eu"): mesmas medidas em toda a árvore. */
export const PERSON_W = 124;
export const PERSON_H = 208;
/** Diâmetro do avatar do cartão de pessoa (mesmo em equipe e alunos). */
export const PERSON_AVATAR = 80;
export const ROOT_W = 280;
export const ROOT_H = 84;
export const BELOW_W = 300;
export const BELOW_H = 116;
const GAP_Y = 64;
/** Espaço entre cartões de pessoa (colunas) e entre fileiras de alunos dentro de um nível. */
export const CARD_GAP = 12;
export const CARD_ROW_GAP = 22;
/** Cartão de um NÍVEL (cabeçalho + grade de alunos): borda 1px + padding 14px + cabeçalho + respiro antes da grade. */
export const GROUP_PAD = 14;
export const GROUP_BORDER = 1;
export const GROUP_HEAD_H = 56;
export const GROUP_HEAD_GAP = 16;
export const GROUP_MIN_W = 292;
/** Altura do cartão de nível sem ninguém (cabeçalho + frase "Ninguém neste nível ainda"). */
const GROUP_EMPTY_BODY = 22;

/** Colunas de cartões por fileira conforme a largura da tela (2-3 no celular, mais no desktop). */
export function columnsFor(width: number): number {
  if (width < 640) return 3;
  if (width < 1100) return 4;
  return 6;
}

/**
 * Nós da árvore: grupo (root) -> [cartão "Equipe" só para quem não tem corda no sistema exibido] -> um cartão de NÍVEL por
 * corda (com a equipe daquela corda + os alunos) -> bloco "abaixo de você" ou o "eu" avulso.
 */
export type NodeKind = "root" | "team" | "level" | "mine" | "below";

export interface LayoutNode {
  key: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  level?: HierarchyLevel;
  /** Nó "level": a equipe cuja corda atual é este nível; nó "team": a equipe sem corda no sistema exibido. */
  staff?: StaffEntry[];
  /** Nó "mine" avulso (aluno sem nível no sistema exibido): só a pessoa. */
  me?: Hierarchy["me"];
  /** Nós "level"/"team": colunas da grade de cartões e quantos cartões (equipe + alunos + "+N") ela tem. */
  cols?: number;
  items?: number;
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
  /**
   * Retângulo de enquadramento "em mim" (ou null): para o aluno, a LARGURA do cartão do nível dele na altura do cartão
   * dele (assim os vizinhos de fileira aparecem); para a equipe ou o "eu" avulso, o próprio cartão.
   */
  mine: { x: number; y: number; w: number; h: number } | null;
  /** O cartão da pessoa "eu" em si (coordenadas do mundo, sem o deslocamento x do centro). */
  meCard: { x: number; y: number; w: number; h: number } | null;
  /** Níveis abaixo do meu que NÃO viraram cartão (sem equipe): resumidos no bloco "alunos abaixo de você". */
  belowLevels: HierarchyLevel[];
}

/** Cartões de um nível: equipe + alunos listados + o cartão final "+N" quando o total passa do que veio. */
export const levelItems = (level: HierarchyLevel, staffCount = 0): number =>
  staffCount + level.students.length + (level.count > level.students.length ? 1 : 0);

/** Caixa de um cartão-seção (nível ou "Equipe"): cabeçalho + grade de `cols` colunas máx. com `items` cartões de pessoa. */
function boxSize(items: number, cols: number): { w: number; h: number; cols: number; items: number } {
  const used = Math.max(1, Math.min(cols, items));
  const chrome = 2 * (GROUP_BORDER + GROUP_PAD);
  const gridW = used * PERSON_W + (used - 1) * CARD_GAP;
  const w = Math.max(GROUP_MIN_W, gridW + chrome);
  if (items === 0) return { w, h: chrome + GROUP_HEAD_H + 12 + GROUP_EMPTY_BODY, cols: used, items };
  const rows = Math.ceil(items / used);
  const h = chrome + GROUP_HEAD_H + GROUP_HEAD_GAP + rows * PERSON_H + (rows - 1) * CARD_ROW_GAP;
  return { w, h, cols: used, items };
}

/** Medidas do cartão de um nível (cabeçalho + grade de `cols` colunas máx.), contando a equipe que está nele. */
export function groupSize(level: HierarchyLevel, cols: number, staffCount = 0): { w: number; h: number; cols: number; items: number } {
  return boxSize(levelItems(level, staffCount), cols);
}

/** Medidas do cartão "Equipe" (pessoas sem corda no sistema exibido). */
export const teamSize = (people: number, cols: number): { w: number; h: number; cols: number; items: number } => boxSize(people, cols);

/** Um cargo do grupo com as suas pessoas. */
export interface StaffTier {
  badge: Badge;
  people: HierarchyTeacher[];
  /** "staff" = veio de `staff`; "master"/"teacher" = fallback de backend antigo (masters/teachers). */
  kind: "staff" | "master" | "teacher";
}

/** Uma pessoa da equipe com o cargo (selo) com que aparece. */
export interface StaffEntry {
  key: string;
  person: HierarchyTeacher;
  badge: Badge;
}

/** Onde cada pessoa da equipe aparece: dentro do nível da SUA corda, ou em "Equipe" (sem corda / corda fora do sistema exibido). */
export interface StaffPlacement {
  byLevel: Map<number, StaffEntry[]>;
  unplaced: StaffEntry[];
}

/**
 * Cargos do grupo da árvore, do maior rank para o menor. Usa `staff` quando traz alguém; senão (backend antigo,
 * `staff` ausente/vazio) cai no comportamento antigo: mestres e depois professores, com o nome do papel de acesso.
 */
export function staffTiers(h: Hierarchy): StaffTier[] {
  const tiers: StaffTier[] = (h.staff ?? [])
    .filter((g) => g.people.length > 0)
    .map((g) => ({ badge: g.groupRole, people: g.people, kind: "staff" as const }))
    .sort((a, b) => b.badge.rank - a.badge.rank);
  if (tiers.length > 0) return tiers;
  const legacy: StaffTier[] = [];
  if (h.masters.length > 0) legacy.push({ badge: legacyBadge("MESTRE"), people: h.masters.map((p) => ({ ...p, isMyTeacher: false })), kind: "master" });
  if (h.teachers.length > 0) legacy.push({ badge: legacyBadge("PROFESSOR"), people: h.teachers, kind: "teacher" });
  return legacy;
}

/** O aluno ativo tem "meu professor" na equipe (qualquer cargo)? */
export const hasMyTeacher = (h: Hierarchy): boolean => staffTiers(h).some((t) => t.people.some((p) => p.isMyTeacher));

const byRankThenName = (a: StaffEntry, b: StaffEntry): number => b.badge.rank - a.badge.rank || a.person.displayName.localeCompare(b.person.displayName, "pt-BR");

/**
 * Distribui a equipe pela escada: cada pessoa vai para o cartão do NÍVEL da sua corda atual (`person.level.id` existente em
 * `h.levels`); sem corda ou com corda fora do sistema exibido cai em `unplaced` (cartão "Equipe"). Cada pessoa aparece UMA
 * vez (pelo cargo de maior rank) e, no mesmo destino, fica do maior rank para o menor e depois por nome.
 */
export function placeStaff(h: Hierarchy): StaffPlacement {
  const levelIds = new Set(h.levels.map((l) => l.id));
  const seen = new Set<number>();
  const byLevel = new Map<number, StaffEntry[]>();
  const unplaced: StaffEntry[] = [];
  for (const tier of staffTiers(h)) {
    for (const person of tier.people) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      const entry: StaffEntry = { key: `${tier.kind === "staff" ? `s${tier.badge.slug}-` : tier.kind === "master" ? "m" : "t"}${person.id}`, person, badge: tier.badge };
      const levelId = person.level?.id;
      if (levelId !== undefined && levelIds.has(levelId)) byLevel.set(levelId, [...(byLevel.get(levelId) ?? []), entry]);
      else unplaced.push(entry);
    }
  }
  for (const list of byLevel.values()) list.sort(byRankThenName);
  unplaced.sort(byRankThenName);
  return { byLevel, unplaced };
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

/** Retângulo (coordenadas do mundo) do `index`-ésimo cartão da grade de um cartão-seção, que fica centrada na caixa. */
function gridCell(node: LayoutNode, cols: number, index: number): { x: number; y: number; w: number; h: number } {
  const inner = GROUP_BORDER + GROUP_PAD;
  const gridW = cols * PERSON_W + (cols - 1) * CARD_GAP;
  return {
    x: node.x + inner + (node.w - 2 * inner - gridW) / 2 + (index % cols) * (PERSON_W + CARD_GAP),
    y: node.y + inner + GROUP_HEAD_H + GROUP_HEAD_GAP + Math.floor(index / cols) * (PERSON_H + CARD_ROW_GAP),
    w: PERSON_W,
    h: PERSON_H,
  };
}

/**
 * Monta a escada DE CIMA PARA BAIXO centrada em x=0: raiz (grupo) -> [cartão "Equipe", só para quem não tem corda no
 * sistema exibido] -> UM CARTÃO DE NÍVEL por corda, do mais alto até o MEU, cada um com a equipe cuja corda é aquela
 * (do maior rank ao menor) e os alunos do nível, tudo no mesmo cartão de pessoa -> bloco esmaecido "N alunos abaixo de
 * você" (níveis abaixo do meu SEM equipe; os que têm equipe continuam como cartão para ninguém sumir). Sem nível meu
 * (aluno sem graduação) mostra todos os níveis e um cartão "você" ao final; se eu sou da equipe, o "eu" é o meu cartão
 * dentro do nível da minha corda (ou em "Equipe"). Funções puras: testáveis sem DOM.
 */
export function buildLayout(h: Hierarchy, maxCols = columnsFor(typeof window === "undefined" ? 1280 : window.innerWidth)): Layout {
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
    children.forEach((c, i) => edges.push({ key: `${tag}-c${i}`, d: upPath(c.x + c.w / 2, jy, c.y), tone }));
  };

  const place = (items: Omit<LayoutNode, "x" | "y" | "order">[], tone: LayoutEdge["tone"], tag: string, link = true): LayoutNode[] => {
    const w = items.reduce((sum, n) => sum + n.w, 0) + CARD_GAP * (items.length - 1);
    maxHalf = Math.max(maxHalf, w / 2);
    let x = -w / 2;
    const rowH = Math.max(...items.map((n) => n.h));
    const placed = items.map((n) => {
      const node: LayoutNode = { ...n, x, y, order: order++ };
      x += n.w + CARD_GAP;
      return node;
    });
    nodes.push(...placed);
    if (link && prev) connect(prev.nodes, placed, tone, tag);
    prev = { nodes: placed, tone };
    y += rowH + (link ? GAP_Y : CARD_ROW_GAP);
    return placed;
  };

  let mine: Layout["mine"] = null;
  let meCard: Layout["meCard"] = null;
  /** A equipe consultando a própria hierarquia: o "eu" é o cartão dela (nunca um aluno de nível). */
  const markStaffMe = (node: LayoutNode | undefined, staff: StaffEntry[], cols: number) => {
    const at = staff.findIndex((s) => s.person.isMe);
    if (!node || at < 0) return;
    meCard = gridCell(node, cols, at);
    mine = meCard;
  };

  // raiz: grupo + sistema
  place([{ key: "root", kind: "root", w: ROOT_W, h: ROOT_H }], "normal", "root", false);

  const placement = placeStaff(h);
  if (placement.unplaced.length > 0) {
    const size = teamSize(placement.unplaced.length, maxCols);
    const [node] = place([{ key: "team", kind: "team", w: size.w, h: size.h, staff: placement.unplaced, cols: size.cols, items: size.items }], "normal", "team");
    markStaffMe(node, placement.unplaced, size.cols);
  }

  const staffOf = (level: HierarchyLevel): StaffEntry[] => placement.byLevel.get(level.id) ?? [];
  const mineIndex = h.levels.findIndex((l) => l.isMine);
  // Todas as graduações do sistema aparecem (inclusive as abaixo do aluno): a hierarquia completa, do topo à base.
  const shown = h.levels;
  const belowLevels: HierarchyLevel[] = [];
  shown.forEach((level, i) => {
    const staff = staffOf(level);
    const size = groupSize(level, maxCols, staff.length);
    const [node] = place(
      [{ key: `l${level.id}`, kind: "level", w: size.w, h: size.h, level, staff, cols: size.cols, items: size.items }],
      level.isMine ? "mine" : "normal",
      `lv${i}`,
    );
    markStaffMe(node, staff, size.cols);
    const at = level.students.findIndex((s) => s.isMe);
    if (level.isMine && node && at >= 0) {
      // o cartão "eu" vem depois da equipe do nível, na grade centrada no cartão do nível
      meCard = gridCell(node, size.cols, staff.length + at);
      mine = { x: node.x, y: meCard.y, w: node.w, h: PERSON_H };
    } else if (level.isMine && node) {
      mine = { x: node.x, y: node.y, w: node.w, h: node.h };
    }
  });

  if (mineIndex >= 0) {
    if (belowLevels.length > 0) place([{ key: "below", kind: "below", w: BELOW_W, h: BELOW_H }], "dim", "below");
  } else if (h.me && !h.me.isStaff) {
    const [node] = place([{ key: "me", kind: "mine", w: PERSON_W, h: PERSON_H, me: h.me }], "mine", "me");
    if (node) {
      meCard = { x: node.x, y: node.y, w: node.w, h: node.h };
      mine = meCard;
    }
  }

  const width = maxHalf * 2 + 80;
  return { nodes, edges, width, height: Math.max(0, y - GAP_Y) + 40, mine, meCard, belowLevels };
}

/* ---------- Pan / zoom (transform CSS: translate(x,y) scale(s), origem no canto superior esquerdo) ---------- */

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.1;
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
