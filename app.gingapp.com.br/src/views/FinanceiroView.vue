<script setup lang="ts">
// Rota sensível: dados financeiros nunca são cacheados agressivamente pelo
// service worker (ver vite.config.ts → workbox.runtimeCaching e
// navigateFallbackDenylist para /app/financeiro — PLANO_PROJETO.md §6).
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '../utils/api'
import AppIcon from '../components/icons/AppIcon.vue'
import Badge, { type BadgeTone } from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

type FinanceStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'

interface FinancialRecord {
  id: number
  studentId: number
  unitId: number | null
  description: string
  amountCents: number
  type: string
  dueDate: string
  paidAt: string | null
  status: FinanceStatus
  createdAt: string
  updatedAt: string
}

const isLoading = ref(true)
const loadError = ref('')
const records = ref<FinancialRecord[]>([])

// Mais recentes (por vencimento) primeiro — é um extrato de consulta, não uma fila de ação.
const sortedRecords = computed<FinancialRecord[]>(() =>
  [...records.value].sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()),
)

const openAmountCents = computed(() =>
  records.value
    .filter((r) => r.status === 'PENDING' || r.status === 'OVERDUE')
    .reduce((sum, r) => sum + r.amountCents, 0),
)

const statusLabel: Record<FinanceStatus, string> = {
  PENDING: 'Em aberto',
  PAID: 'Pago',
  OVERDUE: 'Atrasado',
  CANCELLED: 'Cancelado',
}

const statusTone: Record<FinanceStatus, BadgeTone> = {
  PENDING: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'neutral',
}

function formatCurrency(amountCents: number): string {
  return (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string): string {
  // timeZone: 'UTC' evita o bug de "um dia antes" quando o valor vem como
  // meia-noite UTC (ex.: dueDate) e o navegador está num fuso negativo.
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    records.value = await api.get<FinancialRecord[]>('/finance/me')
  } catch (error) {
    loadError.value =
      error instanceof ApiError ? error.message : 'Não foi possível carregar seus dados financeiros.'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="flex flex-col gap-7 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-2xl font-bold text-text">Financeiro</h1>
      <p class="text-sm text-text-muted">Mensalidades e pagamentos</p>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">
      {{ loadError }}
    </p>

    <template v-else>
      <section
        class="flex items-center gap-4 rounded-card-lg p-5"
        :class="openAmountCents > 0 ? 'bg-warning text-white' : 'bg-accent text-white'"
      >
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20">
          <AppIcon name="wallet" :size="22" />
        </span>
        <div>
          <p class="text-xs font-medium text-white/80">{{ openAmountCents > 0 ? 'Em aberto' : 'Situação financeira' }}</p>
          <p class="text-xl font-bold">
            {{ openAmountCents > 0 ? formatCurrency(openAmountCents) : 'Tudo em dia' }}
          </p>
        </div>
      </section>

      <p v-if="isLoading" class="text-center text-sm text-text-faint">Carregando…</p>

      <EmptyState v-else-if="sortedRecords.length === 0" icon="wallet" message="Nenhum lançamento financeiro encontrado." />

      <section v-else class="flex flex-col gap-3">
        <article
          v-for="record in sortedRecords"
          :key="record.id"
          class="flex items-center justify-between gap-3 rounded-card-lg bg-surface p-4"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-text">{{ record.description }}</p>
            <p class="text-xs text-text-muted">
              {{ formatCurrency(record.amountCents) }} · vence em {{ formatDate(record.dueDate) }}
            </p>
          </div>
          <Badge :tone="statusTone[record.status]">{{ statusLabel[record.status] }}</Badge>
        </article>
      </section>

      <p class="text-center text-xs text-text-faint">
        Dados sempre buscados online — esta tela não fica disponível offline.
      </p>
    </template>
  </div>
</template>
