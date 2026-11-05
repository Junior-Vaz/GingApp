import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { errorMessage } from "@/lib/api";
import { formatPoints, leagueColor } from "@/lib/ranking";
import { SHOWCASE_MAX, streakExample, useRankingRules, type RankingRules } from "@/lib/ranking-student";
import { TIER_LABEL } from "./ranking-icons";

/**
 * "Como funciona?": TODO número destes textos vem de GET /ranking/rules (nunca fixo no app). Linguagem simples, para criança e
 * responsável. Sem as regras carregadas mostra carregando / erro com "Tentar de novo" - nunca um texto com número inventado.
 */

const pts = (value: number): string => `${formatPoints(value)} ${value === 1 ? "ponto" : "pontos"}`;
const plus = (value: number): string => `+${formatPoints(value)}`;

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{value}</td>
    </tr>
  );
}

function Section({ value, title, children }: { value: string; title: string; children: ReactNode }) {
  return (
    <AccordionItem value={value} data-testid={`how-${value}`}>
      <AccordionTrigger className="min-h-11 py-3 text-[15px] font-bold">{title}</AccordionTrigger>
      <AccordionContent className="rkp-how-body">{children}</AccordionContent>
    </AccordionItem>
  );
}

function PointsSection({ rules }: { rules: RankingRules }) {
  const { points, limits } = rules;
  return (
    <Section value="points" title="Como ganhar pontos">
      <table className="rkp-how-table">
        <caption className="sr-only">Pontos por atividade</caption>
        <tbody>
          <Row label="Ir à aula" value={`${plus(points.classAttendance)} por aula`} />
          <Row label="Semanas seguidas treinando" value={`${plus(points.streakStep)} a mais a cada semana seguida, até ${plus(points.streakMax)}`} />
          <Row label="Evento do grupo" value={plus(points.eventAttendance)} />
          <Row label="Roda" value={plus(points.rodaParticipation)} />
          <Row label="Mês consistente" value={plus(points.monthlyConsistency)} />
          <Row label="Nova graduação" value={`${plus(points.graduationPerLevel)} × o nível da corda`} />
          <Row label="Certificado" value={plus(points.certificate)} />
          <Row label="Check-in diário" value={plus(points.dailyCheckin)} />
          <Row label="Semana em dia no check-in" value={plus(points.dailyWeekBonus)} />
        </tbody>
      </table>
      <p data-testid="how-daily-limit">
        Limite do dia: no máximo {limits.maxClassPointsPerDay} {limits.maxClassPointsPerDay === 1 ? "aula" : "aulas"} por dia rendem ponto.
      </p>
      <p>Só conta presença registrada pelo professor (ou o check-in da aula). Mensalidade e pagamentos nunca dão ponto.</p>
    </Section>
  );
}

function StreakSection({ rules }: { rules: RankingRules }) {
  const { steps, capWeek } = streakExample(rules.points);
  return (
    <Section value="streak" title="Sequência semanal">
      <p>Treinar semanas seguidas rende um bônus extra, que cresce a cada semana:</p>
      <ul className="rkp-how-list" data-testid="how-streak-example">
        {steps.map((step) => (
          <li key={step.week}>
            {step.week}ª semana seguida: <strong>{plus(step.bonus)}</strong>
          </li>
        ))}
      </ul>
      <p>
        A partir da {capWeek}ª semana seguida o bônus fica no teto de <strong>{plus(rules.points.streakMax)}</strong> por semana.
      </p>
    </Section>
  );
}

function MonthSection({ rules }: { rules: RankingRules }) {
  const percent = Math.round(rules.limits.consistencyMinRate * 100);
  return (
    <Section value="month" title="Mês consistente">
      <p data-testid="how-month-text">
        Se você for em pelo menos <strong>{percent}%</strong> das aulas do mês, e o mês tiver pelo menos <strong>{rules.limits.consistencyMinLessons}</strong>{" "}
        aulas com chamada, ganha <strong>{plus(rules.points.monthlyConsistency)}</strong>.
      </p>
      <p>O bônus é concedido quando o mês fecha. Você acompanha o caminho no anel da “Meta do mês”, em Meu progresso.</p>
    </Section>
  );
}

