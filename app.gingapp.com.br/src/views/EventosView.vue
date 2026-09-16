<script setup lang="ts">
// Decisão de UX: os participantes de TODOS os eventos visíveis são buscados
// já no onMounted (em paralelo, via Promise.all) para que o botão
// "Quero participar" / "Cancelar presença" já apareça correto em cada card
// sem exigir um segundo clique/expansão. Como a lista de eventos de uma
// organização tende a ser pequena, isso é preferível a buscar sob demanda.
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../utils/api'

interface Student {
  id: number
  name: string
}

interface Event {
  id: number
  organizationId: number
  unitId: number | null
  title: string
  description: string | null
  date: string
  location: string | null
  isPublic: boolean
  createdAt: string
  updatedAt: string
}

interface EventParticipant {
  id: number
  eventId: number
  studentId: number | null
  userId: number | null
  guestName: string | null
  status: string
  createdAt: string
  student: { id: number; name: string } | null
}

const auth = useAuthStore()

const isLoading = ref(true)
const loadError = ref('')
const events = ref<Event[]>([])
const participantsByEvent = ref<Record<number, EventParticipant[]>>({})
const myStudentId = ref<number | null>(null)
const pendingEventId = ref<number | null>(null)
const actionError = ref('')

const sortedEvents = computed<Event[]>(() =>
  [...events.value].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
)

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/**
 * Identifica "minha participação" num evento.
 *
 * - Caminho normal (conta com aluno vinculado): comparamos `studentId`, que é
 *   confiável.
 * - Caminho de fallback (conta sem aluno vinculado, ex. um MESTRE testando):
 *   o registro foi criado via `guestName` e o backend não grava `userId`
 *   nesse caso, então só é possível comparar `guestName === auth.user.name`
 *   por melhor esforço — se outra pessoa participar com o mesmo nome, ambos
 *   apareceriam como "participando" aqui. Limitação conhecida do backend,
 *   documentada também no README de tarefas do projeto.
 */
function findMyParticipant(eventId: number): EventParticipant | null {
  const list = participantsByEvent.value[eventId] ?? []
  if (myStudentId.value !== null) {
    return list.find((p) => p.studentId === myStudentId.value) ?? null
  }
  return list.find((p) => p.guestName === auth.user?.name) ?? null
}

function isParticipating(eventId: number): boolean {
  return findMyParticipant(eventId) !== null
}

async function loadParticipants(eventIds: number[]): Promise<void> {
  const results = await Promise.all(
    eventIds.map((id) =>
      api
        .get<EventParticipant[]>(`/events/${id}/participants`)
        .catch(() => [] as EventParticipant[]),
    ),
  )
  const map: Record<number, EventParticipant[]> = {}
  eventIds.forEach((id, index) => {
    map[id] = results[index]
  })
  participantsByEvent.value = map
}

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const [eventsRes, studentsRes] = await Promise.all([
      api.get<Event[]>('/events'),
      api.get<Student[]>('/students/me').catch(() => [] as Student[]),
    ])
    events.value = eventsRes
    myStudentId.value = studentsRes[0]?.id ?? null
    await loadParticipants(eventsRes.map((e) => e.id))
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar os eventos.'
  } finally {
    isLoading.value = false
  }
})

async function toggleParticipation(event: Event): Promise<void> {
  actionError.value = ''
  pendingEventId.value = event.id
  try {
    const mine = findMyParticipant(event.id)
    if (mine) {
      await api.delete(`/events/${event.id}/participants/${mine.id}`)
    } else if (myStudentId.value !== null) {
      await api.post(`/events/${event.id}/participants`, { studentId: myStudentId.value })
    } else {
      await api.post(`/events/${event.id}/participants`, { guestName: auth.user?.name })
    }
    await loadParticipants([event.id])
  } catch (error) {
    actionError.value =
      error instanceof ApiError ? error.message : 'Não foi possível atualizar sua presença.'
  } finally {
    pendingEventId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Eventos</h1>
      <p class="text-sm text-text-muted">Próximos eventos do seu grupo</p>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/15 px-4 py-3 text-sm text-danger">
      {{ loadError }}
    </p>

    <p v-else-if="isLoading" class="text-center text-sm text-text-faint">Carregando…</p>

    <p v-else-if="sortedEvents.length === 0" class="rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
      Nenhum evento programado no momento.
    </p>

    <template v-else>
      <p v-if="actionError" class="rounded-card bg-danger/15 px-4 py-3 text-sm text-danger">
        {{ actionError }}
      </p>

      <section class="flex flex-col gap-4">
        <article v-for="evento in sortedEvents" :key="evento.id" class="rounded-card-lg bg-surface p-5">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-xs font-semibold text-accent">{{ formatDate(evento.date) }}</p>
              <h3 class="mt-1 text-sm font-semibold text-text">{{ evento.title }}</h3>
            </div>
            <span
              v-if="evento.isPublic"
              class="flex-shrink-0 rounded-full bg-accent/15 px-2 py-1 text-[10px] font-semibold text-accent"
            >
              Público
            </span>
          </div>
          <p v-if="evento.location" class="mt-1 text-xs text-text-muted">{{ evento.location }}</p>
          <p v-if="evento.description" class="mt-2 text-xs text-text-faint">{{ evento.description }}</p>

          <button
            type="button"
            class="mt-4 w-full rounded-card px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
            :class="
              isParticipating(evento.id)
                ? 'bg-surface-hover text-text-muted'
                : 'bg-accent text-white'
            "
            :disabled="pendingEventId === evento.id"
            @click="toggleParticipation(evento)"
          >
            {{ pendingEventId === evento.id ? 'Aguarde…' : isParticipating(evento.id) ? 'Cancelar presença' : 'Quero participar' }}
          </button>
        </article>
      </section>
    </template>
  </div>
</template>
