import { describe, expect, it } from "vitest";
import { civilDay, currentLessonWindow, lessonPeriodParams } from "@/lib/lesson-window";
import { plural } from "@/lib/plural";

describe("plural (pt-BR)", () => {
  it("1 usa o singular; 0 e os demais, o plural", () => {
    expect(plural(1, "aluno")).toBe("1 aluno");
    expect(plural(2, "aluno")).toBe("2 alunos");
    expect(plural(0, "aluno")).toBe("0 alunos");
    expect(plural(1, "dia")).toBe("1 dia");
    expect(plural(30, "dia")).toBe("30 dias");
    expect(plural(1, "presente")).toBe("1 presente");
    expect(plural(3, "lançamento")).toBe("3 lançamentos");
  });

  it("aceita o plural irregular", () => {
    expect(plural(1, "mês", "meses")).toBe("1 mês");
    expect(plural(2, "mês", "meses")).toBe("2 meses");
    expect(plural(1, "aluno ativo", "alunos ativos")).toBe("1 aluno ativo");
    expect(plural(2, "aluno ativo", "alunos ativos")).toBe("2 alunos ativos");
  });
});

describe("janela padrão das aulas (hoje-7 a hoje+30)", () => {
  it("calcula from/to a partir de um 'hoje' injetável, em datas civis locais", () => {
    expect(currentLessonWindow(new Date(2026, 2, 10, 12))).toEqual({ from: "2026-03-03", to: "2026-04-09" });
  });

  it("atravessa mês e ano (e ano bissexto)", () => {
    expect(currentLessonWindow(new Date(2026, 0, 3, 9))).toEqual({ from: "2025-12-27", to: "2026-02-02" });
    expect(currentLessonWindow(new Date(2028, 1, 25, 9))).toEqual({ from: "2028-02-18", to: "2028-03-26" });
  });

  it("não desloca o dia perto da meia-noite (nada de toISOString/UTC)", () => {
    // 23:59 local do dia 10 continua sendo dia 10, qualquer que seja o fuso da máquina.
    expect(civilDay(new Date(2026, 2, 10, 23, 59, 59))).toBe("2026-03-10");
    expect(civilDay(new Date(2026, 2, 10, 0, 0, 1))).toBe("2026-03-10");
    expect(currentLessonWindow(new Date(2026, 2, 10, 23, 59, 59)).from).toBe("2026-03-03");
  });

  it("período 'current' = janela + order=nearest; 'all' = só order=nearest", () => {
    const today = new Date(2026, 2, 10, 12);
    expect(lessonPeriodParams("current", today)).toEqual({ order: "nearest", from: "2026-03-03", to: "2026-04-09" });
    expect(lessonPeriodParams("all", today)).toEqual({ order: "nearest" });
  });
});
