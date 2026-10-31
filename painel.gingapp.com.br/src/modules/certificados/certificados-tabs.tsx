import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const TAB_CLASS =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0";
const ACTIVE_CLASS = "bg-background text-foreground shadow";

/** Abas "Certificados" | "Modelos" (rotas /certificados e /certificados/modelos). */
export function CertificadosTabs({ active }: { active: "certificados" | "modelos" }) {
  return (
    <nav aria-label="Seções de certificados" className="mb-4">
      <div className="inline-flex max-w-full items-center rounded-lg bg-muted p-1 md:h-9">
        <Link
          to="/certificados"
          activeOptions={{ exact: true }}
          aria-current={active === "certificados" ? "page" : undefined}
          className={cn(TAB_CLASS, active === "certificados" && ACTIVE_CLASS)}
        >
          Certificados
        </Link>
        <Link
          to="/certificados/modelos"
          activeOptions={{ exact: true }}
          aria-current={active === "modelos" ? "page" : undefined}
          className={cn(TAB_CLASS, active === "modelos" && ACTIVE_CLASS)}
        >
          Modelos
        </Link>
      </div>
    </nav>
  );
}
