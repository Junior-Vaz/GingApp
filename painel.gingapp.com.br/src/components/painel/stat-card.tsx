import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Linha pequena abaixo do valor. */
  hint?: ReactNode;
  icon?: LucideIcon;
  /** "danger" pinta o valor de vermelho (ex.: inadimplência). */
  tone?: "default" | "danger";
}

export function StatCard({ label, value, hint, icon: Icon, tone = "default" }: StatCardProps) {
  return (
    <Card className="gap-0 p-5" data-testid="stat-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p
            className={cn(
              "mt-2 font-display text-2xl font-extrabold",
              tone === "danger" && "text-destructive",
            )}
          >
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-secondary text-primary">
            <Icon className="size-[18px]" />
          </span>
        )}
      </div>
    </Card>
  );
}
