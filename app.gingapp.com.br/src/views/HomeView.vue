<script setup lang="ts">
// Home como feed (PLANO_PROJETO.md §10.21, pedido direto do owner com referência visual de um
// app de listagens — estilo copiado, não a funcionalidade): cards com "foto" de capa (placeholder
// ilustrado quando não há imagem — nenhum Roda/Event tem foto ainda) + ícones, resumindo Rodas,
// Eventos públicos (via GET /calendar, cross-organização) e Avisos do próprio grupo num só feed
// rolável, com abas de filtro por tipo.
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../utils/api'
import AppIcon, { type IconName } from '../components/icons/AppIcon.vue'
import FeedCard from '../components/ui/FeedCard.vue'
import AnnouncementCard from '../components/ui/AnnouncementCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SlidingTabs from '../components/ui/SlidingTabs.vue'
import AvatarCircle from '../components/ui/AvatarCircle.vue'

interface Student {
  id: number
  unitId: number | null
  photo: string | null
}

interface CalendarItem {
  id: number
  source: 'RODA' | 'EVENTO'
  type: string
  title: string
  date: string
  location: string | null
  imageUrl: string | null
  state: { uf: string } | null
  city: { name: string } | null
}

interface Announcement {
  id: number
  unitId: number | null
  title: string
  body: string
  publishedAt: string | null
  isActive: boolean
  createdAt: string
}

type FeedKind = 'roda' | 'evento' | 'aviso'
type FeedFilter = 'todos' | FeedKind

interface FeedItem {
  key: string
  kind: FeedKind
  icon: IconName
  badge: string
  title: string
  meta: string
  subtitle?: string
  to?: string
  imageUrl?: string | null
}

const auth = useAuthStore()

const quickLinks: { to: string; label: string; icon: IconName }[] = [
  { to: '/app/frequencia', label: 'Frequência', icon: 'check-circle' },
  { to: '/app/financeiro', label: 'Financeiro', icon: 'wallet' },
  { to: '/app/eventos', label: 'Eventos', icon: 'ticket' },
  { to: '/app/rodas', label: 'Rodas', icon: 'drum' },
]

const FILTERS: { value: FeedFilter; label: string }[] = [
  { value: 'todos', label: 'Tudo' },
  { value: 'roda', label: 'Rodas' },
  { value: 'evento', label: 'Eventos' },
  { value: 'aviso', label: 'Avisos' },
]

const isLoading = ref(true)
const loadError = ref('')
const hasStudent = ref(true)

const calendarItems = ref<CalendarItem[]>([])
const announcements = ref<Announcement[]>([])
const activeFilter = ref<FeedFilter>('todos')
const profilePhoto = ref<string | null>(null)

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
}

function formatRelative(iso: string): string {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (diffDays <= 0) return 'hoje'
  if (diffDays === 1) return 'ontem'
  return `há ${diffDays}d`
}

const feedItems = computed<FeedItem[]>(() => {
  const avisos: FeedItem[] = announcements.value.map((a) => ({
    key: `aviso-${a.id}`,
    kind: 'aviso',
    icon: 'megaphone',
    badge: 'Aviso',
    title: a.title,
    meta: formatRelative(a.publishedAt ?? a.createdAt),
    subtitle: a.body,
  }))

  const calendar: FeedItem[] = calendarItems.value.map((item) => ({
    key: `${item.source}-${item.id}`,
    kind: item.source === 'RODA' ? 'roda' : 'evento',
    icon: item.source === 'RODA' ? 'drum' : 'ticket',
    badge: item.source === 'RODA' ? 'Roda' : 'Evento',
    title: item.title,
    meta: formatShortDate(item.date),
    subtitle: [item.location, item.city?.name, item.state?.uf].filter(Boolean).join(' · ') || undefined,
    to: item.source === 'RODA' ? '/app/rodas' : '/app/comunidade',
    imageUrl: item.imageUrl,
  }))

  const combined = [...avisos, ...calendar]
  return activeFilter.value === 'todos' ? combined : combined.filter((i) => i.kind === activeFilter.value)
})

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const [studentsRes, calendarRes, announcementsRes] = await Promise.all([
      api.get<Student[]>('/students/me'),
      api.get<CalendarItem[]>('/calendar'),
      api.get<Announcement[]>('/announcements'),
    ])

    hasStudent.value = studentsRes.length > 0
    calendarItems.value = calendarRes
    profilePhoto.value = studentsRes[0]?.photo ?? null
    const myUnitId = studentsRes[0]?.unitId ?? null
    announcements.value = announcementsRes
      .filter((a) => a.isActive && (a.unitId === null || a.unitId === myUnitId))
      .slice(0, 3)
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar a home.'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="flex flex-col gap-5 pb-6">
    <header class="flex items-center justify-between px-5 pt-6">
      <div class="flex min-w-0 items-center gap-3">
        <router-link to="/app/perfil" class="transition-transform duration-150 active:scale-90">
          <AvatarCircle :photo="profilePhoto" :name="auth.user?.name" :size="48" />
        </router-link>
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {{ auth.user?.organizationName ?? 'Seu grupo' }}
          </p>
          <h1 class="font-display italic font-semibold text-4xl leading-tight text-accent">
            Olá, {{ auth.user?.name?.split(' ')[0] ?? 'capoeirista' }}
          </h1>
        </div>
      </div>
      <router-link
        to="/app/notificacoes"
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-text-muted transition-transform duration-150 active:scale-90"
        aria-label="Notificações"
      >
        <AppIcon name="bell" :size="19" />
      </router-link>
    </header>

    <p v-if="loadError" class="mx-5 rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">
      {{ loadError }}
    </p>

    <div v-else-if="!isLoading && !hasStudent" class="px-5">
      <EmptyState icon="user" message="Nenhum aluno vinculado a esta conta." />
    </div>

    <template v-else>
      <section class="grid grid-cols-4 gap-2 px-5">
        <router-link
          v-for="link in quickLinks"
          :key="link.to"
          :to="link.to"
          class="flex flex-col items-center gap-1.5 rounded-card bg-surface py-3 text-center transition-transform duration-150 active:scale-95 active:bg-surface-hover"
        >
          <span class="text-accent"><AppIcon :name="link.icon" :size="18" /></span>
          <span class="text-[10px] font-medium text-text-muted">{{ link.label }}</span>
        </router-link>
      </section>

      <div class="px-5">
        <SlidingTabs v-model="activeFilter" :options="FILTERS" />
      </div>

      <p v-if="isLoading" class="px-5 text-center text-sm text-text-faint">Carregando…</p>

      <div v-else-if="feedItems.length === 0" class="px-5">
        <EmptyState icon="compass" message="Nada por aqui ainda com esse filtro." />
      </div>

      <section v-else class="flex flex-col gap-4 px-5">
        <template v-for="(item, index) in feedItems" :key="item.key">
          <AnnouncementCard
            v-if="item.kind === 'aviso'"
            class="animate-rise"
            :style="{ animationDelay: `${index * 60}ms` }"
            :title="item.title"
            :meta="item.meta"
            :body="item.subtitle ?? ''"
          />
          <FeedCard
            v-else
            class="animate-rise"
            :style="{ animationDelay: `${index * 60}ms` }"
            :icon="item.icon"
            :badge="item.badge"
            :title="item.title"
            :meta="item.meta"
            :subtitle="item.subtitle"
            :to="item.to"
            :image-url="item.imageUrl"
          />
        </template>
      </section>
    </template>
  </div>
</template>
