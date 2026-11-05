import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Award, Lock, Pencil, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ApiError, errorMessage } from "@/lib/api";
import { useStudentScope } from "@/lib/queries";
import { useSaveRankingSettings } from "@/lib/ranking";
import {
  SHOWCASE_MAX,
  rarityText,
  statementFullDate,
  useRankingAchievements,
  type AchievementView,
} from "@/lib/ranking-student";
import { cn } from "@/lib/utils";
import { ProfileCard } from "./profile-parts";
import { TIER_LABEL, achievementIconFor, familyLabel, tierClass } from "./ranking-icons";

/** Texto do nível em palavras (a cor nunca é a única pista). */
const tierWord = (item: Pick<AchievementView, "tier">): string | null => (item.tier ? TIER_LABEL[item.tier] : null);

/** Descrição falada de uma conquista: nome, nível, estado, progresso e raridade. */
function spokenLabel(item: AchievementView): string {
  const parts = [item.name];
  const tier = tierWord(item);
  if (tier) parts.push(`medalha de ${tier.toLowerCase()}`);
  parts.push(item.earned ? "conquistada" : "ainda não conquistada");
  if (!item.earned && item.progress) parts.push(`${item.progress.current} de ${item.progress.target}`);
  const rarity = rarityText(item.rarityPct);
  if (rarity) parts.push(rarity);
  return parts.join(", ");
}

/* ---------- Medalha ---------- */

function Medal({ item, large = false }: { item: AchievementView; large?: boolean }) {
  const Icon = achievementIconFor(item.icon, item.family);
  return (
    <span className={cn("rkp-medal", tierClass(item.tier), item.earned ? "is-earned" : "is-locked", large && "is-lg")} aria-hidden="true">
      <Icon />
      {!item.earned && <Lock className="rkp-medal-lock" />}
    </span>
  );
}

function ProgressBar({ item }: { item: AchievementView }) {
  if (!item.progress) return null;
  const { current, target } = item.progress;
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0;
  return (
    <span className="rkp-ach-prog">
      <span
        className="rkp-ach-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(current, target)}
        aria-label={`Progresso de ${item.name}`}
      >
        <i style={{ width: `${pct}%` }} />
      </span>
      <small>
        {current}/{target}
      </small>
    </span>
  );
}

/* ---------- Vitrine ---------- */

