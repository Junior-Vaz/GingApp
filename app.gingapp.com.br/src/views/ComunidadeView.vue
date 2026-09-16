<script setup lang="ts">
// Não existe um endpoint único de "feed da comunidade" no backend. Para o
// MVP, combinamos GET /rodas (futuras) e GET /events (públicas e futuras)
// numa lista única ordenada por data. Cada card linka para a lista completa
// (/app/rodas ou /app/eventos) — não há página de detalhe individual ainda.
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '../utils/api'

interface Roda {
  id: number
  title: string
  description: string | null
  date: string
  location: string | null
}

interface Event {
  id: number
  title: string
  description: string | null
  date: string
  location: string | null
  isPublic: boolean
}

type FeedItem = {
  key: string
  kind: 'roda' | 'evento'
  title: string
  subtitle: string
  date: string
  to: string
  icon: string
}

const isLoading = ref(true)
const loadError = ref('')
const rodas = ref<Roda[]>([])
const events = ref<Event[]>([])

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
}

const feedItems = computed<FeedItem[]>(() => {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const rodaItems: FeedItem[] = rodas.value
    .filter((r) => new Date(r.date) >= startOfToday)
    .map((r) => ({
      key: `roda-${r.id}`,
      kind: 'roda',
      title: r.title,
      subtitle: [formatDate(r.date), r.location].filter(Boolean).join(' · '),
      date: r.date,
      to: '/app/rodas',
      icon: '🥁',
    }))

  const eventItems: FeedItem[] = events.value
    .filter((e) => e.isPublic && new Date(e.date) >= startOfToday)
    .map((e) => ({
      key: `evento-${e.id}`,
      kind: 'evento',
      title: e.title,
      subtitle: [formatDate(e.date), e.location].filter(Boolean).join(' · '),
      date: e.date,
      to: '/app/eventos',
      icon: '🎉',
    }))

  return [...rodaItems, ...eventItems].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
})

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const [rodasRes, eventsRes] = await Promise.all([
      api.get<Roda[]>('/rodas'),
      api.get<Event[]>('/events'),
    ])
    rodas.value = rodasRes
    events.value = eventsRes
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar a comunidade.'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="flex flex-col gap-6 pb-6 pt-6">
    <header class="px-5">
      <h1 class="text-xl font-semibold text-text">Comunidade</h1>
      <p class="text-sm text-text-muted">O que está rolando na capoeira</p>
    </header>

    <p v-if="loadError" class="mx-5 rounded-card bg-danger/15 px-4 py-3 text-sm text-danger">
      {{ loadError }}
    </p>

    <p v-else-if="isLoading" class="px-5 text-center text-sm text-text-faint">Carregando…</p>

    <p v-else-if="feedItems.length === 0" class="mx-5 rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
      Nenhuma novidade por enquanto.
    </p>

    <section v-else class="flex flex-col gap-4 px-5">
      <router-link
        v-for="item in feedItems"
        :key="item.key"
        :to="item.to"
        class="block overflow-hidden rounded-card-lg bg-surface shadow-md shadow-black/10 transition-colors active:bg-surface-hover"
      >
        <div class="flex h-40 items-center justify-center bg-gradient-to-br from-accent/30 to-bg-elevated text-4xl">
          {{ item.icon }}
        </div>
        <div class="flex flex-col gap-1 p-4">
          <p class="text-sm font-semibold text-text">{{ item.title }}</p>
          <p class="text-xs text-text-muted">{{ item.subtitle }}</p>
        </div>
      </router-link>
    </section>
  </div>
</template>
