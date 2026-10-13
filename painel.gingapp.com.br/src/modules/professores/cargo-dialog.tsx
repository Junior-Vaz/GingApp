import { useEffect, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { RoleBadge } from "@/components/painel/role-badges";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api";
import { HEX_COLOR, ROLE_COLOR_PALETTE, ROLE_ICON_NAMES, ROLE_ICONS } from "@/lib/role-style";
import { ACCESS_ROLE_SUMMARY, STAFF_ROLES, STAFF_ROLE_LABEL, type AccessRole } from "@/lib/staff-roles";
import { cn } from "@/lib/utils";
import {
  errorCode,
  useCreateGroupRole,
  useUpdateGroupRole,
  type GroupRole,
  type GroupRoleCreateInput,
  type GroupRoleUpdateInput,
} from "./roles-api";

const NAME_MIN = 2;
const NAME_MAX = 30;

interface FormState {
  name: string;
  accessRole: AccessRole;
  color: string;
  icon: string;
  rank: string;
  active: boolean;
}

const EMPTY: FormState = { name: "", accessRole: "PROFESSOR", color: "", icon: "", rank: "", active: true };

const toForm = (role: GroupRole): FormState => ({
  name: role.name,
  accessRole: role.accessRole,
  color: role.color ?? "",
  icon: role.icon ?? "",
  rank: String(role.rank),
  active: role.active,
});

/** Normaliza o hex digitado (aceita sem `#`) para `#RRGGBB` em maiúsculas; deixa como está se ainda for inválido. */
function normalizeHex(value: string): string {
  const trimmed = value.trim();
  const withHash = trimmed === "" || trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return HEX_COLOR.test(withHash) ? withHash.toUpperCase() : withHash;
}

/**
 * Criar/editar um cargo do grupo (só o Mestre): nome, perfil de acesso (cartões), cor (paleta + hex), ícone (grade),
 * rank opcional e ativo. `target` = `"new"` para criar ou o cargo a editar; `null` fecha. Erros do servidor viram toast
 * (com a `message` dele) e o diálogo continua aberto.
 */
export function CargoDialog({ target, onClose }: { target: GroupRole | "new" | null; onClose: () => void }) {
  const create = useCreateGroupRole();
  const update = useUpdateGroupRole();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [nameError, setNameError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const editing = target !== null && target !== "new" ? target : null;
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    setForm(editing ? toForm(editing) : EMPTY);
    setNameError(null);
    setColorError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reinicia só ao abrir/trocar o cargo
  }, [target]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const peopleBlock = editing !== null && editing.peopleCount > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = form.name.trim();
    const color = normalizeHex(form.color);
    let invalid = false;
    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      setNameError(`O nome precisa ter de ${NAME_MIN} a ${NAME_MAX} caracteres.`);
      invalid = true;
    } else setNameError(null);
    if (color !== "" && !HEX_COLOR.test(color)) {
      setColorError("Use uma cor no formato #RRGGBB (ex.: #B45309).");
      invalid = true;
    } else setColorError(null);
    const rankText = form.rank.trim();
    const rank = rankText === "" ? undefined : Number(rankText);
    if (rank !== undefined && !Number.isInteger(rank)) invalid = true;
    if (invalid) return;

    try {
      if (editing) {
        const data: GroupRoleUpdateInput = {};
        if (name !== editing.name) data.name = name;
        if (form.accessRole !== editing.accessRole) data.accessRole = form.accessRole;
        if (rank !== undefined && rank !== editing.rank) data.rank = rank;
        if (color !== (editing.color ?? "")) data.color = color === "" ? null : color;
        if (form.icon !== (editing.icon ?? "")) data.icon = form.icon === "" ? null : form.icon;
        if (form.active !== editing.active) data.active = form.active;
        if (Object.keys(data).length > 0) await update.mutateAsync({ id: editing.id, data });
      } else {
        const data: GroupRoleCreateInput = { name, accessRole: form.accessRole };
        if (rank !== undefined) data.rank = rank;
        if (color !== "") data.color = color;
        if (form.icon !== "") data.icon = form.icon;
        if (!form.active) data.active = false;
        await create.mutateAsync(data);
      }
      onClose();
    } catch (error) {
      // O toast com a `message` do servidor já saiu no hook; nome inválido/repetido também aparece junto ao campo.
      const code = errorCode(error);
      if ((code === "INVALID_GROUP_ROLE_NAME" || code === "GROUP_ROLE_NAME_TAKEN") && error instanceof ApiError) {
        setNameError(error.message);
      }
    }
  }

  const colorValue = normalizeHex(form.color);
  const previewColor = HEX_COLOR.test(colorValue) ? colorValue : null;

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[92dvh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden max-sm:overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar cargo" : "Novo cargo"}</DialogTitle>
          <DialogDescription>
            O perfil de acesso define o que a pessoa pode fazer no painel; o nome, a cor e o ícone são só o selo do cargo.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4"
        >
          <div className="-mx-1 grid min-h-0 content-start gap-5 overflow-y-auto px-1">
            <div className="grid gap-1.5">
              <Label htmlFor="cargo-name">Nome do cargo</Label>
              <Input
                id="cargo-name"
                value={form.name}
                maxLength={NAME_MAX + 10}
                placeholder="Ex.: Contramestre"
                autoComplete="off"
                aria-invalid={nameError !== null}
                onChange={(e) => set("name", e.target.value)}
              />
              {nameError && (
                <p role="alert" className="text-sm text-destructive">
                  {nameError}
                </p>
              )}
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Perfil de acesso</legend>
              <div role="radiogroup" aria-label="Perfil de acesso" className="grid gap-2 sm:grid-cols-2">
                {STAFF_ROLES.map((role) => {
                  const selected = form.accessRole === role;
                  return (
                    <button
                      key={role}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-testid={`access-card-${role}`}
                      onClick={() => set("accessRole", role)}
                      className={cn(
                        "flex flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected && "border-primary bg-primary/5 ring-1 ring-primary",
                      )}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        {STAFF_ROLE_LABEL[role]}
                        {selected && <Check className="size-4 text-primary" aria-hidden="true" />}
                      </span>
                      <span className="text-xs text-muted-foreground">{ACCESS_ROLE_SUMMARY[role]}</span>
                    </button>
                  );
                })}
              </div>
              {peopleBlock && (
                <p className="text-xs text-muted-foreground">
                  Este cargo tem {editing.peopleCount} pessoa(s). Para mudar o perfil de acesso, migre antes as pessoas para
                  outro cargo.
                </p>
              )}
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Cor</legend>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-label="Sem cor"
                  aria-pressed={form.color === ""}
                  onClick={() => set("color", "")}
                  className={cn(
                    "grid size-8 place-items-center rounded-full border border-dashed text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    form.color === "" && "ring-2 ring-primary",
                  )}
                >
                  —
                </button>
                {ROLE_COLOR_PALETTE.map((swatch) => {
                  const selected = colorValue.toUpperCase() === swatch.value;
                  return (
                    <button
                      key={swatch.value}
                      type="button"
                      aria-label={`Cor ${swatch.label}`}
                      aria-pressed={selected}
                      title={swatch.label}
                      onClick={() => set("color", swatch.value)}
                      style={{ backgroundColor: swatch.value }}
                      className={cn(
                        "grid size-8 place-items-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                      )}
                    >
                      {selected && <Check className="size-4 text-white" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-1.5 sm:max-w-48">
                <Label htmlFor="cargo-color" className="text-xs text-muted-foreground">
                  Ou digite a cor (#RRGGBB)
                </Label>
                <Input
                  id="cargo-color"
                  value={form.color}
                  placeholder="#B45309"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={colorError !== null}
                  onChange={(e) => set("color", e.target.value)}
                />
              </div>
              {colorError && (
                <p role="alert" className="text-sm text-destructive">
                  {colorError}
                </p>
              )}
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Ícone</legend>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2">
                <button
                  type="button"
                  aria-label="Sem ícone"
                  aria-pressed={form.icon === ""}
                  onClick={() => set("icon", "")}
                  className={cn(
                    "grid h-11 place-items-center rounded-md border border-dashed text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    form.icon === "" && "border-primary bg-primary/5 ring-1 ring-primary",
                  )}
                >
                  —
                </button>
                {ROLE_ICON_NAMES.map((iconName) => {
                  const Icon = ROLE_ICONS[iconName]!;
                  const selected = form.icon === iconName;
                  return (
                    <button
                      key={iconName}
                      type="button"
                      aria-label={`Ícone ${iconName}`}
                      aria-pressed={selected}
                      title={iconName}
                      onClick={() => set("icon", iconName)}
                      className={cn(
                        "grid h-11 place-items-center rounded-md border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected && "border-primary bg-primary/5 ring-1 ring-primary",
                      )}
                    >
                      <Icon className="size-5" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="cargo-rank">Rank (opcional)</Label>
                <Input
                  id="cargo-rank"
                  type="number"
                  inputMode="numeric"
                  value={form.rank}
                  placeholder="Automático"
                  onChange={(e) => set("rank", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Maior = mais sênior. Também dá para reordenar na lista.</p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:self-start">
                <div>
                  <Label htmlFor="cargo-active">Cargo ativo</Label>
                  <p className="text-xs text-muted-foreground">Só cargos ativos podem ser dados a alguém.</p>
                </div>
                <Switch id="cargo-active" checked={form.active} onCheckedChange={(checked) => set("active", checked)} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="cargo-preview">
              Selo:
              <RoleBadge
                badge={{ name: form.name.trim() || "Nome do cargo", color: previewColor, icon: form.icon || null }}
              />
            </div>
          </div>
          <DialogFooter className="border-t pt-4 max-sm:flex-row max-sm:gap-2 max-sm:pt-3 max-sm:[&>button]:flex-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
