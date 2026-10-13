import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { plural } from "@/lib/plural";
import { NativeSelect } from "@/modules/alunos/native-select";
import {
  errorCode,
  errorPeopleCount,
  roleErrorMessage,
  useDeleteGroupRole,
  useMigrateGroupRole,
  useUpdateGroupRole,
  type GroupRole,
} from "./roles-api";

/** O que fazer com o cargo: excluir, inativar ou só migrar as pessoas dele para outro cargo. */
export type CargoUsoMode = "delete" | "deactivate" | "migrate";

export interface CargoUsoTarget {
  role: GroupRole;
  mode: CargoUsoMode;
}

/**
 * Excluir / inativar / migrar um cargo do grupo. Sem ninguém no cargo, excluir é uma confirmação simples (DELETE);
 * com gente (ou se o servidor responder 409 GROUP_ROLE_IN_USE) o painel explica e oferece "Migrar pessoas para…"
 * (POST /group-roles/:id/migrate) seguido de excluir ou inativar. Erros do servidor viram toast com a `message` dele.
 */
export function CargoUsoDialog({
  target,
  roles,
  onClose,
}: {
  target: CargoUsoTarget | null;
  roles: GroupRole[];
  onClose: () => void;
}) {
  const remove = useDeleteGroupRole();
  const migrate = useMigrateGroupRole();
  const update = useUpdateGroupRole();
  const [inUse, setInUse] = useState<number | null>(null);
  const [targetId, setTargetId] = useState("");
  const busy = remove.isPending || migrate.isPending || update.isPending;

  const role = target?.role ?? null;
  const mode = target?.mode ?? "delete";
  // Destinos possíveis: os outros cargos ATIVOS (o servidor recusa cargo inativo: GROUP_ROLE_INACTIVE).
  const destinations = roles.filter((other) => other.active && other.id !== role?.id);
  // Preferência: o cargo com o mesmo perfil de acesso e rank mais próximo.
  const suggested = role
    ? ([...destinations].sort(
        (a, b) =>
          Number(b.accessRole === role.accessRole) - Number(a.accessRole === role.accessRole) ||
          Math.abs(a.rank - role.rank) - Math.abs(b.rank - role.rank),
      )[0] ?? null)
    : null;

  useEffect(() => {
    if (!target) return;
    setInUse(mode === "delete" ? (target.role.peopleCount > 0 ? target.role.peopleCount : null) : target.role.peopleCount);
    setTargetId(suggested ? String(suggested.id) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reinicia só ao abrir
  }, [target]);

  if (!role) return null;
  const people = inUse ?? 0;
  const needsMigration = inUse !== null && inUse > 0;
  const chosenId = Number(targetId);

  async function doDelete() {
    try {
      await remove.mutateAsync(role!.id);
      toast.success(`Cargo "${role!.name}" excluído.`);
      onClose();
    } catch (error) {
      if (errorCode(error) === "GROUP_ROLE_IN_USE") setInUse(errorPeopleCount(error) ?? Math.max(role!.peopleCount, 1));
      else toast.error(roleErrorMessage(error, "Não foi possível excluir o cargo."));
    }
  }

  /** Migra as pessoas e, se pedido, exclui ou inativa o cargo (se a migração falhar, para; o hook já avisou). */
  async function migrateThen(after: CargoUsoMode) {
    try {
      await migrate.mutateAsync({ id: role!.id, targetGroupRoleId: chosenId });
    } catch {
      return;
    }
    try {
      if (after === "delete") {
        await remove.mutateAsync(role!.id);
        toast.success(`Cargo "${role!.name}" excluído.`);
      } else if (after === "deactivate") {
        await update.mutateAsync({ id: role!.id, data: { active: false } });
      }
      onClose();
    } catch (error) {
      toast.error(roleErrorMessage(error, "As pessoas foram migradas, mas não foi possível concluir."));
    }
  }

  const title =
    mode === "migrate"
      ? `Migrar pessoas de "${role.name}"`
      : needsMigration
        ? `Migrar as pessoas de "${role.name}"?`
        : `Excluir o cargo "${role.name}"?`;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {needsMigration
              ? `${plural(people, "pessoa")} ${people === 1 ? "exerce" : "exercem"} este cargo. Para ${
                  mode === "migrate" ? "mudar o cargo delas" : mode === "deactivate" ? "inativá-lo" : "excluí-lo"
                }, mova antes ${people === 1 ? "essa pessoa" : "essas pessoas"} para outro cargo ativo do grupo.`
              : "O cargo não tem ninguém e será removido do grupo. Esta ação não pode ser desfeita."}
          </DialogDescription>
        </DialogHeader>
        {needsMigration && (
          <div className="grid gap-1.5">
            <Label htmlFor="cargo-migrate-to">Migrar pessoas para…</Label>
            <NativeSelect
              id="cargo-migrate-to"
              value={targetId}
              disabled={busy || destinations.length === 0}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {destinations.map((other) => (
                <option key={other.id} value={String(other.id)}>
                  {other.name}
                </option>
              ))}
            </NativeSelect>
            {destinations.length === 0 && (
              <p className="text-xs text-muted-foreground">Não há outro cargo ativo para receber as pessoas.</p>
            )}
          </div>
        )}
        <DialogFooter className="max-sm:gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          {!needsMigration && (
            <Button type="button" variant="destructive" onClick={() => void doDelete()} disabled={busy}>
              {remove.isPending ? "Excluindo…" : "Excluir cargo"}
            </Button>
          )}
          {needsMigration && mode === "migrate" && (
            <Button type="button" onClick={() => void migrateThen("migrate")} disabled={busy || targetId === ""}>
              {migrate.isPending ? "Migrando…" : "Migrar pessoas"}
            </Button>
          )}
          {needsMigration && mode !== "migrate" && role.active && mode === "delete" && (
            <Button type="button" variant="outline" onClick={() => void migrateThen("deactivate")} disabled={busy || targetId === ""}>
              Migrar e inativar
            </Button>
          )}
          {needsMigration && mode === "deactivate" && (
            <Button type="button" onClick={() => void migrateThen("deactivate")} disabled={busy || targetId === ""}>
              {busy ? "Migrando…" : "Migrar e inativar"}
            </Button>
          )}
          {needsMigration && mode === "delete" && !role.isDefault && (
            <Button type="button" variant="destructive" onClick={() => void migrateThen("delete")} disabled={busy || targetId === ""}>
              {busy ? "Migrando…" : "Migrar e excluir"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
