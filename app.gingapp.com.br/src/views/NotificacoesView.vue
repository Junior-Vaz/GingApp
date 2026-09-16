<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '../utils/api'

interface Notification {
  id: number
  title: string
  body: string
  type: string
  readAt: string | null
  createdAt: string
}

const isLoading = ref(true)
const loadError = ref('')
const notifications = ref<Notification[]>([])
const isMarkingAll = ref(false)

const hasUnread = computed(() => notifications.value.some((n) => n.readAt === null))

/** Tempo relativo simples, sem dependência externa. */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)

  if (diffMinutes < 1) return 'agora mesmo'
  if (diffMinutes < 60) return `há ${diffMinutes} min`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `há ${diffHours}h`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'há 1 dia'
  if (diffDays < 30) return `há ${diffDays} dias`

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths === 1) return 'há 1 mês'
  if (diffMonths < 12) return `há ${diffMonths} meses`

  const diffYears = Math.floor(diffMonths / 12)
  return diffYears === 1 ? 'há 1 ano' : `há ${diffYears} anos`
}

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    notifications.value = await api.get<Notification[]>('/notifications')
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar as notificações.'
  } finally {
    isLoading.value = false
  }
})

async function markAsRead(notification: Notification): Promise<void> {
  if (notification.readAt !== null) return
  // Otimista: atualiza o estado local sem recarregar a lista inteira.
  const previous = notification.readAt
  notification.readAt = new Date().toISOString()
  try {
    await api.patch(`/notifications/${notification.id}/read`)
  } catch {
    notification.readAt = previous
  }
}

async function markAllAsRead(): Promise<void> {
  if (!hasUnread.value || isMarkingAll.value) return
  isMarkingAll.value = true
  const previousStates = notifications.value.map((n) => n.readAt)
  const now = new Date().toISOString()
  notifications.value.forEach((n) => {
    if (n.readAt === null) n.readAt = now
  })
  try {
    await api.patch('/notifications/read-all')
  } catch {
    notifications.value.forEach((n, index) => {
      n.readAt = previousStates[index] ?? null
    })
  } finally {
    isMarkingAll.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-text">Notificações</h1>
        <p class="text-sm text-text-muted">Avisos do seu grupo e da plataforma</p>
      </div>
      <button
        v-if="hasUnread"
        type="button"
        class="text-xs font-semibold text-accent disabled:opacity-60"
        :disabled="isMarkingAll"
        @click="markAllAsRead"
      >
        Marcar todas como lidas
      </button>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/15 px-4 py-3 text-sm text-danger">
      {{ loadError }}
    </p>

    <p v-else-if="isLoading" class="text-center text-sm text-text-faint">Carregando…</p>

    <p v-else-if="notifications.length === 0" class="rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
      Nenhuma notificação por enquanto.
    </p>

    <section v-else class="flex flex-col gap-3">
      <article
        v-for="n in notifications"
        :key="n.id"
        class="flex items-start gap-3 rounded-card bg-surface p-4 text-left transition-colors"
        :class="n.readAt === null ? 'cursor-pointer active:bg-surface-hover' : ''"
        role="button"
        :tabindex="n.readAt === null ? 0 : -1"
        @click="markAsRead(n)"
      >
        <span
          class="mt-1 h-2 w-2 flex-shrink-0 rounded-full"
          :class="n.readAt === null ? 'bg-accent' : 'bg-transparent'"
        />
        <div>
          <p class="text-sm font-semibold text-text">{{ n.title }}</p>
          <p class="text-sm" :class="n.readAt === null ? 'text-text' : 'text-text-muted'">{{ n.body }}</p>
          <p class="mt-1 text-xs text-text-faint">{{ formatRelativeTime(n.createdAt) }}</p>
        </div>
      </article>
    </section>
  </div>
</template>
