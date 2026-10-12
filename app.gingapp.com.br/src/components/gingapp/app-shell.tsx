import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  House,
  Route,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Wallet,
  Users,
  CircleDot,
  Bell,
  UserRound,
  MapPin,
  ChevronRight,
  Download,
  Heart,
  Menu,
  LogOut,
  QrCode,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { logout } from "@/lib/auth";
import { useSessionUser } from "@/lib/session";
import { useMyIdentity, useMyStudent, usePassport, useUnreadCount } from "@/lib/queries";
import { Avatar } from "./avatar";

const mainNav = [
  { to: "/", label: "Início", icon: House },
  { to: "/jornada", label: "Minha jornada", icon: Route },
  { to: "/aulas", label: "Minhas aulas", icon: CalendarDays },
  { to: "/frequencia", label: "Frequência", icon: ChartNoAxesColumnIncreasing },
  { to: "/financeiro", label: "Financeiro", icon: Wallet },
  { to: "/checkin", label: "Check-in", icon: QrCode },
] as const;
const communityNav = [
  { to: "/comunidade", label: "Comunidade", icon: Users },
  { to: "/eventos", label: "Eventos", icon: CalendarDays },
  { to: "/rodas", label: "Rodas de capoeira", icon: CircleDot },
  { to: "/ranking", label: "Ranking", icon: Trophy },
] as const;
const personalNav = [
  { to: "/notificacoes", label: "Notificações", icon: Bell },
  { to: "/perfil", label: "Meu perfil", icon: UserRound },
] as const;
const bottomNav = [mainNav[0], mainNav[1], communityNav[0], communityNav[3], mainNav[2], personalNav[1]];
type NavItem = (typeof mainNav)[number] | (typeof communityNav)[number] | (typeof personalNav)[number];

export function Brand({ mobile = false, large = false }: { mobile?: boolean; large?: boolean }) {
  return (
    <div className={`brand ${mobile ? "mobile-brand" : ""} ${large ? "brand-lg" : ""}`}>
      <img src="/logo.png" alt="GingApp" width={1550} height={312} />
    </div>
  );
}

/**
 * Seletor de dependente: aparece SÓ quando a conta tem 2+ alunos ligados (responsável com mais de um
 * dependente, ou aluno que também é responsável). ALUNO com um vínculo e responsável com 1 dependente
 * não veem nada. O aluno escolhido guia TODAS as telas (passaporte, graduações, aulas, frequência,
 * financeiro, inscrição em eventos) e a escolha persiste por usuário.
 */
