import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import { UNIT_STATUS_LABEL, type Unit } from "@/modules/unidades/units";
import type { Teacher } from "./schema";

/**
 * "Unidades de atuação" (E08): o Mestre marca em quais unidades o professor atua. Com unidades marcadas o professor só
 * enxerga/edita alunos, turmas, aulas e frequência delas; sem nenhuma marcada ele continua vendo todas as unidades.
 * PUT /teachers/:id/units substitui o conjunto (só o Mestre; valida que as unidades são do grupo).
 */
export function UnidadesAtuacaoDialog({
  teacher,
  units,
  onOpenChange,
}: {
  teacher: Teacher | null;
  units: Unit[];
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(() => {
    if (teacher) setSelected(teacher.unitIds ?? []);
  }, [teacher]);

  const save = useMutation({
    mutationFn: (unitIds: number[]) => api.put<{ unitIds: number[] }>(`/teachers/${teacher!.id}/units`, { unitIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["crud", "/teachers"] });
      toast.success("Unidades de atuação atualizadas.");
      onOpenChange(false);
    },
    onError: (error) => notifyError(error),
  });

  const toggle = (id: number, checked: boolean) =>
    setSelected((current) => (checked ? [...new Set([...current, id])] : current.filter((x) => x !== id)));

  return (
    <Dialog open={teacher !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unidades de atuação</DialogTitle>
          <DialogDescription>
            {teacher
              ? `Marque as unidades em que ${teacher.user.name} atua. Ele só verá alunos, turmas, aulas e frequência delas. Sem nenhuma marcada, ele vê todas as unidades.`
              : undefined}
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-72 gap-2 overflow-y-auto">
          {units.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma unidade cadastrada.</p>}
          {units.map((unit) => (
            <div key={unit.id} className="flex items-center gap-2">
              <Checkbox
                id={`unit-${unit.id}`}
                checked={selected.includes(unit.id)}
                onCheckedChange={(checked) => toggle(unit.id, checked === true)}
              />
              <Label htmlFor={`unit-${unit.id}`} className="cursor-pointer">
                {unit.name}
                {unit.status === "INACTIVE" ? ` (${UNIT_STATUS_LABEL.INACTIVE.toLowerCase()})` : ""}
              </Label>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => save.mutate(selected)} disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
