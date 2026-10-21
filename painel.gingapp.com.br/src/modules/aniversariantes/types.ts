/** Tipos do módulo Aniversariantes (contrato: docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md, seção 2). */

export type BirthdayKind = "STUDENT" | "STAFF" | "GUARDIAN";

export const KIND_LABEL: Record<BirthdayKind, string> = {
  STUDENT: "Aluno",
  STAFF: "Equipe",
  GUARDIAN: "Responsável",
};

/** Item de GET /birthdays e de GET /birthdays/summary (mesmo formato nos dois). */
export interface BirthdayItem {
  personId: number;
  studentId: number | null;
  userId: number | null;
  name: string;
  nickname: string | null;
  photo: string | null;
  day: number;
  month: number;
  /** Idade que a pessoa FAZ no aniversário deste ano (a equipe vê; o aluno nunca). */
  age: number | null;
  turnsAge: number | null;
  isMinor: boolean;
  kind: BirthdayKind;
  unitId: number | null;
  unitName: string | null;
  classNames: string[];
  phone: string | null;
  greetedThisYear: boolean;
}

export interface BirthdayList {
  items: BirthdayItem[];
  month: number;
  total: number;
}

export interface BirthdaySummary {
  today: BirthdayItem[];
  next7Days: BirthdayItem[];
  monthTotal: number;
  todayTotal: number;
}

/** Resposta de POST /birthdays/:personId/greet. */
export interface GreetResult {
  sent: boolean;
  alreadyGreeted: boolean;
  whatsappUrl: string | null;
}

/** GET/PUT /birthdays/settings (só MESTRE). */
export interface BirthdaySettings {
  dailyDigest: boolean;
  autoGreeting: boolean;
  autoGreetingMessage: string;
  autoGreetingHour: number;
}
