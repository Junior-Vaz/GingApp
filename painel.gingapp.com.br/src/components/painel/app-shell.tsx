import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Brand } from "@/components/painel/brand";
import { ChangePasswordButton } from "@/components/painel/change-password-dialog";
import { MyDataButton } from "@/components/painel/legal";
import { TwoFactorButton } from "@/components/painel/two-factor-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { initials } from "@/lib/format";
import { navItemsFor } from "@/lib/nav";
import { ROLE_LABEL, useSessionUser } from "@/lib/session";
import { imageSrc } from "@/lib/uploads";

/** Layout do painel: sidebar colapsável (drawer no mobile) + topbar com usuário/grupo/logout. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const items = navItemsFor(user?.role);
  const logoSrc = imageSrc(user?.organizationLogoUrl?.trim()) || "/icone.png";
  const current = items.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));

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
        <SidebarFooter className="border-t group-data-[collapsible=icon]:hidden">
          {/* No celular o nome/papel não cabem no cabeçalho: aparecem aqui, na gaveta do menu. */}
          {user && (
            <p className="truncate px-2 text-xs font-semibold sm:hidden" data-testid="drawer-user">
              {user.name} · {ROLE_LABEL[user.role]}
            </p>
          )}
          <p className="truncate px-2 text-xs text-muted-foreground">{user?.organizationSlug}</p>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 min-w-0 items-center gap-2 border-b bg-card px-3 sm:gap-3 sm:px-4">
          <SidebarTrigger aria-label="Alternar menu" className="shrink-0" />
          {/* Celular/tablet: o menu vira gaveta e a marca some da tela; o logo do grupo (ou o do GingApp) fica no cabeçalho. */}
          <img
            data-testid="topbar-logo"
            src={logoSrc}
            alt={user?.organizationLogoUrl ? `Logo de ${user.organizationSlug}` : "GingApp"}
            className="size-7 shrink-0 rounded-full bg-secondary object-cover md:hidden"
          />
          <Separator orientation="vertical" className="hidden h-5 md:block" />
          {/* min-w-0 + truncate: um título longo (ex.: "Transferências") encolhe em vez de empurrar as ações para fora da tela. */}
          <span className="min-w-0 truncate font-display text-sm font-bold">{current?.label ?? "Painel"}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
            {user && (
              <div className="hidden items-center gap-2 sm:flex" data-testid="topbar-user">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-secondary text-xs font-bold text-primary">
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden text-left leading-tight sm:block">
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.organizationSlug}</p>
                </div>
                <Badge variant="secondary" className="hidden sm:inline-flex">
                  {ROLE_LABEL[user.role]}
                </Badge>
              </div>
            )}
            <MyDataButton />
            <ChangePasswordButton />
            <TwoFactorButton />
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
