import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { useFicha, type FichaPatch } from "@/lib/queries";

function FichaEditForm({ nickname }: { nickname: string | null }) {
  const queryClient = useQueryClient();
  const [nick, setNick] = useState(nickname ?? "");
  const [phone, setPhone] = useState("");

  const save = useMutation({
    mutationFn: () => {
      // Apelido vazio limpa (null). Telefone vazio mantém o atual: a ficha não devolve o telefone para pré-preencher.
      const body: FichaPatch = { nickname: nick.trim() === "" ? null : nick.trim() };
      if (phone.trim() !== "") body.phone = phone.trim();
      return api.patch("/people/me", body);
    },
    onSuccess: async () => {
      setPhone("");
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      toast.success("Dados da ficha atualizados.");
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar os dados da ficha.")),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="ficha-nickname">
        Apelido
      </label>
      <input className="profile-input" id="ficha-nickname" value={nick} maxLength={60} onChange={(e) => setNick(e.target.value)} placeholder="Como o grupo te chama" />
      <label className="field-label" htmlFor="ficha-phone">
        Telefone
      </label>
      <input className="profile-input" id="ficha-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Deixe em branco para manter o atual" />
      <Button className="mt-4" type="submit" size="sm" disabled={save.isPending}>
        <Check />
        {save.isPending ? "Salvando…" : "Salvar dados da ficha"}
      </Button>
    </form>
  );
}

/**
 * "Meus dados da ficha": a própria pessoa edita apelido e telefone (PATCH /people/me, propaga às matrículas).
 * Só para o aluno ativo que é o PRÓPRIO usuário. Sem ficha (404) ou erro: não renderiza nada.
 */
export function FichaEditSection() {
  const ficha = useFicha();
  if (!ficha.data) return null;
  return (
    <section className="content-band" data-testid="ficha-edit" aria-labelledby="ficha-edit-title">
      <h2 id="ficha-edit-title">Meus dados da ficha</h2>
      <p className="text-xs text-muted-foreground">Estes dados valem para a sua ficha única e aparecem em todos os grupos onde você tem matrícula.</p>
      <FichaEditForm key={ficha.data.person.nickname ?? ""} nickname={ficha.data.person.nickname} />
    </section>
  );
}