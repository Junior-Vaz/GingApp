<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface EventItem {
  id: number
  unitId: number | null
  title: string
  description: string | null
  date: string
  location: string | null
  isPublic: boolean
}

interface Unit {
  id: number
  name: string
}

interface Student {
  id: number
  name: string
}

type ParticipantStatus = 'INVITED' | 'CONFIRMED' | 'DECLINED' | 'ATTENDED' | 'CANCELLED'

interface Participant {
  id: number
  eventId: number
  studentId: number | null
  guestName: string | null
  status: ParticipantStatus
  student: { id: number; name: string } | null
}

interface EventFormState {
  id: number | null
  title: string
  description: string
  date: string
  location: string
  unitId: string
  isPublic: boolean
}

const STATUS_LABEL: Record<ParticipantStatus, string> = {
  INVITED: 'Convidado',
  CONFIRMED: 'Confirmado',
  DECLINED: 'Recusou',
  ATTENDED: 'Compareceu',
  CANCELLED: 'Cancelado',
}

const events = ref<EventItem[]>([])
const units = ref<Unit[]>([])
const students = ref<Student[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): EventFormState {
  return { id: null, title: '', description: '', date: '', location: '', unitId: '', isPublic: false }
}

const form = reactive<EventFormState>(emptyForm())

// --- Participantes ---
const isParticipantsModalOpen = ref(false)
const selectedEvent = ref<EventItem | null>(null)
const participants = ref<Participant[]>([])
const isParticipantsLoading = ref(false)
const participantsError = ref('')
const isAddingParticipant = ref(false)

type ParticipantKind = 'student' | 'guest'
const participantKind = ref<ParticipantKind>('student')
const newParticipantStudentId = ref('')
const newParticipantGuestName = ref('')
const newParticipantStatus = ref<ParticipantStatus>('CONFIRMED')

async function loadEvents(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    events.value = await api.get<EventItem[]>('/events')
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar os eventos.'
  } finally {
    isLoading.value = false
  }
}

async function loadUnits(): Promise<void> {
  try {
    units.value = await api.get<Unit[]>('/units')
  } catch {
    // Não bloqueia a tela de eventos se as unidades falharem — o campo fica sem opções.
  }
}

async function loadStudents(): Promise<void> {
  try {
    students.value = await api.get<Student[]>('/students')
  } catch {
    // Não bloqueia a tela de eventos se os alunos falharem — o select de participante fica sem opções.
  }
}

function formatDate(date: string): string {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  isModalOpen.value = true
}

function openEditModal(event: EventItem): void {
  Object.assign(form, {
    id: event.id,
    title: event.title,
    description: event.description ?? '',
    date: event.date ? event.date.slice(0, 16) : '',
    location: event.location ?? '',
    unitId: event.unitId ? String(event.unitId) : '',
    isPublic: event.isPublic,
  })
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
}

async function submitForm(): Promise<void> {
  formError.value = ''
  if (!form.title.trim()) {
    formError.value = 'Informe o título do evento.'
    return
  }
  if (!form.date) {
    formError.value = 'Informe a data do evento.'
    return
  }

  isSubmitting.value = true
  const payload = {
    title: form.title.trim(),
    date: new Date(form.date).toISOString(),
    description: form.description || undefined,
    location: form.location || undefined,
    unitId: form.unitId ? Number(form.unitId) : undefined,
    isPublic: form.isPublic,
  }

  try {
    if (form.id) {
      await api.patch(`/events/${form.id}`, payload)
    } else {
      await api.post('/events', payload)
    }
    isModalOpen.value = false
    await loadEvents()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar o evento.'
  } finally {
    isSubmitting.value = false
  }
}

async function removeEvent(event: EventItem): Promise<void> {
  if (!confirm(`Excluir o evento "${event.title}"? Os participantes cadastrados também serão removidos.`)) {
    return
  }
  try {
    await api.delete(`/events/${event.id}`)
    await loadEvents()
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível excluir o evento.'
  }
}

