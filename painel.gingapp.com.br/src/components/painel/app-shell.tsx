import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Building2, LogOut } from "lucide-react";
import { Brand } from "@/components/painel/brand";
import { ChangePasswordButton } from "@/components/painel/change-password-dialog";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { MyDataButton } from "@/components/painel/legal";
import { MobileNav } from "@/components/painel/mobile-nav";
import { OfflineBanner, UpdatePrompt } from "@/components/painel/pwa-prompts";
import { TwoFactorButton } from "@/components/painel/two-factor-dialog";
import { UserAvatar } from "@/components/painel/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { logout } from "@/lib/auth";
import { PROFILE_ITEM, navItemsFor } from "@/lib/nav";
import { useSyncSessionFromMe } from "@/lib/profile";
import { ROLE_LABEL, useSessionUser } from "@/lib/session";
import { imageSrc } from "@/lib/uploads";

/** Layout do painel: sidebar colapsável (drawer no mobile) + topbar com grupo, avatar do usuário e logout. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Foto, nome do grupo e cargos vêm de GET /auth/me (o login antigo pode não trazer): mantém a sessão em dia.
  useSyncSessionFromMe();
  const items = navItemsFor(user?.role);
  const logoSrc = imageSrc(user?.organizationLogoUrl?.trim()) || "/icone.png";
  const groupName = user?.organizationName?.trim() || user?.organizationSlug || "";
  const current = items.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
  const onProfile = pathname === PROFILE_ITEM.to || pathname.startsWith(`${PROFILE_ITEM.to}/`);
  const title = onProfile ? PROFILE_ITEM.label : (current?.label ?? "Painel");

  function handleLogout() {
    logout(queryClient);
    void navigate({ to: "/login", search: { redirect: undefined } });
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-14 justify-center border-b px-4 group-data-[collapsible=icon]:px-2">
          <div className="group-data-[collapsible=icon]:hidden">
            <Brand withBadge />
          </div>
          <img
            src="/icone.png"
            alt="GingApp"
            className="hidden size-7 rounded-full group-data-[collapsible=icon]:block"
          />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu aria-label="Menu principal">
                {items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.label}
                      isActive={current?.to === item.to}
                    >
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t">
          {/* Usuário logado: o mesmo avatar do cabeçalho, com nome, papel e grupo; abre o perfil. */}
          {user && (
            <SidebarMenu aria-label="Conta">
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  size="lg"
                  tooltip={PROFILE_ITEM.label}
                  isActive={onProfile}
                >
                  <Link to={PROFILE_ITEM.to} data-testid="sidebar-user">
                    <UserAvatar className="size-8" />
                    <span className="grid min-w-0 flex-1 text-left leading-tight">
                      <span className="truncate text-sm font-semibold">{user.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {ROLE_LABEL[user.role]} · {groupName}
                      </span>
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        {/* Celular: cabeçalho compacto que respeita o entalhe/status bar (safe-area); a navegação fica na barra inferior. */}
        <header className="sticky top-0 z-10 flex h-[calc(3rem+env(safe-area-inset-top))] min-w-0 items-center gap-2 border-b bg-card px-3 pt-[env(safe-area-inset-top)] sm:gap-3 sm:px-4 md:h-14 md:pt-0">
          <SidebarTrigger aria-label="Alternar menu" className="shrink-0 max-md:hidden" />
          {/* Celular/tablet: o menu vira gaveta e a marca some da tela; o logo do grupo (ou o do GingApp) fica no cabeçalho. */}
          <img
            data-testid="topbar-logo"
            src={logoSrc}
            alt={user?.organizationLogoUrl ? `Logo de ${groupName}` : "GingApp"}
            className="size-7 shrink-0 rounded-full bg-secondary object-cover md:hidden"
          />
          <Separator orientation="vertical" className="hidden h-5 md:block" />
          {/* min-w-0 + truncate: um título longo (ex.: "Transferências") encolhe em vez de empurrar o avatar para fora da tela. */}
          <span
            className="min-w-0 truncate font-display text-sm font-bold md:shrink-0"
            data-testid="topbar-title"
          >
            {title}
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            {user && (
              <div className="flex min-w-0 items-center gap-2" data-testid="topbar-user">
                {/* Grupo: nome truncado (e, no desktop, o logo pequeno). No celular o logo do grupo já está à esquerda. */}
                <span className="flex min-w-0 items-center gap-1.5" data-testid="topbar-group">
                  <EntityAvatar
                    name={groupName}
                    photo={user.organizationLogoUrl}
                    icon={Building2}
                    className="hidden size-6 md:inline-flex"
                  />
                  <span className="max-w-[7.5rem] truncate text-xs font-semibold text-muted-foreground min-[400px]:max-w-[10rem] sm:max-w-[14rem] sm:text-sm lg:max-w-[18rem]">
                    {groupName}
                  </span>
                </span>
                <Link
                  to={PROFILE_ITEM.to}
                  aria-label={PROFILE_ITEM.label}
                  title={PROFILE_ITEM.label}
                  data-testid="topbar-avatar"
                  className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <UserAvatar className="size-9" />
                </Link>
                <div className="hidden text-left leading-tight xl:block">
                  <p className="max-w-40 truncate text-sm font-semibold">{user.name}</p>
                </div>
                <Badge variant="secondary" className="hidden xl:inline-flex">
                  {ROLE_LABEL[user.role]}
                </Badge>
              </div>
            )}
            {/* Celular: estas ações moram na folha "Mais" da barra inferior (MobileNav) e no perfil. */}
            <div className="flex shrink-0 items-center gap-1 max-md:hidden sm:gap-3">
              <MyDataButton />
              <ChangePasswordButton />
              <TwoFactorButton />
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut />
                <span className="hidden lg:inline">Sair</span>
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] md:px-8 md:py-8">
          <OfflineBanner />
          {children}
        </main>
        <MobileNav onLogout={handleLogout} />
        <UpdatePrompt />
      </SidebarInset>
    </SidebarProvider>
  );
}
