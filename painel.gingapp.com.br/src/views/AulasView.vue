<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface Lesson {
  id: number
  classId: number
  unitId: number | null
  teacherUserId: number | null
  date: string
  startTime: string | null
  endTime: string | null
  notes: string | null
  status: 'ACTIVE' | 'INACTIVE'
}

interface ClassOption {
  id: number
  name: string
}

interface TeacherMembership {
  id: number
  role: 'MESTRE' | 'PROFESSOR'
  status: string
  user: { id: number; name: string; email: string; phone: string | null }
}

interface LessonFormState {
  id: number | null
  classId: string
  date: string
  startTime: string
  endTime: string
  teacherUserId: string
  notes: string
  status: Lesson['status']
}

const STATUS_LABEL: Record<Lesson['status'], string> = {
  ACTIVE: 'Ativa',
  INACTIVE: 'Cancelada',
}

const lessons = ref<Lesson[]>([])
const classes = ref<ClassOption[]>([])
const teachers = ref<TeacherMembership[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): LessonFormState {
  return { id: null, classId: '', date: '', startTime: '', endTime: '', teacherUserId: '', notes: '', status: 'ACTIVE' }
}

const form = reactive<LessonFormState>(emptyForm())

async function loadLessons(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    lessons.value = await api.get<Lesson[]>('/lessons')
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar as aulas.'
  } finally {
    isLoading.value = false
  }
}

async function loadClasses(): Promise<void> {
  try {
    classes.value = await api.get<ClassOption[]>('/classes')
  } catch {
    // Não bloqueia a tela de aulas se as turmas falharem — o campo fica sem opções.
  }
}

async function loadTeachers(): Promise<void> {
  try {
    teachers.value = await api.get<TeacherMembership[]>('/teachers')
  } catch {
    // Não bloqueia a tela de aulas se os professores falharem — o campo fica sem opções.
  }
}

function className(classId: number): string {
  return classes.value.find((c) => c.id === classId)?.name ?? '—'
}

function teacherName(teacherUserId: number | null): string {
  if (!teacherUserId) return '—'
  return teachers.value.find((t) => t.user.id === teacherUserId)?.user.name ?? '—'
}

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  isModalOpen.value = true
}

function openEditModal(lesson: Lesson): void {
  Object.assign(form, {
    id: lesson.id,
    classId: String(lesson.classId),
    date: lesson.date.slice(0, 10),
    startTime: lesson.startTime ?? '',
    endTime: lesson.endTime ?? '',
    teacherUserId: lesson.teacherUserId ? String(lesson.teacherUserId) : '',
    notes: lesson.notes ?? '',
    status: lesson.status,
  })
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
}

async function submitForm(): Promise<void> {
  formError.value = ''
  if (!form.classId) {
    formError.value = 'Selecione a turma.'
    return
  }
  if (!form.date) {
    formError.value = 'Informe a data da aula.'
    return
  }

  isSubmitting.value = true
  const payload = {
    classId: Number(form.classId),
    date: form.date,
    startTime: form.startTime || undefined,
    endTime: form.endTime || undefined,
    teacherUserId: form.teacherUserId ? Number(form.teacherUserId) : undefined,
    notes: form.notes || undefined,
    status: form.status,
  }

  try {
    if (form.id) {
      await api.patch(`/lessons/${form.id}`, payload)
    } else {
      await api.post('/lessons', payload)
    }
    isModalOpen.value = false
    await loadLessons()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar a aula.'
  } finally {
    isSubmitting.value = false
  }
}

async function inactivate(lesson: Lesson): Promise<void> {
  if (!confirm(`Cancelar a aula de "${className(lesson.classId)}" em ${lesson.date.slice(0, 10)}? O histórico é preservado.`)) {
    return
  }
  try {
    await api.delete(`/lessons/${lesson.id}`)
    await loadLessons()
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível cancelar a aula.'
  }
}

onMounted(() => {
  void loadLessons()
  void loadClasses()
  void loadTeachers()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Aulas</h1>
        <p class="mt-1 text-sm text-slate-500">Aulas agendadas do grupo.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Nova aula
      </button>
    </div>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Turma</th>
            <th class="px-4 py-3 font-medium">Data</th>
            <th class="px-4 py-3 font-medium">Horário</th>
            <th class="px-4 py-3 font-medium">Professor</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="lessons.length === 0">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Nenhuma aula cadastrada ainda.</td>
          </tr>
          <tr v-for="lesson in lessons" v-else :key="lesson.id" class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ className(lesson.classId) }}</td>
            <td class="px-4 py-3 text-slate-600">{{ lesson.date.slice(0, 10) }}</td>
            <td class="px-4 py-3 text-slate-600">
              <template v-if="lesson.startTime || lesson.endTime">{{ lesson.startTime || '—' }} – {{ lesson.endTime || '—' }}</template>
              <template v-else>—</template>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ teacherName(lesson.teacherUserId) }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="
                  lesson.status === 'ACTIVE'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                "
              >
                {{ STATUS_LABEL[lesson.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button type="button" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="openEditModal(lesson)">
                Editar
              </button>
              <button
                v-if="lesson.status === 'ACTIVE'"
                type="button"
                class="ml-3 text-sm font-medium text-red-600 hover:text-red-700"
                @click="inactivate(lesson)"
              >
                Cancelar aula
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal criar/editar -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">{{ form.id ? 'Editar aula' : 'Nova aula' }}</h2>

        <form class="mt-4 space-y-4" @submit.prevent="submitForm">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Turma</label>
            <select
              v-model="form.classId"
              required
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            >
              <option value="" disabled>Selecione…</option>
              <option v-for="classItem in classes" :key="classItem.id" :value="classItem.id">{{ classItem.name }}</option>
            </select>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Data</label>
              <input
                v-model="form.date"
                type="date"
                required
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Início</label>
              <input
                v-model="form.startTime"
                type="time"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Fim</label>
              <input
                v-model="form.endTime"
                type="time"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Professor</label>
            <select
              v-model="form.teacherUserId"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            >
              <option value="">—</option>
              <option v-for="membership in teachers" :key="membership.id" :value="membership.user.id">{{ membership.user.name }}</option>
            </select>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Observações</label>
            <textarea
              v-model="form.notes"
              rows="2"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            ></textarea>
          </div>

          <div v-if="form.id">
            <label class="mb-1 block text-sm font-medium text-slate-700">Status</label>
            <select
              v-model="form.status"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            >
              <option v-for="(label, value) in STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
            </select>
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
  </div>
</template>
