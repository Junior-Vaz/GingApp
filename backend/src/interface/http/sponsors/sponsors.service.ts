import { Injectable, Logger } from '@nestjs/common';
import { SponsorCampaignStatus } from '@prisma/client';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { isMinorByBirthDate, isUserMinor } from '../feed/feed-minor';
import { spDay } from '../ranking/ranking-rules';
import { StudentsService } from '../students/students.service';
import {
  clickRedirectUrl,
  impressionCountsFor,
  isServableNow,
  looksLikeBot,
  matchesRegion,
  orderSlidesByScope,
  pickWeighted,
  SponsorScope,
  sponsorsEnabled,
  toUf,
  validateDestinationUrl,
} from './sponsor-rules';

/**
 * Item do carrossel do app (contrato 4.1 + contrato do grupo secao 2). Nunca contato, preco, notas nem URL de destino.
 * `scope`/`groupName` (Fase 2): GRUPO = patrocinador local do grupo do espectador (groupName = nome do grupo); PLATAFORMA =
 * como na Fase 1 (groupName null). Os campos da Fase 1 continuam iguais.
 */
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
  scope: SponsorScope;
  groupName: string | null;
}

const SLIDE_SELECT = {
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
  organizationId: true,
  platformSuspendedAt: true,
  sponsor: { select: { name: true, logo: true } },
} as const;

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

  /**
   * GET /sponsors/active: 0, 1 ou 2 slides — no maximo 1 do GRUPO (patrocinio local do grupo do token: ACTIVE na janela, sem
   * suspensao da plataforma, grupo nao bloqueado; sorteio uniforme, peso 1) e 1 da PLATAFORMA (organizationId nulo; sorteio
   * ponderado por weight entre as elegiveis na regiao, como na Fase 1); o do GRUPO vem primeiro. Menor / interruptor
   * desligado = nenhum dos dois.
   */
  async active(organizationId: number, user: AuthenticatedUser, studentId?: number): Promise<{ items: SponsorSlide[] }> {
    if (!sponsorsEnabled()) return { items: [] };
    const now = new Date();
    const viewer = await this.resolveViewer(organizationId, user, studentId, now);
    if (viewer.minor) return { items: [] };
    const window = { status: SponsorCampaignStatus.ACTIVE, startsAt: { lte: now }, endsAt: { gt: now } };
    const [org, groupRows, platformRows] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, sponsorsBlockedAt: true } }),
      this.prisma.sponsorCampaign.findMany({
        where: { ...window, organizationId, platformSuspendedAt: null },
        select: SLIDE_SELECT,
        orderBy: { id: 'asc' },
      }),
      this.prisma.sponsorCampaign.findMany({
        where: {
          ...window,
          organizationId: null,
          OR: [{ states: { isEmpty: true } }, ...(viewer.uf ? [{ states: { has: viewer.uf } }] : [])],
        },
        select: SLIDE_SELECT,
        orderBy: { id: 'asc' },
      }),
    ]);
    const blockedAt = org?.sponsorsBlockedAt ?? null;
    const servable = (r: (typeof groupRows)[number]) => isServableNow(r, blockedAt, now) && matchesRegion(r.states, viewer.uf);
    // Grupo: peso fixo 1 (sorteio uniforme), mesmo se alguem gravou outro peso fora da API.
    const groupPick = pickWeighted(
      groupRows.filter((r) => r.organizationId === organizationId && servable(r)).map((r) => ({ ...r, weight: 1 })),
      this.random,
    );
    const platformPick = pickWeighted(platformRows.filter((r) => r.organizationId === null && servable(r)), this.random);
    const slide = (pick: (typeof groupRows)[number], scope: SponsorScope): SponsorSlide => ({
      id: pick.id,
      sponsorName: pick.sponsor.name,
      logoUrl: pick.sponsor.logo ?? null,
      imageUrl: pick.imageRef ?? null,
      title: pick.title,
      text: pick.text,
      ctaLabel: pick.ctaLabel,
      clickPath: `/api/sponsors/${pick.id}/click${viewer.uf ? `?s=${viewer.uf}` : ''}`,
      state: viewer.uf,
      scope,
      groupName: scope === 'GROUP' ? (org?.name ?? null) : null,
    });
    const items: SponsorSlide[] = [];
    if (groupPick) items.push(slide(groupPick, 'GROUP'));
    if (platformPick) items.push(slide(platformPick, 'PLATFORM'));
    return { items: orderSlidesByScope(items) };
  }

  /**
   * POST /sponsors/:id/impression: +1 em (campanha, dia SP, UF do espectador) SO se o interruptor estiver ligado, o
   * User-Agent nao parecer robo, o espectador nao for menor e a campanha estiver elegivel AGORA e na regiao dele; campanha
   * de GRUPO so conta para espectador DO MESMO grupo, sem suspensao da plataforma e com o grupo nao bloqueado. Qualquer
   * outro caso: nada conta e nada e revelado (o controller responde 204 sempre).
   */
  async impression(organizationId: number, user: AuthenticatedUser, campaignId: number, userAgent: unknown, studentId?: number): Promise<void> {
    if (!sponsorsEnabled() || looksLikeBot(userAgent)) return;
    const now = new Date();
    const viewer = await this.resolveViewer(organizationId, user, studentId, now);
    if (viewer.minor) return;
    const campaign = await this.prisma.sponsorCampaign.findUnique({
      where: { id: campaignId },
      select: {
        status: true,
        startsAt: true,
        endsAt: true,
        states: true,
        organizationId: true,
        platformSuspendedAt: true,
        organization: { select: { sponsorsBlockedAt: true } },
      },
    });
    if (!campaign) return;
    if (!impressionCountsFor(campaign, campaign.organization?.sponsorsBlockedAt ?? null, organizationId, now)) return;
    if (!matchesRegion(campaign.states, viewer.uf)) return;
    await this.bump(campaignId, spDay(now), viewer.uf, 1, 0);
  }

  /**
   * GET /sponsors/:id/click (PUBLICO): destino = a URL GRAVADA da campanha (+ utm); o pedido nunca escolhe o destino.
   * Campanha inelegivel/inexistente, id invalido ou SPONSORS_ENABLED=false => `<APP_URL>/` sem contar (null sem APP_URL => 404).
   * Campanha de GRUPO: o clique e publico (sem token), entao NAO se exige o grupo, so a elegibilidade geral (ACTIVE na janela,
   * sem suspensao da plataforma, grupo nao bloqueado).
   */
  async click(rawId: string, rawState: unknown): Promise<string | null> {
    const fallback = appHomeUrl();
    if (!sponsorsEnabled()) return fallback;
    if (!/^[1-9]\d{0,9}$/.test(rawId) || Number(rawId) > 2_147_483_647) return fallback;
    const id = Number(rawId);
    const now = new Date();
    const campaign = await this.prisma.sponsorCampaign.findUnique({
      where: { id },
      select: {
        status: true,
        startsAt: true,
        endsAt: true,
        destinationUrl: true,
        organizationId: true,
        platformSuspendedAt: true,
        organization: { select: { sponsorsBlockedAt: true } },
      },
    });
    if (!campaign || !isServableNow(campaign, campaign.organization?.sponsorsBlockedAt ?? null, now)) return fallback;
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
