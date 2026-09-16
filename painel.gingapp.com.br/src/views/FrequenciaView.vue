<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, ApiError } from '@/utils/api'

interface Lesson {
  id: number
  classId: number
  date: string
  startTime: string | null
  endTime: string | null
  status: 'ACTIVE' | 'INACTIVE'
}

interface ClassOption {
  id: number
  name: string
}

interface RosterEntry {
  studentId: number
  studentName: string
  present: boolean | null
  justification: string | null
}

/** Linha editável do formulário — cópia local do roster para não mutar a resposta da API
 * enquanto o professor faz a chamada. */
interface RosterRow {
  studentId: number
  studentName: string
  present: boolean
  /** true enquanto o professor não interagiu com o checkbox desta linha — usado só para o
   * estado visual neutro (indeterminate) do checkbox, não é enviado ao backend. */
  untouched: boolean
  justification: string
}

const lessons = ref<Lesson[]>([])
const classes = ref<ClassOption[]>([])
const selectedLessonId = ref('')
const roster = ref<RosterRow[]>([])

const isLoadingLessons = ref(false)
const isLoadingRoster = ref(false)
const isSaving = ref(false)
const listError = ref('')
const rosterError = ref('')
const saveMessage = ref('')

function className(classId: number): string {
  return classes.value.find((c) => c.id === classId)?.name ?? 'Turma'
}

function formatLessonDate(dateIso: string): string {
  const [year, month, day] = dateIso.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

const lessonOptions = computed(() =>
  lessons.value.map((lesson) => ({
    id: lesson.id,
    label: `${className(lesson.classId)} — ${formatLessonDate(lesson.date)}`,
  })),
)

async function loadLessons(): Promise<void> {
  isLoadingLessons.value = true
  listError.value = ''
  try {
    lessons.value = await api.get<Lesson[]>('/lessons')
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar as aulas.'
  } finally {
    isLoadingLessons.value = false
  }
}

async function loadClasses(): Promise<void> {
  try {
    classes.value = await api.get<ClassOption[]>('/classes')
  } catch {
    // Não bloqueia a tela se as turmas falharem — o select mostra "Turma" genérico.
  }
}

async function loadRoster(lessonId: string): Promise<void> {
  roster.value = []
  saveMessage.value = ''
  rosterError.value = ''
  if (!lessonId) return

  isLoadingRoster.value = true
  try {
    const entries = await api.get<RosterEntry[]>(`/attendance/lessons/${lessonId}`)
    roster.value = entries.map((entry) => ({
      studentId: entry.studentId,
      studentName: entry.studentName,
      present: entry.present === true,
      untouched: entry.present === null,
      justification: entry.justification ?? '',
    }))
  } catch (error) {
    rosterError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar a chamada desta aula.'
  } finally {
    isLoadingRoster.value = false
  }
}

function markTouched(row: RosterRow): void {
  row.untouched = false
}

async function saveAttendance(): Promise<void> {
  if (!selectedLessonId.value || roster.value.length === 0) return

  saveMessage.value = ''
  rosterError.value = ''
  isSaving.value = true
  const payload = roster.value.map((row) => ({
    studentId: row.studentId,
    present: row.present,
    justification: row.present ? undefined : row.justification.trim() || undefined,
  }))

  try {
    await api.post(`/attendance/lessons/${selectedLessonId.value}`, payload)
    saveMessage.value = 'Frequência salva com sucesso.'
  } catch (error) {
    rosterError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar a frequência.'
  } finally {
    isSaving.value = false
  }
}

watch(selectedLessonId, (lessonId) => {
  void loadRoster(lessonId)
})

onMounted(() => {
  void loadLessons()
  void loadClasses()
})
</script>

<template>
  <div>
    <div>
      <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Frequência</h1>
      <p class="mt-1 text-sm text-slate-500">Registre a chamada de uma aula.</p>
    </div>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <label class="mb-1 block text-sm font-medium text-slate-700">Aula</label>
      <select
        v-model="selectedLessonId"
        class="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
      >
        <option value="">{{ isLoadingLessons ? 'Carregando aulas…' : 'Selecione uma aula' }}</option>
        <option v-for="option in lessonOptions" :key="option.id" :value="String(option.id)">
          {{ option.label }}
        </option>
      </select>
    </div>

    <div v-if="!selectedLessonId" class="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
      Selecione uma aula para ver a lista de chamada.
    </div>

    <div v-else class="mt-6 rounded-xl border border-slate-200 bg-white">
      <div v-if="isLoadingRoster" class="px-4 py-8 text-center text-sm text-slate-400">Carregando chamada…</div>

      <p v-else-if="rosterError" class="px-4 py-8 text-center text-sm text-red-600">{{ rosterError }}</p>

      <p v-else-if="roster.length === 0" class="px-4 py-8 text-center text-sm text-slate-400">
        Esta turma não tem alunos matriculados.
      </p>

      <template v-else>
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3 font-medium">Aluno</th>
              <th class="px-4 py-3 font-medium">Presente</th>
              <th class="px-4 py-3 font-medium">Justificativa</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="row in roster" :key="row.studentId" class="hover:bg-slate-50">
              <td class="px-4 py-3 font-medium text-slate-900">{{ row.studentName }}</td>
              <td class="px-4 py-3">
                <input
                  type="checkbox"
                  v-model="row.present"
                  :indeterminate="row.untouched"
                  class="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                  :class="row.untouched ? 'opacity-60' : ''"
                  @change="markTouched(row)"
                />
              </td>
              <td class="px-4 py-3">
                <input
                  v-if="!row.present"
                  v-model="row.justification"
                  type="text"
                  placeholder="Motivo da falta (opcional)"
                  class="w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
                />
                <span v-else class="text-slate-300">—</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="flex items-center justify-end gap-3 border-t border-slate-200 px-4 py-3">
          <p v-if="saveMessage" class="text-sm text-emerald-600">{{ saveMessage }}</p>
          <p v-if="rosterError" class="text-sm text-red-600">{{ rosterError }}</p>
          <button
            type="button"
            :disabled="isSaving"
            class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            @click="saveAttendance"
          >
            {{ isSaving ? 'Salvando…' : 'Salvar frequência' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
