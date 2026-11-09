/**
 * Cartão "Primeiros passos" do dashboard do MESTRE (docs/CONTRATO_ADESAO_GRUPOS.md, seção 7).
 * Aqui ficam a regra (qual passo está cumprido) e as marcas guardadas no navegador; a tela está em
 * `modules/dashboard/primeiros-passos.tsx`. Nada aqui chama o servidor.
 */

export const FIRST_STEP_IDS = ["profile", "matriz", "class", "people", "app"] as const;
export type FirstStepId = (typeof FIRST_STEP_IDS)[number];
export const FIRST_STEPS_TOTAL = FIRST_STEP_IDS.length;

/** Resultado de uma consulta já resolvida: `null` = ainda não carregou ou falhou (o passo fica pendente). */
export interface FirstStepsFacts {
  organization: { city?: string | null; state?: string | null; description?: string | null } | null;
  /** Unidades do grupo (GET /units). */
  units: ReadonlyArray<{ isMain: boolean; address: string | null }> | null;
  classesTotal: number | null;
  /** Professores cadastrados (GET /teachers?role=PROFESSOR): o próprio Mestre não conta. */
  teachersTotal: number | null;
  studentsTotal: number | null;
  /** O Mestre já abriu o app dos alunos a partir do cartão (marca local, ver `readFirstStepsFlag`). */
  appOpened: boolean;
}

const filled = (value: string | null | undefined): boolean => typeof value === "string" && value.trim() !== "";

/** SSOT das regras: o mesmo cálculo alimenta a lista, a barra "N de 5" e o desaparecimento do cartão. */
export function computeFirstSteps(facts: FirstStepsFacts): Record<FirstStepId, boolean> {
  const org = facts.organization;
  const matriz = facts.units?.find((unit) => unit.isMain);
  return {
    profile: !!org && filled(org.city) && filled(org.state) && filled(org.description),
    matriz: !!matriz && filled(matriz.address),
    class: (facts.classesTotal ?? 0) >= 1,
    people: (facts.teachersTotal ?? 0) >= 1 || (facts.studentsTotal ?? 0) >= 1,
    app: facts.appOpened,
  };
}

export const countDone = (steps: Record<FirstStepId, boolean>): number =>
  FIRST_STEP_IDS.filter((id) => steps[id]).length;

/**
 * Marcas por usuário (`dismissed` = "Dispensar"; `app` = abriu o app dos alunos). `localStorage` pode estar
 * bloqueado/indisponível: tudo em try/catch, e a página funciona sem (a marca vale só até recarregar).
 */
export type FirstStepsFlag = "dismissed" | "app";
const flagKey = (userId: number, flag: FirstStepsFlag) => `gingapp_first_steps_${flag}_${String(userId)}`;

export function readFirstStepsFlag(userId: number, flag: FirstStepsFlag): boolean {
  try {
    return localStorage.getItem(flagKey(userId, flag)) === "1";
  } catch {
    return false;
  }
}

export function writeFirstStepsFlag(userId: number, flag: FirstStepsFlag): void {
  try {
    localStorage.setItem(flagKey(userId, flag), "1");
  } catch {
    // sem armazenamento: a marca vale só nesta visita
  }
}