async function openParticipantsModal(event: EventItem): Promise<void> {
  selectedEvent.value = event
  isParticipantsModalOpen.value = true
  participantsError.value = ''
  participantKind.value = 'student'
  newParticipantStudentId.value = ''
  newParticipantGuestName.value = ''
  newParticipantStatus.value = 'CONFIRMED'
  await loadParticipants()
}

async function loadParticipants(): Promise<void> {
  if (!selectedEvent.value) return
  isParticipantsLoading.value = true
  participantsError.value = ''
  try {
    participants.value = await api.get<Participant[]>(`/events/${selectedEvent.value.id}/participants`)
  } catch (error) {
    participantsError.value =
      error instanceof ApiError ? error.message : 'Não foi possível carregar os participantes.'
  } finally {
    isParticipantsLoading.value = false
  }
}

function closeParticipantsModal(): void {
  isParticipantsModalOpen.value = false
  selectedEvent.value = null
  participants.value = []
}

function participantName(participant: Participant): string {
  return participant.student?.name ?? participant.guestName ?? '—'
}

async function addParticipant(): Promise<void> {
  if (!selectedEvent.value) return
  participantsError.value = ''

  const payload: { studentId?: number; guestName?: string; status: ParticipantStatus } = {
    status: newParticipantStatus.value,
  }
  if (participantKind.value === 'student') {
    if (!newParticipantStudentId.value) {
      participantsError.value = 'Selecione um aluno.'
      return
    }
    payload.studentId = Number(newParticipantStudentId.value)
  } else {
    if (!newParticipantGuestName.value.trim()) {
      participantsError.value = 'Informe o nome do convidado.'
      return
    }
    payload.guestName = newParticipantGuestName.value.trim()
  }

  isAddingParticipant.value = true
  try {
    await api.post(`/events/${selectedEvent.value.id}/participants`, payload)
    newParticipantStudentId.value = ''
    newParticipantGuestName.value = ''
    newParticipantStatus.value = 'CONFIRMED'
    await loadParticipants()
  } catch (error) {
    participantsError.value =
      error instanceof ApiError ? error.message : 'Não foi possível adicionar o participante.'
  } finally {
    isAddingParticipant.value = false
  }
}

async function checkIn(participant: Participant): Promise<void> {
  if (!selectedEvent.value) return
  participantsError.value = ''
  try {
    await api.patch(`/events/${selectedEvent.value.id}/participants/${participant.id}/check-in`)
    await loadParticipants()
  } catch (error) {
    participantsError.value =
      error instanceof ApiError ? error.message : 'Não foi possível confirmar a presença.'
  }
}

async function removeParticipant(participant: Participant): Promise<void> {
  if (!selectedEvent.value) return
  if (!confirm(`Remover "${participantName(participant)}" deste evento?`)) {
    return
  }
  try {
    await api.delete(`/events/${selectedEvent.value.id}/participants/${participant.id}`)
    await loadParticipants()
  } catch (error) {
    participantsError.value =
      error instanceof ApiError ? error.message : 'Não foi possível remover o participante.'
  }
}