export function StudentSwitcher() {
  const { students, student, selectStudent } = useMyStudent();
  if (students.length < 2 || !student) return null;
  return (
    <div className="student-bar" data-testid="student-switcher">
      <label htmlFor="active-student">
        <Users size={14} /> Acompanhando
      </label>
      <select
        id="active-student"
        className="select-field"
        aria-label="Aluno ativo"
        value={student.id}
        onChange={(event) => selectStudent(Number(event.target.value))}
      >
        {students.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [installOpen, setInstallOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const passport = usePassport();
  const me = useMyIdentity();
  const unread = useUnreadCount().data ?? 0; // contado no banco, não pela lista de notificações
  const groupName = passport.data?.organization.name ?? user?.organizationSlug ?? "Seu grupo";
  const unitName = passport.data?.unit?.name ?? "";
  const current = [...mainNav, ...communityNav, ...personalNav].find((item) => item.to === pathname)?.label ?? "GingApp";

  function handleLogout() {
    logout(queryClient);
    setMenuOpen(false);
    void navigate({ to: "/login", search: { redirect: undefined } });
  }

  const navigation = (items: readonly NavItem[]) =>
    items.map((item) => (
      <Link
        key={item.to}
        to={item.to}
        className={`nav-item ${pathname === item.to ? "active" : ""}`}
        onClick={() => setMenuOpen(false)}
      >
        <item.icon />
        <span>{item.label}</span>
        {item.to === "/notificacoes" && unread > 0 && <span className="nav-count">{unread > 9 ? "9+" : unread}</span>}
      </Link>
    ));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="no-underline">
          <Brand />
        </Link>
        <p className="brand-sub">A plataforma que conecta a capoeira.</p>
        <nav aria-label="Menu principal">
          {navigation(mainNav)}
          <div className="nav-caption">Na roda, juntos</div>
          {navigation(communityNav)}
          <div className="nav-caption">Sua conta</div>
          {navigation(personalNav)}
        </nav>
        <div className="sidebar-bottom">
          <Link to="/perfil" className="group-mini no-underline" aria-label="Meu perfil">
            <Avatar decorative name={me.name || user?.name} src={me.photo} size={38} groupName={me.groupName ?? groupName} groupLogoUrl={me.groupLogoUrl} />
            <div className="min-w-0">
              <strong className="truncate">{user?.name}</strong>
              <p className="truncate">
                {groupName}
                {unitName ? ` · ${unitName}` : ""}
              </p>
            </div>
            <ChevronRight size={13} className="ml-auto flex-none text-muted-foreground" />
          </Link>
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground mt-3 text-xs" onClick={() => setInstallOpen(true)}>
            <Download size={14} /> Instalar GingApp
          </Button>
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground text-xs" onClick={handleLogout}>
            <LogOut size={14} /> Sair
          </Button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Meu GingApp <ChevronRight size={12} />
            <strong>{current}</strong>
          </div>
          <Link to="/" className="no-underline">
            <Brand mobile />
          </Link>
          <div className="top-actions">
            {unitName && (
              <span className="location-label">
                <MapPin size={13} /> {unitName}
              </span>
            )}
            <Button variant="ghost" size="icon" asChild title="Notificações">
              <Link to="/notificacoes">
                <Bell size={18} />
              </Link>
            </Button>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}>
              <Menu />
            </Button>
            <Link to="/perfil" aria-label="Meu perfil">
              <Avatar decorative name={me.name || user?.name} src={me.photo} size={36} groupName={me.groupName} groupLogoUrl={me.groupLogoUrl} />
            </Link>
          </div>
        </header>
        <StudentSwitcher />
        <main className="main-content">
          {children}
          <footer className="footer">
            <span>
              Feito de ginga, história e conexão <Heart size={10} />
            </span>
            <span>GingApp © {new Date().getFullYear()} • Axé!</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navegação inferior">
        {bottomNav.map((item) => (
          <Link key={item.to} to={item.to} className={pathname === item.to ? "active" : ""}>
            <item.icon />
            <span>
              {item.to === "/jornada" ? "Jornada" : item.to === "/aulas" ? "Aulas" : item.to === "/perfil" ? "Perfil" : item.label}
            </span>
          </Link>
        ))}
      </nav>
      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent>
          <DialogTitle>Leve sua capoeira com você</DialogTitle>
          <DialogDescription>Instale o GingApp na tela inicial do seu celular.</DialogDescription>
          <div className="space-y-4 text-sm">
            <p>
              <strong>No iPhone:</strong> abra no Safari, toque em Compartilhar e selecione “Adicionar à Tela de Início”.
            </p>
            <p>
              <strong>No Android:</strong> abra no Chrome, toque no menu ⋮ e selecione “Instalar aplicativo” ou “Adicionar à tela inicial”.
            </p>
            <p className="text-muted-foreground">
              A instalação e o acesso básico sem internet ficam disponíveis na versão publicada. Dados da sua conta sempre são buscados online.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent>
          <DialogTitle>Meu GingApp</DialogTitle>
          <DialogDescription>
            {groupName}
            {unitName ? ` · ${unitName}` : ""}
          </DialogDescription>
          <Link to="/perfil" className="menu-user no-underline" onClick={() => setMenuOpen(false)}>
            <Avatar name={me.name || user?.name} src={me.photo} size={44} groupName={me.groupName} groupLogoUrl={me.groupLogoUrl} />
            <strong className="truncate">{user?.name}</strong>
          </Link>
          <nav>{navigation([...mainNav, ...communityNav, ...personalNav])}</nav>
          <Button
            variant="soft"
            onClick={() => {
              setMenuOpen(false);
              setInstallOpen(true);
            }}
          >
            <Download />
            Instalar GingApp
          </Button>
          <Button variant="outline" onClick={handleLogout}>
            <LogOut />
            Sair
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
