import { describe, expect, it } from "vitest";
import type { CertificateLayout } from "@/modules/certificados/modelos/types";
import { toWireLayout, validateLayout } from "@/modules/certificados/modelos/layout-utils";
import { REAL_CERTIFICATE_PRESETS, REAL_CLASSIC_LAYOUT } from "./real-contract-certificados";

/** Conformidade com o backend REAL: os modelos prontos que o backend entrega passam na valida??o do painel e sobrevivem ao ida-e-volta. */
describe("modelos prontos do backend real", () => {
  const all: [string, CertificateLayout][] = [
    ["classico (embutido)", REAL_CLASSIC_LAYOUT as CertificateLayout],
    ...REAL_CERTIFICATE_PRESETS.map((p): [string, CertificateLayout] => [p.key, p.layout as CertificateLayout]),
  ];

  it("traz os 5 modelos prontos do contrato", () => {
    expect(REAL_CERTIFICATE_PRESETS.map((p) => p.key)).toEqual(["classico", "moderno", "batizado", "evento", "minimalista"]);
  });

  it.each(all)("%s: sem problemas na valida??o local e id?ntico ap?s toWireLayout", (_key, layout) => {
    expect(validateLayout(layout)).toEqual([]);
    expect(toWireLayout(layout)).toEqual(layout);
  });
});