function DailySection({ rules }: { rules: RankingRules }) {
  const { points, limits } = rules;
  return (
    <Section value="daily" title="Check-in diário">
      <p data-testid="how-daily-text">
        Uma vez por dia, toque em “Salve! Check-in de hoje”. Vale <strong>{pts(points.dailyCheckin)}</strong> — de propósito: treinar vale muito mais (uma aula vale{" "}
        {plus(points.classAttendance)}).
      </p>
      <p>
        A meta é por semana, sem pressão: com <strong>{limits.dailyWeekTarget}</strong> ou mais dias de check-in na semana você ganha{" "}
        <strong>{plus(points.dailyWeekBonus)}</strong> quando a semana fecha. Faltar um dia não tira nada.
      </p>
      <p>
        Tem teto no mês: só os primeiros <strong>{limits.dailyMonthCapDays}</strong> dias de check-in de cada mês somam ponto. Os outros ainda contam para a
        semana e para as conquistas.
      </p>
    </Section>
  );
}

function LeaguesSection({ rules }: { rules: RankingRules }) {
  return (
    <Section value="leagues" title="Ligas">
      <p>A liga mostra o quanto você já caminhou. Ela vem da soma de todos os pontos que você já fez.</p>
      <ul className="rkp-how-leagues" data-testid="how-leagues">
        {rules.leagues.map((league) => (
          <li key={league.code} style={{ "--lg": leagueColor(league) } as CSSProperties}>
            <i aria-hidden="true" />
            <strong>{league.name}</strong>
            <span>{league.minPoints <= 0 ? "ponto de partida" : `a partir de ${pts(league.minPoints)}`}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CategoriesSection({ rules }: { rules: RankingRules }) {
  return (
    <Section value="categories" title="Categorias do ranking">
      <ul className="rkp-how-list" data-testid="how-categories">
        {rules.categories.map((category) => (
          <li key={category.code}>
            <strong>{category.label}:</strong> {category.description}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function BandsSection({ rules }: { rules: RankingRules }) {
  return (
    <Section value="bands" title="Faixas etárias">
      <p>Você pode ver o ranking só de quem tem a sua idade:</p>
      <ul className="rkp-how-list" data-testid="how-bands">
        {rules.bands.map((band) => (
          <li key={band.code}>{band.label}</li>
        ))}
      </ul>
    </Section>
  );
}

function SeasonsSection({ rules }: { rules: RankingRules }) {
  const { lengthLabel, timezone } = rules.seasons;
  const clock = timezone === "America/Sao_Paulo" ? "horário de Brasília" : timezone;
  return (
    <Section value="seasons" title="Temporadas">
      <p data-testid="how-seasons-text">
        A temporada é <strong>{lengthLabel}</strong> (contada pelo {clock}): a cada nova temporada o placar recomeça e todo mundo sai da largada. Seus
        pontos de todos os tempos, a sua liga e as suas conquistas continuam com você. As temporadas passadas ficam guardadas no ranking.
      </p>
    </Section>
  );
}

function AchievementsSection({ rules }: { rules: RankingRules }) {
  const count = (tier: "BRONZE" | "SILVER" | "GOLD") => rules.achievements.filter((item) => item.tier === tier).length;
  return (
    <Section value="achievements" title="Conquistas">
      <p data-testid="how-ach-text">
        Existem <strong>{rules.achievements.length}</strong> conquistas: <strong>{count("BRONZE")}</strong> de {TIER_LABEL.BRONZE.toLowerCase()},{" "}
        <strong>{count("SILVER")}</strong> de {TIER_LABEL.SILVER.toLowerCase()} e <strong>{count("GOLD")}</strong> de {TIER_LABEL.GOLD.toLowerCase()}. O nível
        mostra o quanto cada uma é difícil, e vem escrito junto com a medalha.
      </p>
      <p>Cada conquista mostra quantos por cento do grupo já a tem — assim você vê as mais raras. Em grupos pequenos essa informação fica escondida.</p>
      <p>Você escolhe até {SHOWCASE_MAX} conquistas ganhas para a sua vitrine.</p>
    </Section>
  );
}

function PrivacySection() {
  return (
    <Section value="privacy" title="Privacidade">
      <ul className="rkp-how-list">
        <li>No ranking do seu grupo aparecem todos os alunos ativos.</li>
        <li>Nos rankings abertos (cidade, estado e Brasil) você só aparece se quiser — é uma escolha sua, em “Configurar ranking”.</li>
        <li>Você pode usar um apelido no lugar do nome.</li>
        <li>Para menores de idade, aparecer nos rankings abertos só com a autorização do responsável.</li>
        <li>O seu extrato, a sua meta e a sua evolução são só seus: ninguém mais vê.</li>
      </ul>
    </Section>
  );
}

function FaqSection({ rules }: { rules: RankingRules }) {
  const { points } = rules;
  return (
    <>
      <h3 className="rkp-how-faq">Perguntas frequentes</h3>
      <Section value="faq-fee" title="Pagar a mensalidade dá ponto?">
        <p>Não. Pagamento e mensalidade nunca dão ponto, nem tiram. O ranking é só de treino, roda, evento e dedicação.</p>
      </Section>
      <Section value="faq-absence" title="Se eu faltar, perco ponto?">
        <p>Não. Falta não tira ponto de ninguém. Você só deixa de somar naquele dia. É só voltar a treinar.</p>
      </Section>
      <Section value="faq-missing" title="Por que meu ponto não apareceu?">
        <p>
          O ponto da aula só entra depois que a presença está registrada na chamada (pelo professor ou pelo check-in da aula). Se você foi e o ponto não veio,
          peça ao professor para conferir a chamada. Depois de registrada, pode levar um pouquinho para aparecer.
        </p>
      </Section>
      <Section value="faq-season" title="O que é temporada?">
        <p>
          É o período do placar: a temporada é {rules.seasons.lengthLabel}. Quando ela acaba, o placar recomeça. O que você já ganhou — pontos de todos os
          tempos, liga e conquistas — fica guardado.
        </p>
      </Section>
      <Section value="faq-checkin" title="Quanto vale o check-in diário?">
        <p data-testid="how-faq-checkin">
          {pts(points.dailyCheckin)} por dia, de propósito: uma aula vale {plus(points.classAttendance)}. O check-in ajuda a lembrar do treino, mas quem
          treina sempre sobe mais rápido.
        </p>
      </Section>
    </>
  );
}

function RulesBody({ rules }: { rules: RankingRules }) {
  return (
    <Accordion type="multiple" defaultValue={["points"]} className="rkp-how" data-testid="how-rules">
      <PointsSection rules={rules} />
      <StreakSection rules={rules} />
      <MonthSection rules={rules} />
      <DailySection rules={rules} />
      <LeaguesSection rules={rules} />
      <CategoriesSection rules={rules} />
      <BandsSection rules={rules} />
      <SeasonsSection rules={rules} />
      <AchievementsSection rules={rules} />
      <PrivacySection />
      <FaqSection rules={rules} />
    </Accordion>
  );
}

/** Folha "Como funciona o Ginga Rank" (de baixo no celular, lateral no computador). As regras só são pedidas ao abrir. */
export function HowItWorksSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const mobile = useIsMobile();
  const rules = useRankingRules(open);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={mobile ? "bottom" : "right"} className="rk-sheet rkp-how-sheet sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Como funciona o Ginga Rank</SheetTitle>
          <SheetDescription>Pontos, ligas e conquistas, em poucas palavras.</SheetDescription>
        </SheetHeader>
        {rules.isPending ? (
          <div aria-busy="true" role="status" aria-label="Carregando as regras" className="rkp-skel-wrap" data-testid="how-loading">
            {[80, 60, 70, 50].map((width) => (
              <span key={width} className="rk-skel rk-skel-line" style={{ width: `${width}%` }} />
            ))}
          </div>
        ) : rules.isError || !rules.data ? (
          <div className="rkp-error" role="alert" data-testid="how-error">
            <p>{errorMessage(rules.error, "Não foi possível carregar as regras agora.")}</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void rules.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : (
          <RulesBody rules={rules.data} />
        )}
      </SheetContent>
    </Sheet>
  );
}
