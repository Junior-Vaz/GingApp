import { Injectable, Logger } from '@nestjs/common';
import { SponsorCampaignStatus } from '@prisma/client';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { isMinorByBirthDate, isUserMinor } from '../feed/feed-minor';
import { spDay } from '../ranking/ranking-rules';
import { StudentsService } from '../students/students.service';
import {
  clickRedirectUrl,
  isEligibleNow,
  looksLikeBot,
  matchesRegion,
  pickWeighted,
  sponsorsEnabled,
  toUf,
  validateDestinationUrl,
} from './sponsor-rules';

/** Item do carrossel do app (contrato 4.1). Nunca contato, preco, notas nem URL de destino. */
export interface SponsorSlide {
  id: number;
  sponsorName: string;
  logoUrl: string | null;
  imageUrl: string | null;
  title: string;
  text: string;
  ctaLabel: string;
  clickPath: string;
  state: string;
}

export interface SponsorViewer {
  /** Menor (contrato secao 5): nao ve patrocinador e nao conta impressao. */
  minor: boolean;
  /** UF da regiao do espectador ('' = desconhecida: so campanhas nacionais). */
  uf: string;
}

/**
 * Lado do APP e do CLIQUE dos patrocinadores (docs/CONTRATO_PATROCINADORES.md 4.1, 4.2 e 5). Nada aqui grava ou loga
 * usuario, grupo, aparelho, IP ou User-Agent: so os contadores agregados (campanha, dia de Sao Paulo, UF) em SponsorStatDay.
 */
