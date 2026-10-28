import { useMemo } from "react";
import type { FeedVisibility } from "@/lib/feed";
import { useClasses, useMyStudent, usePassport } from "@/lib/queries";

export interface VisibilityOption {
  value: string;
  label: string;
  visibility: FeedVisibility;
  unitId?: number;
  classId?: number;
}

/**
 * Opções de "Quem pode ver" do usuário: "Todo o grupo" sempre; "Minha unidade"/"Minha turma" a partir das turmas
 * (/classes/me), do aluno ativo e do passaporte. Compartilhada pelo compositor do feed e pelo criador de story.
 * Só 1 opção = o seletor vira texto fixo.
 */
export function useVisibilityOptions(): VisibilityOption[] {
  const classes = useClasses();
  const { student } = useMyStudent();
  const passport = usePassport();
  const classList = classes.data;
  const studentUnitId = student?.unitId ?? null;
  const passportUnit = passport.data?.unit ?? null;
  return useMemo(() => {
    const options: VisibilityOption[] = [{ value: "GROUP", label: "Todo o grupo", visibility: "GROUP" }];
    const units = new Map<number, string>();
    for (const item of classList ?? []) {
      if (item.unit) units.set(item.unit.id, item.unit.name);
    }
    if (passportUnit?.id !== undefined) units.set(passportUnit.id, passportUnit.name);
    if (studentUnitId !== null && !units.has(studentUnitId)) units.set(studentUnitId, passportUnit?.name ?? "Minha unidade");
    for (const [id, name] of units) {
      options.push({ value: `UNIT:${id}`, label: units.size > 1 ? `Minha unidade: ${name}` : `Minha unidade (${name})`, visibility: "UNIT", unitId: id });
    }
    for (const item of classList ?? []) {
      options.push({ value: `CLASS:${item.id}`, label: `Minha turma: ${item.name}`, visibility: "CLASS", classId: item.id });
    }
    return options;
  }, [classList, studentUnitId, passportUnit]);
}
