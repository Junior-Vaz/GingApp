import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Ações à direita (ex.: botão "Novo aluno"). */
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 md:mb-6">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold tracking-tight md:text-2xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground md:mt-1">{description}</p>}
      </div>
      {/* min-w-0 + flex-wrap (sem shrink-0): várias ações quebram de linha em vez de estourar a largura no celular. */}
      {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
