import { useState } from "react";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/painel/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { useSessionUser } from "@/lib/session";
import { useTerms } from "./api";
import { CampaignsTab } from "./campaigns-tab";
import { SponsorsTab } from "./sponsors-tab";
import { BlockedAlert, TermsPendingAlert, TermsTab } from "./terms-tab";

type TabValue = "campanhas" | "patrocinadores" | "termo";

function MestrePatrocinadores() {
  const terms = useTerms();
  const [chosen, setChosen] = useState<TabValue | null>(null);
  // Primeiro acesso (ou versão nova do termo): abre direto no Termo. Depois que a pessoa escolhe uma aba, a escolha vale.
  const tab: TabValue = chosen ?? (terms.data && !terms.data.accepted ? "termo" : "campanhas");

  return (
    <>
      <PageHeader
        title="Patrocinadores"
        description="Anúncios de parceiros locais no banner da Home do app do seu grupo. Você publica e responde pelo conteúdo."
      />
      <BlockedAlert terms={terms.data} />
      <TermsPendingAlert terms={terms.data} onOpen={() => setChosen("termo")} />
      <Tabs value={tab} onValueChange={(v) => setChosen(v as TabValue)}>
        <TabsList className="mb-4 w-full sm:w-auto" aria-label="Seções de Patrocinadores">
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="patrocinadores">Patrocinadores</TabsTrigger>
          <TabsTrigger value="termo">Termo</TabsTrigger>
        </TabsList>
        <TabsContent value="campanhas">
          <CampaignsTab terms={terms.data} />
        </TabsContent>
        <TabsContent value="patrocinadores">
          <SponsorsTab />
        </TabsContent>
        <TabsContent value="termo">
          <TermsTab query={terms} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/**
 * "Patrocinadores" do grupo (SÓ o MESTRE): termo de responsabilidade, patrocinadores, campanhas e relatório.
 * A rota e o menu já filtram por papel; aqui há uma segunda barreira (defesa em profundidade) que nem chega a consultar a API
 * para quem não é Mestre. A autorização de verdade é do servidor (qualquer outro papel = 403).
 */
export function PatrocinadoresPage() {
  const user = useSessionUser();
  if (user?.role !== "MESTRE") {
    return (
      <div className="grid place-items-center gap-2 rounded-lg border p-8 text-center" role="alert" data-testid="patrocinadores-forbidden">
        <Lock className="size-6 text-muted-foreground" aria-hidden />
        <p className="font-semibold">Área exclusiva do Mestre</p>
        <p className="text-sm text-muted-foreground">{ROUTE_FORBIDDEN_MESSAGE}</p>
      </div>
    );
  }
  return <MestrePatrocinadores />;
}
