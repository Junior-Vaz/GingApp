import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Award, Check, Facebook, Instagram, LogOut, MessageCircle, QrCode, Sprout, Users, X, Youtube, Music2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { logout } from "@/lib/auth";
import { buildProfilePayload, passportActions } from "@/lib/derive";
import { dayOnly, fmt, passportUrl } from "@/lib/format";
import { useSessionUser } from "@/lib/session";
import { imageSrc } from "@/lib/uploads";
import {
  useGraduations,
  useMyIdentity,
  useMyRoles,
  useMyStudent,
  useMyUnit,
  usePassport,
  useStudents,
  type SocialLinks,
  type Student,
} from "@/lib/queries";
import { ChangePasswordSection } from "./change-password";
import { UnitLine } from "./class-parts";
import { PersonCodeCard } from "./ficha-code-card";
import { FichaEditSection } from "./ficha-edit";
import { ImageUploadControl } from "./image-upload";
import { MyDataSection } from "./legal";
import { QrDialog } from "./journey";
import { PanelShortcut, RoleBadges } from "./roles";
import { TwoFactorSection } from "./two-factor";
import { PageHeading, StateMessage } from "./shared";
import { Avatar } from "./avatar";
import { Rope } from "./rope";
import { OccurrencesShortcut } from "./occurrences";
import { TransfersShortcut } from "./transfers";

const ROLE_LABEL: Record<string, string> = {
  ALUNO: "Aluno",
  RESPONSAVEL: "Responsável",
  MESTRE: "Mestre",
  PROFESSOR: "Professor",
  INSTRUTOR: "Instrutor",
  MONITOR: "Monitor",
};

const SOCIAL_FIELDS: { key: keyof SocialLinks; label: string; icon: typeof Instagram; placeholder: string }[] = [
  { key: "instagram", label: "Instagram", icon: Instagram, placeholder: "https://instagram.com/seu_usuario" },
  { key: "youtube", label: "YouTube", icon: Youtube, placeholder: "https://youtube.com/@seu_canal" },
  { key: "tiktok", label: "TikTok", icon: Music2, placeholder: "https://tiktok.com/@seu_usuario" },
  { key: "facebook", label: "Facebook", icon: Facebook, placeholder: "https://facebook.com/seu_perfil" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, placeholder: "https://wa.me/5511999999999" },
];

/** Campo de URL com “Remover” (só aparece preenchido): limpa o campo; o servidor limpa ao salvar. */
function UrlField({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2">
      <input className="profile-input min-w-0 flex-1" id={id} type="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value.trim() !== "" && (
        <Button type="button" variant="ghost" size="sm" aria-label={`Remover ${label}`} onClick={() => onChange("")}>
          <X />
          Remover
        </Button>
      )}
    </div>
  );
}

export function ProfileForm({ student }: { student: Student }) {
  const queryClient = useQueryClient();
  const links = student.socialLinks ?? {};
  const [form, setForm] = useState({
    photo: student.photo ?? "",
    coverPhoto: student.coverPhoto ?? "",
    instagram: links.instagram ?? "",
    youtube: links.youtube ?? "",
    tiktok: links.tiktok ?? "",
    facebook: links.facebook ?? "",
    whatsapp: links.whatsapp ?? "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    // Campo vazio => null (limpa no servidor); ver buildProfilePayload.
    mutationFn: () => api.patch("/students/me/profile", buildProfilePayload(form)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["students"] });
      toast.success("Perfil atualizado.");
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar o perfil.")),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit}>
      <p className="text-xs text-muted-foreground">Envie uma imagem (JPEG, PNG ou WebP até 5 MB) ou cole o link. Para remover foto, capa ou uma rede, deixe o campo vazio (ou use “Remover”) e salve.</p>
      <label className="field-label" htmlFor="photo">
        Foto (URL)
      </label>
      <ImageUploadControl label="foto" value={form.photo} onChange={set("photo")} />
      <UrlField id="photo" label="foto" value={form.photo} onChange={set("photo")} placeholder="https://..." />
      <label className="field-label" htmlFor="coverPhoto">
        Foto de capa (URL)
      </label>
      <ImageUploadControl label="foto de capa" shape="wide" value={form.coverPhoto} onChange={set("coverPhoto")} />
      <UrlField id="coverPhoto" label="foto de capa" value={form.coverPhoto} onChange={set("coverPhoto")} placeholder="https://..." />
      {SOCIAL_FIELDS.map((field) => (
        <div key={field.key}>
          <label className="field-label" htmlFor={field.key}>
            {field.label}
          </label>
          <UrlField id={field.key} label={field.label} value={form[field.key]} onChange={set(field.key)} placeholder={field.placeholder} />
        </div>
      ))}
      <Button className="mt-6" type="submit" disabled={save.isPending}>
        <Check />
        {save.isPending ? "Salvando…" : "Salvar alterações"}
      </Button>
    </form>
  );
}

