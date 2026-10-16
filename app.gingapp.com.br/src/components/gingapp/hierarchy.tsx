import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Crown, Locate, Maximize2, Minus, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import {
  buildLayout,
  centerOn,
  clampScale,
  columnsFor,
  cssTransform,
  fitScale,
  hasMyTeacher,
  PERSON_AVATAR,
  progressOf,
  shortName,
  zoomAt,
  type Layout,
  type LayoutNode,
  type StaffEntry,
  type Transform,
} from "@/lib/hierarchy";
import { useHierarchy, type GraduationLevel, type Hierarchy, type HierarchyLevel } from "@/lib/queries";
import { Avatar } from "./avatar";
import { Rope } from "./rope";
import { RoleChip } from "./roles";
import { plural } from "@/lib/plural";

const ZOOM_STEP = 1.25;
const GOLD = "#e0a920";

/* ---------- Nós ---------- */

interface PersonCardProps {
  name: string;
  photo: string | null;
  group: Hierarchy["group"];
  /** "staff" = cargo do grupo (selo colorido); "student" = aluno (selo do nível). Só muda selos/anéis. */
  variant: "staff" | "student";
  /** Selo sob o nome: cargo do grupo (equipe) ou nível (aluno). */
  chip: ReactNode;
  /** Corda desenhada embaixo (null = sem graduação). */
  rope: GraduationLevel | null;
  isMe?: boolean;
  isMyTeacher?: boolean;
}

/**
 * Cartão de PESSOA único da árvore (mestre, professor, instrutor, aluno e "eu"): avatar grande redondo com o selo do
 * grupo, nome em negrito, selo (cargo ou nível) e a corda embaixo. As variantes só trocam selos e anéis.
 */
function PersonCard({ name, photo, group, variant, chip, rope, isMe = false, isMyTeacher = false }: PersonCardProps) {
  const teacher = isMyTeacher && !isMe;
  return (
    <div
      className={`hier-card hier-person is-${variant} ${isMe ? "is-me" : ""} ${teacher ? "is-my-teacher" : ""}`.replace(/\s+/g, " ").trim()}
      data-testid={isMe ? "hier-me" : teacher ? "my-teacher" : undefined}
    >
      {isMe && (
        <span className="hier-ribbon hier-ribbon-me">
          <Sparkles aria-hidden="true" /> {variant === "student" ? "Você está aqui" : "Você"}
        </span>
      )}
      {teacher && (
        <span className="hier-ribbon hier-ribbon-teacher">
          <ShieldCheck aria-hidden="true" /> Seu professor
        </span>
      )}
      <Avatar name={name} src={photo} size={PERSON_AVATAR} ringColor={isMe ? GOLD : undefined} groupName={group.name} groupLogoUrl={group.logoUrl} badgeLetters={1} />
      <strong className="hier-name">{name}</strong>
      {chip}
      <span className="hier-person-rope">{rope && <Rope {...rope} orientation="horizontal" length={72} thickness={13} />}</span>
    </div>
  );
}

function LevelChip({ level }: { level: GraduationLevel }) {
  return (
    <span className="hier-level-chip" title={level.name} data-testid="level-chip">
      <i aria-hidden="true" style={{ background: level.color ?? undefined }} />
      <span>{level.name}</span>
    </span>
  );
}

function StaffCard({ entry, group }: { entry: StaffEntry; group: Hierarchy["group"] }) {
  const { person, badge } = entry;
  return (
    <PersonCard
      name={person.displayName}
      photo={person.photo}
      group={group}
      variant="staff"
      chip={<RoleChip badge={badge} />}
      rope={person.level}
      isMe={person.isMe === true}
      isMyTeacher={person.isMyTeacher}
    />
  );
}

/** "2 na equipe · 12 alunos": a contagem de alunos NUNCA inclui a equipe (ela vem como cartões de pessoa). */
function levelCaption(staff: number, students: number): string {
  return staff > 0 ? `${staff} na equipe · ${plural(students, "aluno", "alunos")}` : plural(students, "aluno", "alunos");
}

/**
 * Um NÍVEL da escada: cabeçalho compacto (corda + nome + contagem, abre a lista de alunos) e UMA grade de cartões de
 * pessoa: primeiro a equipe cuja corda é este nível (do maior cargo ao menor), depois os alunos, com o cartão final "+N"
 * quando há mais alunos do que os listados.
 */
