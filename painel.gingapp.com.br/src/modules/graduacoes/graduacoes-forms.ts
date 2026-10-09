import { z } from "zod";
import type { LevelInput, RegistrationInput, SystemInput } from "./graduacoes-api";

// Espelha os DTOs do backend: sistema (name >= 2), nível (name >= 1, order inteiro >= 0, color string).
export const systemSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do sistema (mín. 2 letras)."),
  description: z.string(),
});
export type SystemFormValues = z.infer<typeof systemSchema>;

export const levelSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do nível."),
  order: z.string().regex(/^\d+$/, "Informe a ordem (número inteiro, 0 ou mais)."),
  color: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, "Cor inválida."),
});
export type LevelFormValues = z.infer<typeof levelSchema>;

export const registrationSchema = z.object({
  graduationLevelId: z.string().min(1, "Selecione o nível alcançado."),
  graduatedAt: z.string().min(1, "Informe a data da graduação."),
  notes: z.string(),
});
export type RegistrationFormValues = z.infer<typeof registrationSchema>;

export const toSystemInput = (v: SystemFormValues): SystemInput => ({
  name: v.name.trim(),
  description: v.description.trim() || undefined,
});

export const toLevelInput = (v: LevelFormValues): LevelInput => ({
  name: v.name.trim(),
  order: Number(v.order),
  color: v.color || undefined,
});

export const toRegistrationInput = (v: RegistrationFormValues): RegistrationInput => ({
  graduationLevelId: Number(v.graduationLevelId),
  graduatedAt: v.graduatedAt,
  notes: v.notes.trim() || undefined,
});
