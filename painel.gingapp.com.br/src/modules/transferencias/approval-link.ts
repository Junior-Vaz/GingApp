import { fmt, toDate } from "@/lib/format";
import type { ApprovalLink } from "./transfer-api";

/** Texto (pt-BR) enviado pelo WhatsApp junto do link de aprovação. */
export function approvalWhatsAppText(link: ApprovalLink, personName: string, groupName?: string): string {
  const until = fmt(toDate(link.expiresAt), "dd/MM/yyyy 'às' HH:mm");
  const from = groupName ? `O grupo ${groupName}` : "Um grupo";
  return `Olá, ${personName}! ${from} pediu a sua transferência no GingApp. Para aprovar ou recusar, use este link (vale até ${until}): ${link.url}`;
}

/** Endereço do WhatsApp (wa.me) com o texto do convite já preenchido. */
export const approvalWhatsAppUrl = (link: ApprovalLink, personName: string, groupName?: string) =>
  `https://wa.me/?text=${encodeURIComponent(approvalWhatsAppText(link, personName, groupName))}`;
