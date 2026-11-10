import { describe, expect, it } from "vitest";
import { lessonsSyncMessage, type ClassLessonsSync } from "@/modules/turmas/lessons-sync";
import { REAL_PATCH_COM_SYNC, REAL_PATCH_SEM_SYNC } from "./real-contract-troca-dia";

/** Conformidade com o backend REAL: PATCH /classes/:id capturado do e2e (com e sem `lessonsSync`). */
describe("troca de dia: resposta real do backend", () => {
  it("o lessonsSync real tem exatamente as chaves que o painel lê e vira a mensagem esperada", () => {
    const sync = REAL_PATCH_COM_SYNC["lessonsSync"] as ClassLessonsSync;
    expect(Object.keys(sync).sort()).toEqual(["cancelled", "created", "kept", "newWeekday", "oldWeekday"]);
    expect(sync).toMatchObject({ cancelled: 3, kept: 3, created: 8, oldWeekday: 1, newWeekday: 2 });
    const text = lessonsSyncMessage(sync);
    expect(text).toContain("3 aulas do dia antigo canceladas");
    expect(text).toContain("8 geradas no dia novo");
    expect(text).toContain("3 aulas do dia antigo foram mantidas");
  });

  it("o PATCH sem troca de dia não traz lessonsSync", () => {
    expect("lessonsSync" in REAL_PATCH_SEM_SYNC).toBe(false);
  });
});
