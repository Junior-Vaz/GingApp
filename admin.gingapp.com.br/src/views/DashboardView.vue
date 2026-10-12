<script setup lang="ts">
import { onMounted, ref } from 'vue'
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

const data = ref<PlatformDashboard | null>(null)
const isLoading = ref(false)
const loadError = ref('')

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
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Painel</h1>
        <p class="mt-1 text-sm text-slate-500">Visão geral da plataforma GingApp.</p>
      </div>
      <button
        type="button"
        :disabled="isLoading"
        class="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        @click="load"
      >
        {{ isLoading ? 'Atualizando…' : 'Atualizar' }}
      </button>
    </div>

    <div
      v-if="loadError"
      role="alert"
      class="mt-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <span>{{ loadError }}</span>
      <button type="button" class="font-medium underline" @click="load">Tentar novamente</button>
    </div>

    <p v-if="isLoading && !data" class="mt-6 rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
      Carregando…
    </p>

    <template v-if="data">
      <p class="mt-2 text-xs text-slate-400" data-testid="generated-at">
        Atualizado em {{ formatDateTime(data.generatedAt) }}
      </p>

      <div class="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Grupos ativos</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900" data-testid="card-orgs-active">
            {{ formatInt(data.organizations.active) }}
          </p>
          <p class="mt-1 text-xs text-slate-400">de {{ formatInt(data.organizations.total) }} no total</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Grupos inativos</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900" data-testid="card-orgs-inactive">
            {{ formatInt(data.organizations.inactive) }}
          </p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Novos grupos (30 dias)</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900" data-testid="card-orgs-new">
            {{ formatInt(data.newOrganizationsLast30Days) }}
          </p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Alunos ativos</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900" data-testid="card-students">
            {{ formatInt(data.students.active) }}
          </p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">MRR estimado</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900" data-testid="card-mrr">{{ formatBRL(data.mrrCents) }}</p>
          <p class="mt-1 text-xs text-slate-400">Assinaturas ativas; planos anuais divididos por 12.</p>
        </div>
      </div>

      <p
        v-if="data.mrrIgnoredSubscriptions > 0"
        data-testid="mrr-ignored"
        class="mt-3 text-xs text-amber-700"
      >
        {{ formatInt(data.mrrIgnoredSubscriptions) }}
        {{ data.mrrIgnoredSubscriptions === 1 ? 'assinatura ativa ficou' : 'assinaturas ativas ficaram' }}
        fora do cálculo do MRR (periodicidade do plano não suportada).
      </p>

      <h2 class="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Assinaturas por status</h2>
      <div class="mt-3 grid grid-cols-2 gap-4 md:grid-cols-5">
        <div
          v-for="status in STATUS_ORDER"
          :key="status"
          class="rounded-xl border border-slate-200 bg-white p-4"
          :data-testid="`status-${status}`"
        >
          <p class="text-xs font-medium text-slate-500">{{ STATUS_LABELS[status] }}</p>
          <p class="mt-1 text-xl font-semibold text-slate-900">{{ formatInt(data.subscriptions.byStatus[status] ?? 0) }}</p>
        </div>
      </div>

      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Assinaturas por plano</h2>
          <p class="mt-1 text-xs text-slate-400">Conta assinaturas ativas e em teste.</p>
          <div class="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table class="w-full text-left text-sm" data-testid="by-plan-table">
              <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="px-4 py-3 font-medium">Plano</th>
                  <th class="px-4 py-3 font-medium">Código</th>
                  <th class="px-4 py-3 text-right font-medium">Assinaturas</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-if="data.subscriptions.byPlan.length === 0">
                  <td colspan="3" class="px-4 py-8 text-center text-slate-400">Nenhuma assinatura em uso.</td>
                </tr>
                <tr v-for="plan in data.subscriptions.byPlan" :key="plan.planId" class="hover:bg-slate-50">
                  <td class="px-4 py-3 font-medium text-slate-900">{{ plan.name }}</td>
                  <td class="px-4 py-3 text-slate-600">{{ plan.code }}</td>
                  <td class="px-4 py-3 text-right text-slate-900">{{ formatInt(plan.count) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Grupos recentes</h2>
          <p class="mt-1 text-xs text-slate-400">Os últimos grupos cadastrados.</p>
          <div class="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table class="w-full text-left text-sm" data-testid="recent-table">
              <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="px-4 py-3 font-medium">Grupo</th>
                  <th class="px-4 py-3 font-medium">Plano</th>
                  <th class="px-4 py-3 font-medium">Criado em</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-if="data.recentOrganizations.length === 0">
                  <td colspan="3" class="px-4 py-8 text-center text-slate-400">Nenhum grupo cadastrado ainda.</td>
                </tr>
                <tr v-for="org in data.recentOrganizations" :key="org.id" class="hover:bg-slate-50">
                  <td class="px-4 py-3">
                    <RouterLink :to="`/organizations/${org.id}`" class="font-medium text-slate-900 hover:underline">
                      {{ org.name }}
                    </RouterLink>
                    <p class="text-xs text-slate-400">{{ org.slug }}</p>
                  </td>
                  <td class="px-4 py-3 text-slate-600">
                    <template v-if="org.currentPlan">
                      {{ org.currentPlan.name }}
                      <span class="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {{ STATUS_SINGULAR[org.currentPlan.subscriptionStatus] }}
                      </span>
                    </template>
                    <span v-else class="text-slate-400">Sem plano</span>
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
