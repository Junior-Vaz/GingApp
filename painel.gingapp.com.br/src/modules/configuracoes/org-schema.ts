import { z } from "zod";
import { BR_UFS } from "@/lib/br-ufs";
import { isUploadPath } from "@/lib/uploads";
import type { Organization, OrganizationSocialLinks } from "./plan";

/** Mesmos padrões do backend (create-organization.dto.ts) - o servidor continua sendo a validação de verdade. */
const DOCUMENT_PATTERN = /^(?:\d{11}|\d{14}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/;
const PHONE_PATTERN = /^\+?[0-9()\-.\s]{8,30}$/;
const HTTP_URL = /^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]{2,}$/i;

export const SOCIAL_NETWORKS = [
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "facebook", label: "Facebook" },
  { key: "whatsapp", label: "WhatsApp (link)" },
] as const;
export type SocialKey = (typeof SOCIAL_NETWORKS)[number]["key"];

const optional = <T extends z.ZodTypeAny>(schema: T) => z.union([z.literal(""), schema]);
const url = (what: string) =>
  optional(z.string().trim().max(500, `${what}: no máximo 500 caracteres.`).regex(HTTP_URL, `${what}: informe um link completo (https://...).`));

export const organizationSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do grupo (mínimo 2 letras).").max(120, "O nome pode ter no máximo 120 caracteres."),
  document: optional(z.string().trim().regex(DOCUMENT_PATTERN, "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).")),
  email: optional(z.string().trim().email("Informe um e-mail válido.").max(254)),
  phone: optional(z.string().trim().regex(PHONE_PATTERN, "Telefone: de 8 a 30 caracteres entre dígitos, +, (), - e espaço.")),
  description: z.string().trim().max(1000, "A apresentação pode ter no máximo 1000 caracteres."),
  history: z.string().trim().max(10000, "A história pode ter no máximo 10000 caracteres."),
  foundedYear: optional(
    z
      .string()
      .trim()
      .regex(/^\d{4}$/, "Informe o ano com 4 dígitos (ex.: 1998).")
      .refine((v) => Number(v) >= 1800 && Number(v) <= 2100, "O ano deve estar entre 1800 e 2100."),
  ),
  city: z.string().trim().max(100, "A cidade pode ter no máximo 100 caracteres."),
  state: z.string().refine((v) => v === "" || (BR_UFS as readonly string[]).includes(v), "Escolha uma UF válida."),
  website: url("Site"),
  logo: optional(
    z
      .string()
      .trim()
      .max(500, "Logomarca: no máximo 500 caracteres.")
      .refine((v) => HTTP_URL.test(v) || isUploadPath(v), "Logomarca: informe um link completo (https://...) ou envie uma imagem."),
  ),
  paymentInstructions: z.string().trim().max(2000, "Como pagar: no máximo 2000 caracteres."),
  instagram: url("Instagram"),
  youtube: url("YouTube"),
  tiktok: url("TikTok"),
  facebook: url("Facebook"),
  whatsapp: url("WhatsApp"),
});
export type OrganizationFormValues = z.infer<typeof organizationSchema>;

export function organizationToForm(org: Organization): OrganizationFormValues {
  const links: OrganizationSocialLinks = org.socialLinks ?? {};
  return {
    name: org.name,
    document: org.document ?? "",
    email: org.email ?? "",
    phone: org.phone ?? "",
    description: org.description ?? "",
    history: org.history ?? "",
    foundedYear: org.foundedYear ? String(org.foundedYear) : "",
    city: org.city ?? "",
    state: org.state ?? "",
    website: org.website ?? "",
    logo: org.logo ?? "",
    paymentInstructions: org.paymentInstructions ?? "",
    instagram: links.instagram ?? "",
    youtube: links.youtube ?? "",
    tiktok: links.tiktok ?? "",
    facebook: links.facebook ?? "",
    whatsapp: links.whatsapp ?? "",
  };
}

/** Corpo de PATCH /organizations/me (UpdateOwnOrganizationDto). Slug e status NÃO existem aqui (imutáveis). */
export interface OrganizationUpdateInput {
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
  history: string | null;
  foundedYear: number | null;
  city: string | null;
  state: string | null;
  website: string | null;
  logo: string | null;
  paymentInstructions: string | null;
  socialLinks: OrganizationSocialLinks | null;
}

/** Tudo é enviado a cada salvamento: campo esvaziado vai como `null` (o backend limpa a coluna);
 * `socialLinks` substitui o objeto inteiro (sem nenhuma rede = null). */
export function organizationToPayload(values: OrganizationFormValues): OrganizationUpdateInput {
  const orNull = (v: string) => v.trim() || null;
  const socialLinks: OrganizationSocialLinks = {};
  for (const { key } of SOCIAL_NETWORKS) {
    const link = values[key].trim();
    if (link) socialLinks[key] = link;
  }
  return {
    name: values.name.trim(),
    document: orNull(values.document),
    email: orNull(values.email),
    phone: orNull(values.phone),
    description: orNull(values.description),
    history: orNull(values.history),
    foundedYear: values.foundedYear ? Number(values.foundedYear) : null,
    city: orNull(values.city),
    state: values.state || null,
    website: orNull(values.website),
    logo: orNull(values.logo),
    paymentInstructions: orNull(values.paymentInstructions),
    socialLinks: Object.keys(socialLinks).length > 0 ? socialLinks : null,
  };
}
