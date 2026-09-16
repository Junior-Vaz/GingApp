<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface ClassItem {
  id: number
  unitId: number | null
  name: string
  description: string | null
  weekday: number | null
  startTime: string | null
  endTime: string | null
  status: 'ACTIVE' | 'INACTIVE'
}

interface Unit {
  id: number
  name: string
}

interface ClassFormState {
  id: number | null
  name: string
  unitId: string
  weekday: string
  startTime: string
  endTime: string
  description: string
  status: ClassItem['status']
}

const STATUS_LABEL: Record<ClassItem['status'], string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
}

const WEEKDAY_LABEL: Record<number, string> = {
  0: 'Domingo',
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta',
  6: 'Sábado',
}

const classes = ref<ClassItem[]>([])
const units = ref<Unit[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): ClassFormState {
  return { id: null, name: '', unitId: '', weekday: '', startTime: '', endTime: '', description: '', status: 'ACTIVE' }
}

const form = reactive<ClassFormState>(emptyForm())

async function loadClasses(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    classes.value = await api.get<ClassItem[]>('/classes')
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar as turmas.'
  } finally {
    isLoading.value = false
  }
}

async function loadUnits(): Promise<void> {
  try {
    units.value = await api.get<Unit[]>('/units')
  } catch {
    // Não bloqueia a tela de turmas se as unidades falharem — o campo fica sem opções.
  }
}

function unitName(unitId: number | null): string {
  if (!unitId) return '—'
  return units.value.find((u) => u.id === unitId)?.name ?? '—'
}

function weekdayLabel(weekday: number | null): string {
  if (weekday === null || weekday === undefined) return '—'
  return WEEKDAY_LABEL[weekday] ?? '—'
}

function scheduleLabel(classItem: ClassItem): string {
  if (!classItem.startTime && !classItem.endTime) return '—'
  return `${classItem.startTime ?? '—'} - ${classItem.endTime ?? '—'}`
}

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  isModalOpen.value = true
}

function openEditModal(classItem: ClassItem): void {
  Object.assign(form, {
    id: classItem.id,
    name: classItem.name,
    unitId: classItem.unitId ? String(classItem.unitId) : '',
    weekday: classItem.weekday !== null && classItem.weekday !== undefined ? String(classItem.weekday) : '',
    startTime: classItem.startTime ?? '',
    endTime: classItem.endTime ?? '',
    description: classItem.description ?? '',
    status: classItem.status,
  })
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
}

async function submitForm(): Promise<void> {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = 'Informe o nome da turma.'
    return
  }

  isSubmitting.value = true
  const payload = {
    name: form.name.trim(),
    unitId: form.unitId ? Number(form.unitId) : undefined,
    weekday: form.weekday !== '' ? Number(form.weekday) : undefined,
    startTime: form.startTime || undefined,
    endTime: form.endTime || undefined,
    description: form.description || undefined,
    status: form.status,
  }

  try {
    if (form.id) {
      await api.patch(`/classes/${form.id}`, payload)
    } else {
      await api.post('/classes', payload)
    }
    isModalOpen.value = false
    await loadClasses()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar a turma.'
  } finally {
    isSubmitting.value = false
  }
}

async function inactivate(classItem: ClassItem): Promise<void> {
  if (!confirm(`Marcar "${classItem.name}" como inativa? O histórico dela é preservado.`)) {
    return
  }
  try {
    await api.delete(`/classes/${classItem.id}`)
    await loadClasses()
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível inativar a turma.'
  }
}

onMounted(() => {
  void loadClasses()
  void loadUnits()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Turmas</h1>
        <p class="mt-1 text-sm text-slate-500">Turmas do grupo.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Nova turma
      </button>
    </div>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Nome</th>
            <th class="px-4 py-3 font-medium">Unidade</th>
            <th class="px-4 py-3 font-medium">Dia da semana</th>
            <th class="px-4 py-3 font-medium">Horário</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="classes.length === 0">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Nenhuma turma cadastrada ainda.</td>
          </tr>
          <tr v-for="classItem in classes" v-else :key="classItem.id" class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ classItem.name }}</td>
            <td class="px-4 py-3 text-slate-600">{{ unitName(classItem.unitId) }}</td>
            <td class="px-4 py-3 text-slate-600">{{ weekdayLabel(classItem.weekday) }}</td>
            <td class="px-4 py-3 text-slate-600">{{ scheduleLabel(classItem) }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="
                  classItem.status === 'ACTIVE'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                "
              >
                {{ STATUS_LABEL[classItem.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button type="button" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="openEditModal(classItem)">
                Editar
              </button>
              <button
                v-if="classItem.status === 'ACTIVE'"
                type="button"
                class="ml-3 text-sm font-medium text-red-600 hover:text-red-700"
                @click="inactivate(classItem)"
              >
                Inativar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal criar/editar -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">{{ form.id ? 'Editar turma' : 'Nova turma' }}</h2>

        <form class="mt-4 space-y-4" @submit.prevent="submitForm">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Nome</label>
            <input
              v-model="form.name"
              type="text"
              required
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
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
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Dia da semana</label>
              <select
                v-model="form.weekday"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              >
                <option value="">—</option>
                <option v-for="(label, value) in WEEKDAY_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
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
            <label class="mb-1 block text-sm font-medium text-slate-700">Descrição</label>
            <textarea
              v-model="form.description"
              rows="2"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
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
