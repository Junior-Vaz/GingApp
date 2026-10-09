import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Circle, Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CHANGE_PASSWORD_SUCCESS,
  changePassword,
  changePasswordErrorMessage,
  emptyChangePasswordForm,
  newPasswordRules,
  validateChangePassword,
  type ChangePasswordErrors,
  type ChangePasswordValues,
} from "@/lib/password";

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error: string | undefined;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          className="profile-input pr-10"
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground"
          aria-label={`${visible ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * "Alterar senha" do perfil (POST /auth/change-password, ALUNO e RESPONSAVEL). No sucesso o token novo
 * já foi gravado por `changePassword` (sem deslogar, seletor de dependente intacto) e os campos são
 * limpos. Erros do servidor (senha atual incorreta etc.) viram toast e os campos continuam preenchidos.
 */
export function ChangePasswordSection() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ChangePasswordValues>(emptyChangePasswordForm);
  const [errors, setErrors] = useState<ChangePasswordErrors>({});
  const set = (key: keyof ChangePasswordValues) => (value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const mutation = useMutation({
    mutationFn: (input: ChangePasswordValues) => changePassword(input.currentPassword, input.newPassword),
    onSuccess: () => {
      setValues(emptyChangePasswordForm);
      setErrors({});
      setOpen(false);
      toast.success(CHANGE_PASSWORD_SUCCESS);
    },
    onError: (error) => toast.error(changePasswordErrorMessage(error)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateChangePassword(values);
    setErrors(found);
    if (Object.keys(found).length === 0) mutation.mutate(values);
  }

  function cancel() {
    setValues(emptyChangePasswordForm);
    setErrors({});
    setOpen(false);
  }

  if (!open) {
    return (
      <Button variant="outline" className="mt-6" onClick={() => setOpen(true)}>
        <KeyRound />
        Alterar senha
      </Button>
    );
  }

  return (
    <section className="content-band mt-6" aria-labelledby="change-password-title">
      <h2 id="change-password-title">Alterar senha</h2>
      <p className="text-xs text-muted-foreground">
        Você continua conectado neste aparelho; as demais sessões abertas serão encerradas.
      </p>
      <form onSubmit={submit} noValidate>
        <PasswordField
          id="currentPassword"
          label="Senha atual"
          autoComplete="current-password"
          value={values.currentPassword}
          onChange={set("currentPassword")}
          error={errors.currentPassword}
        />
        <PasswordField
          id="newPassword"
          label="Nova senha"
          autoComplete="new-password"
          value={values.newPassword}
          onChange={set("newPassword")}
          error={errors.newPassword}
        />
        <PasswordField
          id="confirmPassword"
          label="Confirmar nova senha"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={set("confirmPassword")}
          error={errors.confirmPassword}
        />
        <ul className="mt-3 grid gap-1 text-xs" aria-label="Requisitos da nova senha" data-testid="password-requirements">
          {newPasswordRules(values.newPassword, values.currentPassword).map((rule) => (
            <li
              key={rule.id}
              data-ok={rule.ok}
              className={rule.ok ? "flex items-center gap-1.5" : "flex items-center gap-1.5 text-muted-foreground"}
            >
              {rule.ok ? <Check size={14} aria-hidden /> : <Circle size={14} aria-hidden />}
              {rule.label}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            <Check />
            {mutation.isPending ? "Alterando…" : "Salvar nova senha"}
          </Button>
          <Button type="button" variant="outline" onClick={cancel} disabled={mutation.isPending}>
            Cancelar
          </Button>
        </div>
      </form>
    </section>
  );
}
