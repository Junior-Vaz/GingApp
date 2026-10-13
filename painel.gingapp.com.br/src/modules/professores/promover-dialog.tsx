import { useEffect, useState } from "react";
import { ArrowUpCircle } from "lucide-react";
import { RoleBadges } from "@/components/painel/role-badges";
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
import { promotableGroupRoles, type RoleBadgeData } from "@/lib/staff-roles";
import { NativeSelect } from "@/modules/alunos/native-select";
import { useGroupRoles } from "./roles-api";
import { useGrantRole } from "./use-grant-role";

/** Quem vai ser promovido: a matrícula de aluno e os cargos que ela já tem (para oferecer só os MAIORES). */
export interface PromoteTarget {
  studentId: number;
  name: string;
  email?: string | null | undefined;
  roles: RoleBadgeData[];
}

/**
 * "Promover a…": o Mestre escolhe um cargo ATIVO do grupo e MAIOR que os atuais da pessoa (POST /roles/grant com
 * `groupRoleId`). Sem login ainda, o servidor responde LOGIN_REQUIRED e o painel pede e-mail + senha provisória (ou
 * convite) e reenvia.
 */
export function PromoverDialog({ target, onClose }: { target: PromoteTarget | null; onClose: () => void }) {
  const groupRoles = useGroupRoles(target !== null);
  const options = promotableGroupRoles(groupRoles.data, target?.roles);
  const [roleId, setRoleId] = useState("");
  const { grant, isPending, awaitingLogin, loginDialog } = useGrantRole({ onGranted: onClose });

  // Preseleciona o próximo cargo acima (o de menor rank entre os oferecidos) quando a lista chega.
  const firstOptionId = options[0]?.id;
  useEffect(() => {
    setRoleId(firstOptionId === undefined ? "" : String(firstOptionId));
  }, [target, firstOptionId]);

  async function submit() {
    const chosen = options.find((option) => String(option.id) === roleId);
    if (!target || !chosen) return;
    await grant({ studentId: target.studentId, groupRoleId: chosen.id, roleName: chosen.name, name: target.name, email: target.email });
  }

  return (
    <>
      <Dialog open={target !== null && !awaitingLogin} onOpenChange={(open) => !open && !isPending && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promover a…</DialogTitle>
            <DialogDescription>
              {target
                ? `Escolha o novo cargo de ${target.name}. Os cargos se somam e o de maior rank vira o selo principal; a matrícula de aluno continua.`
                : undefined}
            </DialogDescription>
          </DialogHeader>
          {target && target.roles.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              Cargos atuais: <RoleBadges roles={target.roles} />
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="promote-role">Novo cargo</Label>
            <NativeSelect
              id="promote-role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              disabled={isPending || options.length === 0}
            >
              {options.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.name}
                </option>
              ))}
            </NativeSelect>
            {groupRoles.isLoading && <p className="text-xs text-muted-foreground">Carregando os cargos do grupo…</p>}
            {groupRoles.error && <p className="text-xs text-destructive">Não foi possível carregar os cargos do grupo.</p>}
            {groupRoles.data && options.length === 0 && (
              <p className="text-xs text-muted-foreground">Esta pessoa já tem o maior cargo.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={isPending || roleId === ""}>
              <ArrowUpCircle /> {isPending ? "Promovendo…" : "Promover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {loginDialog}
    </>
  );
}
