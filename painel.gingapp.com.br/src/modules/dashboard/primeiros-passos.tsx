import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import {
  FIRST_STEPS_TOTAL,
  computeFirstSteps,
  countDone,
  readFirstStepsFlag,
  writeFirstStepsFlag,
  type FirstStepId,
} from "@/lib/first-steps";
import { appOrigin } from "@/lib/format";
import { useSessionUser } from "@/lib/session";
import { useOwnOrganization } from "@/modules/configuracoes/org-api";
import type { Unit } from "@/modules/unidades/units";

/** Consultas leves (já existentes) que respondem "o que já foi feito?". Erro = passo pendente, sem derrubar o dashboard. */
const LIGHT = { retry: false, staleTime: 30_000 } as const;

function useFirstStepsFacts(appOpened: boolean) {
  const org = useOwnOrganization();
  // GET /units não filtra por Matriz: poucas unidades por grupo, então uma página de 50 cobre.
  const units = useQuery({ queryKey: ["first-steps", "units"], queryFn: () => api.getPage<Unit>("/units", { limit: 50 }), ...LIGHT });
  const classes = useQuery({ queryKey: ["first-steps", "classes"], queryFn: () => api.getPage<unknown>("/classes", { limit: 1 }), ...LIGHT });
  const teachers = useQuery({
    queryKey: ["first-steps", "teachers"],
    queryFn: () => api.getPage<unknown>("/teachers", { role: "PROFESSOR", limit: 1 }),
    ...LIGHT,
  });
  const students = useQuery({ queryKey: ["first-steps", "students"], queryFn: () => api.getPage<unknown>("/students", { limit: 1 }), ...LIGHT });
  const settled = ![org, units, classes, teachers, students].some((query) => query.isPending);
  const steps = computeFirstSteps({
    organization: org.data ?? null,
    units: units.data?.items ?? null,
    classesTotal: classes.data?.total ?? null,
    teachersTotal: teachers.data?.total ?? null,
    studentsTotal: students.data?.total ?? null,
    appOpened,
  });
  return { settled, steps };
}

interface StepAction {
  label: string;
  to: "/configuracoes" | "/unidades" | "/turmas" | "/alunos" | "/professores";
}

const STEP_TEXT: Record<Exclude<FirstStepId, "app">, { title: string; hint: string; actions: StepAction[] }> = {
  profile: {
    title: "Complete o perfil do grupo",
    hint: "Informe a cidade, a UF e uma apresentação do grupo.",
    actions: [{ label: "Abrir configurações", to: "/configuracoes" }],
  },
  matriz: {
    title: "Confira o endereço da unidade Matriz",
    hint: "É o local principal de treino; o endereço ajuda os alunos a te encontrar.",
    actions: [{ label: "Abrir unidades", to: "/unidades" }],
  },
  class: {
    title: "Cadastre a primeira turma",
    hint: "Com a turma criada você já pode gerar aulas e fazer a chamada.",
    actions: [{ label: "Abrir turmas", to: "/turmas" }],
  },
  people: {
    title: "Cadastre o primeiro professor ou aluno",
    hint: "Quem treina com você, ou quem ajuda a dar aula.",
    actions: [
      { label: "Cadastrar aluno", to: "/alunos" },
      { label: "Cadastrar professor", to: "/professores" },
    ],
  },
};

function StepRow({ id, done, onOpenApp }: { id: FirstStepId; done: boolean; onOpenApp: () => void }) {
  const text = id === "app" ? null : STEP_TEXT[id];
  const title = text?.title ?? "Mostre o app para os alunos";
  const hint = text?.hint ?? "Abra o app dos alunos e instale na tela inicial do celular, para ver como o aluno enxerga o grupo.";
  return (
    <li className="flex gap-3 py-3" data-testid={`first-step-${id}`} data-done={done ? "true" : "false"}>
      {done ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      ) : (
        <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          <span className="sr-only">{done ? "Concluído: " : "Pendente: "}</span>
          {title}
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {text ? (
            text.actions.map((action) => (
              <Button key={action.to} asChild variant={done ? "ghost" : "outline"} size="sm" className="min-h-11 md:min-h-8">
                <Link to={action.to}>{action.label}</Link>
              </Button>
            ))
          ) : (
            <Button asChild variant={done ? "ghost" : "outline"} size="sm" className="min-h-11 md:min-h-8">
              <a href={appOrigin()} target="_blank" rel="noopener noreferrer" onClick={onOpenApp}>
                Abrir o app dos alunos <ExternalLink aria-hidden />
              </a>
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function FirstStepsContent({ userId, onDismiss }: { userId: number; onDismiss: () => void }) {
  const [appOpened, setAppOpened] = useState(() => readFirstStepsFlag(userId, "app"));
  const { settled, steps } = useFirstStepsFacts(appOpened);
  // Espera as consultas para não piscar "0 de 5" e sumir logo em seguida.
  if (!settled) return null;
  const done = countDone(steps);
  // Tudo cumprido: o cartão some sozinho.
  if (done === FIRST_STEPS_TOTAL) return null;

  return (
    <Card className="mb-4 gap-3 p-5" data-testid="first-steps" aria-labelledby="first-steps-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="first-steps-title" className="text-base font-extrabold">
            Primeiros passos
          </h2>
          <p className="text-sm text-muted-foreground">Deixe o seu grupo pronto para usar, um passo de cada vez.</p>
        </div>
        <Button variant="ghost" size="sm" className="min-h-11 shrink-0 md:min-h-8" onClick={onDismiss}>
          Dispensar
        </Button>
      </div>
      <div className="flex items-center gap-3">
        {/* O Progress do shadcn não repassa `value` ao Root: os atributos ARIA vão explícitos (o Radix deixa os de fora vencerem). */}
        <Progress
          value={(done / FIRST_STEPS_TOTAL) * 100}
          aria-valuenow={Math.round((done / FIRST_STEPS_TOTAL) * 100)}
          aria-valuetext={`${String(done)} de ${String(FIRST_STEPS_TOTAL)} passos`}
          aria-label="Progresso dos primeiros passos"
          className="h-2 flex-1"
          data-testid="first-steps-progress"
        />
        <span className="shrink-0 text-sm font-semibold" data-testid="first-steps-count">
          {done} de {FIRST_STEPS_TOTAL}
        </span>
      </div>
      <ol className="divide-y">
        {(["profile", "matriz", "class", "people", "app"] as const).map((id) => (
          <StepRow
            key={id}
            id={id}
            done={steps[id]}
            onOpenApp={() => {
              writeFirstStepsFlag(userId, "app");
              setAppOpened(true);
            }}
          />
        ))}
      </ol>
    </Card>
  );
}

/** Cartão "Primeiros passos": só para o MESTRE, no topo do dashboard. Dispensar persiste por usuário (localStorage). */
export function FirstStepsCard() {
  const user = useSessionUser();
  if (!user || user.role !== "MESTRE") return null;
  return <FirstStepsGate key={user.id} userId={user.id} />;
}

function FirstStepsGate({ userId }: { userId: number }) {
  const [dismissed, setDismissed] = useState(() => readFirstStepsFlag(userId, "dismissed"));
  if (dismissed) return null;
  return (
    <FirstStepsContent
      userId={userId}
      onDismiss={() => {
        writeFirstStepsFlag(userId, "dismissed");
        setDismissed(true);
      }}
    />
  );
}
