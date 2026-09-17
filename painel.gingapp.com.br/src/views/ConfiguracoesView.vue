<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface Plan {
  id: number
  name: string
  priceCents: number
  maxStudents: number | null
  maxUnits: number | null
}

type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'

interface Subscription {
  id: number
  status: SubscriptionStatus
  currentPeriodEnd: string | null
  plan: Plan
}

interface Student {
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'FORMER'
}

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: 'Em teste',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Pagamento pendente',
  CANCELED: 'Cancelada',
  EXPIRED: 'Expirada',
}

const subscription = ref<Subscription | null>(null)
const activeStudentCount = ref(0)
const isLoading = ref(false)
const loadError = ref('')

const usagePercent = computed(() => {
  const max = subscription.value?.plan.maxStudents
  if (!max) return null
  return Math.min(100, Math.round((activeStudentCount.value / max) * 100))
})

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

async function loadPlanUsage(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    const [sub, students] = await Promise.all([
      api.get<Subscription | null>('/subscriptions/me'),
      api.get<Student[]>('/students'),
    ])
    subscription.value = sub
    activeStudentCount.value = students.filter((s) => s.status === 'ACTIVE').length
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar o plano.'
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  void loadPlanUsage()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Configurações</h1>
    <p class="mt-1 text-sm text-slate-500">Plano e uso do grupo.</p>

    <p v-if="loadError" class="mt-4 text-sm text-red-600">{{ loadError }}</p>
    <p v-if="isLoading" class="mt-6 text-sm text-slate-400">Carregando…</p>

    <div v-else class="mt-6 rounded-xl border border-slate-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-slate-900">Meu plano</h2>

      <div v-if="subscription" class="mt-4 space-y-3">
        <div class="flex items-center justify-between text-sm">
          <span class="font-medium text-slate-900">{{ subscription.plan.name }}</span>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-medium"
            :class="subscription.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
          >
            {{ STATUS_LABEL[subscription.status] }}
          </span>
        </div>
        <p class="text-sm text-slate-500">
          {{ formatPrice(subscription.plan.priceCents) }}/mês · renova em {{ formatDate(subscription.currentPeriodEnd) }}
        </p>

        <div>
          <div class="flex items-center justify-between text-sm text-slate-600">
            <span>Alunos ativos</span>
            <span>{{ activeStudentCount }} / {{ subscription.plan.maxStudents ?? '∞' }}</span>
          </div>
          <div v-if="usagePercent !== null" class="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              class="h-full rounded-full transition-all"
              :class="usagePercent >= 100 ? 'bg-red-500' : usagePercent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'"
              :style="{ width: `${usagePercent}%` }"
            />
          </div>
          <p v-if="usagePercent !== null && usagePercent >= 100" class="mt-1.5 text-sm text-red-600">
            Limite de alunos do plano atingido — fale com a equipe GingApp para fazer upgrade.
          </p>
        </div>
      </div>
      <p v-else class="mt-4 text-sm text-slate-400">
        Nenhuma assinatura ativa no momento. Fale com a equipe GingApp para contratar um plano.
      </p>
    </div>
  </div>
</template>
