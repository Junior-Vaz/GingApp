import { SponsorCampaignStatus } from '@prisma/client';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  campaignScope,
  GROUP_SPONSOR_LIMITS,
  groupCampaignFieldError,
  impressionCountsFor,
  isServableNow,
  normalizeReason,
  orderSlidesByScope,
  statusAfterSuspend,
  termsAccepted,
} from '../src/interface/http/sponsors/sponsor-rules';
import { SPONSOR_TERMS_TEXT, SPONSOR_TERMS_VERSION } from '../src/interface/http/sponsors/sponsor-terms';
import { AUDIT_ACTION_CODES } from '../src/shared/audit/audit-actions';

/** Regras PURAS dos patrocinadores do GRUPO (docs/CONTRATO_PATROCINADORES_GRUPO.md). O HTTP esta em sponsor-groups.e2e-spec.ts. */
const DAY = 86_400_000;
const now = new Date('2026-11-10T15:00:00.000Z');
const base = {
  status: SponsorCampaignStatus.ACTIVE as SponsorCampaignStatus,
  startsAt: new Date(now.getTime() - DAY),
  endsAt: new Date(now.getTime() + DAY),
  organizationId: 7 as number | null,
  platformSuspendedAt: null as Date | null,
};

describe('Patrocinadores do grupo: escopo e campos exclusivos', () => {
  it('campaignScope: nulo/undefined = PLATFORM; número = GROUP', () => {
    assert.equal(campaignScope(null), 'PLATFORM');
    assert.equal(campaignScope(undefined), 'PLATFORM');
    assert.equal(campaignScope(5), 'GROUP');
  });

  it('groupCampaignFieldError: states só vazio/ausente; weight só 1/ausente', () => {
    assert.equal(groupCampaignFieldError({}), null);
    assert.equal(groupCampaignFieldError({ states: [], weight: 1 }), null);
    assert.equal(groupCampaignFieldError({ states: null, weight: null }), null);
    assert.equal(groupCampaignFieldError({ states: ['GO'] })?.field, 'states');
    assert.equal(groupCampaignFieldError({ states: 'GO' })?.field, 'states');
    assert.equal(groupCampaignFieldError({ weight: 2 })?.field, 'weight');
    assert.equal(groupCampaignFieldError({ weight: 0 })?.field, 'weight');
    assert.equal(groupCampaignFieldError({ weight: '1' })?.field, 'weight');
    const e = groupCampaignFieldError({ states: ['SP'], weight: 3 });
    assert.equal(e?.field, 'states', 'o primeiro erro vence');
    assert.match(e?.message ?? '', /^states: /);
    assert.match(groupCampaignFieldError({ weight: 3 })?.message ?? '', /^weight: /);
  });

  it('limites anti-abuso do contrato: 10 patrocinadores, 10 campanhas, 3 ativas', () => {
    assert.deepEqual({ ...GROUP_SPONSOR_LIMITS }, { sponsors: 10, campaigns: 10, activeCampaigns: 3 });
  });
});

describe('Patrocinadores do grupo: termo', () => {
  it('termsAccepted só com a versão VIGENTE exata', () => {
    assert.equal(termsAccepted(SPONSOR_TERMS_VERSION, SPONSOR_TERMS_VERSION), true);
    assert.equal(termsAccepted(null, SPONSOR_TERMS_VERSION), false);
    assert.equal(termsAccepted(undefined, SPONSOR_TERMS_VERSION), false);
    assert.equal(termsAccepted('2020-01-01.v0', SPONSOR_TERMS_VERSION), false);
    assert.equal(termsAccepted(` ${SPONSOR_TERMS_VERSION}`, SPONSOR_TERMS_VERSION), false);
  });

  it('texto em português, cita a versão, o aviso de revisão jurídica e as regras-chave', () => {
    assert.ok(SPONSOR_TERMS_TEXT.includes(SPONSOR_TERMS_VERSION));
    assert.match(SPONSOR_TERMS_TEXT, /revisão jurídica/);
    assert.match(SPONSOR_TERMS_TEXT, /menores de 18 anos não veem/);
    assert.match(SPONSOR_TERMS_TEXT, /"Patrocinado"/);
    assert.match(SPONSOR_TERMS_TEXT, /apostas/);
    assert.match(SPONSOR_TERMS_TEXT, /não cobra, não recebe e não intermedeia/);
    assert.ok(!/<\s*[a-z]/i.test(SPONSOR_TERMS_TEXT), 'texto puro');
  });
});

