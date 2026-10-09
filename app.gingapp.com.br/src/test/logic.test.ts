import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  currentStreak,
  effectiveFinanceStatus,
  monthRange,
  monthStats,
  passportActions,
  recentMonths,
  streakOf,
} from "@/lib/derive";
import { dayOnly, formatCurrency, initials, readableIconColor, softenColor } from "@/lib/format";
import { logout } from "@/lib/auth";
import { getToken, saveSession } from "@/lib/session";
import { withQuery, type AttendanceRecord } from "@/lib/queries";

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

describe("frequência: estatística do servidor não depende da lista carregada", () => {
  it("sequência: usa a do servidor (todo o histórico) e só cai na da lista em backend antigo", () => {
    const one = [rec(1, "2026-10-01T00:00:00.000Z", true)];
    expect(streakOf({ currentStreak: 63, records: one })).toBe(63); // 63 > registros da página
    expect(streakOf({ currentStreak: 0, records: one })).toBe(0); // 0 do servidor é um valor válido
    expect(streakOf({ records: one })).toBe(1); // backend sem o campo
    expect(streakOf(undefined)).toBe(0);
  });

  it("monthRange: primeiro e último dia do mês (inclui fevereiro bissexto e virada de ano)", () => {
    expect(monthRange(new Date(2026, 9, 17))).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange(new Date(2028, 1, 10))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange(new Date(2026, 11, 31))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("recentMonths: o atual primeiro, cruzando o ano", () => {
    expect(recentMonths(4, new Date(2026, 0, 15))).toEqual(["2026-01", "2025-12", "2025-11", "2025-10"]);
    expect(recentMonths(12, new Date(2026, 9, 1))).toHaveLength(12);
  });
});

describe("financeiro: situação exibida (mesma regra do servidor)", () => {
  const today = new Date(2026, 9, 9); // 09/10/2026
  const base = { dueDate: "2026-10-09T00:00:00.000Z" };
  it("vence hoje NÃO é atrasado; ontem é; futuro não; CANCELLED/PAID/OVERDUE ficam como estão", () => {
    expect(effectiveFinanceStatus({ ...base, status: "PENDING" }, today)).toBe("PENDING");
    expect(effectiveFinanceStatus({ dueDate: "2026-10-08T00:00:00.000Z", status: "PENDING" }, today)).toBe("OVERDUE");
    expect(effectiveFinanceStatus({ dueDate: "2026-10-10T00:00:00.000Z", status: "PENDING" }, today)).toBe("PENDING");
    expect(effectiveFinanceStatus({ dueDate: "2020-01-01T00:00:00.000Z", status: "PAID" }, today)).toBe("PAID");
    expect(effectiveFinanceStatus({ dueDate: "2020-01-01T00:00:00.000Z", status: "CANCELLED" }, today)).toBe("CANCELLED");
    expect(effectiveFinanceStatus({ dueDate: "2026-12-01T00:00:00.000Z", status: "OVERDUE" }, today)).toBe("OVERDUE");
  });
});

describe("withQuery", () => {
  it("monta a query ignorando vazios/indefinidos", () => {
    expect(withQuery("/x", { a: 1, b: "", c: undefined, d: "z" })).toBe("/x?a=1&d=z");
    expect(withQuery("/x")).toBe("/x");
  });
});

describe("passaporte: ações oferecidas (regra LGPD do backend, evita 403 na tela)", () => {
  const viewer = (v: Partial<NonNullable<Parameters<typeof passportActions>[0]>>) => ({
    isGuardian: false,
    isMinor: false,
    hasConsent: null,
    canPublish: false,
    canConsent: false,
    ...v,
  });

  it("aluno menor sem responsável: não oferece publicar nem autorizar, só o aviso", () => {
    expect(passportActions(viewer({ isMinor: true }), "ALUNO")).toEqual({
      canPublish: false,
      canConsent: false,
      showMinorNote: true,
    });
  });

  it("aluno maior de idade pode publicar sozinho", () => {
    expect(passportActions(viewer({ canPublish: true }), "ALUNO")).toEqual({
      canPublish: true,
      canConsent: false,
      showMinorNote: false,
    });
  });

  it("responsável sem consentimento: só 'autorizar e publicar'", () => {
    expect(
      passportActions(viewer({ isGuardian: true, isMinor: true, hasConsent: false, canConsent: true }), "RESPONSAVEL"),
    ).toEqual({ canPublish: false, canConsent: true, showMinorNote: false });
  });

  it("responsável com consentimento: publica direto, sem o atalho", () => {
    expect(
      passportActions(
        viewer({ isGuardian: true, isMinor: true, hasConsent: true, canPublish: true, canConsent: true }),
        "RESPONSAVEL",
      ),
    ).toEqual({ canPublish: true, canConsent: false, showMinorNote: false });
  });

  it("sem viewer (backend antigo): mantém o comportamento anterior", () => {
    expect(passportActions(undefined, "RESPONSAVEL")).toEqual({
      canPublish: true,
      canConsent: true,
      showMinorNote: false,
    });
    expect(passportActions(undefined, "ALUNO").canConsent).toBe(false);
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
