import { createFileRoute } from "@tanstack/react-router";
import { PassportVerificationPage } from "@/components/gingapp/public";

export const Route = createFileRoute("/verificar-passaporte/$code")({
  head: () => ({ meta: [{ title: "Passaporte do Capoeirista — GingApp" }] }),
  component: function VerifyPassport() {
    const { code } = Route.useParams();
    return <PassportVerificationPage code={code} />;
  },
});