function LevelGroup({
  level,
  staff,
  cols,
  group,
  onOpen,
  selected,
}: {
  level: HierarchyLevel;
  staff: StaffEntry[];
  cols: number;
  group: Hierarchy["group"];
  onOpen: (level: HierarchyLevel) => void;
  selected: boolean;
}) {
  const hidden = Math.max(0, level.count - level.students.length);
  const caption = levelCaption(staff.length, level.count);
  return (
    <section className={`hier-group ${level.isMine ? "is-mine" : ""}`.trim()} aria-label={`Nível ${level.name}`} data-testid="hier-level">
      <button
        type="button"
        className={`hier-level hier-level-head ${selected ? "is-selected" : ""}`.trim()}
        onClick={() => onOpen(level)}
        aria-label={`${level.name}: ${caption}. Ver alunos`}
        aria-haspopup="dialog"
      >
        <Rope {...level} orientation="horizontal" length={76} thickness={16} />
        <span className="hier-level-body">
          <strong className="hier-name">{level.name}</strong>
          <span className="hier-role">{caption}</span>
        </span>
      </button>
      {staff.length + level.students.length > 0 ? (
        <ul className="hier-grid" style={{ "--cols": cols } as CSSProperties} aria-label={`Pessoas de ${level.name}`}>
          {staff.map((entry) => (
            <li key={entry.key}>
              <StaffCard entry={entry} group={group} />
            </li>
          ))}
          {level.students.map((s) => (
            <li key={s.studentId}>
              <PersonCard name={s.displayName} photo={s.photo} group={group} variant="student" chip={<LevelChip level={level} />} rope={level} isMe={s.isMe} />
            </li>
          ))}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                className="hier-card hier-person hier-more-card"
                onClick={() => onOpen(level)}
                aria-label={`Mais ${plural(hidden, "aluno", "alunos")} em ${level.name}. Ver alunos`}
                aria-haspopup="dialog"
              >
                <strong className="hier-more-num">+{hidden}</strong>
                <span className="hier-role">{hidden === 1 ? "aluno" : "alunos"}</span>
              </button>
            </li>
          )}
        </ul>
      ) : (
        <p className="hier-empty-level">Ninguém neste nível ainda</p>
      )}
    </section>
  );
}

