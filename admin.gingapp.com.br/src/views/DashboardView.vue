<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
import StatusChip, { type ChipTone } from '@/components/ui/StatusChip.vue'
import { api, errorMessage } from '@/utils/api'
import { formatBRL, formatDate, formatDateTime, formatInt } from '@/utils/format'

type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'

interface PlatformDashboard {
  generatedAt: string
  organizations: { total: number; active: number; inactive: number }
  newOrganizationsLast30Days: number
  students: { active: number }
  subscriptions: {
    byStatus: Record<SubscriptionStatus, number>
    byPlan: Array<{ planId: number; code: string; name: string; count: number }>
  }
  mrrCents: number
  mrrIgnoredSubscriptions: number
  recentOrganizations: Array<{
    id: number
    name: string
    slug: string
    createdAt: string
    currentPlan: { id: number; code: string; name: string; subscriptionStatus: SubscriptionStatus } | null
  }>
}

const STATUS_ORDER: SubscriptionStatus[] = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'EXPIRED']
const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE: 'Ativas',
  TRIALING: 'Em teste',
  PAST_DUE: 'Em atraso',
  CANCELED: 'Canceladas',
  EXPIRED: 'Expiradas',
}
const STATUS_SINGULAR: Record<SubscriptionStatus, string> = {
  ACTIVE: 'Ativa',
  TRIALING: 'Em teste',
  PAST_DUE: 'Em atraso',
  CANCELED: 'Cancelada',
  EXPIRED: 'Expirada',
}
// Cor de cada status (barra de distribuição, bolinha do cartão e chip da lista de grupos recentes).
const STATUS_TONE: Record<SubscriptionStatus, ChipTone> = {
  ACTIVE: 'success',
  TRIALING: 'info',
  PAST_DUE: 'warning',
  CANCELED: 'danger',
  EXPIRED: 'neutral',
}
const STATUS_COLOR: Record<SubscriptionStatus, string> = {
  ACTIVE: 'bg-emerald-600',
  TRIALING: 'bg-sky-500',
  PAST_DUE: 'bg-amber-500',
  CANCELED: 'bg-red-500',
  EXPIRED: 'bg-slate-400',
}

const data = ref<PlatformDashboard | null>(null)
const isLoading = ref(false)
const loadError = ref('')

const statusTotal = computed(() =>
  data.value ? STATUS_ORDER.reduce((sum, status) => sum + (data.value!.subscriptions.byStatus[status] ?? 0), 0) : 0,
)
const planTotal = computed(() => data.value?.subscriptions.byPlan.reduce((sum, plan) => sum + plan.count, 0) ?? 0)
// Largura (%) de uma barra proporcional; mínimo de 2% para o valor não-zero continuar visível.
function share(count: number, total: number): string {
  return total > 0 && count > 0 ? `${Math.max(2, Math.round((count / total) * 100))}%` : '0%'
}

const metricIcons: Record<string, IconName> = {
  active: 'groups',
  inactive: 'inbox',
  fresh: 'trendingUp',
  students: 'team',
  mrr: 'finance',
}

