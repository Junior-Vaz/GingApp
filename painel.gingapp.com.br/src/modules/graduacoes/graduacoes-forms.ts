import { z } from "zod";
import { HEX_COLOR, ropeOf } from "@/lib/rope";
import type {
  GraduationLevel,
  LevelInput,
  LevelUpdate,
  RegistrationInput,
  RegistrationUpdate,
  SystemInput,
} from "./graduacoes-api";

// Espelha os DTOs do backend: sistema (name >= 2), nível (name >= 1, order inteiro >= 0, style + colors).
export const systemSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do sistema (mín. 2 letras)."),
  description: z.string(),
});
export type SystemFormValues = z.infer<typeof systemSchema>;

/** Estilos de corda: SOLID = 1 cor; SPLIT (dividida) e BRAIDED (trançada) = 2 ou 3 cores. */
export const levelSchema = z
  .object({
    name: z.string().trim().min(1, "Informe o nome do nível."),
    order: z.string().regex(/^\d+$/, "Informe a ordem (número inteiro, 0 ou mais)."),
    style: z.enum(["SOLID", "SPLIT", "BRAIDED"]),
    colors: z.array(z.string()),
  })
  .superRefine((value, ctx) => {
    const count = value.colors.length;
    if (value.style === "SOLID" ? count !== 1 : count < 2 || count > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["colors"],
        message: value.style === "SOLID" ? "A corda sólida usa exatamente 1 cor." : "A corda dividida ou trançada usa 2 ou 3 cores.",
      });
      return;
    }
    const bad = value.colors.findIndex((c) => !HEX_COLOR.test(c));
    if (bad >= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["colors"],
        message: `Cor ${bad + 1} inválida (use o formato #RRGGBB).`,
      });
    }
  });
export type LevelFormValues = z.infer<typeof levelSchema>;

export const registrationSchema = z.object({
  graduationLevelId: z.string().min(1, "Selecione o nível alcançado."),
  graduatedAt: z.string().min(1, "Informe a data da graduação."),
  notes: z.string(),
});
export type RegistrationFormValues = z.infer<typeof registrationSchema>;

export const templateSchema = z.object({
  code: z.string().min(1, "Escolha um modelo."),
  name: z.string().trim().min(2, "Informe o nome do sistema (mín. 2 letras)."),
});
export type TemplateFormValues = z.infer<typeof templateSchema>;

export const DEFAULT_ROPE_COLOR = "#f5f1e6";

/** Valores iniciais do editor: novo nível (corda crua, sólida) ou o nível em edição. */
export function levelDefaults(level: GraduationLevel | null, nextOrder: number): LevelFormValues {
  if (!level) return { name: "", order: String(nextOrder), style: "SOLID", colors: [DEFAULT_ROPE_COLOR] };
  const rope = ropeOf(level);
  return {
    name: level.name,
    order: String(level.order),
    style: rope.style,
    colors: rope.colors.length > 0 ? rope.colors : [DEFAULT_ROPE_COLOR],
  };
}

export const toSystemInput = (v: SystemFormValues): SystemInput => ({
  name: v.name.trim(),
  description: v.description.trim() || undefined,
});

export const toLevelInput = (v: LevelFormValues): LevelInput => ({
  name: v.name.trim(),
  order: Number(v.order),
  style: v.style,
  colors: v.colors.map((c) => c.toLowerCase()),
});

export const toRegistrationInput = (v: RegistrationFormValues): RegistrationInput => ({
  graduationLevelId: Number(v.graduationLevelId),
  graduatedAt: v.graduatedAt,
  notes: v.notes.trim() || undefined,
});

// PATCH: campos opcionais vazios viram `null` (limpam a coluna no backend), não `undefined`.
export const toSystemUpdate = (v: SystemFormValues): SystemInput => ({
  name: v.name.trim(),
  description: v.description.trim() || null,
});

export const toLevelUpdate = (v: LevelFormValues): LevelUpdate => ({
  name: v.name.trim(),
  order: Number(v.order),
  style: v.style,
  colors: v.colors.map((c) => c.toLowerCase()),
});

export const toRegistrationUpdate = (v: RegistrationFormValues): RegistrationUpdate => ({
  graduationLevelId: Number(v.graduationLevelId),
  graduatedAt: v.graduatedAt,
  notes: v.notes.trim() || null,
});
