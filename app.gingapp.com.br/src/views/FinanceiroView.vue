<script setup lang="ts">
// Rota sensível: dados financeiros nunca são cacheados agressivamente pelo
// service worker (ver vite.config.ts → workbox.runtimeCaching e
// navigateFallbackDenylist para /app/financeiro — PLANO_PROJETO.md §6).
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '../utils/api'

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

const statusLabel: Record<FinanceStatus, string> = {
  PENDING: 'Em aberto',
  PAID: 'Pago',
  OVERDUE: 'Atrasado',
  CANCELLED: 'Cancelado',
}

const statusClass: Record<FinanceStatus, string> = {
  PENDING: 'bg-warning/15 text-warning',
  PAID: 'bg-success/15 text-success',
  OVERDUE: 'bg-danger/15 text-danger',
  CANCELLED: 'bg-text-faint/15 text-text-faint',
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
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Financeiro</h1>
      <p class="text-sm text-text-muted">Mensalidades e pagamentos</p>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/15 px-4 py-3 text-sm text-danger">
      {{ loadError }}
    </p>

    <p v-else-if="isLoading" class="text-center text-sm text-text-faint">Carregando…</p>

    <p v-else-if="sortedRecords.length === 0" class="rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
      Nenhum lançamento financeiro encontrado.
    </p>

    <section v-else class="flex flex-col gap-3">
      <article
        v-for="record in sortedRecords"
        :key="record.id"
        class="flex items-center justify-between rounded-card bg-surface p-4"
      >
        <div>
          <p class="text-sm font-semibold text-text">{{ record.description }}</p>
          <p class="text-xs text-text-muted">
            {{ formatCurrency(record.amountCents) }} · vence em {{ formatDate(record.dueDate) }}
          </p>
        </div>
        <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="statusClass[record.status]">
          {{ statusLabel[record.status] }}
        </span>
      </article>
    </section>

    <p class="text-center text-xs text-text-faint">
      Dados sempre buscados online — esta tela não fica disponível offline.
    </p>
  </div>
</template>
