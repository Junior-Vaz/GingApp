<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../utils/api'
import AvatarCarousel, { type AvatarCarouselItem } from '../components/layout/AvatarCarousel.vue'
import AppIcon, { type IconName } from '../components/icons/AppIcon.vue'
import StatTile from '../components/ui/StatTile.vue'
import SectionHeader from '../components/ui/SectionHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'

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

const quickLinks: { to: string; label: string; icon: IconName }[] = [
  { to: '/app/frequencia', label: 'Frequência', icon: 'check-circle' },
  { to: '/app/financeiro', label: 'Financeiro', icon: 'wallet' },
  { to: '/app/eventos', label: 'Eventos', icon: 'ticket' },
  { to: '/app/rodas', label: 'Rodas', icon: 'drum' },
]

const isLoading = ref(true)
const loadError = ref('')

const students = ref<Student[]>([])
const lessons = ref<Lesson[]>([])
const graduations = ref<StudentGraduation[]>([])
const announcements = ref<Announcement[]>([])

// TODO: seletor de aluno quando houver mais de um dependente
const primaryStudent = computed<Student | null>(() => students.value[0] ?? null)
const initials = computed(() => (primaryStudent.value?.name ?? auth.user?.name ?? 'C').charAt(0).toUpperCase())

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
  <div class="flex flex-col gap-8 pb-6">
    <header class="flex items-center justify-between px-5 pt-6">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-lg font-bold text-white">
          {{ initials }}
        </span>
        <div>
          <p class="text-xs text-text-muted">Olá, {{ auth.user?.name?.split(' ')[0] ?? 'capoeirista' }}</p>
          <h1 class="text-lg font-bold leading-tight text-text">{{ auth.user?.organizationName ?? 'Seu grupo' }}</h1>
        </div>
      </div>
      <router-link
        to="/app/notificacoes"
        class="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-text-muted"
        aria-label="Notificações"
      >
        <AppIcon name="bell" :size="19" />
      </router-link>
    </header>

    <p v-if="loadError" class="mx-5 rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">
      {{ loadError }}
    </p>

    <template v-else-if="!isLoading && students.length === 0">
      <div class="px-5">
        <EmptyState icon="user" message="Nenhum aluno vinculado a esta conta." />
      </div>
    </template>

    <template v-else>
      <section class="px-5">
        <div class="flex items-center gap-4 rounded-card-lg bg-accent p-5 text-white">
          <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20">
            <AppIcon name="graduation" :size="24" />
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium text-white/80">
              Graduação atual{{ primaryStudent ? ` · ${primaryStudent.name}` : '' }}
            </p>
            <p class="truncate text-xl font-bold">
              {{ latestGraduation ? latestGraduation.graduationLevel.name : 'Ainda sem graduação' }}
            </p>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <SectionHeader title="Próximas aulas" action-label="Ver tudo" action-to="/app/aulas" />
        <AvatarCarousel v-if="carouselItems.length > 0" :items="carouselItems" />
        <p v-else-if="!isLoading" class="px-5 text-sm text-text-faint">Nenhuma aula agendada por enquanto.</p>
      </section>

      <section class="flex flex-col gap-3 px-5">
        <SectionHeader title="Acesso rápido" />
        <div class="grid grid-cols-4 gap-2.5">
          <StatTile v-for="link in quickLinks" :key="link.to" :to="link.to" :icon="link.icon" :label="link.label" />
        </div>
      </section>

      <section class="flex flex-col gap-3 px-5">
        <SectionHeader title="Avisos do grupo" />

        <div v-if="visibleAnnouncements.length > 0" class="flex flex-col gap-3">
          <article
            v-for="announcement in visibleAnnouncements"
            :key="announcement.id"
            class="flex gap-3 rounded-card-lg bg-surface p-4"
          >
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
              <AppIcon name="megaphone" :size="16" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-text">{{ announcement.title }}</h3>
              <p class="mt-0.5 text-xs text-text-muted">{{ announcement.body }}</p>
            </div>
          </article>
        </div>
        <EmptyState v-else-if="!isLoading" icon="megaphone" message="Nenhum aviso publicado no momento." />
      </section>
    </template>
  </div>
</template>
