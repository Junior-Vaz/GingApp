import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { fichaBirthdayVisible, isMinorByBirthDate } from "@/lib/birthdays";
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
 * Privacidade do aniversário: "Mostrar meu aniversário ao grupo" (`birthdayVisible`, PATCH /people/me).
 * Salva ao alternar (é uma preferência, não um campo de texto) e desfaz a troca se o servidor recusar.
 */
function BirthdayPrivacy({ visible }: { visible: boolean }) {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState(visible);

  const save = useMutation({
    mutationFn: (value: boolean) => {
      const body: FichaPatch = { birthdayVisible: value };
      return api.patch("/people/me", body);
    },
    onMutate: (value) => setChecked(value),
    onSuccess: async (_data, value) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["people"] }),
        queryClient.invalidateQueries({ queryKey: ["birthdays"] }),
      ]);
      toast.success(value ? "Seu aniversário aparece para o grupo." : "Seu aniversário não aparece mais para o grupo.");
    },
    onError: (error, value) => {
      setChecked(!value);
      toast.error(errorMessage(error, "Não foi possível salvar sua preferência de aniversário."));
    },
  });

  return (
    <div className="mt-6 border-t border-border pt-4" data-testid="birthday-privacy">
      {/* A linha inteira é o rótulo (alvo de toque >= 44px). `min-h-0!` impede que `.pf-sheet button {min-height:44px}` estique o switch. */}
      <label htmlFor="ficha-birthday-visible" className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
        <span className="min-w-0 flex-1">Mostrar meu aniversário ao grupo</span>
        <Switch
          id="ficha-birthday-visible"
          className="min-h-0!"
          checked={checked}
          disabled={save.isPending}
          onCheckedChange={(value) => save.mutate(value)}
        />
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Seu dia e mês aparecem para o grupo na faixa de aniversariantes; a idade nunca é mostrada.
      </p>
    </div>
  );
}

/**
 * "Meus dados da ficha": a própria pessoa edita apelido e telefone (PATCH /people/me, propaga às matrículas)
 * e escolhe se o aniversário aparece ao grupo (menores: regra fixa, sem switch).
 * Só para o aluno ativo que é o PRÓPRIO usuário. Sem ficha (404) ou erro: não renderiza nada.
 */
export function FichaEditSection() {
  const ficha = useFicha();
  if (!ficha.data) return null;
  // Menor de 18: a regra é fixa (nunca aparece ao grupo), então o switch some. Sem data de nascimento, o switch fica.
  const showBirthday = !isMinorByBirthDate(ficha.data.person.birthDate);
  const visible = fichaBirthdayVisible(ficha.data);
  return (
    <section className="content-band" data-testid="ficha-edit" aria-labelledby="ficha-edit-title">
      <h2 id="ficha-edit-title">Meus dados da ficha</h2>
      <p className="text-xs text-muted-foreground">Estes dados valem para a sua ficha única e aparecem em todos os grupos onde você tem matrícula.</p>
      <FichaEditForm key={ficha.data.person.nickname ?? ""} nickname={ficha.data.person.nickname} />
      {showBirthday && <BirthdayPrivacy key={String(visible)} visible={visible} />}
    </section>
  );
}