async function load(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    data.value = await api.get<PlatformDashboard>('/platform-dashboard')
  } catch (error) {
    loadError.value = errorMessage(error, 'Não foi possível carregar o painel.')
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div>
    <PageHeader title="Painel" description="Visão geral da plataforma GingApp.">
      <button
        type="button"
        :disabled="isLoading"
        class="btn btn-secondary"
        @click="load"
      >
        <AppIcon name="refresh" :size="16" :class="isLoading ? 'animate-spin motion-reduce:animate-none' : ''" />
        {{ isLoading ? 'Atualizando…' : 'Atualizar' }}
      </button>
    </PageHeader>

    <div
      v-if="loadError"
      role="alert"
      class="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <span>{{ loadError }}</span>
      <button type="button" class="min-h-10 font-semibold underline" @click="load">Tentar novamente</button>
    </div>

    <!-- Carregando: esqueleto no formato dos cartões (o texto fica para leitores de tela). -->
    <div v-if="isLoading && !data" class="mt-6" aria-busy="true" data-testid="dashboard-loading">
      <span class="sr-only">Carregando…</span>
      <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <div v-for="n in 5" :key="n" class="card p-4 sm:p-5">
          <Skeleton height="0.75rem" width="55%" />
          <Skeleton class="mt-3" height="1.75rem" width="40%" />
          <Skeleton class="mt-2" height="0.75rem" width="70%" />
        </div>
      </div>
      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <div v-for="n in 2" :key="n" class="card p-5">
          <Skeleton height="1rem" width="40%" />
          <Skeleton class="mt-4" height="2.25rem" />
          <Skeleton class="mt-2" height="2.25rem" />
          <Skeleton class="mt-2" height="2.25rem" />
        </div>
      </div>
    </div>

    <template v-if="data">
      <p class="mt-3 text-xs text-slate-500" data-testid="generated-at">
        Atualizado em {{ formatDateTime(data.generatedAt) }}
      </p>

      <div class="mt-3 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <div class="card p-4 sm:p-5">
          <div class="flex items-start justify-between gap-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Grupos ativos</p>
            <AppIcon :name="metricIcons.active!" :size="18" class="text-primary" />
          </div>
          <p class="mt-2 text-2xl font-extrabold tabular-nums text-slate-900" data-testid="card-orgs-active">
            {{ formatInt(data.organizations.active) }}
          </p>
          <p class="mt-1 text-xs text-slate-500">de {{ formatInt(data.organizations.total) }} no total</p>
        </div>
        <div class="card p-4 sm:p-5">
          <div class="flex items-start justify-between gap-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Grupos inativos</p>
            <AppIcon :name="metricIcons.inactive!" :size="18" class="text-slate-500" />
          </div>
          <p class="mt-2 text-2xl font-extrabold tabular-nums text-slate-900" data-testid="card-orgs-inactive">
            {{ formatInt(data.organizations.inactive) }}
          </p>
        </div>
        <div class="card p-4 sm:p-5">
          <div class="flex items-start justify-between gap-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Novos grupos (30 dias)</p>
            <AppIcon :name="metricIcons.fresh!" :size="18" class="text-primary" />
          </div>
          <p class="mt-2 text-2xl font-extrabold tabular-nums text-slate-900" data-testid="card-orgs-new">
            {{ formatInt(data.newOrganizationsLast30Days) }}
          </p>
        </div>
        <div class="card p-4 sm:p-5">
          <div class="flex items-start justify-between gap-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Alunos ativos</p>
            <AppIcon :name="metricIcons.students!" :size="18" class="text-primary" />
          </div>
          <p class="mt-2 text-2xl font-extrabold tabular-nums text-slate-900" data-testid="card-students">
            {{ formatInt(data.students.active) }}
          </p>
        </div>
        <div class="card col-span-2 border-primary/30 bg-secondary/40 p-4 sm:p-5 lg:col-span-1">
          <div class="flex items-start justify-between gap-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-600">MRR estimado</p>
            <AppIcon :name="metricIcons.mrr!" :size="18" class="text-primary" />
          </div>
          <p class="mt-2 text-2xl font-extrabold tabular-nums text-slate-900" data-testid="card-mrr">{{ formatBRL(data.mrrCents) }}</p>
          <p class="mt-1 text-xs text-slate-600">Assinaturas ativas; planos anuais divididos por 12.</p>
        </div>
      </div>

      <p
        v-if="data.mrrIgnoredSubscriptions > 0"
        data-testid="mrr-ignored"
        class="mt-3 flex items-start gap-1.5 text-xs text-amber-800"
      >
        <AppIcon name="alert" :size="14" class="mt-px text-amber-700" />
        <span>
          {{ formatInt(data.mrrIgnoredSubscriptions) }}
          {{ data.mrrIgnoredSubscriptions === 1 ? 'assinatura ativa ficou' : 'assinaturas ativas ficaram' }}
          fora do cálculo do MRR (periodicidade do plano não suportada).
        </span>
      </p>

      <h2 class="mt-8 text-base font-extrabold text-slate-900">Assinaturas por status</h2>
      <!-- Barra de distribuição (decorativa: os números estão nos cartões logo abaixo). -->
      <div
        v-if="statusTotal > 0"
        class="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
        aria-hidden="true"
        data-testid="status-bar"
      >
        <div
          v-for="status in STATUS_ORDER"
          :key="status"
          class="h-full transition-[width] duration-500 motion-reduce:transition-none"
          :class="STATUS_COLOR[status]"
          :style="{ width: `${((data.subscriptions.byStatus[status] ?? 0) / statusTotal) * 100}%` }"
        />
      </div>
      <div class="mt-3 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-5">
        <div
          v-for="status in STATUS_ORDER"
          :key="status"
          class="card p-3.5 sm:p-4"
          :data-testid="`status-${status}`"
        >
          <p class="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <span class="size-2.5 shrink-0 rounded-full" :class="STATUS_COLOR[status]" aria-hidden="true" />
            {{ STATUS_LABELS[status] }}
          </p>
          <p class="mt-1 text-xl font-extrabold tabular-nums text-slate-900">{{ formatInt(data.subscriptions.byStatus[status] ?? 0) }}</p>
        </div>
      </div>

      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 class="text-base font-extrabold text-slate-900">Assinaturas por plano</h2>
          <p class="mt-0.5 text-xs text-slate-600">Conta assinaturas ativas e em teste.</p>
          <div class="card mt-3 overflow-hidden">
            <table class="w-full text-left text-sm" data-testid="by-plan-table">
              <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th class="px-4 py-3 font-medium">Plano</th>
                  <th class="px-4 py-3 font-medium">Código</th>
                  <th class="px-4 py-3 text-right font-medium">Assinaturas</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-if="data.subscriptions.byPlan.length === 0">
                  <td colspan="3"><EmptyState title="Nenhuma assinatura em uso." icon="plans" /></td>
                </tr>
                <tr v-for="plan in data.subscriptions.byPlan" :key="plan.planId" class="hover:bg-slate-50">
                  <td class="px-4 py-3 font-medium text-slate-900">{{ plan.name }}</td>
                  <td class="px-4 py-3 text-slate-600">{{ plan.code }}</td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex items-center justify-end gap-3">
                      <span class="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 sm:block" aria-hidden="true">
                        <span class="block h-full rounded-full bg-primary" :style="{ width: share(plan.count, planTotal) }" />
                      </span>
                      <span class="min-w-6 font-semibold tabular-nums text-slate-900">{{ formatInt(plan.count) }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 class="text-base font-extrabold text-slate-900">Grupos recentes</h2>
          <p class="mt-0.5 text-xs text-slate-600">Os últimos grupos cadastrados.</p>
          <div class="card mt-3 overflow-hidden">
            <table class="w-full text-left text-sm" data-testid="recent-table">
              <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th class="px-4 py-3 font-medium">Grupo</th>
                  <th class="px-4 py-3 font-medium">Plano</th>
                  <th class="px-4 py-3 font-medium">Criado em</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-if="data.recentOrganizations.length === 0">
                  <td colspan="3"><EmptyState title="Nenhum grupo cadastrado ainda." icon="groups" /></td>
                </tr>
                <tr v-for="org in data.recentOrganizations" :key="org.id" class="hover:bg-slate-50">
                  <td class="px-4 py-3">
                    <RouterLink :to="`/organizations/${org.id}`" class="font-medium text-slate-900 hover:underline">
                      {{ org.name }}
                    </RouterLink>
                    <p class="text-xs text-slate-500">{{ org.slug }}</p>
                  </td>
                  <td class="px-4 py-3 text-slate-600">
                    <template v-if="org.currentPlan">
                      {{ org.currentPlan.name }}
                      <StatusChip :tone="STATUS_TONE[org.currentPlan.subscriptionStatus]" class="ml-1">
                        {{ STATUS_SINGULAR[org.currentPlan.subscriptionStatus] }}
                      </StatusChip>
                    </template>
                    <span v-else class="text-slate-500">Sem plano</span>
                  </td>
                  <td class="px-4 py-3 text-slate-600">{{ formatDate(org.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
