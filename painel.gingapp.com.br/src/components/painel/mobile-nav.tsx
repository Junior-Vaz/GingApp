import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Ellipsis, LogOut } from "lucide-react";
import { ChangePasswordButton } from "@/components/painel/change-password-dialog";
import { MyDataButton } from "@/components/painel/legal";
import { InstallAppButton } from "@/components/painel/pwa-prompts";
import { TwoFactorButton } from "@/components/painel/two-factor-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { mobileMoreFor, mobileTabsFor, type NavItem } from "@/lib/nav";
import { ROLE_LABEL, useSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";

/** No celular o item do dashboard se chama "Início" (o rótulo do menu lateral continua "Dashboard"). */
const tabLabel = (item: NavItem) => (item.to === "/dashboard" ? "Início" : item.label);

const isActive = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/**
 * Navegação do CELULAR (< md): barra inferior com os 4 atalhos mais usados do papel (Início, Alunos, Frequência,
 * Financeiro; sem Financeiro entram Turmas/Aulas) + "Mais", que abre uma folha com o resto do menu e a conta.
 * A lista de itens/permissões vem de `lib/nav.ts` (a mesma do menu lateral): nada de regra duplicada aqui.
 */
export function MobileNav({ onLogout }: { onLogout: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const user = useSessionUser();
  const [open, setOpen] = useState(false);
  const tabs = mobileTabsFor(user?.role);
  const more = mobileMoreFor(user?.role);
  const moreActive = more.some((item) => isActive(pathname, item.to));

  return (
    <>
      <nav
        aria-label="Navegação principal"
        data-testid="mobile-nav"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid auto-cols-fr grid-flow-col">
          {tabs.map((item) => {
            const active = isActive(pathname, item.to);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:bg-secondary",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <span className={cn("grid h-7 w-12 place-items-center rounded-full", active && "bg-secondary")}>
                    <item.icon className="size-5" />
                  </span>
                  {tabLabel(item)}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className={cn(
                "flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:bg-secondary",
                moreActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span className={cn("grid h-7 w-12 place-items-center rounded-full", moreActive && "bg-secondary")}>
                <Ellipsis className="size-5" />
              </span>
              Mais
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="max-h-[88dvh] overflow-y-auto rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle>Mais</SheetTitle>
            <SheetDescription className="sr-only">Demais áreas do painel e opções da conta.</SheetDescription>
          </SheetHeader>
          <ul aria-label="Mais áreas" className="mt-3 grid grid-cols-2 gap-2" data-testid="mobile-more-list">
            {more.map((item) => {
              const active = isActive(pathname, item.to);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-lg border px-3 text-sm font-medium",
                      active ? "border-primary bg-secondary text-primary" : "bg-card",
                    )}
                  >
                    <item.icon className="size-5 shrink-0" />
                    <span className="min-w-0 break-words leading-tight">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 space-y-2 border-t pt-4">
            {user && (
              <p className="truncate text-xs text-muted-foreground" data-testid="drawer-user">
                {user.name} · {ROLE_LABEL[user.role]} · {user.organizationSlug}
              </p>
            )}
            {/* Os botões da conta têm rótulo só em telas largas; aqui viram itens de lista com texto. */}
            <div className="grid gap-1 [&_button]:w-full [&_button]:justify-start [&_span]:inline!">
              <MyDataButton />
              <ChangePasswordButton />
              <TwoFactorButton />
            </div>
            <InstallAppButton className="[&_button]:w-full [&_button]:justify-start" />
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              <LogOut /> Sair
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
