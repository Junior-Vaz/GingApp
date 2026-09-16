<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../utils/api'
import AvatarCarousel, { type AvatarCarouselItem } from '../components/layout/AvatarCarousel.vue'

interface Student {
  id: number
  organizationId: number
  unitId: number | null
  userId: number | null
  name: string
  birthDate: string | null
  document: string | null
  phone: string | null
  email: string | null
  photo: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'FORMER'
  joinedAt: string | null
  createdAt: string
  updatedAt: string
}

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

interface GraduationLevel {
  id: number
  name: string
  order: number
  color: string | null
}

interface StudentGraduation {
  id: number
  studentId: number
  graduationLevelId: number
  graduatedAt: string
  notes: string | null
  createdAt: string
  graduationLevel: GraduationLevel
}

interface Announcement {
  id: number
  organizationId: number
  unitId: number | null
  title: string
  body: string
  publishedAt: string | null
  isActive: boolean
  createdByUserId: number | null
  createdAt: string
  updatedAt: string
}

const auth = useAuthStore()

const quickLinks = [
  { to: '/app/frequencia', label: 'Frequência', icon: '✓' },
  { to: '/app/financeiro', label: 'Financeiro', icon: '$' },
  { to: '/app/eventos', label: 'Eventos', icon: '★' },
  { to: '/app/rodas', label: 'Rodas', icon: '◎' },
]

const isLoading = ref(true)
const loadError = ref('')

const students = ref<Student[]>([])
const lessons = ref<Lesson[]>([])
const graduations = ref<StudentGraduation[]>([])
const announcements = ref<Announcement[]>([])

// TODO: seletor de aluno quando houver mais de um dependente
const primaryStudent = computed<Student | null>(() => students.value[0] ?? null)

const latestGraduation = computed<StudentGraduation | null>(() => graduations.value[0] ?? null)

// lesson.date vem do painel via <input type="date"> (sem hora) — chega como meia-noite UTC,
// representando um DIA, não um instante. Comparar contra "meia-noite local" (Date(y,m,d))
// desalinha em fusos negativos: uma aula de hoje ficaria "no passado" e sumiria do carrossel.
// Por isso "hoje" também é expresso como meia-noite UTC do dia local atual, alinhando as duas
// pontas na mesma convenção.
function todayAsUtcMidnight(): number {
  const now = new Date()
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
}

const upcomingLessons = computed<Lesson[]>(() => {
  const todayUtcMidnight = todayAsUtcMidnight()
  return lessons.value
    .filter((lesson) => new Date(lesson.date).getTime() >= todayUtcMidnight)
    .slice(0, 5)
})

const carouselItems = computed<AvatarCarouselItem[]>(() =>
  upcomingLessons.value.map((lesson, index) => {
    const date = new Date(lesson.date)
    const isToday = date.getTime() === todayAsUtcMidnight()
    const weekdayLabel = isToday
      ? 'Hoje'
      : date.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
    const label = weekdayLabel.charAt(0).toUpperCase() + weekdayLabel.slice(1)
    return {
      id: lesson.id,
      label,
      subtitle: lesson.startTime ?? undefined,
      highlighted: index === 0,
      initials: label.slice(0, 2).toUpperCase(),
    }
  }),
)

const visibleAnnouncements = computed<Announcement[]>(() =>
  announcements.value
    .filter((a) => a.isActive && (a.unitId === null || a.unitId === primaryStudent.value?.unitId))
    .slice(0, 5),
)

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const [studentsRes, lessonsRes, announcementsRes] = await Promise.all([
      api.get<Student[]>('/students/me'),
      api.get<Lesson[]>('/lessons/me'),
      api.get<Announcement[]>('/announcements'),
    ])

    students.value = studentsRes
    lessons.value = lessonsRes
    announcements.value = announcementsRes

    const student = studentsRes[0]
    if (student) {
      try {
        graduations.value = await api.get<StudentGraduation[]>(`/graduations/students/${student.id}`)
      } catch {
        // Sem graduações ainda não é um erro fatal para a Home.
        graduations.value = []
      }
    }
  } catch (error) {
    loadError.value =
      error instanceof ApiError ? error.message : 'Não foi possível carregar os dados da home.'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="flex flex-col gap-7 pb-6">
    <header class="flex items-center justify-between px-5 pt-6">
      <div>
        <p class="text-sm text-text-muted">Olá, {{ auth.user?.name?.split(' ')[0] ?? 'capoeirista' }} 👋</p>
        <h1 class="text-xl font-semibold text-text">{{ auth.user?.organizationName ?? 'Seu grupo' }}</h1>
      </div>
      <router-link
        to="/app/notificacoes"
        class="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-text-muted"
        aria-label="Notificações"
      >
        🔔
      </router-link>
    </header>

    <p v-if="loadError" class="mx-5 rounded-card bg-danger/15 px-4 py-3 text-sm text-danger">
      {{ loadError }}
    </p>

    <template v-else-if="!isLoading && students.length === 0">
      <p class="mx-5 rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
        Nenhum aluno vinculado a esta conta.
      </p>
    </template>

    <template v-else>
      <section v-if="latestGraduation" class="mx-5 rounded-card-lg bg-surface p-5">
        <p class="text-xs text-text-muted">Graduação atual{{ primaryStudent ? ` de ${primaryStudent.name}` : '' }}</p>
        <p class="mt-1 text-lg font-semibold text-accent">{{ latestGraduation.graduationLevel.name }}</p>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="px-5 text-sm font-medium text-text-muted">Próximas aulas</h2>
        <AvatarCarousel v-if="carouselItems.length > 0" :items="carouselItems" />
        <p v-else-if="!isLoading" class="px-5 text-sm text-text-faint">Nenhuma aula agendada por enquanto.</p>
      </section>

      <section class="grid grid-cols-4 gap-3 px-5">
        <router-link
          v-for="link in quickLinks"
          :key="link.to"
          :to="link.to"
          class="flex flex-col items-center gap-2 rounded-card bg-surface py-4 text-center transition-colors active:bg-surface-hover"
        >
          <span class="text-lg text-accent">{{ link.icon }}</span>
          <span class="text-[11px] font-medium text-text-muted">{{ link.label }}</span>
        </router-link>
      </section>

      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between px-5">
          <h2 class="text-sm font-medium text-text-muted">Avisos do grupo</h2>
        </div>

        <div v-if="visibleAnnouncements.length > 0" class="flex flex-col gap-4 px-5">
          <article
            v-for="announcement in visibleAnnouncements"
            :key="announcement.id"
            class="flex flex-col gap-1 rounded-card-lg bg-surface p-4 shadow-md shadow-black/10"
          >
            <h3 class="text-sm font-semibold text-text">{{ announcement.title }}</h3>
            <p class="text-xs text-text-muted">{{ announcement.body }}</p>
          </article>
        </div>
        <p v-else-if="!isLoading" class="px-5 text-sm text-text-faint">Nenhum aviso publicado no momento.</p>
      </section>
    </template>
  </div>
</template>
