import { describe, expect, it } from "vitest";
import { plural, pluralWord } from "@/lib/plural";
import { graduationCardLabel } from "@/lib/derive";

describe("plural (pt-BR)", () => {
  it("1 usa o singular; 0 e demais usam o plural", () => {
    expect(plural(1, "aluno")).toBe("1 aluno");
    expect(plural(0, "aluno")).toBe("0 alunos");
    expect(plural(2, "aluno")).toBe("2 alunos");
  });
  it("aceita plural irregular", () => {
    expect(plural(1, "mês", "meses")).toBe("1 mês");
    expect(plural(3, "mês", "meses")).toBe("3 meses");
    expect(plural(5, "aluno abaixo de você", "alunos abaixo de você")).toBe("5 alunos abaixo de você");
    expect(pluralWord(1, "presente")).toBe("presente");
    expect(pluralWord(4, "presente")).toBe("presentes");
  });
});

describe("graduationCardLabel", () => {
  it("o próprio aluno (ou sem aluno) => 'Minha graduação'", () => {
    expect(graduationCardLabel({ userId: 7, name: "Ana Souza" }, 7)).toBe("Minha graduação");
    expect(graduationCardLabel(null, 7)).toBe("Minha graduação");
  });
  it("dependente selecionado => 'Graduação de <primeiro nome>'", () => {
    expect(graduationCardLabel({ userId: null, name: "João Pedro Lima" }, 7)).toBe("Graduação de João");
    expect(graduationCardLabel({ userId: 9, name: "Bia" }, 7)).toBe("Graduação de Bia");
  });
});
