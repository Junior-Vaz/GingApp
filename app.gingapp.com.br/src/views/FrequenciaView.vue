<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '../utils/api'
import Badge from '../components/ui/Badge.vue'
import SectionHeader from '../components/ui/SectionHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'

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
  <div class="flex flex-col gap-7 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-2xl font-bold text-text">Frequência</h1>
      <p class="text-sm text-text-muted">Seu histórico de presença nas aulas</p>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">{{ loadError }}</p>

    <template v-else>
      <section class="flex items-center gap-5 rounded-card-lg bg-accent p-5 text-white">
        <div
          v-if="last30dPercent !== null"
          class="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-base font-bold"
        >
          {{ Math.round(last30dPercent) }}%
        </div>
        <div v-else class="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-xs">
          —
        </div>
        <p class="text-sm font-medium leading-snug">
          {{
            last30dPercent !== null
              ? `${Math.round(last30dPercent)}% de frequência nos últimos 30 dias`
              : 'Sem registros ainda'
          }}
        </p>
      </section>

      <section class="flex flex-col gap-3">
        <SectionHeader title="Histórico recente" />
        <EmptyState
          v-if="!isLoading && sortedRecords.length === 0"
          icon="check-circle"
          message="Nenhum registro de presença ainda."
        />
        <div v-else class="flex flex-col gap-2 rounded-card-lg bg-surface p-2">
          <div v-for="item in sortedRecords" :key="item.id" class="flex items-center justify-between gap-3 px-3 py-2.5">
            <div>
              <span class="text-sm font-medium text-text">{{ formatDate(item.lesson.date) }}</span>
              <p v-if="!item.present && item.justification" class="mt-0.5 text-xs text-text-faint">
                {{ item.justification }}
              </p>
            </div>
            <Badge :tone="item.present ? 'success' : 'danger'">{{ item.present ? 'Presente' : 'Falta' }}</Badge>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