describe('Patrocinadores do grupo: servir, impressão e suspensão', () => {
  it('isServableNow: plataforma ignora suspensão/bloqueio; grupo exige sem suspensão e sem bloqueio; janela e status valem para os dois', () => {
    assert.equal(isServableNow(base, null, now), true);
    assert.equal(isServableNow({ ...base, platformSuspendedAt: now }, null, now), false);
    assert.equal(isServableNow(base, now, now), false, 'grupo bloqueado');
    const platform = { ...base, organizationId: null };
    assert.equal(isServableNow({ ...platform, platformSuspendedAt: now }, now, now), true, 'campos de grupo não afetam a plataforma');
    assert.equal(isServableNow({ ...base, status: SponsorCampaignStatus.PAUSED }, null, now), false);
    assert.equal(isServableNow({ ...base, endsAt: now }, null, now), false, 'fim exclusivo');
    assert.equal(isServableNow({ ...base, startsAt: new Date(now.getTime() + 1) }, null, now), false);
  });

  it('impressionCountsFor: campanha de grupo só para espectador DO MESMO grupo; plataforma para qualquer grupo', () => {
    assert.equal(impressionCountsFor(base, null, 7, now), true);
    assert.equal(impressionCountsFor(base, null, 8, now), false, 'outro grupo nunca conta');
    assert.equal(impressionCountsFor({ ...base, platformSuspendedAt: now }, null, 7, now), false);
    assert.equal(impressionCountsFor(base, now, 7, now), false);
    assert.equal(impressionCountsFor({ ...base, organizationId: null }, null, 8, now), true);
  });

  it('orderSlidesByScope: GRUPO primeiro, estável', () => {
    const items = [
      { id: 1, scope: 'PLATFORM' as const },
      { id: 2, scope: 'GROUP' as const },
      { id: 3, scope: 'PLATFORM' as const },
    ];
    assert.deepEqual(orderSlidesByScope(items).map((i) => i.id), [2, 1, 3]);
    assert.deepEqual(orderSlidesByScope([]), []);
  });

  it('statusAfterSuspend: ACTIVE vira PAUSED; DRAFT/PAUSED ficam', () => {
    assert.equal(statusAfterSuspend(SponsorCampaignStatus.ACTIVE), SponsorCampaignStatus.PAUSED);
    assert.equal(statusAfterSuspend(SponsorCampaignStatus.PAUSED), SponsorCampaignStatus.PAUSED);
    assert.equal(statusAfterSuspend(SponsorCampaignStatus.DRAFT), SponsorCampaignStatus.DRAFT);
  });

  it('normalizeReason: 3..300 após normalizar espaços/controle, sem HTML, só texto', () => {
    assert.deepEqual(normalizeReason('  Denúncia   de\tconteúdo\n enganoso  '), { ok: true, reason: 'Denúncia de conteúdo enganoso' });
    assert.equal(normalizeReason('ab').ok, false);
    assert.equal(normalizeReason('   a b  ').ok, true, '"a b" tem 3 caracteres');
    assert.equal(normalizeReason('x'.repeat(300)).ok, true);
    assert.equal(normalizeReason('x'.repeat(301)).ok, false);
    assert.equal(normalizeReason('<b>motivo</b>').ok, false);
    assert.equal(normalizeReason(undefined).ok, false);
    assert.equal(normalizeReason(123).ok, false);
    const bad = normalizeReason('');
    assert.ok(!bad.ok && /^reason: /.test(bad.message));
  });
});

describe('Patrocinadores do grupo: catálogo de auditoria', () => {
  it('tem os códigos do contrato do grupo e continua sem repetição', () => {
    for (const code of [
      'SPONSOR_GROUP_TERMS_ACCEPT',
      'SPONSOR_GROUP_SPONSOR_CREATE', 'SPONSOR_GROUP_SPONSOR_UPDATE', 'SPONSOR_GROUP_SPONSOR_DELETE',
      'SPONSOR_GROUP_CAMPAIGN_CREATE', 'SPONSOR_GROUP_CAMPAIGN_UPDATE', 'SPONSOR_GROUP_CAMPAIGN_DELETE',
      'SPONSOR_GROUP_CAMPAIGN_ACTIVATE', 'SPONSOR_GROUP_CAMPAIGN_PAUSE', 'SPONSOR_GROUP_CAMPAIGN_RESUME',
      'SPONSOR_CAMPAIGN_SUSPEND', 'SPONSOR_CAMPAIGN_UNSUSPEND', 'SPONSOR_GROUP_BLOCK', 'SPONSOR_GROUP_UNBLOCK',
    ]) {
      assert.ok(AUDIT_ACTION_CODES.includes(code), code);
    }
    assert.equal(new Set(AUDIT_ACTION_CODES).size, AUDIT_ACTION_CODES.length);
  });
});
