<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '../utils/api'
import AppIcon from '../components/icons/AppIcon.vue'
import Badge from '../components/ui/Badge.vue'
import SectionHeader from '../components/ui/SectionHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'

interface Lesson {
  id: number
  organizationId: number
  classId: number
  unitId: number | null
  teacherUserId: number | null
  date: string
  startTime: string | null
  endTime: string | null
  notes: string | null
  status: 'ACTIVE' | 'INACTIVE'
  createdAt: string
  updatedAt: string
}

const isLoading = ref(true)
const loadError = ref('')
const lessons = ref<Lesson[]>([])

function isFuture(lesson: Lesson): boolean {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return new Date(lesson.date) >= startOfToday
}

const upcoming = computed<Lesson[]>(() => lessons.value.filter(isFuture))
const past = computed<Lesson[]>(() => [...lessons.value.filter((l) => !isFuture(l))].reverse())

function formatDate(iso: string): string {
  // timeZone: 'UTC' evita o bug de "um dia antes": Lesson.date é preenchido no painel via
  // <input type="date"> (sem hora), então chega como meia-noite UTC — sem forçar UTC aqui,
  // um fuso negativo mostraria o dia anterior.
  const label = new Date(iso).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  })
  return label.charAt(0).toUpperCase() + label.slice(1).replace('.', '')
}

function formatTime(lesson: Lesson): string | null {
  if (!lesson.startTime && !lesson.endTime) return null
  if (lesson.startTime && lesson.endTime) return `${lesson.startTime}–${lesson.endTime}`
  return lesson.startTime ?? lesson.endTime
}

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    lessons.value = await api.get<Lesson[]>('/lessons/me')
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar as aulas.'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="flex flex-col gap-7 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-2xl font-bold text-text">Aulas</h1>
      <p class="text-sm text-text-muted">Turmas e horários do seu grupo</p>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">{{ loadError }}</p>

    <EmptyState v-else-if="!isLoading && lessons.length === 0" icon="calendar" message="Nenhuma aula agendada." />

    <template v-else>
      <section v-if="upcoming.length > 0" class="flex flex-col gap-3">
        <SectionHeader title="Próximas" />
        <div class="flex flex-col gap-3">
          <article v-for="lesson in upcoming" :key="lesson.id" class="flex items-center gap-3 rounded-card-lg bg-surface p-4">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
              <AppIcon name="calendar" :size="18" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold text-text">{{ formatDate(lesson.date) }}</p>
              <p v-if="formatTime(lesson)" class="text-xs text-text-muted">{{ formatTime(lesson) }}</p>
            </div>
            <Badge v-if="lesson.status === 'INACTIVE'" tone="danger">Cancelada</Badge>
            <Badge v-else tone="success">Confirmada</Badge>
          </article>
        </div>
      </section>

      <section v-if="past.length > 0" class="flex flex-col gap-3">
        <SectionHeader title="Anteriores" />
        <div class="flex flex-col gap-2 rounded-card-lg bg-surface p-2">
          <article v-for="lesson in past" :key="lesson.id" class="flex items-center justify-between gap-3 px-3 py-2.5">
            <div>
              <p class="text-sm font-medium text-text">{{ formatDate(lesson.date) }}</p>
              <p v-if="formatTime(lesson)" class="text-xs text-text-muted">{{ formatTime(lesson) }}</p>
            </div>
            <Badge v-if="lesson.status === 'INACTIVE'" tone="danger">Cancelada</Badge>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>
