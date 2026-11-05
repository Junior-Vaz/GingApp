import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { AuthUser } from '@/stores/auth'
import type { CampaignReport, Sponsor, SponsorCampaign } from '@/utils/sponsors'
import { loginAs, makeUser } from './helpers'

export function sponsor(overrides: Partial<Sponsor> = {}): Sponsor {
  return {
    id: 1,
    name: 'Casa do Berimbau',
    logo: null,
    contactName: 'Ana Comercial',
    contactEmail: 'ana@casadoberimbau.com.br',
    contactPhone: '62999990000',
    document: '12.345.678/0001-90',
    notes: 'Fecha por trimestre.',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

export function campaign(overrides: Partial<SponsorCampaign> = {}): SponsorCampaign {
  return {
    id: 7,
    sponsorId: 1,
    sponsorName: 'Casa do Berimbau',
    title: 'Berimbau com 20% off',
    text: 'Instrumentos artesanais para a sua roda.',
    imageRef: null,
    ctaLabel: 'Conhecer',
    destinationUrl: 'https://www.casadoberimbau.com.br/oferta',
    destinationHost: 'www.casadoberimbau.com.br',
    category: 'INSTRUMENTOS',
    startsAt: '2026-10-01T03:00:00.000Z',
    endsAt: '2026-11-01T03:00:00.000Z',
    status: 'DRAFT',
    effectiveStatus: 'DRAFT',
    weight: 3,
    states: ['GO', 'SP'],
    priceCents: 150000,
    billingNote: 'Boleto em 10 dias',
    approvedByUserId: null,
    approvedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

export function report(overrides: Partial<CampaignReport> = {}): CampaignReport {
  return {
    campaign: { id: 7, title: 'Berimbau com 20% off', sponsorName: 'Casa do Berimbau', startsAt: '2026-10-01T03:00:00.000Z', endsAt: '2026-11-01T03:00:00.000Z', status: 'ACTIVE' },
    totals: { impressions: 1234, clicks: 56, ctr: 4.54 },
    byDay: [
      { day: '2026-10-05', impressions: 1000, clicks: 40 },
      { day: '2026-10-06', impressions: 234, clicks: 16 },
    ],
    byState: [
      { state: 'SP', impressions: 200, clicks: 10 },
      { state: 'GO', impressions: 1000, clicks: 40 },
      { state: '', impressions: 34, clicks: 6 },
    ],
    ...overrides,
  }
}

const stub = { template: '<div />' }

/** Monta a view numa rota memória com as rotas de patrocinadores (a URL inicial vale para `useRoute().params`). */
export async function mountAt(
  component: Component,
  path: string,
  user: AuthUser = makeUser(),
): Promise<{ wrapper: VueWrapper; router: ReturnType<typeof createRouter> }> {
  const { pinia } = loginAs(user)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: stub },
      { path: '/dashboard', name: 'dashboard', component: stub },
      { path: '/login', name: 'login', component: stub },
      { path: '/sponsors', name: 'sponsors', component: stub },
      { path: '/sponsors/campaigns', name: 'sponsor-campaigns', component: stub },
      { path: '/sponsors/campaigns/new', name: 'sponsor-campaign-new', component: stub },
      { path: '/sponsors/campaigns/:id/edit', name: 'sponsor-campaign-edit', component: stub },
      { path: '/sponsors/campaigns/:id/report', name: 'sponsor-campaign-report', component: stub },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

export function listReply(items: unknown[], total = items.length) {
  return { body: items, headers: { 'X-Total-Count': String(total) } }
}

export const nonSuper = () => makeUser({ id: 2, name: 'Ana Suporte', isSuperAdmin: false })