@Injectable()
export class SponsorsService {
  private readonly logger = new Logger(SponsorsService.name);
  /** RNG do sorteio ponderado; os e2e trocam por um deterministico (app.get(SponsorsService).random = ...). */
  random: () => number = Math.random;

  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsService,
  ) {}

  /**
   * Espectador efetivo (contrato 4.1 e 5): o aluno de `studentId` SE for do usuario (proprio ou dependente, conferido por
   * StudentsService.resolveLink); senao o proprio usuario. `studentId` alheio/inexistente nao e erro: cai no proprio usuario.
   *  - Dependente: menor pela data da FICHA dele (Person), senao a da matricula; SEM data = menor (perfil de aluno: conservador).
   *  - Proprio usuario: a regra do feed (isUserMinor: ficha do login, senao matricula; sem data, papel ALUNO = menor).
   * Regiao = UF da unidade do aluno efetivo; sem aluno/unidade/UF, a da unidade PRINCIPAL ativa do grupo; sem ela, a UF-sede
   * do grupo (Organization.state); senao ''.
   */
  async resolveViewer(organizationId: number, user: AuthenticatedUser, studentId?: number, now: Date = new Date()): Promise<SponsorViewer> {
    let unitId: number | null = null;
    let minor: boolean;
    const link = studentId ? await this.students.resolveLink(organizationId, user.id, studentId) : null;
    if (link?.linked && link.student.userId !== user.id) {
      const person = link.student.personId
        ? await this.prisma.person.findUnique({ where: { id: link.student.personId }, select: { birthDate: true } })
        : null;
      minor = isMinorByBirthDate(person?.birthDate ?? link.student.birthDate ?? null, true, now);
      unitId = link.student.unitId;
    } else {
      minor = await isUserMinor(this.prisma, { organizationId, userId: user.id, role: user.role }, now);
      const own = link?.linked
        ? link.student
        : await this.prisma.student.findFirst({ where: { organizationId, userId: user.id }, select: { unitId: true } });
      unitId = own?.unitId ?? null;
    }
    if (minor) return { minor: true, uf: '' };
    return { minor: false, uf: await this.regionOf(organizationId, unitId) };
  }

  private async regionOf(organizationId: number, unitId: number | null): Promise<string> {
    if (unitId !== null) {
      const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId }, select: { state: true } });
      const uf = toUf(unit?.state);
      if (uf) return uf;
    }
    const main = await this.prisma.unit.findFirst({
      where: { organizationId, isMain: true, status: 'ACTIVE' },
      select: { state: true },
      orderBy: { id: 'asc' },
    });
    const mainUf = toUf(main?.state);
    if (mainUf) return mainUf;
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { state: true } });
    return toUf(org?.state);
  }

  /** GET /sponsors/active: 0 ou 1 slide (sorteio ponderado por weight entre as elegiveis na regiao). */
  async active(organizationId: number, user: AuthenticatedUser, studentId?: number): Promise<{ items: SponsorSlide[] }> {
    if (!sponsorsEnabled()) return { items: [] };
    const now = new Date();
    const viewer = await this.resolveViewer(organizationId, user, studentId, now);
    if (viewer.minor) return { items: [] };
    const rows = await this.prisma.sponsorCampaign.findMany({
      where: {
        status: SponsorCampaignStatus.ACTIVE,
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [{ states: { isEmpty: true } }, ...(viewer.uf ? [{ states: { has: viewer.uf } }] : [])],
      },
      select: {
        id: true,
        title: true,
        text: true,
        imageRef: true,
        ctaLabel: true,
        weight: true,
        states: true,
        status: true,
        startsAt: true,
        endsAt: true,
        sponsor: { select: { name: true, logo: true } },
      },
      orderBy: { id: 'asc' },
    });
    const eligible = rows.filter((r) => isEligibleNow(r, now) && matchesRegion(r.states, viewer.uf));
    const pick = pickWeighted(eligible, this.random);
    if (!pick) return { items: [] };
    return {
      items: [
        {
          id: pick.id,
          sponsorName: pick.sponsor.name,
          logoUrl: pick.sponsor.logo ?? null,
          imageUrl: pick.imageRef ?? null,
          title: pick.title,
          text: pick.text,
          ctaLabel: pick.ctaLabel,
          clickPath: `/api/sponsors/${pick.id}/click${viewer.uf ? `?s=${viewer.uf}` : ''}`,
          state: viewer.uf,
        },
      ],
    };
  }

  /**
   * POST /sponsors/:id/impression: +1 em (campanha, dia SP, UF do espectador) SO se o interruptor estiver ligado, o
   * User-Agent nao parecer robo, o espectador nao for menor e a campanha estiver elegivel AGORA e na regiao dele. Qualquer
   * outro caso: nada conta e nada e revelado (o controller responde 204 sempre).
   */
  async impression(organizationId: number, user: AuthenticatedUser, campaignId: number, userAgent: unknown, studentId?: number): Promise<void> {
    if (!sponsorsEnabled() || looksLikeBot(userAgent)) return;
    const now = new Date();
    const viewer = await this.resolveViewer(organizationId, user, studentId, now);
    if (viewer.minor) return;
    const campaign = await this.prisma.sponsorCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true, startsAt: true, endsAt: true, states: true },
    });
    if (!campaign || !isEligibleNow(campaign, now) || !matchesRegion(campaign.states, viewer.uf)) return;
    await this.bump(campaignId, spDay(now), viewer.uf, 1, 0);
  }

  /**
   * GET /sponsors/:id/click (PUBLICO): destino = a URL GRAVADA da campanha (+ utm); o pedido nunca escolhe o destino.
   * Campanha inelegivel/inexistente, id invalido ou SPONSORS_ENABLED=false => `<APP_URL>/` sem contar (null sem APP_URL => 404).
   */
  async click(rawId: string, rawState: unknown): Promise<string | null> {
    const fallback = appHomeUrl();
    if (!sponsorsEnabled()) return fallback;
    if (!/^[1-9]\d{0,9}$/.test(rawId) || Number(rawId) > 2_147_483_647) return fallback;
    const id = Number(rawId);
    const now = new Date();
    const campaign = await this.prisma.sponsorCampaign.findUnique({
      where: { id },
      select: { status: true, startsAt: true, endsAt: true, destinationUrl: true },
    });
    if (!campaign || !isEligibleNow(campaign, now)) return fallback;
    // Defesa em profundidade: a URL gravada ja foi validada no cadastro; se alguem a alterou fora da API, nao redireciona.
    const checked = validateDestinationUrl(campaign.destinationUrl);
    if (!checked.ok) return fallback;
    await this.bump(id, spDay(now), toUf(typeof rawState === 'string' ? rawState : ''), 0, 1);
    return clickRedirectUrl(checked.url, id);
  }

  /** Contador ATOMICO: INSERT ... ON CONFLICT (campanha, dia, UF) DO UPDATE soma. Sem nenhum dado de quem viu/clicou. */
  private async bump(campaignId: number, day: string, state: string, impressions: number, clicks: number): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "SponsorStatDay" ("campaignId", "day", "state", "impressions", "clicks")
        VALUES (${campaignId}, ${day}, ${state}, ${impressions}, ${clicks})
        ON CONFLICT ("campaignId", "day", "state")
        DO UPDATE SET "impressions" = "SponsorStatDay"."impressions" + EXCLUDED."impressions",
                      "clicks" = "SponsorStatDay"."clicks" + EXCLUDED."clicks"`;
    } catch (error) {
      // Campanha apagada entre a leitura e a soma (FK): nao conta e nao derruba a resposta do app/clique.
      this.logger.warn(`Contador de patrocinio nao gravado (campanha ${campaignId}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** `<APP_URL>/` (sem barras duplicadas) ou null quando APP_URL nao esta configurada. Lido a cada chamada. */
export function appHomeUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APP_URL?.trim();
  if (!raw) return null;
  return `${raw.replace(/\/+$/, '')}/`;
}
