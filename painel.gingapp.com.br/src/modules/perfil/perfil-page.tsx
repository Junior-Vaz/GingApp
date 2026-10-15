import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Camera,
  Copy,
  Info,
  Loader2,
  LogOut,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ChangePasswordButton } from "@/components/painel/change-password-dialog";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { MyDataButton } from "@/components/painel/legal";
import { PageHeader } from "@/components/painel/page-header";
import { RoleBadges } from "@/components/painel/role-badges";
import { TwoFactorButton } from "@/components/painel/two-factor-dialog";
import { UserAvatar } from "@/components/painel/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { logout } from "@/lib/auth";
import {
  MY_CODE_KEY,
  MY_PERSON_KEY,
  fetchMyCode,
  fetchMyPerson,
  profilePayload,
  profileSchema,
  syncSessionFromMe,
  updateAccountPhoto,
  updateMyPerson,
  useInvalidateProfile,
  type MyPerson,
} from "@/lib/profile";
import { ROLE_LABEL, useSessionUser } from "@/lib/session";
import { ME_QUERY_KEY, fetchMe } from "@/lib/two-factor";
import { UPLOAD_ACCEPT, uploadImage, validateImageFile } from "@/lib/uploads";

/** Cartão de seção: título + descrição curta e o conteúdo. Mobile-first (nada de largura fixa). */
function Section({
  title,
  description,
  children,
  testId,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
  testId?: string | undefined;
}) {
  return (
    <Card className="p-4 sm:p-6" data-testid={testId}>
      <h2 className="font-display text-base font-bold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

/** Botões da conta (alterar senha, duas etapas, meus dados) viram itens de lista com texto aqui (os rótulos são só-ícone em telas estreitas). */
const ACCOUNT_BUTTONS =
  "grid gap-1 sm:grid-cols-2 [&_button]:w-full [&_button]:justify-start [&_span]:inline!";

/**
 * Cabeçalho do perfil: avatar grande (toque para trocar a foto: envia para POST /uploads e grava em
 * PATCH /auth/me/profile), nome, apelido, cargos e grupo.
 */
function ProfileHero({ person }: { person: MyPerson | null | undefined }) {
  const user = useSessionUser();
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidateProfile();

  const savePhoto = useMutation({
    mutationFn: async (file: File | null) => {
      const photo = file ? await uploadImage(file) : null;
      await updateAccountPhoto(photo);
      // Com ficha de pessoa, a foto também vale na ficha/matrículas (mesma foto em todo lugar).
      if (person) await updateMyPerson({ photo });
      return photo;
    },
    onSuccess: (photo) => {
      invalidate();
      toast.success(photo ? "Foto atualizada." : "Foto removida.");
    },
    onError: (error) =>
      toast.error(errorMessage(error, "Não foi possível salvar a foto. Tente novamente.")),
  });

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) return void toast.error(invalid);
    savePhoto.mutate(file);
  }

  if (!user) return null;
  const groupName = user.organizationName?.trim() || user.organizationSlug;
  const nickname = person?.nickname?.trim();

  return (
    <Card className="overflow-hidden" data-testid="profile-hero">
      <div className="h-16 bg-gradient-to-r from-primary/90 to-primary/50 sm:h-20" aria-hidden />
      <div className="px-4 pb-5 sm:px-6">
        <div className="-mt-10 flex flex-col items-center gap-3 text-center sm:-mt-12 sm:flex-row sm:items-end sm:text-left">
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Trocar foto de perfil"
              data-testid="profile-photo-button"
              disabled={savePhoto.isPending}
              onClick={() => fileRef.current?.click()}
              className="group relative block rounded-full ring-4 ring-card outline-none focus-visible:ring-primary"
            >
              <UserAvatar className="size-24 text-2xl sm:size-28 sm:text-3xl" />
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100 group-focus-visible:bg-black/40 group-focus-visible:opacity-100">
                {savePhoto.isPending ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : (
                  <Camera className="size-6" />
                )}
              </span>
            </button>
            <span
              aria-hidden
              className="pointer-events-none absolute right-0 bottom-0 grid size-8 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow"
            >
              {savePhoto.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Camera className="size-4" />
              )}
            </span>
            <input
              id={inputId}
              ref={fileRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-label="Escolher foto de perfil"
              data-testid="profile-photo-input"
              onChange={handleFile}
            />
          </div>
          <div className="min-w-0 sm:pb-1">
            <h2
              className="truncate font-display text-xl font-extrabold tracking-tight sm:text-2xl"
              data-testid="profile-name"
            >
              {user.name}
            </h2>
            {nickname && <p className="truncate text-sm text-muted-foreground">“{nickname}”</p>}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
              {user.roles && user.roles.length > 0 ? (
                <RoleBadges roles={user.roles} />
              ) : (
                <Badge variant="secondary">{ROLE_LABEL[user.role]}</Badge>
              )}
            </div>
            <p
              className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground sm:justify-start"
              data-testid="profile-group"
            >
              <EntityAvatar
                name={groupName}
                photo={user.organizationLogoUrl}
                icon={Building2}
                className="size-6"
              />
              <span className="truncate">{groupName}</span>
            </p>
          </div>
        </div>
        {user.photo && (
          <div className="mt-3 flex justify-center sm:justify-start">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={savePhoto.isPending}
              onClick={() => savePhoto.mutate(null)}
              data-testid="profile-photo-remove"
            >
              <Trash2 /> Remover foto
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** "Foto e identificação": nome, apelido e telefone (PATCH /people/me); e-mail somente leitura. Sem ficha, só leitura. */
function IdentitySection({
  person,
  phone,
}: {
  person: MyPerson | null | undefined;
  phone: string | null;
}) {
  const user = useSessionUser();
  const invalidate = useInvalidateProfile();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phoneValue, setPhoneValue] = useState("");
  const [error, setError] = useState("");
  const loaded = person !== undefined;

  useEffect(() => {
    if (!loaded) return;
    setName(person?.name ?? user?.name ?? "");
    setNickname(person?.nickname ?? "");
    setPhoneValue(phone ?? "");
    // Recarrega o formulário quando os dados do servidor mudam (salvar, outro aparelho).
  }, [loaded, person?.name, person?.nickname, phone, user?.name]);

  const save = useMutation({
    mutationFn: (values: ReturnType<typeof profilePayload>) => updateMyPerson(values),
    onSuccess: (_data, values) => {
      syncSessionFromMe({ name: values.name });
      invalidate();
      toast.success("Dados atualizados.");
    },
    onError: (err) => toast.error(errorMessage(err, "Não foi possível salvar. Tente novamente.")),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = profileSchema.safeParse({ name, nickname, phone: phoneValue });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Confira os campos.");
      return;
    }
    setError("");
    save.mutate(profilePayload(parsed.data));
  }

  if (!loaded) {
    return (
      <Section title="Foto e identificação" testId="profile-identity">
        <Skeleton className="h-40 w-full" />
      </Section>
    );
  }

  const editable = person !== null;
  return (
    <Section
      title="Foto e identificação"
      description={
        editable
          ? "Toque na foto acima para trocá-la. Nome, apelido e telefone aparecem para o seu grupo."
          : undefined
      }
      testId="profile-identity"
    >
      {!editable && (
        <p
          className="mb-4 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
          role="note"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Sua conta ainda não tem ficha de pessoa, então só a foto pode ser alterada aqui. Nome e
          telefone são mantidos pelo Mestre do grupo.
        </p>
      )}
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="profile-name">Nome</Label>
          <Input
            id="profile-name"
            value={name}
            readOnly={!editable}
            disabled={save.isPending}
            autoComplete="name"
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {editable && (
          <div className="grid gap-1.5">
            <Label htmlFor="profile-nickname">Apelido</Label>
            <Input
              id="profile-nickname"
              value={nickname}
              disabled={save.isPending}
              autoComplete="nickname"
              maxLength={40}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="profile-phone">Telefone</Label>
          <Input
            id="profile-phone"
            type="tel"
            inputMode="tel"
            value={phoneValue}
            readOnly={!editable}
            disabled={save.isPending}
            autoComplete="tel"
            maxLength={30}
            onChange={(e) => setPhoneValue(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="profile-email">E-mail</Label>
          <Input
            id="profile-email"
            type="email"
            value={user?.email ?? ""}
            readOnly
            aria-describedby="profile-email-hint"
          />
          <p id="profile-email-hint" className="text-xs text-muted-foreground">
            O e-mail é o seu acesso e não pode ser alterado por aqui.
          </p>
        </div>
        {error && (
          <p className="text-sm text-destructive sm:col-span-2" role="alert">
            {error}
          </p>
        )}
        {editable && (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending} className="w-full sm:w-auto">
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Salvar alterações
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

/** Código GingApp da pessoa (GET /people/me/code) com botão de copiar. Sem ficha, o cartão não aparece. */
function CodeSection() {
  const query = useQuery({ queryKey: MY_CODE_KEY, queryFn: fetchMyCode, retry: false });
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Código copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie o código manualmente.");
    }
  }
  if (query.isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (!query.data) return null;
  const { gingappCode, qrDataUrl } = query.data;
  return (
    <Section
      title="Código GingApp"
      description="Seu identificador único: ele acompanha você entre grupos e transferências."
      testId="profile-code"
    >
      <div className="flex flex-wrap items-center gap-4">
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt={`QR Code do código ${gingappCode}`}
            className="size-24 rounded-md border bg-white p-1"
          />
        )}
        <div className="min-w-0">
          <p
            className="break-all font-mono text-lg font-bold tracking-wider"
            data-testid="profile-code-value"
          >
            {gingappCode}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void copy(gingappCode)}
          >
            <Copy /> Copiar código
          </Button>
        </div>
      </div>
    </Section>
  );
}

/** Tela "Meu perfil" (/perfil): todos os papéis do painel. Foto, identificação, código, segurança e meus dados. */
export function PerfilPage() {
  const user = useSessionUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const person = useQuery({ queryKey: MY_PERSON_KEY, queryFn: fetchMyPerson, retry: false });
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const phone = (me.data as { phone?: string | null } | undefined)?.phone ?? null;
  const twoFactor = me.data?.twoFactorEnabled ?? user?.twoFactorEnabled;
  // `undefined` = carregando; `null` = sem ficha (404); objeto = com ficha. Erro de rede cai no modo leitura.
  const personState: MyPerson | null | undefined = person.isLoading
    ? undefined
    : (person.data ?? null);

  function handleLogout() {
    logout(queryClient);
    void navigate({ to: "/login", search: { redirect: undefined } });
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-4 md:gap-6" data-testid="perfil-page">
      <PageHeader
        title="Meu perfil"
        description="Sua foto, seus dados e a segurança da sua conta."
      />
      <ProfileHero person={personState} />
      <IdentitySection person={personState} phone={phone} />
      <CodeSection />
      <Section
        title="Segurança"
        description="Trocar a senha desconecta os outros aparelhos onde você está logado."
        testId="profile-security"
      >
        <div className={ACCOUNT_BUTTONS}>
          <ChangePasswordButton />
          <TwoFactorButton />
        </div>
        <p
          className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
          data-testid="profile-2fa-status"
        >
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          Verificação em duas etapas:{" "}
          {twoFactor === undefined ? "carregando…" : twoFactor ? "ligada" : "desligada"}
        </p>
      </Section>
      <Section
        title="Meus dados"
        description="Baixe uma cópia dos seus dados ou peça a exclusão (LGPD)."
        testId="profile-data"
      >
        <div className={ACCOUNT_BUTTONS}>
          <MyDataButton />
        </div>
      </Section>
      <Button
        type="button"
        variant="outline"
        className="w-full text-destructive hover:text-destructive sm:w-auto sm:justify-self-start"
        onClick={handleLogout}
      >
        <LogOut /> Sair
      </Button>
    </div>
  );
}
