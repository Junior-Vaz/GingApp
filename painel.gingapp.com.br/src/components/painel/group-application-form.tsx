import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Circle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PasswordInput } from "@/components/painel/password-input";
import {
  CLAIMED_ROLES,
  CLAIMED_ROLE_LABEL,
  GROUP_APPLICATION_UFS,
  MESSAGE_MAX_LENGTH,
  emptyGroupApplicationForm,
  groupApplicationSchema,
  passwordStrength,
  saveApplicationToken,
  signupPasswordRules,
  submitErrorMessage,
  submitGroupApplication,
  toGroupApplicationPayload,
  INSTAGRAM_MAX_LENGTH,
  type GroupApplicationSubmitted,
  type GroupApplicationValues,
} from "@/lib/group-application";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/modules/alunos/native-select";

/** Requisitos da senha ao vivo + barra de força (só dica visual: o servidor valida de verdade). */
function PasswordHints({ password }: { password: string }) {
  // A regra da senha padrão de desenvolvimento vale na validação, mas não é lista de requisito para quem se cadastra.
  const rules = signupPasswordRules(password).filter((rule) => rule.id !== "forbidden");
  const strength = passwordStrength(password);
  const barColor = strength.level === 3 ? "bg-primary" : strength.level === 2 ? "bg-warning" : "bg-destructive";
  return (
    <div className="grid gap-2" data-testid="password-hints">
      <ul className="grid gap-1 text-xs">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={cn("flex items-center gap-1.5", rule.ok && password !== "" ? "text-primary" : "text-muted-foreground")}
            data-ok={rule.ok && password !== "" ? "true" : "false"}
          >
            {rule.ok && password !== "" ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
            <span>{rule.label}</span>
          </li>
        ))}
      </ul>
      {strength.level > 0 && (
        <div className="flex items-center gap-2" data-testid="password-strength">
          <div className="flex h-1.5 w-24 gap-0.5" aria-hidden>
            {[1, 2, 3].map((step) => (
              <span key={step} className={cn("h-full flex-1 rounded-full bg-muted", strength.level >= step && barColor)} />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">Força: {strength.label}</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Dica: uma frase longa que só você conheça é mais segura e mais fácil de lembrar do que uma senha curta cheia de símbolos.
      </p>
    </div>
  );
}

/**
 * Formulário público de pedido de cadastro de grupo (POST /public/group-applications). O pedido NÃO cria conta nem
 * grupo: a equipe da plataforma confere e aprova. Sucesso -> `onSubmitted(statusToken)`.
 */
export function GroupApplicationForm({ onSubmitted }: { onSubmitted: (result: GroupApplicationSubmitted) => void }) {
  const [error, setError] = useState("");
  const form = useForm<GroupApplicationValues>({
    resolver: zodResolver(groupApplicationSchema),
    defaultValues: emptyGroupApplicationForm,
  });
  const password = useWatch({ control: form.control, name: "password" });
  const messageLength = useWatch({ control: form.control, name: "message" }).length;

  async function onSubmit(values: GroupApplicationValues) {
    setError("");
    try {
      const result = await submitGroupApplication(toGroupApplicationPayload(values));
      if (typeof result?.statusToken !== "string" || result.statusToken === "") {
        setError("Não foi possível confirmar o pedido. Tente novamente.");
        return;
      }
      saveApplicationToken(result.statusToken);
      // A senha não fica na memória do formulário depois do envio.
      form.reset(emptyGroupApplicationForm);
      onSubmitted(result);
    } catch (err) {
      setError(submitErrorMessage(err));
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        noValidate
        className="relative grid gap-4"
        aria-label="Pedido de cadastro do grupo"
      >
        <FormField
          control={form.control}
          name="applicantName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Seu nome</FormLabel>
              <FormControl>
                <Input autoComplete="name" maxLength={120} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" inputMode="email" maxLength={254} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Telefone (opcional)</FormLabel>
                <FormControl>
                  <Input type="tel" autoComplete="tel" inputMode="tel" maxLength={30} placeholder="(11) 91234-5678" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="claimedRole"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Seu cargo</FormLabel>
              <FormControl>
                <NativeSelect {...field}>
                  <option value="">Selecione</option>
                  {CLAIMED_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {CLAIMED_ROLE_LABEL[role]}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
              <FormDescription>Serve só para a equipe te conhecer. Quem pede e é aprovado passa a administrar o grupo.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="groupName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome do grupo</FormLabel>
              <FormControl>
                <Input autoComplete="organization" maxLength={120} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-[1fr_6.5rem] gap-4">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cidade</FormLabel>
                <FormControl>
                  <Input autoComplete="address-level2" maxLength={80} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>UF</FormLabel>
                <FormControl>
                  <NativeSelect autoComplete="address-level1" {...field}>
                    <option value="">UF</option>
                    {GROUP_APPLICATION_UFS.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="instagram"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Instagram do grupo (opcional)</FormLabel>
              <FormControl>
                <Input
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={INSTAGRAM_MAX_LENGTH}
                  placeholder="@meugrupo"
                  {...field}
                />
              </FormControl>
              <FormDescription>Ajuda a equipe a conferir seu pedido. Ex.: @meugrupo ou o link do perfil</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="estimatedStudents"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Quantos alunos, mais ou menos? (opcional)</FormLabel>
              <FormControl>
                <Input inputMode="numeric" autoComplete="off" maxLength={6} placeholder="Ex.: 40" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Conte sobre o grupo (opcional)</FormLabel>
              <FormControl>
                <Textarea rows={3} maxLength={MESSAGE_MAX_LENGTH} placeholder="Há quanto tempo existe, onde treina, quem lidera…" {...field} />
              </FormControl>
              <FormDescription>
                {messageLength}/{MESSAGE_MAX_LENGTH}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Crie uma senha</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" toggleLabel="senha" {...field} />
              </FormControl>
              <PasswordHints password={password} />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="adult"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-start gap-3">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} onBlur={field.onBlur} ref={field.ref} />
                </FormControl>
                <FormLabel className="cursor-pointer text-sm font-normal leading-snug">Declaro ter 18 anos ou mais.</FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="acceptTerms"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-start gap-3">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} onBlur={field.onBlur} ref={field.ref} />
                </FormControl>
                <FormLabel className="cursor-pointer text-sm font-normal leading-snug">
                  Li e aceito os{" "}
                  <a href="/termos" target="_blank" rel="noopener noreferrer" className="underline">
                    Termos de Uso
                  </a>{" "}
                  e a{" "}
                  <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="underline">
                    Política de Privacidade
                  </a>
                  .
                </FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* Honeypot: fora da tela (não `display:none`, que robôs já ignoram), fora do foco e dos leitores de tela. */}
        <div
          aria-hidden="true"
          data-testid="honeypot"
          style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}
        >
          <label htmlFor="group-application-website">Site (deixe em branco)</label>
          <input
            id="group-application-website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            {...form.register("website")}
          />
        </div>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
          <Send />
          {form.formState.isSubmitting ? "Enviando…" : "Enviar pedido"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Se esse e-mail já tem cadastro, use <strong>Entrar</strong> ou <strong>Esqueci minha senha</strong> na tela de login.
        </p>
      </form>
    </Form>
  );
}
