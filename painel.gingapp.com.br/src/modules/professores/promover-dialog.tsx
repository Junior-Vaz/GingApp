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
import { promotableRoles, STAFF_ROLE_LABEL, type StaffRole } from "@/lib/staff-roles";
import { NativeSelect } from "@/modules/alunos/native-select";
import { useGrantRole } from "./use-grant-role";

/** Quem vai ser promovido: a matrícula de aluno e os cargos que ela já tem (para oferecer só os MAIORES). */
export interface PromoteTarget {
  studentId: number;
  name: string;
  email?: string | null | undefined;
  roles: StaffRole[];
}

/**
 * "Promover a…": o Mestre escolhe um cargo MAIOR que os atuais da pessoa (POST /roles/grant). Sem login ainda, o
 * servidor responde LOGIN_REQUIRED e o painel pede e-mail + senha provisória (ou convite) e reenvia.
 */
export function PromoverDialog({ target, onClose }: { target: PromoteTarget | null; onClose: () => void }) {
  const options = promotableRoles(target?.roles);
  const [role, setRole] = useState<StaffRole | "">("");
  const { grant, isPending, awaitingLogin, loginDialog } = useGrantRole({ onGranted: onClose });

  useEffect(() => {
    setRole(promotableRoles(target?.roles)[0] ?? "");
  }, [target]);

  async function submit() {
    if (!target || role === "") return;
    await grant({ studentId: target.studentId, role, name: target.name, email: target.email });
  }

  return (
    <>
      <Dialog open={target !== null && !awaitingLogin} onOpenChange={(open) => !open && !isPending && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promover a…</DialogTitle>
            <DialogDescription>
              {target
                ? `Escolha o novo cargo de ${target.name}. Os cargos se somam e o maior vira o acesso dele ao painel; a matrícula de aluno continua.`
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
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              disabled={isPending || options.length === 0}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {STAFF_ROLE_LABEL[option]}
                </option>
              ))}
            </NativeSelect>
            {options.length === 0 && (
              <p className="text-xs text-muted-foreground">Esta pessoa já tem o maior cargo.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={isPending || role === ""}>
              <ArrowUpCircle /> {isPending ? "Promovendo…" : "Promover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {loginDialog}
    </>
  );
}
