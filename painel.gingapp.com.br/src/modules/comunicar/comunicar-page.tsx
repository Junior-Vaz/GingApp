import { PageHeader } from "@/components/painel/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComposeTab } from "./compose-tab";
import { HistoryTab } from "./history-tab";

/** Comunicar: compositor único (alcance, agendamento, confirmação, fixar no feed) e histórico com alcance/lidos/confirmados. */
export function ComunicarPage() {
  return (
    <>
      <PageHeader title="Comunicar" description="Mande uma mensagem para o grupo, uma unidade, uma turma ou um papel e acompanhe quem leu." />
      <Tabs defaultValue="nova">
        <TabsList className="mb-4 w-full sm:w-auto" aria-label="Seções de Comunicar">
          <TabsTrigger value="nova">Nova mensagem</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="nova">
          <ComposeTab />
        </TabsContent>
        <TabsContent value="historico">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