onMounted(() => {
  void loadEvents()
  void loadUnits()
  void loadStudents()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Eventos</h1>
        <p class="mt-1 text-sm text-slate-500">Eventos e rodas do grupo.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Novo evento
      </button>
    </div>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Título</th>
            <th class="px-4 py-3 font-medium">Data</th>
            <th class="px-4 py-3 font-medium">Local</th>
            <th class="px-4 py-3 font-medium">Público</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="events.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Nenhum evento cadastrado ainda.</td>
          </tr>
          <tr v-for="event in events" v-else :key="event.id" class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ event.title }}</td>
            <td class="px-4 py-3 text-slate-600">{{ formatDate(event.date) }}</td>
            <td class="px-4 py-3 text-slate-600">{{ event.location || '—' }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="event.isPublic ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
              >
                {{ event.isPublic ? 'Sim' : 'Não' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button
                type="button"
                class="text-sm font-medium text-slate-600 hover:text-slate-900"
                @click="openParticipantsModal(event)"
              >
                Participantes
              </button>
              <button
                type="button"
                class="ml-3 text-sm font-medium text-slate-600 hover:text-slate-900"
                @click="openEditModal(event)"
              >
                Editar
              </button>
              <button
                type="button"
                class="ml-3 text-sm font-medium text-red-600 hover:text-red-700"
                @click="removeEvent(event)"
              >
                Excluir
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal criar/editar evento -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">{{ form.id ? 'Editar evento' : 'Novo evento' }}</h2>

        <form class="mt-4 space-y-4" @submit.prevent="submitForm">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Título</label>
            <input
              v-model="form.title"
              type="text"
              required
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Descrição</label>
            <textarea
              v-model="form.description"
              rows="2"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            ></textarea>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Data e hora</label>
              <input
                v-model="form.date"
                type="datetime-local"
                required
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Local</label>
              <input
                v-model="form.location"
                type="text"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Unidade</label>
            <select
              v-model="form.unitId"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            >
              <option value="">—</option>
              <option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option>
            </select>
          </div>

          <div class="flex items-center gap-2">
            <input id="event-is-public" v-model="form.isPublic" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
            <label for="event-is-public" class="text-sm font-medium text-slate-700">Evento público</label>
          </div>

          <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              @click="closeModal"
            >
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="isSubmitting"
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {{ isSubmitting ? 'Salvando…' : 'Salvar' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal participantes -->
    <div
      v-if="isParticipantsModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
    >
      <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">
          Participantes — {{ selectedEvent?.title }}
        </h2>

        <p v-if="participantsError" class="mt-3 text-sm text-red-600">{{ participantsError }}</p>

        <div class="mt-4 max-h-64 overflow-y-auto rounded-md border border-slate-200">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-3 py-2 font-medium">Nome</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-if="isParticipantsLoading">
                <td colspan="3" class="px-3 py-6 text-center text-slate-400">Carregando…</td>
              </tr>
              <tr v-else-if="participants.length === 0">
                <td colspan="3" class="px-3 py-6 text-center text-slate-400">Nenhum participante ainda.</td>
              </tr>
              <tr v-for="participant in participants" v-else :key="participant.id" class="hover:bg-slate-50">
                <td class="px-3 py-2 text-slate-900">{{ participantName(participant) }}</td>
                <td class="px-3 py-2 text-slate-600">{{ STATUS_LABEL[participant.status] }}</td>
                <td class="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    v-if="participant.status !== 'ATTENDED'"
                    type="button"
                    class="text-sm font-medium text-emerald-600 hover:text-emerald-700"
                    @click="checkIn(participant)"
                  >
                    Confirmar presença
                  </button>
                  <button
                    type="button"
                    class="ml-3 text-sm font-medium text-red-600 hover:text-red-700"
                    @click="removeParticipant(participant)"
                  >
                    Remover
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <form class="mt-4 space-y-3 border-t border-slate-200 pt-4" @submit.prevent="addParticipant">
          <p class="text-sm font-medium text-slate-700">Adicionar participante</p>

          <div class="flex items-center gap-4 text-sm text-slate-700">
            <label class="flex items-center gap-1.5">
              <input v-model="participantKind" type="radio" value="student" class="h-4 w-4" />
              Aluno cadastrado
            </label>
            <label class="flex items-center gap-1.5">
              <input v-model="participantKind" type="radio" value="guest" class="h-4 w-4" />
              Convidado
            </label>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Aluno</label>
              <select
                v-model="newParticipantStudentId"
                :disabled="participantKind !== 'student'"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 disabled:bg-slate-100 disabled:text-slate-400"
              >
                <option value="">Selecione…</option>
                <option v-for="student in students" :key="student.id" :value="student.id">{{ student.name }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Nome do convidado</label>
              <input
                v-model="newParticipantGuestName"
                type="text"
                :disabled="participantKind !== 'guest'"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Status</label>
            <select
              v-model="newParticipantStatus"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            >
              <option v-for="(label, value) in STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              @click="closeParticipantsModal"
            >
              Fechar
            </button>
            <button
              type="submit"
              :disabled="isAddingParticipant"
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {{ isAddingParticipant ? 'Adicionando…' : 'Adicionar' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
