import { useEffect, useState } from "react";
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
import { sortRoles, STAFF_ROLE_LABEL, type StaffRole } from "@/lib/staff-roles";
import { NativeSelect } from "@/modules/alunos/native-select";
import { useRevokeRole } from "./roles-api";

/** De quem tirar o cargo: a matrícula de aluno e os cargos que ela tem. */
export interface RevokeTarget {
  studentId: number;
  name: string;
  roles: StaffRole[];
}

/**
 * "Revogar cargo": confirmação (POST /roles/revoke). Com mais de um cargo o Mestre escolhe qual; a matrícula de aluno
 * é mantida. O servidor recusa o último Mestre do grupo (LAST_MESTRE) e o painel explica o motivo.
 */
export function RevogarDialog({ target, onClose }: { target: RevokeTarget | null; onClose: () => void }) {
  const roles = sortRoles(target?.roles);
  const [role, setRole] = useState<StaffRole | "">("");
  const revoke = useRevokeRole();

  useEffect(() => {
    setRole(sortRoles(target?.roles)[0] ?? "");
  }, [target]);

  async function confirm() {
    if (!target || role === "") return;
    try {
      await revoke.mutateAsync({ target: { studentId: target.studentId }, role, name: target.name });
      onClose();
    } catch {
      // erro já avisado em toast; o diálogo continua aberto
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !revoke.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revogar cargo?</DialogTitle>
          <DialogDescription>
            {target
              ? `${target.name} perde o cargo escolhido, mas continua como aluno do grupo (ficha, matrícula e graduações são mantidas).`
              : undefined}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="revoke-role">Cargo a revogar</Label>
          <NativeSelect
            id="revoke-role"
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            disabled={revoke.isPending || roles.length <= 1}
          >
            {roles.map((option) => (
              <option key={option} value={option}>
                {STAFF_ROLE_LABEL[option]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={revoke.isPending}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={revoke.isPending || role === ""}>
            {revoke.isPending ? "Revogando…" : "Revogar cargo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
