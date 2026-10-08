import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { currentStreak, monthStats } from "@/lib/derive";
import { dayOnly, formatCurrency, initials, readableIconColor, softenColor } from "@/lib/format";
import { logout } from "@/lib/auth";
import { getToken, saveSession } from "@/lib/session";
import type { AttendanceRecord } from "@/lib/queries";

const rec = (id: number, date: string, present: boolean): AttendanceRecord => ({
  id,
  lessonId: id,
  present,
  justification: null,
  lesson: { date, classId: 1 },
});

describe("formatação", () => {
  it("data só-dia em UTC não vira o dia anterior", () => {
    const d = dayOnly("2026-10-10T00:00:00.000Z");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 10]);
  });
  it("moeda BRL a partir de centavos", () => {
    expect(formatCurrency(15000).replace(/\s/g, " ")).toBe("R$ 150,00");
  });
  it("iniciais", () => {
    expect(initials("Lucas Carvalho")).toBe("LC");
    expect(initials("")).toBe("?");
  });
  it("cor da graduação: suaviza e escolhe ícone legível", () => {
    expect(softenColor("#000000")).toBe("#595959");
    expect(softenColor(null)).toBeNull();
    expect(readableIconColor("#f5f5f5")).toBe("#16181d");
    expect(readableIconColor("#164d38")).toBe("#ffffff");
  });
});

describe("frequência", () => {
  const records = [
    rec(1, "2026-10-01T00:00:00.000Z", true),
    rec(2, "2026-10-06T00:00:00.000Z", false),
    rec(3, "2026-10-08T00:00:00.000Z", true),
    rec(4, "2026-10-13T00:00:00.000Z", true),
    rec(5, "2026-09-20T00:00:00.000Z", true),
  ];
  it("estatística do mês", () => {
    expect(monthStats(records, new Date(2026, 9, 15))).toEqual({ present: 3, total: 4, percent: 75 });
  });
  it("sequência para na primeira falta", () => {
    expect(currentStreak(records)).toBe(2);
  });
});

describe("logout", () => {
  it("limpa sessão E cache do TanStack Query", () => {
    const qc = new QueryClient();
    qc.setQueryData(["finance", "me"], [{ id: 1 }]);
    saveSession("t", {
      id: 1, name: "A", email: "a@b.c", userType: "MEMBER", isSuperAdmin: false,
      organizationId: 1, organizationSlug: "g", role: "ALUNO",
    });
    logout(qc);
    expect(getToken()).toBeNull();
    expect(qc.getQueryData(["finance", "me"])).toBeUndefined();
  });
});
