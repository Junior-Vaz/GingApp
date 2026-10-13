import { createFileRoute } from "@tanstack/react-router";
import { TransferApprovalPage } from "@/components/gingapp/transfer-approval";

// Pública (sem login e fora do guard/aceite de termos do /_app): o link do mestre traz ?token=...;
// a tela guarda o token em memória e o remove da URL.
export const Route = createFileRoute("/aprovar-transferencia")({
  validateSearch: (search: Record<string, unknown>): { token?: string | undefined } => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  // Sem Referer: o token (mesmo removido da URL) não vaza para links/recursos externos.
  head: () => ({
    meta: [{ title: "Aprovar transferência — GingApp" }, { name: "referrer", content: "no-referrer" }],
  }),
  component: function ApproveTransfer() {
    const { token } = Route.useSearch();
    return <TransferApprovalPage token={token} />;
  },
});
