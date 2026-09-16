<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface DashboardSummary {
  students: { active: number; new30d: number; inactive: number }
  classes: { active: number }
  lessonsToday: number
  finance: { pendingCount: number; pendingCents: number; overdueCount: number; overdueCents: number }
  attendance: { last30dPercent: number | null }
  graduations: { last30d: number }
  upcomingEvents: Array<{ id: number; title: string; date: string; location: string | null }>
}

const summary = ref<DashboardSummary | null>(null)
const isLoading = ref(false)
const loadError = ref('')

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

async function load(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    summary.value = await api.get<DashboardSummary>('/dashboard')
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar o dashboard.'
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
    <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
    <p class="mt-1 text-sm text-slate-500">Como está o seu grupo agora.</p>

    <p v-if="loadError" class="mt-4 text-sm text-red-600">{{ loadError }}</p>
    <p v-else-if="isLoading" class="mt-6 text-sm text-slate-400">Carregando…</p>

    <template v-else-if="summary">
      <div class="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Alunos ativos</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900">{{ summary.students.active }}</p>
          <p class="mt-1 text-xs text-slate-500">+{{ summary.students.new30d }} nos últimos 30 dias</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Turmas ativas</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900">{{ summary.classes.active }}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Aulas hoje</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900">{{ summary.lessonsToday }}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Frequência (30d)</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900">
            {{ summary.attendance.last30dPercent !== null ? `${summary.attendance.last30dPercent}%` : '—' }}
          </p>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Mensalidades previstas</p>
          <p class="mt-2 text-xl font-semibold text-slate-900">{{ formatCurrency(summary.finance.pendingCents) }}</p>
          <p class="mt-1 text-xs text-slate-500">{{ summary.finance.pendingCount }} lançamento(s) pendente(s)</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Mensalidades atrasadas</p>
          <p class="mt-2 text-xl font-semibold text-red-600">{{ formatCurrency(summary.finance.overdueCents) }}</p>
          <p class="mt-1 text-xs text-slate-500">{{ summary.finance.overdueCount }} lançamento(s) atrasado(s)</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Graduações (30d)</p>
          <p class="mt-2 text-xl font-semibold text-slate-900">{{ summary.graduations.last30d }}</p>
        </div>
      </div>

      <div class="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Próximos eventos</p>
        <p v-if="summary.upcomingEvents.length === 0" class="mt-3 text-sm text-slate-400">
          Nenhum evento futuro cadastrado.
        </p>
        <ul v-else class="mt-3 space-y-2">
          <li v-for="event in summary.upcomingEvents" :key="event.id" class="flex items-center justify-between text-sm">
            <span class="font-medium text-slate-900">{{ event.title }}</span>
            <span class="text-slate-500">{{ formatDate(event.date) }}<template v-if="event.location"> · {{ event.location }}</template></span>
          </li>
        </ul>
      </div>

      <p class="mt-4 text-xs text-slate-400">
        Alunos inativos: {{ summary.students.inactive }}
      </p>
    </template>
  </div>
</template>