/** Equipe SEM corda no sistema exibido (ou com corda de outro sistema): um único cartão-seção "Equipe" logo abaixo do grupo. */
function TeamGroup({ staff, cols, group }: { staff: StaffEntry[]; cols: number; group: Hierarchy["group"] }) {
  return (
    <section className="hier-group" aria-label="Equipe" data-testid="hier-team">
      <div className="hier-level-head is-static">
        <span className="hier-team-icon">
          <Crown aria-hidden="true" />
        </span>
        <span className="hier-level-body">
          <strong className="hier-name">Equipe</strong>
          <span className="hier-role">{plural(staff.length, "pessoa", "pessoas")} sem corda neste sistema</span>
        </span>
      </div>
      <ul className="hier-grid" style={{ "--cols": cols } as CSSProperties} aria-label="Pessoas da equipe">
        {staff.map((entry) => (
          <li key={entry.key}>
            <StaffCard entry={entry} group={group} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Eu" avulso: aluno sem corda no sistema exibido (o mesmo cartão de pessoa, com a frase "Sem graduação ainda"). */
function MeCard({ me, group }: { me: NonNullable<Hierarchy["me"]>; group: Hierarchy["group"] }) {
  return (
    <PersonCard
      name={me.displayName}
      photo={me.photo}
      group={group}
      variant="student"
      chip={me.level ? <LevelChip level={me.level} /> : <span className="hier-level-chip is-empty">Sem graduação ainda</span>}
      rope={me.level}
      isMe
    />
  );
}

function BelowNode({ lower }: { lower: HierarchyLevel[] }) {
  const count = lower.reduce((sum, l) => sum + l.count, 0);
  return (
    <div className="hier-card hier-below" data-testid="hier-below">
      <strong className="hier-name">{plural(count, "aluno abaixo de você", "alunos abaixo de você")}</strong>
      <div className="hier-below-ropes">
        {lower.map((l) => (
          <span key={l.id} className="hier-below-item" title={`${l.name}: ${plural(l.count, "aluno", "alunos")}`}>
            <Rope {...l} orientation="vertical" length={30} thickness={9} />
            <small>{l.count}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function RootNode({ h }: { h: Hierarchy }) {
  return (
    <div className="hier-card hier-root">
      <Avatar decorative name={h.group.name} src={h.group.logoUrl} size={46} />
      <span className="hier-level-body">
        <strong className="hier-name">{h.group.name}</strong>
        <span className="hier-role">
          {h.system ? `${h.system.name} · ` : ""}
          {plural(h.totalStudents, "aluno", "alunos")}
        </span>
      </span>
    </div>
  );
}

function renderNode(node: LayoutNode, h: Hierarchy, selectedId: number | null, open: (l: HierarchyLevel) => void, lower: HierarchyLevel[]): ReactNode {
  switch (node.kind) {
    case "root":
      return <RootNode h={h} />;
    case "team":
      return <TeamGroup staff={node.staff ?? []} cols={node.cols ?? 1} group={h.group} />;
    case "level":
      return node.level ? (
        <LevelGroup level={node.level} staff={node.staff ?? []} cols={node.cols ?? 1} group={h.group} onOpen={open} selected={selectedId === node.level.id} />
      ) : null;
    case "mine":
      return node.me ? <MeCard me={node.me} group={h.group} /> : null;
    case "below":
      return <BelowNode lower={lower} />;
  }
}

/* ---------- Cartão com os alunos de um nível ---------- */

function LevelSheet({ level, onClose }: { level: HierarchyLevel; onClose: () => void }) {
  const hidden = Math.max(0, level.count - level.students.length);
  return (
    <aside className="hier-sheet map-float" role="dialog" aria-label={`Alunos de ${level.name}`} data-testid="hier-sheet">
      <header>
        <Rope {...level} orientation="horizontal" length={72} thickness={16} />
        <div>
          <h3>{level.name}</h3>
          <p>{plural(level.count, "aluno", "alunos")}</p>
        </div>
        <button type="button" className="hier-close" onClick={onClose} aria-label="Fechar">
          <X aria-hidden="true" />
        </button>
      </header>
      {level.students.length > 0 ? (
        <ul>
          {level.students.map((s) => (
            <li key={s.studentId} className={s.isMe ? "is-me" : undefined}>
              <Avatar decorative name={s.displayName} src={s.photo} size={34} />
              <span>{shortName(s.displayName)}</span>
              {s.isMe && <em>você</em>}
            </li>
          ))}
          {hidden > 0 && <li className="hier-sheet-more">e mais {plural(hidden, "aluno", "alunos")}</li>}
        </ul>
      ) : (
        <p className="hier-sheet-empty">Nenhum aluno neste nível ainda.</p>
      )}
    </aside>
  );
}

/* ---------- Estados ---------- */

function HierarchySkeleton() {
  return (
    <div className="hier-skeleton" role="status" aria-label="Carregando a hierarquia" data-testid="hier-skeleton">
      <span className="sk sk-root" />
      <span className="sk-line" />
      <span className="sk-row">
        <span className="sk sk-person" />
        <span className="sk sk-person" />
      </span>
      <span className="sk-line" />
      <span className="sk sk-level" />
      <span className="sk-line" />
      <span className="sk sk-level" />
    </div>
  );
}

/* ---------- Canvas ---------- */

/**
 * Hierarquia do grupo em TELA CHEIA (mesmo contêiner do mapa): escada de cima para baixo — grupo e as cordas do sistema
 * do mais alto até a minha, cada nível com a equipe da sua corda (selo do cargo) e os alunos. Arrastar = pan; roda/pinça/botões = zoom; "Centralizar em mim".
 * Pan/zoom são só `transform` CSS sobre o "mundo" (sem bibliotecas).
 */
export function HierarchyCanvas({ viewToggle }: { viewToggle: ReactNode }) {
  const query = useHierarchy();
  const h = query.data ?? null;

  let body: ReactNode;
  if (query.isLoading) body = <HierarchySkeleton />;
  else if (query.error)
    body = (
      <div className="map-loading" role="alert">
        {errorMessage(query.error, "Não foi possível carregar a hierarquia.")}
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  else if (!h || h.levels.length === 0)
    body = (
      <div className="map-loading" role="status" data-testid="hier-empty">
        <Crown aria-hidden="true" className="size-8 text-primary" />
        <strong>Seu grupo ainda não definiu as cordas</strong>
        <span className="map-overlay-sub">Quando o seu mestre cadastrar o sistema de graduação, a árvore do grupo aparece aqui.</span>
      </div>
    );
  else body = <HierarchyTree h={h} viewToggle={viewToggle} />;

  const hasTree = h !== null && h.levels.length > 0 && !query.isLoading && !query.error;
  return (
    <div className="map-fullscreen hier-fullscreen" data-testid="hier-canvas">
      {body}
      {!hasTree && <div className="map-float map-switch map-switch-top">{viewToggle}</div>}
    </div>
  );
}

/** Colunas de cartões por fileira conforme a largura da janela (muda só ao cruzar um limite: não reconstrói à toa). */
function useColumns(): number {
  const [cols, setCols] = useState(() => columnsFor(window.innerWidth));
  useEffect(() => {
    const onResize = () => setCols(columnsFor(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return cols;
}

function HierarchyTree({ h, viewToggle }: { h: Hierarchy; viewToggle: ReactNode }) {
  const cols = useColumns();
  const layout: Layout = useMemo(() => buildLayout(h, cols), [h, cols]);
  const progress = useMemo(() => progressOf(h), [h]);
  const off = layout.width / 2;
  const viewportRef = useRef<HTMLDivElement>(null);
  const tRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const [t, setT] = useState<Transform>(tRef.current);
  const [animate, setAnimate] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const framed = useRef(false);
  /** O usuário já mexeu (pan/zoom): redimensionar a janela não reenquadra mais. */
  const touched = useRef(false);

  const apply = useCallback((next: Transform, animated = false) => {
    tRef.current = next;
    touched.current = false;
    setAnimate(animated);
    setT(next);
  }, []);

  const hudRef = useRef<HTMLDivElement>(null);
  const size = useCallback(() => {
    const el = viewportRef.current;
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  }, []);
  /** Área livre: o enquadramento ignora a faixa do topo coberta pelo alternador/resumo flutuantes. */
  const inset = useCallback(() => {
    const hud = hudRef.current?.getBoundingClientRect();
    const view = viewportRef.current?.getBoundingClientRect();
    return hud && view && hud.height > 0 ? Math.max(0, Math.round(hud.bottom - view.top + 8)) : 0;
  }, []);
  const framedTransform = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, scaleFor: (area: { w: number; h: number }) => number): Transform => {
      const vp = size();
      const top = inset();
      const area = { w: vp.w, h: Math.max(1, vp.h - top) };
      const t = centerOn(rect, area, scaleFor(area));
      return { ...t, y: t.y + top };
    },
    [inset, size],
  );

  const wholeTree = useMemo(() => ({ x: 0, y: 0, w: layout.width, h: layout.height }), [layout]);

  /** Enquadra a MIM (centro no meu cartão); sem nível meu, enquadra a árvore toda. */
  const frameMe = useCallback(
    (animated: boolean) => {
      const vp = size();
      if (!vp.w || !vp.h) return;
      if (layout.mine) {
        const rect = { ...layout.mine, x: layout.mine.x + off };
        apply(framedTransform(rect, (area) => clampScale(Math.min(0.92, (area.w * 0.94) / rect.w, (area.h * 0.9) / rect.h))), animated);
      } else {
        apply(framedTransform(wholeTree, (area) => fitScale(wholeTree, area)), animated);
      }
    },
    [apply, framedTransform, layout, off, size, wholeTree],
  );

  const frameAll = useCallback(() => {
    const vp = size();
    if (!vp.w || !vp.h) return;
    apply(framedTransform(wholeTree, (area) => fitScale(wholeTree, area)), true);
  }, [apply, framedTransform, size, wholeTree]);

  // Primeiro enquadramento (e novo, se o aluno ativo / os dados mudarem): começa em mim.
  useLayoutEffect(() => {
    framed.current = false;
  }, [layout]);
  useLayoutEffect(() => {
    if (framed.current) return;
    const vp = size();
    if (!vp.w || !vp.h) return;
    framed.current = true;
    frameMe(false);
  });
  useEffect(() => {
    const onResize = () => {
      if (!touched.current) frameMe(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [frameMe]);

  const zoomBy = useCallback(
    (factor: number) => {
      const vp = size();
      apply(zoomAt(tRef.current, factor, vp.w / 2, vp.h / 2), true);
      touched.current = true;
    },
    [apply, size],
  );

  // Roda do mouse / pinça do trackpad: zoom no cursor (listener nativo não passivo para evitar rolar a página).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0016));
      apply(zoomAt(tRef.current, factor, event.clientX - rect.left, event.clientY - rect.top), false);
      touched.current = true;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply]);

  /* Gestos por pointer events: 1 dedo/mouse = pan; 2 dedos = pinça. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; t: Transform; moved: boolean } | null>(null);
  const pinch = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      drag.current = { x: event.clientX, y: event.clientY, t: tRef.current, moved: false };
      pinch.current = null;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
      drag.current = null;
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = event.currentTarget.getBoundingClientRect();
      if (dist > 0) {
        apply(zoomAt(tRef.current, dist / pinch.current, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top), false);
        pinch.current = dist;
        touched.current = true;
      }
      suppressClick.current = true;
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      // Só captura depois de arrastar: um toque simples continua clicando no nó.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* ponteiro sintético / já solto */
      }
    }
    apply({ ...d.t, x: d.t.x + dx, y: d.t.y + dy }, false);
    touched.current = true;
  };
  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (drag.current?.moved || pinch.current) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    }
    if (pointers.current.size === 0) {
      drag.current = null;
      pinch.current = null;
    } else if (pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()];
      pinch.current = null;
      drag.current = rest ? { x: rest.x, y: rest.y, t: tRef.current, moved: true } : null;
    }
  };

  const openLevel = useCallback((level: HierarchyLevel) => setSelectedId(level.id), []);
  const selected = selectedId === null ? null : (h.levels.find((l) => l.id === selectedId) ?? null);

  const nextName = progress.next?.name;
  const summary = h.me?.isStaff ? (
    <>
      <strong>Você faz parte da equipe do grupo</strong>
      <span>{plural(h.totalStudents, "aluno no grupo", "alunos no grupo")}</span>
    </>
  ) : h.me ? (
    <>
      <strong>{plural(h.higherCount, "pessoa acima de você", "pessoas acima de você")}</strong>
      <span>
        {progress.mineIndex < 0
          ? "Você ainda não tem uma corda"
          : progress.next
            ? `Próximo nível: ${nextName} · ${progress.levelsAbove === 1 ? "falta 1 nível" : `faltam ${progress.levelsAbove} níveis`} até ${progress.top?.name ?? "o topo"}`
            : "Você está no nível mais alto do grupo"}
      </span>
    </>
  ) : (
    <strong>{plural(h.totalStudents, "aluno no grupo", "alunos no grupo")}</strong>
  );

  return (
    <section
      className="hier"
      aria-label="Hierarquia do grupo"
      data-sheet={selected ? "true" : "false"}
      onKeyDown={(event) => {
        if (event.key === "Escape" && selected) setSelectedId(null);
        else if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
        else if (event.key === "-") zoomBy(1 / ZOOM_STEP);
      }}
    >
      <div
        className="hier-viewport"
        ref={viewportRef}
        tabIndex={0}
        aria-label="Área da árvore: arraste para mover, use a roda ou a pinça para aproximar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div
          className={`hier-world ${animate ? "is-animating" : ""}`}
          data-testid="hier-world"
          data-scale={t.scale.toFixed(3)}
          style={{ width: layout.width, height: layout.height, transform: cssTransform(t) }}
        >
          <svg className="hier-edges" width={layout.width} height={layout.height} viewBox={`${-off} 0 ${layout.width} ${layout.height}`} aria-hidden="true">
            {layout.edges.map((edge) => (
              <path key={edge.key} d={edge.d} className={`hier-edge is-${edge.tone}`} />
            ))}
          </svg>
          {layout.nodes.map((node) => (
            <div
              key={node.key}
              className={`hier-node is-${node.kind}`}
              style={{ left: node.x + off, top: node.y, width: node.w, minHeight: node.h, "--i": node.order } as CSSProperties}
            >
              {renderNode(node, h, selectedId, openLevel, layout.belowLevels)}
            </div>
          ))}
        </div>
      </div>

      <div className="map-hud">
        <div className="hier-hud-top" ref={hudRef}>
          <div className="map-float map-switch">{viewToggle}</div>
          <div className="map-float hier-summary" data-testid="hier-summary">
            {summary}
          </div>
        </div>
        <div className="hier-controls map-float" role="group" aria-label="Controles do mapa da hierarquia">
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)} aria-label="Aproximar">
            <Plus aria-hidden="true" />
          </button>
          <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="Afastar">
            <Minus aria-hidden="true" />
          </button>
          <button type="button" onClick={() => frameMe(true)} aria-label="Centralizar em mim">
            <Locate aria-hidden="true" />
          </button>
          <button type="button" onClick={frameAll} aria-label="Ver tudo">
            <Maximize2 aria-hidden="true" />
          </button>
        </div>
        {!selected && (
          <ul className="hier-legend map-float" aria-label="Legenda">
            <li>
              <i className="lg-me" /> Você
            </li>
            {hasMyTeacher(h) && (
              <li>
                <i className="lg-teacher" /> Seu professor
              </li>
            )}
            <li>
              <i className="lg-above" /> Acima de você
            </li>
            <li>
              <i className="lg-below" /> Abaixo
            </li>
          </ul>
        )}
        {selected && <LevelSheet level={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </section>
  );
}
