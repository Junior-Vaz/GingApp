import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  Bell,
  Check,
  Facebook,
  FileText,
  Instagram,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageCircle,
  Music2,
  QrCode,
  Route as RouteIcon,
  ShieldCheck,
  ShieldAlert,
  Sprout,
  Trophy,
  CalendarCheck,
  Wallet,
  Users,
  UserRound,
  Pencil,
  X,
  Youtube,
  ArrowRightLeft,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { api, errorMessage } from "@/lib/api";
import { logout } from "@/lib/auth";
import { buildProfilePayload, passportActions } from "@/lib/derive";
import { dayOnly, fmt, passportUrl } from "@/lib/format";
import { useSessionUser } from "@/lib/session";
import { plural } from "@/lib/plural";
import { isPushSupported, needsIosInstall, usePushConfig } from "@/lib/push";
import {
  useFicha,
  useMyIdentity,
  useMyRoles,
  useMyStudent,
  useMyUnit,
  useOccurrences,
  usePassport,
  useStudents,
  useTransfers,
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
import { PanelShortcut } from "./roles";
import { TwoFactorSection } from "./two-factor";
import { StateMessage } from "./shared";
import { Rope } from "./rope";
import { OccurrencesShortcut } from "./occurrences";
import { TransfersShortcut } from "./transfers";
import { PushSettings } from "./push-settings";
import { DependentChips, InstallRow, LinkRow, ProfileCard, ProfileHero, ProfileHighlights, ProfileSkeleton } from "./profile-parts";

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
      <input className="profile-input min-w-0 flex-1" id={id} type="text" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value.trim() !== "" && (
        <Button type="button" variant="ghost" size="sm" aria-label={`Remover ${label}`} onClick={() => onChange("")}>
          <X />
          Remover
        </Button>
      )}
    </div>
  );
}

type ProfileFormState = { photo: string; coverPhoto: string; instagram: string; youtube: string; tiktok: string; facebook: string; whatsapp: string };

/** Estado inicial do formulário a partir do aluno (campos ausentes viram texto vazio). */
function formFromStudent(student: Student): ProfileFormState {
  const links = student.socialLinks ?? {};
  return {
    photo: student.photo ?? "",
    coverPhoto: student.coverPhoto ?? "",
    instagram: links.instagram ?? "",
    youtube: links.youtube ?? "",
    tiktok: links.tiktok ?? "",
    facebook: links.facebook ?? "",
    whatsapp: links.whatsapp ?? "",
  };
}

/** Salva foto, capa e redes (PATCH /students/me/profile): ÚNICO caminho de gravação, usado pelo formulário e pela troca rápida de foto. */
function useSaveProfile(onSaved?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    // Campo vazio => null (limpa no servidor); ver buildProfilePayload.
    mutationFn: (form: ProfileFormState) => api.patch("/students/me/profile", buildProfilePayload(form)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["students"] });
      toast.success("Perfil atualizado.");
      onSaved?.();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar o perfil.")),
  });
}

