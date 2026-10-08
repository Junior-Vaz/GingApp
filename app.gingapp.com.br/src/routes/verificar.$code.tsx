import { createFileRoute } from "@tanstack/react-router";
import { CertificateVerificationPage } from "@/components/gingapp/public";

export const Route = createFileRoute("/verificar/$code")({
  head: () => ({ meta: [{ title: "Verificação de certificado — GingApp" }] }),
  component: function Verify() {
    const { code } = Route.useParams();
    return <CertificateVerificationPage code={code} />;
  },
});
