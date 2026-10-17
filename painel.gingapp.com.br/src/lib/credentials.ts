import { appOrigin } from "@/lib/format";

/** Texto pronto para mandar ao aluno (WhatsApp, e-mail, ditado). */
export function credentialsMessage(email: string, password: string): string {
  return `App GingApp: ${appOrigin()} — Login: ${email} — Senha provisória: ${password} (você troca no primeiro acesso)`;
}

/**
 * Link do WhatsApp com o texto pronto. Telefone brasileiro (DDD + número, 10/11 dígitos; com 55 na frente também vale)
 * vai direto para o contato; sem telefone (ou fora desse padrão) abre o WhatsApp para escolher o contato.
 */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const query = `?text=${encodeURIComponent(text)}`;
  if (digits.length === 10 || digits.length === 11) return `https://wa.me/55${digits}${query}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return `https://wa.me/${digits}${query}`;
  return `https://wa.me/${query}`;
}
