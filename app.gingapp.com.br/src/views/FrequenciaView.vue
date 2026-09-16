<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '../utils/api'

interface AttendanceRecord {
  id: number
  lessonId: number
  studentId: number
  present: boolean
  justification: string | null
  createdAt: string
  lesson: {
    date: string
    classId: number
  }
}

interface AttendanceResponse {
  records: AttendanceRecord[]
  last30dPercent: number | null
}

const isLoading = ref(true)
const loadError = ref('')

const records = ref<AttendanceRecord[]>([])
const last30dPercent = ref<number | null>(null)

const sortedRecords = computed<AttendanceRecord[]>(() =>
  [...records.value].sort((a, b) => new Date(b.lesson.date).getTime() - new Date(a.lesson.date).getTime()),
)

function formatDate(iso: string): string {
  // timeZone: 'UTC': lesson.date vem do painel via <input type="date"> (meia-noite UTC).
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
}

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const data = await api.get<AttendanceResponse>('/attendance/me')
    records.value = data.records
    last30dPercent.value = data.last30dPercent
  } catch (error) {
    loadError.value =
      error instanceof ApiError ? error.message : 'Não foi possível carregar sua frequência.'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Frequência</h1>
      <p class="text-sm text-text-muted">Seu histórico de presença nas aulas</p>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/15 px-4 py-3 text-sm text-danger">{{ loadError }}</p>

    <template v-else>
      <section class="flex items-center gap-6 rounded-card-lg bg-surface p-5">
        <div
          v-if="last30dPercent !== null"
          class="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full border-4 border-accent text-lg font-semibold text-accent"
        >
          {{ Math.round(last30dPercent) }}%
        </div>
        <div v-else class="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full border-4 border-border text-xs text-text-faint">
          —
        </div>
        <div>
          <p class="text-sm font-medium text-text">
            {{
              last30dPercent !== null
                ? `${Math.round(last30dPercent)}% de frequência nos últimos 30 dias`
                : 'Sem registros ainda'
            }}
          </p>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-medium text-text-muted">Histórico recente</h2>
        <p v-if="!isLoading && sortedRecords.length === 0" class="rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
          Nenhum registro de presença ainda.
        </p>
        <div
          v-for="item in sortedRecords"
          :key="item.id"
          class="flex items-center justify-between gap-3 rounded-card bg-surface px-4 py-3"
        >
          <div>
            <span class="text-sm text-text">{{ formatDate(item.lesson.date) }}</span>
            <p v-if="!item.present && item.justification" class="mt-0.5 text-xs text-text-faint">
              {{ item.justification }}
            </p>
          </div>
          <span class="text-xs font-semibold" :class="item.present ? 'text-success' : 'text-danger'">
            {{ item.present ? '✓ Presente' : '✗ Falta' }}
          </span>
        </div>
      </section>
    </template>
  </div>
</template>
