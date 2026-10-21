import { useMemo, useState } from "react";
import { Cake, ChevronLeft, ChevronRight, MessageCircle, PartyPopper, Send } from "lucide-react";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { plural } from "@/lib/plural";
import { useCan, useSessionUser } from "@/lib/session";
import { NativeSelect } from "@/modules/alunos/native-select";
import { useAudiences } from "@/modules/avisos/aviso-api";
import { ALREADY_SENT_LABEL, GreetDialog } from "./greet-dialog";
import { BirthdaySettingsCard } from "./settings-card";
import { birthdayErrorMessage, useBirthdays } from "./api";
import { KIND_LABEL, type BirthdayItem } from "./types";
import { MONTH_NAMES, MONTH_SHORT, defaultGreeting, monthName, todaySP, turnsAgeText, whatsappLink } from "./utils";

/** Aniversariantes do mês: navegação por mês, filtros, "Enviar parabéns", WhatsApp e (só MESTRE) configurações. */
export function AniversariantesPage() {
  const today = useMemo(() => todaySP(), []);
  const canGreet = useCan("announcements", "create");
  const user = useSessionUser();
  const isMestre = user?.role === "MESTRE";
  const group = user?.organizationName?.trim() || null;

  const [month, setMonth] = useState(today.month);
  const [unitId, setUnitId] = useState("");
  const [classId, setClassId] = useState("");
  const [greeting, setGreeting] = useState<BirthdayItem | null>(null);

  const audiences = useAudiences();
  const list = useBirthdays(month, unitId, classId);
  const items = Array.isArray(list.data?.items) ? list.data.items : [];
  const total = list.data?.total ?? items.length;

  const units = audiences.data?.units ?? [];
  const allClasses = audiences.data?.classes ?? [];
  const classes = unitId ? allClasses.filter((c) => String(c.unitId) === unitId) : allClasses;
  const filtered = unitId !== "" || classId !== "";

  const goTo = (next: number) => setMonth(((next - 1 + 12) % 12) + 1);

  return (
    <>
      <PageHeader title="Aniversariantes" description="Quem faz aniversário no mês: mande os parabéns pelo app ou pelo WhatsApp." />

      <div className="space-y-4">
        <Card className="flex flex-col gap-3 p-3 md:p-4">
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="icon" aria-label="Mês anterior" onClick={() => goTo(month - 1)}>
              <ChevronLeft />
            </Button>
            <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:flex-row sm:justify-center">
              <NativeSelect
                aria-label="Mês"
                className="h-11 w-full max-w-48 capitalize md:h-9"
                value={String(month)}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MONTH_NAMES.map((name, index) => (
                  <option key={name} value={String(index + 1)}>
                    {name.charAt(0).toUpperCase() + name.slice(1)}
                  </option>
                ))}
              </NativeSelect>
              {month !== today.month && (
                <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setMonth(today.month)}>
                  Voltar para o mês atual
                </Button>
              )}
            </div>
            <Button type="button" variant="outline" size="icon" aria-label="Próximo mês" onClick={() => goTo(month + 1)}>
              <ChevronRight />
            </Button>
          </div>

          {(units.length > 0 || allClasses.length > 0) && (
            <div className="grid gap-2 sm:grid-cols-2">
              <NativeSelect
                aria-label="Filtrar por unidade"
                className="h-11 md:h-9"
                value={unitId}
                onChange={(e) => {
                  const next = e.target.value;
                  setUnitId(next);
                  // A turma escolhida some do filtro se não for da nova unidade.
                  const stillValid = allClasses.some((c) => String(c.id) === classId && (next === "" || String(c.unitId) === next));
                  if (!stillValid) setClassId("");
                }}
              >
                <option value="">Todas as unidades</option>
                {units.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect aria-label="Filtrar por turma" className="h-11 md:h-9" value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">Todas as turmas</option>
                {classes.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </Card>

        {list.error ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center" role="alert">
            <p className="text-sm text-destructive">{birthdayErrorMessage(list.error, "Não foi possível carregar os aniversariantes.")}</p>
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
              Tentar novamente
            </Button>
          </Card>
        ) : list.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="birthdays-loading">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-28 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-8 text-center" data-testid="birthdays-empty">
            <Cake className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {filtered ? `Nenhum aniversariante em ${monthName(month)} com esses filtros.` : `Nenhum aniversariante em ${monthName(month)}.`}
            </p>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {plural(total, "aniversariante")} em {monthName(month)}
            </p>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={`Aniversariantes de ${monthName(month)}`}>
              {items.map((item) => (
                <BirthdayCard
                  key={`${item.personId}-${item.kind}-${item.unitId ?? 0}`}
                  item={item}
                  isToday={month === today.month && item.day === today.day}
                  turns={turnsAgeText(item, month, today)}
                  canGreet={canGreet}
                  group={group}
                  onGreet={() => setGreeting(item)}
                />
              ))}
            </ul>
          </>
        )}

        {isMestre && <BirthdaySettingsCard />}
      </div>

      <GreetDialog item={greeting} onClose={() => setGreeting(null)} />
    </>
  );
}

function BirthdayCard({
  item,
  isToday,
  turns,
  canGreet,
  group,
  onGreet,
}: {
  item: BirthdayItem;
  isToday: boolean;
  /** "faz 12 anos" / "fez 12 anos" (ou null sem idade). */
  turns: string | null;
  canGreet: boolean;
  group: string | null;
  onGreet: () => void;
}) {
  const whatsapp = whatsappLink(item.phone, defaultGreeting(item, group));
  const where = [item.unitName, item.classNames.length > 0 ? item.classNames.join(", ") : null].filter(Boolean).join(" · ");

  return (
    <li className={`min-w-0 rounded-lg border bg-card p-3 shadow-sm ${isToday ? "border-primary ring-1 ring-primary/40" : ""}`} data-testid="birthday-item">
      <div className="flex items-start gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center rounded-md bg-secondary py-1 text-primary" aria-label={`Dia ${item.day}`}>
          <span className="text-lg font-extrabold leading-none">{item.day}</span>
          <span className="text-[10px] font-semibold uppercase">{MONTH_SHORT[item.month - 1]}</span>
        </div>
        <EntityAvatar name={item.name} photo={item.photo} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold leading-tight">
            {item.name}
            {item.nickname && <span className="font-normal text-muted-foreground"> ({item.nickname})</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {isToday && (
              <Badge className="gap-1">
                <PartyPopper className="size-3" aria-hidden /> Hoje
              </Badge>
            )}
            {item.isMinor && <Badge variant="outline">Menor</Badge>}
            <Badge variant="secondary">{KIND_LABEL[item.kind]}</Badge>
            {turns && <span className="text-xs text-muted-foreground">{turns}</span>}
          </div>
          {where && <p className="mt-1 break-words text-xs text-muted-foreground">{where}</p>}
        </div>
      </div>

      {(canGreet || whatsapp) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canGreet &&
            (item.greetedThisYear ? (
              <Badge variant="outline" className="min-h-8 gap-1" data-testid="greeted-badge">
                {ALREADY_SENT_LABEL}
              </Badge>
            ) : (
              <Button type="button" size="sm" aria-label={`Enviar parabéns para ${item.name}`} onClick={onGreet}>
                <Send /> Enviar parabéns
              </Button>
            ))}
          {whatsapp && (
            <Button asChild size="sm" variant="secondary">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label={`Abrir WhatsApp de ${item.name}`}>
                <MessageCircle /> WhatsApp
              </a>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