export function ProfileForm({ student }: { student: Student }) {
  const [form, setForm] = useState<ProfileFormState>(() => formFromStudent(student));
  const set = (key: keyof ProfileFormState) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const save = useSaveProfile();

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(form);
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

/** Troca rápida da foto (botão de câmera do avatar): envia a imagem e salva só a foto, mantendo capa e redes. */
function PhotoDialog({ open, onOpenChange, student }: { open: boolean; onOpenChange: (open: boolean) => void; student: Student }) {
  const [photo, setPhoto] = useState(student.photo ?? "");
  const save = useSaveProfile(() => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Trocar foto do perfil</DialogTitle>
        <DialogDescription>Envie uma imagem JPEG, PNG ou WebP de até 5 MB.</DialogDescription>
        <ImageUploadControl label="foto" value={photo} onChange={setPhoto} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate({ ...formFromStudent(student), photo })}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            {save.isPending ? "Salvando…" : "Salvar foto"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Folha de edição (lateral no desktop, de baixo no celular): foto, capa, redes e dados da ficha (apelido/telefone). */
function ProfileEditSheet({ open, onOpenChange, own, canEditFicha }: { open: boolean; onOpenChange: (open: boolean) => void; own: Student | null; canEditFicha: boolean }) {
  const mobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={mobile ? "bottom" : "right"} className="pf-sheet" data-testid="profile-edit-sheet">
        <SheetHeader>
          <SheetTitle>Editar perfil</SheetTitle>
          <SheetDescription>Foto, capa, redes sociais e dados da sua ficha.</SheetDescription>
        </SheetHeader>
        {own ? (
          <ProfileForm key={own.id + (own.photo ?? "") + (own.coverPhoto ?? "") + JSON.stringify(own.socialLinks ?? null)} student={own} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Esta conta não tem um perfil de aluno próprio, então foto, capa e redes sociais não podem ser editadas.
          </p>
        )}
        {canEditFicha && <FichaEditSection />}
      </SheetContent>
    </Sheet>
  );
}

function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pf-data-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function ProfilePage() {
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const students = useStudents();
  const { student, students: myStudents, selectStudent } = useMyStudent();
  const own = students.data?.find((s) => s.userId === user?.id) ?? null;
  const passport = usePassport();
  const myUnit = useMyUnit();
  const identity = useMyIdentity();
  const roles = useMyRoles();
  const ficha = useFicha();
  const transfers = useTransfers();
  const occurrences = useOccurrences();
  const pushConfig = usePushConfig();
  const [qrOpen, setQrOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

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

  // Apelido/edição da ficha só valem quando o aluno ativo é o PRÓPRIO usuário (o de um dependente é de outra pessoa).
  const ownIsActive = own !== null && student?.id === own.id;
  const links = own?.socialLinks ?? {};
  const socials = SOCIAL_FIELDS.filter((field) => links[field.key]);
  const p = passport.data;
  const code = p?.publicProfile?.publicCode;
  const actions = passportActions(p?.viewer, user?.role);
  const must = user?.mustChangePassword === true;
  const nickname = ownIsActive ? (ficha.data?.person.nickname ?? null) : null;
  const groupName = identity.groupName ?? p?.organization.name ?? null;
  const unitName = myUnit?.name ?? p?.unit?.name ?? null;
  const showPush = pushConfig.data?.enabled === true && (needsIosInstall() || isPushSupported());
  const hasTransferOrOccurrence = (transfers.data?.length ?? 0) > 0 || (occurrences.data?.length ?? 0) > 0;

  function handleLogout() {
    logout(queryClient);
    void navigate({ to: "/login", search: { redirect: undefined } });
  }

  return (
    <div className="pf" data-testid="profile-page">
      <h1 className="sr-only">Meu perfil</h1>
      {students.error && <StateMessage tone="error">{errorMessage(students.error, "Não foi possível carregar o perfil.")}</StateMessage>}

      {students.isLoading ? (
        <ProfileSkeleton />
      ) : (
        <div className="pf-hero-wrap">
          <ProfileHero
            name={user?.name ?? ""}
            nickname={nickname}
            photo={own?.photo ?? identity.photo}
            coverPhoto={own?.coverPhoto ?? null}
            groupName={groupName}
            groupLogoUrl={identity.groupLogoUrl}
            unitName={unitName}
            baseRole={roles.length > 0 ? "Aluno" : (ROLE_LABEL[user?.role ?? ""] ?? user?.role ?? "")}
            roles={roles}
            canEdit={own !== null}
            onEdit={() => setEditOpen(true)}
            onChangePhoto={() => setPhotoOpen(true)}
            extra={
              socials.length > 0 ? (
                <div className="pf-socials">
                  {socials.map((field) => (
                    <a key={field.key} href={links[field.key]} target="_blank" rel="noopener noreferrer" aria-label={field.label} title={field.label}>
                      <field.icon aria-hidden="true" />
                    </a>
                  ))}
                </div>
              ) : null
            }
            footer={<DependentChips students={myStudents} activeId={student?.id} onSelect={selectStudent} />}
          />
        </div>
      )}

      {must && (
        <p role="alert" className="pf-alert" data-testid="must-change-password">
          <ShieldAlert aria-hidden="true" />
          <span>Sua senha foi definida pelo seu mestre ou professor. Crie uma senha nova abaixo para continuar usando o aplicativo.</span>
        </p>
      )}

      {!must && <ProfileHighlights />}

      <div className="pf-grid">
        <div className="pf-col">
          {!must && (
            <ProfileCard icon={RouteIcon} title="Minha jornada" id="pf-journey-title" testId="profile-journey">
              <div className="pf-rows">
                <LinkRow to="/jornada" icon={RouteIcon} label="Jornada" hint="Graduações e evolução" />
                <LinkRow to="/ranking" icon={Trophy} label="Ranking" hint="Sua liga e seus pontos" />
                <LinkRow to="/frequencia" icon={CalendarCheck} label="Frequência" hint="Presenças e faltas" />
                <LinkRow to="/financeiro" icon={Wallet} label="Financeiro" hint="Mensalidades e pagamentos" />
              </div>
            </ProfileCard>
          )}

          {passport.isLoading ? (
            <Skeleton className="pf-passport-sk" aria-label="Carregando passaporte" />
          ) : p ? (
            <div className="passport" data-testid="profile-passport">
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
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-xs">
                <span>{plural(p.stats.aulas, "aula")}</span>
                <span>{plural(p.stats.rodas, "roda")}</span>
                <span>{plural(p.stats.eventos, "evento")}</span>
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
                  <Button variant="hero" size="icon" className="pf-touch" aria-label="Ver QR Code do passaporte" title="Ver QR Code do passaporte" onClick={() => setQrOpen(true)}>
                    <QrCode />
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {p.publicProfile?.isPublished ? (
                  <Button variant="hero" size="sm" className="pf-touch-btn" disabled={passportAction.isPending} onClick={() => passportAction.mutate("unpublish")}>
                    Despublicar passaporte
                  </Button>
                ) : (
                  <>
                    {/* Espelha as regras do backend (LGPD): menor não publica sozinho. Sem `viewer`
                        (backend antigo) mantém o comportamento anterior e o backend decide. */}
                    {actions.canPublish && (
                      <Button variant="hero" size="sm" className="pf-touch-btn" disabled={passportAction.isPending} onClick={() => passportAction.mutate("publish")}>
                        Compartilhar passaporte
                      </Button>
                    )}
                    {actions.canConsent && (
                      <Button variant="hero" size="sm" className="pf-touch-btn" disabled={passportAction.isPending} onClick={() => passportAction.mutate("consent")}>
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
            <div className="pf-empty" data-testid="passport-unavailable">
              <Sprout aria-hidden="true" />
              <p>Passaporte indisponível para esta conta.</p>
              <span>Quando houver um perfil de aluno ligado, o passaporte aparece aqui.</span>
            </div>
          )}

          {!must && <PersonCodeCard />}

          <ProfileCard icon={Sprout} title="Minhas raízes" id="pf-roots-title" testId="profile-roots">
            {p || (students.data ?? []).length > 1 ? (
              <>
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
              </>
            ) : (
              <p className="pf-hint">Seu grupo e sua unidade aparecem aqui assim que você estiver vinculado a um aluno.</p>
            )}
          </ProfileCard>
        </div>

        <div className="pf-col">
          <ProfileCard
            icon={UserRound}
            title="Dados pessoais"
            id="pf-data-title"
            testId="profile-personal"
            aside={
              own ? (
                <Button variant="soft" size="sm" className="pf-touch-btn" onClick={() => setEditOpen(true)}>
                  <Pencil />
                  Editar
                </Button>
              ) : null
            }
          >
            <dl className="pf-data">
              <DataRow label="Nome">{user?.name || "—"}</DataRow>
              <DataRow label="Apelido">{nickname ?? "—"}</DataRow>
              <DataRow label="E-mail">{user?.email || "—"}</DataRow>
              <DataRow label="Telefone">
                <span className="pf-muted-inline">
                  <Lock aria-hidden="true" /> Protegido. Para trocar, use Editar.
                </span>
              </DataRow>
            </dl>
            {!own && !students.isLoading && (
              <p className="pf-hint">Esta conta não tem um perfil de aluno próprio, então foto, capa e redes sociais não podem ser editadas.</p>
            )}
          </ProfileCard>

          <ProfileCard icon={ShieldCheck} title="Segurança" id="pf-security-title" testId="profile-security">
            <div className="pf-stack">
              <ChangePasswordSection />
              {!must && <TwoFactorSection />}
            </div>
          </ProfileCard>

          {showPush && (
            <ProfileCard icon={Bell} title="Avisos no celular" id="pf-push-title" testId="profile-push">
              <PushSettings />
            </ProfileCard>
          )}

          {!must && hasTransferOrOccurrence && (
            <ProfileCard icon={ArrowRightLeft} title="Transferências e ocorrências" id="pf-tx-title" testId="profile-transfers-occurrences">
              <div className="pf-rows">
                <TransfersShortcut className="pf-row" />
                <OccurrencesShortcut className="pf-row" />
              </div>
            </ProfileCard>
          )}

          {!must && (
            <ProfileCard icon={ShieldCheck} title="Privacidade e dados (LGPD)" id="pf-lgpd-title" flat testId="profile-lgpd">
              <MyDataSection />
            </ProfileCard>
          )}

          <ProfileCard icon={FileText} title="Termos e política" id="pf-legal-title" testId="profile-legal">
            <div className="pf-rows">
              <LinkRow to="/termos" icon={FileText} label="Termos de Uso" />
              <LinkRow to="/privacidade" icon={ShieldCheck} label="Política de Privacidade" />
            </div>
          </ProfileCard>

          {!must && roles.length > 0 && (
            <ProfileCard icon={LayoutDashboard} title="Painel do grupo" id="pf-panel-title" flat testId="profile-panel">
              <PanelShortcut roles={roles} />
            </ProfileCard>
          )}

          <InstallRow />
        </div>
      </div>

      <div className="pf-logout">
        <Button variant="ghost" className="pf-logout-btn" onClick={handleLogout}>
          <LogOut />
          Sair da conta
        </Button>
      </div>

      <ProfileEditSheet open={editOpen} onOpenChange={setEditOpen} own={own} canEditFicha={!must && ownIsActive} />
      {own && photoOpen && <PhotoDialog key={own.photo ?? ""} open={photoOpen} onOpenChange={setPhotoOpen} student={own} />}
      <QrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        title={`Passaporte de ${p?.student.name ?? ""}`}
        description="Escaneie para ver o Passaporte público."
        url={code ? passportUrl(code) : null}
      />
    </div>
  );
}
