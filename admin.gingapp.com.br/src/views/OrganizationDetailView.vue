<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, ApiError } from '@/utils/api'

interface Organization {
  id: number
  name: string
  slug: string
  type: string
  status: string
}

interface Plan {
  id: number
  name: string
  code: string
  priceCents: number
  maxStudents: number | null
  isActive: boolean
}

type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'

interface Subscription {
  id: number
  organizationId: number
  planId: number
  status: SubscriptionStatus
  currentPeriodEnd: string | null
  canceledAt: string | null
  plan: Plan
}

const OPEN_STATUSES: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE']
const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: 'Em teste',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Pagamento pendente',
  CANCELED: 'Cancelada',
  EXPIRED: 'Expirada',
}

const route = useRoute()
const organizationId = Number(route.params.id)

const organization = ref<Organization | null>(null)
const subscription = ref<Subscription | null>(null)
const plans = ref<Plan[]>([])
const isLoading = ref(false)
const loadError = ref('')

const selectedPlanId = ref('')
const isSaving = ref(false)
const actionError = ref('')

const activePlans = computed(() => plans.value.filter((p) => p.isActive))
const hasOpenSubscription = computed(
  () => subscription.value !== null && OPEN_STATUSES.includes(subscription.value.status),
)

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

async function loadAll(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    const [organizations, subscriptions, allPlans] = await Promise.all([
      api.get<Organization[]>('/organizations'),
      api.get<Subscription[]>('/subscriptions'),
      api.get<Plan[]>('/plans'),
    ])

    organization.value = organizations.find((o) => o.id === organizationId) ?? null
    plans.value = allPlans

    const orgSubscriptions = subscriptions.filter((s) => s.organizationId === organizationId)
    subscription.value = orgSubscriptions[0] ?? null
    selectedPlanId.value = subscription.value ? String(subscription.value.planId) : ''
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar a organização.'
  } finally {
    isLoading.value = false
  }
}

async function assignPlan(): Promise<void> {
  actionError.value = ''
  if (!selectedPlanId.value) {
    actionError.value = 'Escolha um plano.'
    return
  }

  isSaving.value = true
  try {
    if (subscription.value && hasOpenSubscription.value) {
      await api.patch(`/subscriptions/${subscription.value.id}`, { planId: Number(selectedPlanId.value) })
    } else {
      await api.post('/subscriptions', { organizationId, planId: Number(selectedPlanId.value) })
    }
    await loadAll()
  } catch (error) {
    actionError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar a assinatura.'
  } finally {
    isSaving.value = false
  }
}

async function cancelSubscription(): Promise<void> {
  if (!subscription.value) return
  if (!confirm('Cancelar a assinatura desta organização? O plano deixa de ser aplicado imediatamente.')) {
    return
  }

  actionError.value = ''
  isSaving.value = true
  try {
    await api.post(`/subscriptions/${subscription.value.id}/cancel`)
    await loadAll()
  } catch (error) {
    actionError.value = error instanceof ApiError ? error.message : 'Não foi possível cancelar a assinatura.'
  } finally {
    isSaving.value = false
  }
}

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <div>
    <RouterLink to="/organizations" class="text-sm font-medium text-slate-500 hover:text-slate-900">
      &larr; Organizations
    </RouterLink>

    <h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
      {{ organization?.name ?? `Organization #${organizationId}` }}
    </h1>
    <p v-if="organization" class="mt-1 text-sm text-slate-500">{{ organization.slug }} · {{ organization.type }}</p>

    <p v-if="loadError" class="mt-4 text-sm text-red-600">{{ loadError }}</p>
    <p v-if="isLoading" class="mt-6 text-sm text-slate-400">Carregando…</p>

    <div v-else class="mt-6 rounded-xl border border-slate-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-slate-900">Assinatura</h2>

      <div v-if="subscription" class="mt-4 space-y-1 text-sm">
        <p>
          <span class="text-slate-500">Plano:</span>
          <span class="ml-1 font-medium text-slate-900">{{ subscription.plan.name }}</span>
          <span class="ml-1 text-slate-500">({{ formatPrice(subscription.plan.priceCents) }}/mês)</span>
        </p>
        <p>
          <span class="text-slate-500">Status:</span>
          <span
            class="ml-1 rounded-full px-2 py-0.5 text-xs font-medium"
            :class="hasOpenSubscription ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
          >
            {{ STATUS_LABEL[subscription.status] }}
          </span>
        </p>
        <p><span class="text-slate-500">Renova em:</span> <span class="ml-1">{{ formatDate(subscription.currentPeriodEnd) }}</span></p>
        <p v-if="subscription.canceledAt">
          <span class="text-slate-500">Cancelada em:</span> <span class="ml-1">{{ formatDate(subscription.canceledAt) }}</span>
        </p>
      </div>
      <p v-else class="mt-4 text-sm text-slate-400">Nenhuma assinatura ainda.</p>

      <div class="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-5">
        <div class="min-w-[220px]">
          <label class="mb-1 block text-sm font-medium text-slate-700">
            {{ hasOpenSubscription ? 'Trocar plano' : 'Atribuir plano' }}
          </label>
          <select
            v-model="selectedPlanId"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          >
            <option value="" disabled>Selecione…</option>
            <option v-for="plan in activePlans" :key="plan.id" :value="plan.id">
              {{ plan.name }} — {{ formatPrice(plan.priceCents) }}/mês
            </option>
          </select>
        </div>
        <button
          type="button"
          :disabled="isSaving"
          class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          @click="assignPlan"
        >
          {{ isSaving ? 'Salvando…' : hasOpenSubscription ? 'Trocar plano' : 'Atribuir plano' }}
        </button>
        <button
          v-if="hasOpenSubscription"
          type="button"
          :disabled="isSaving"
          class="rounded-md px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          @click="cancelSubscription"
        >
          Cancelar assinatura
        </button>
      </div>

      <p v-if="actionError" class="mt-3 text-sm text-red-600">{{ actionError }}</p>
    </div>

    <div class="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
      Uso, atividade, unidades e feature overrides serão implementados nas próximas fases.
    </div>
  </div>
</template>
