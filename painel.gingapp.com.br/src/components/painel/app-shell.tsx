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

/** Layout do painel: sidebar colapsável (drawer no mobile) + topbar com usuário/grupo/logout. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const items = navItemsFor(user?.role);
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
          <p className="truncate px-2 text-xs text-muted-foreground">{user?.organizationSlug}</p>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-card px-4">
          <SidebarTrigger aria-label="Alternar menu" />
          <Separator orientation="vertical" className="h-5" />
          <span className="font-display text-sm font-bold">{current?.label ?? "Painel"}</span>
          <div className="ml-auto flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2" data-testid="topbar-user">
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