export function ProfilePage() {
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const students = useStudents();
  const { student } = useMyStudent();
  const own = students.data?.find((s) => s.userId === user?.id) ?? null;
  const passport = usePassport();
  const myUnit = useMyUnit();
  const identity = useMyIdentity();
  const roles = useMyRoles();
  const graduations = useGraduations(student?.id); // passaporte e graduação: do aluno ATIVO (seletor)
  const [qrOpen, setQrOpen] = useState(false);

  const passportAction = useMutation({
    mutationFn: async (action: "publish" | "unpublish" | "consent") => {
      const studentId = passport.data?.student.id;
      if (studentId === undefined) return;
      if (action === "consent") {
        await api.patch("/passport/guardian-consent", { studentId, consent: true });
        await api.post("/passport/publish", { studentId });
      } else {
        await api.post(`/passport/${action}`, { studentId });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["passport"] }),
    onError: (error) => toast.error(errorMessage(error, "Não foi possível atualizar o passaporte.")),
  });

  // A cordinha ao lado do nome da conta só vale quando o aluno ativo é o PRÓPRIO usuário; a de um
  // dependente aparece no cartão do passaporte (abaixo), não ao lado do nome do responsável.
  const first = own && student?.id === own.id ? graduations.data?.[0] : undefined;
  const links = own?.socialLinks ?? {};
  const socials = SOCIAL_FIELDS.filter((field) => links[field.key]);
  const p = passport.data;
  const code = p?.publicProfile?.publicCode;
  const actions = passportActions(p?.viewer, user?.role);

  function handleLogout() {
    logout(queryClient);
    void navigate({ to: "/login", search: { redirect: undefined } });
  }

  return (
    <>
      <PageHeading title="Meu perfil" subtitle="Sua identidade, suas raízes e sua capoeira." />
      {students.error && <StateMessage tone="error">{errorMessage(students.error, "Não foi possível carregar o perfil.")}</StateMessage>}
      <div className="profile-layout">
        <div>
          {own?.coverPhoto && (
            <img src={imageSrc(own.coverPhoto)} alt="" className="mb-5 h-36 w-full rounded-lg object-cover" />
          )}
          <div className="profile-identity">
            <Avatar name={user?.name} src={own?.photo} size={72} groupName={identity.groupName ?? p?.organization.name} groupLogoUrl={identity.groupLogoUrl} />
            <div>
              <h2>{user?.name}</h2>
              <RoleBadges roles={roles} className="mb-1" />
              <p>
                {roles.length > 0 ? "Aluno" : (ROLE_LABEL[user?.role ?? ""] ?? user?.role)}
                {first ? ` · ${first.graduationLevel.name}` : ""}
              </p>
              {p && <span className="badge mt-2">{p.organization.name}</span>}
            </div>
          </div>
          {socials.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {socials.map((field) => (
                <Button key={field.key} variant="outline" size="icon" asChild aria-label={field.label} title={field.label}>
                  <a href={links[field.key]} target="_blank" rel="noopener noreferrer">
                    <field.icon />
                  </a>
                </Button>
              ))}
            </div>
          )}
          {own ? (
            <ProfileForm key={own.id + (own.photo ?? "") + (own.coverPhoto ?? "") + JSON.stringify(own.socialLinks ?? null)} student={own} />
          ) : (
            !students.isLoading && (
              <p className="text-xs text-muted-foreground">
                Esta conta não tem um perfil de aluno próprio, então foto, capa e redes sociais não podem ser editadas.
              </p>
            )
          )}
          {user?.mustChangePassword && (
            <p role="alert" className="mt-4 rounded-md border border-primary/40 bg-primary/10 p-3 text-sm" data-testid="must-change-password">
              Sua senha foi definida pelo seu mestre ou professor. Crie uma senha nova abaixo para continuar usando o aplicativo.
            </p>
          )}
          {!user?.mustChangePassword && <PanelShortcut roles={roles} />}
          {!user?.mustChangePassword && <PersonCodeCard />}
          {!user?.mustChangePassword && <TransfersShortcut />}
          {!user?.mustChangePassword && <OccurrencesShortcut />}
          {!user?.mustChangePassword && own && student?.id === own.id && <FichaEditSection />}
          <ChangePasswordSection />
          {!user?.mustChangePassword && <TwoFactorSection />}
          {!user?.mustChangePassword && <MyDataSection />}
          <Button variant="outline" className="mt-6" onClick={handleLogout}>
            <LogOut />
            Sair da conta
          </Button>
        </div>
        <div>
          {passport.isLoading ? (
            <StateMessage>Carregando passaporte…</StateMessage>
          ) : p ? (
            <div className="passport">
              <span className="eyebrow">
                <Sprout size={13} />
                Passaporte do capoeirista
              </span>
              <h3>{p.student.name}</h3>
              <p>{p.organization.name}</p>
              <div className="flex gap-2 mt-6 items-center text-sm">
                <Award size={17} />
                {p.currentGraduation?.name ?? "Sem graduação"}
                {p.currentGraduation && <Rope {...p.currentGraduation} orientation="horizontal" length={44} thickness={11} />}
              </div>
              {p.unit && <p className="mt-3">{p.unit.name}</p>}
              <div className="flex gap-4 mt-4 text-xs">
                <span>{p.stats.aulas} aulas</span>
                <span>{p.stats.rodas} rodas</span>
                <span>{p.stats.eventos} eventos</span>
                <span>{p.stats.certificados} certificados</span>
              </div>
              <div className="passport-line">
                <div>
                  <p>Na capoeira desde</p>
                  <strong className="text-sm">
                    {student?.joinedAt ? fmt(dayOnly(student.joinedAt), "MMMM 'de' yyyy") : "—"}
                  </strong>
                </div>
                {p.publicProfile?.isPublished && (
                  <Button variant="hero" size="icon" aria-label="Ver QR Code do passaporte" title="Ver QR Code do passaporte" onClick={() => setQrOpen(true)}>
                    <QrCode />
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {p.publicProfile?.isPublished ? (
                  <Button variant="hero" size="sm" disabled={passportAction.isPending} onClick={() => passportAction.mutate("unpublish")}>
                    Despublicar passaporte
                  </Button>
                ) : (
                  <>
                    {/* Espelha as regras do backend (LGPD): menor não publica sozinho. Sem `viewer`
                        (backend antigo) mantém o comportamento anterior e o backend decide. */}
                    {actions.canPublish && (
                      <Button variant="hero" size="sm" disabled={passportAction.isPending} onClick={() => passportAction.mutate("publish")}>
                        Compartilhar passaporte
                      </Button>
                    )}
                    {actions.canConsent && (
                      <Button variant="hero" size="sm" disabled={passportAction.isPending} onClick={() => passportAction.mutate("consent")}>
                        Autorizar e publicar (responsável)
                      </Button>
                    )}
                    {actions.showMinorNote && (
                      <p className="text-sm opacity-90" data-testid="passport-minor-note">
                        Aluno menor de idade: um responsável cadastrado precisa autorizar e publicar o passaporte.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <StateMessage>Passaporte indisponível para esta conta.</StateMessage>
          )}
          <section className="content-band">
            <h2>Minhas raízes</h2>
            {p && (
              <div className="detail-line">
                <Sprout />
                {p.organization.name}
              </div>
            )}
            {p?.unit && <UnitLine unit={myUnit ?? { name: p.unit.name, photo: p.unit.photo ?? null }} />}
            {(students.data ?? []).length > 1 && (
              <div className="detail-line">
                <Users />
                Alunos vinculados: {(students.data ?? []).map((s) => s.name).join(", ")}
              </div>
            )}
          </section>
        </div>
      </div>
      <QrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        title={`Passaporte de ${p?.student.name ?? ""}`}
        description="Escaneie para ver o Passaporte público."
        url={code ? passportUrl(code) : null}
      />
    </>
  );
}