function ShowcaseMedals({ items, onOpen }: { items: AchievementView[]; onOpen?: (item: AchievementView) => void }) {
  return (
    <ul className="rkp-showcase" aria-label="Conquistas em destaque" data-testid="rkp-showcase">
      {items.map((item) => (
        <li key={item.code} data-testid="rkp-showcase-item" data-code={item.code}>
          {onOpen ? (
            <button type="button" className="rkp-showcase-btn" aria-label={spokenLabel(item)} onClick={() => onOpen(item)}>
              <Medal item={item} large />
              <strong>{item.name}</strong>
              {tierWord(item) && <span className="rkp-tier">{tierWord(item)}</span>}
            </button>
          ) : (
            <div className="rkp-showcase-btn" role="group" aria-label={spokenLabel(item)}>
              <Medal item={item} large />
              <strong>{item.name}</strong>
              {tierWord(item) && <span className="rkp-tier">{tierWord(item)}</span>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Itens da vitrine na ordem escolhida (só as que continuam ganhas). */
const showcaseItems = (items: AchievementView[], codes: string[]): AchievementView[] =>
  codes.map((code) => items.find((item) => item.code === code)).filter((item): item is AchievementView => item !== undefined && item.earned);

/** Vitrine em destaque no topo de "Meu progresso": some quando está vazia, carregando ou com erro (nunca mensagem de erro aqui). */
export function ShowcaseHighlight({ className }: { className?: string }) {
  const query = useRankingAchievements();
  const [open, setOpen] = useState<AchievementView | null>(null);
  const items = query.data ? showcaseItems(query.data.items, query.data.showcase) : [];
  if (items.length === 0) return null;
  return (
    <section className={cn("rk-card rkp-card rkp-highlight", className)} aria-labelledby="rkp-showcase-title" data-testid="rkp-showcase-card">
      <h3 id="rkp-showcase-title" className="rkp-title">
        <Star aria-hidden="true" /> Minha vitrine
      </h3>
      <ShowcaseMedals items={items} onOpen={setOpen} />
      <AchievementDialog item={open} onClose={() => setOpen(null)} />
    </section>
  );
}

/** Vitrine no perfil do aluno ativo (só aparece com conquistas escolhidas). */
export function ProfileShowcase() {
  const query = useRankingAchievements();
  const items = query.data ? showcaseItems(query.data.items, query.data.showcase) : [];
  if (items.length === 0) return null;
  return (
    <ProfileCard
      icon={Award}
      title="Minhas conquistas"
      id="pf-showcase-title"
      testId="profile-showcase"
      aside={
        <Link to="/ranking" className="text-xs font-semibold text-primary underline">
          Ver todas
        </Link>
      }
    >
      <ShowcaseMedals items={items} />
    </ProfileCard>
  );
}

/* ---------- Detalhe ---------- */

function AchievementDialog({ item, onClose }: { item: AchievementView | null; onClose: () => void }) {
  const rarity = item ? rarityText(item.rarityPct) : null;
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rk-dialog">
        {item && (
          <>
            <Medal item={item} large />
            <DialogTitle className="text-center">{item.name}</DialogTitle>
            <DialogDescription className="text-center">
              {item.earned && item.earnedAt ? `Conquistada em ${statementFullDate(item.earnedAt)}` : item.earned ? "Conquistada" : "Ainda não conquistada"}
            </DialogDescription>
            <p className="rkp-dialog-chips">
              {tierWord(item) && <span className={cn("rkp-tier", tierClass(item.tier))}>{tierWord(item)}</span>}
              <span className="rkp-tier is-family">{familyLabel(item.family)}</span>
            </p>
            <p className="rk-dialog-text">{item.earned ? item.description : `Como conquistar: ${item.description}`}</p>
            {!item.earned && <ProgressBar item={item} />}
            {rarity && (
              <p className="rkp-rarity" data-testid="rkp-dialog-rarity">
                {rarity}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Tela "Conquistas" ---------- */

function groupByFamily(items: AchievementView[]): { family: string; items: AchievementView[] }[] {
  const groups: { family: string; items: AchievementView[] }[] = [];
  for (const item of items) {
    const group = groups.find((entry) => entry.family === item.family);
    if (group) group.items.push(item);
    else groups.push({ family: item.family, items: [item] });
  }
  return groups;
}

function saveFailure(error: unknown): string {
  if (error instanceof ApiError && error.code === "ACHIEVEMENT_NOT_EARNED") return "Só dá para pôr na vitrine conquistas que você já ganhou.";
  return errorMessage(error, "Não foi possível salvar a vitrine agora. Tente de novo.");
}

export function AchievementsView() {
  const scope = useStudentScope();
  const query = useRankingAchievements();
  const save = useSaveRankingSettings();
  const [open, setOpen] = useState<AchievementView | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  if (scope.ready && scope.studentId === undefined) {
    return (
      <div className="rk-empty" role="status" data-testid="rkp-no-student">
        <strong>Nenhum aluno vinculado a esta conta.</strong>
        <p>Quando houver um aluno ligado, as conquistas dele aparecem aqui.</p>
      </div>
    );
  }
  if (query.isLoading) {
    return (
      <section className="rk-card rkp-card" aria-busy="true" aria-label="Carregando conquistas" data-testid="rkp-ach-loading">
        <span className="rk-skel rk-skel-line" style={{ width: "40%" }} />
        <div className="rkp-ach-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="rk-skel rk-skel-step" style={{ height: 120, borderRadius: 14 }} />
          ))}
        </div>
      </section>
    );
  }
  if (query.isError || !query.data) {
    return (
      <section className="rk-card rkp-card" data-testid="rkp-ach-error">
        <div className="rkp-error" role="alert">
          <p>{errorMessage(query.error, "Não foi possível carregar as conquistas.")}</p>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        </div>
      </section>
    );
  }

  const data = query.data;
  const groups = groupByFamily(data.items);
  const earnedTotal = data.earnedCount ?? data.items.filter((item) => item.earned).length;
  const total = data.totalCount ?? data.items.length;
  const savedShowcase = showcaseItems(data.items, data.showcase);
  const previewCodes = editing ? draft : data.showcase;
  const preview = showcaseItems(data.items, previewCodes);

  function startEditing() {
    setDraft(savedShowcase.map((item) => item.code));
    setProblem(null);
    setEditing(true);
  }

  function toggle(code: string) {
    setDraft((current) => (current.includes(code) ? current.filter((value) => value !== code) : current.length >= SHOWCASE_MAX ? current : [...current, code]));
  }

  async function saveShowcase() {
    setProblem(null);
    try {
      await save.mutateAsync({ showcase: draft });
      toast.success("Vitrine salva!");
      setEditing(false);
    } catch (error) {
      setProblem(saveFailure(error));
    }
  }

  return (
    <div className="rkp-ach-page" data-testid="rk-achievements">
      <section className="rk-card rkp-card rkp-showcase-card" aria-labelledby="rkp-ach-showcase-title">
        <div className="rkp-showcase-head">
          <h3 id="rkp-ach-showcase-title" className="rkp-title">
            <Star aria-hidden="true" /> Minha vitrine
          </h3>
          {!editing && (
            <Button type="button" variant="outline" className="min-h-11" disabled={earnedTotal === 0} onClick={startEditing}>
              <Pencil aria-hidden="true" /> {savedShowcase.length > 0 ? "Editar vitrine" : "Escolher vitrine"}
            </Button>
          )}
        </div>
        {preview.length > 0 ? (
          <ShowcaseMedals items={preview} />
        ) : (
          <p className="rkp-empty" data-testid="rkp-showcase-empty">
            {earnedTotal === 0
              ? `Ganhe sua primeira conquista para montar a vitrine (até ${SHOWCASE_MAX}).`
              : `Sua vitrine está vazia. Escolha até ${SHOWCASE_MAX} conquistas para destacar no seu perfil.`}
          </p>
        )}
        {editing && (
          <div className="rkp-edit" data-testid="rkp-showcase-edit">
            <p role="status">
              Toque nas conquistas ganhas que quer destacar: <strong data-testid="rkp-showcase-count">{draft.length} de {SHOWCASE_MAX}</strong>
            </p>
            {problem && (
              <p className="rk-problem" role="alert" data-testid="rkp-showcase-error">
                {problem}
              </p>
            )}
            <div className="rkp-edit-actions">
              <Button type="button" className="min-h-11" disabled={save.isPending} onClick={() => void saveShowcase()}>
                {save.isPending ? "Salvando…" : "Salvar vitrine"}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={save.isPending} onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </section>

      <div className="rkp-ach-count" data-testid="rkp-ach-count">
        <strong>
          {earnedTotal} de {total}
        </strong>{" "}
        conquistas
      </div>

      {groups.map((group) => (
        <section key={group.family} className="rk-card rkp-card" aria-labelledby={`rkp-fam-${group.family}`} data-testid="rkp-family">
          <h3 id={`rkp-fam-${group.family}`} className="rkp-title">
            {familyLabel(group.family)}
          </h3>
          <ul className="rkp-ach-grid">
            {group.items.map((item) => {
              const rarity = rarityText(item.rarityPct);
              const selected = draft.includes(item.code);
              const blocked = editing && (!item.earned || (!selected && draft.length >= SHOWCASE_MAX));
              return (
                <li key={item.code}>
                  <button
                    type="button"
                    className={cn("rkp-ach", item.earned ? "is-earned" : "is-locked", editing && selected && "is-selected")}
                    data-testid="rkp-ach"
                    data-code={item.code}
                    data-earned={item.earned ? "true" : "false"}
                    aria-label={spokenLabel(item)}
                    aria-pressed={editing ? selected : undefined}
                    disabled={blocked}
                    onClick={() => (editing ? toggle(item.code) : setOpen(item))}
                  >
                    <Medal item={item} />
                    <span className="rkp-ach-name">{item.name}</span>
                    {tierWord(item) && <span className={cn("rkp-tier", tierClass(item.tier))}>{tierWord(item)}</span>}
                    {item.earned ? <span className="rkp-ach-state">{editing && selected ? "Na vitrine" : "Conquistada"}</span> : <ProgressBar item={item} />}
                    {rarity && (
                      <span className="rkp-ach-rarity" data-testid="rkp-rarity">
                        {rarity}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <AchievementDialog item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
