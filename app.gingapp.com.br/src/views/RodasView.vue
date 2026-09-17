<script setup lang="ts">
// Decisão de UX: mostramos apenas rodas com `date >= hoje` (rodas passadas não
// interessam para "quero participar"; um histórico pode ser adicionado depois
// se fizer sentido para o produto). Participantes de todas as rodas visíveis
// são buscados em paralelo no onMounted, mesmo raciocínio da tela de Eventos.
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../utils/api'
import EmptyState from '../components/ui/EmptyState.vue'
import FeedCard from '../components/ui/FeedCard.vue'

interface Roda {
  id: number
  title: string
  description: string | null
  date: string
  location: string | null
  imageUrl: string | null
  stateId: number | null
  cityId: number | null
  communityId: number | null
  createdAt: string
  updatedAt: string
}

interface RodaParticipant {
  id: number
  rodaId: number
  userId: number | null
  studentId: number | null
  guestName: string | null
  status: string
  createdAt: string
  user: { id: number; name: string } | null
  student: { id: number; name: string } | null
}

const auth = useAuthStore()

const isLoading = ref(true)
const loadError = ref('')
const rodas = ref<Roda[]>([])
const participantsByRoda = ref<Record<number, RodaParticipant[]>>({})
const pendingRodaId = ref<number | null>(null)
const actionError = ref('')

const upcomingRodas = computed<Roda[]>(() => {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return rodas.value
    .filter((r) => new Date(r.date) >= startOfToday)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
})

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

// Aqui a identificação "sou eu" É confiável: participação em Rodas é sempre
// autoregistro pelo usuário logado (userId), diferente de Eventos.
function findMyParticipant(rodaId: number): RodaParticipant | null {
  const list = participantsByRoda.value[rodaId] ?? []
  return list.find((p) => p.userId === auth.user?.id) ?? null
}

function isParticipating(rodaId: number): boolean {
  return findMyParticipant(rodaId) !== null
}

function countConfirmed(rodaId: number): number {
  return (participantsByRoda.value[rodaId] ?? []).length
}

async function loadParticipants(rodaIds: number[]): Promise<void> {
  const results = await Promise.all(
    rodaIds.map((id) =>
      api.get<RodaParticipant[]>(`/rodas/${id}/participants`).catch(() => [] as RodaParticipant[]),
    ),
  )
  const map: Record<number, RodaParticipant[]> = { ...participantsByRoda.value }
  rodaIds.forEach((id, index) => {
    map[id] = results[index]
  })
  participantsByRoda.value = map
}

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const rodasRes = await api.get<Roda[]>('/rodas')
    rodas.value = rodasRes
    await loadParticipants(rodasRes.map((r) => r.id))
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar as rodas.'
  } finally {
    isLoading.value = false
  }
})

async function toggleParticipation(roda: Roda): Promise<void> {
  actionError.value = ''
  pendingRodaId.value = roda.id
  try {
    const mine = findMyParticipant(roda.id)
    if (mine) {
      await api.delete(`/rodas/${roda.id}/participants/${mine.id}`)
    } else {
      await api.post(`/rodas/${roda.id}/participants`)
    }
    await loadParticipants([roda.id])
  } catch (error) {
    actionError.value =
      error instanceof ApiError ? error.message : 'Não foi possível atualizar sua presença.'
  } finally {
    pendingRodaId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-7 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-2xl font-bold text-text">Rodas</h1>
      <p class="text-sm text-text-muted">Rodas da comunidade estadual</p>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">
      {{ loadError }}
    </p>

    <p v-else-if="isLoading" class="text-center text-sm text-text-faint">Carregando…</p>

    <EmptyState v-else-if="upcomingRodas.length === 0" icon="drum" message="Nenhuma roda programada no momento." />

    <template v-else>
      <p v-if="actionError" class="rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">
        {{ actionError }}
      </p>

      <section class="flex flex-col gap-4">
        <FeedCard
          v-for="(roda, index) in upcomingRodas"
          :key="roda.id"
          class="animate-rise"
          :style="{ animationDelay: `${index * 60}ms` }"
          icon="drum"
          :image-url="roda.imageUrl"
          badge="Roda"
          :title="roda.title"
          :meta="formatDate(roda.date)"
          :subtitle="roda.location ?? undefined"
        >
          <template #actions>
            <p class="mt-1 text-xs font-medium text-white/80">{{ countConfirmed(roda.id) }} confirmados</p>
            <button
              type="button"
              class="mt-2 w-full rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
              :class="isParticipating(roda.id) ? 'bg-white/20 text-white backdrop-blur-sm' : 'bg-accent text-white'"
              :disabled="pendingRodaId === roda.id"
              @click="toggleParticipation(roda)"
            >
              {{ pendingRodaId === roda.id ? 'Aguarde…' : isParticipating(roda.id) ? 'Cancelar presença' : 'Quero participar' }}
            </button>
          </template>
        </FeedCard>
      </section>
    </template>
  </div>
</template>
