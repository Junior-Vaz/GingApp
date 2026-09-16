<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface Student {
  id: number
  unitId: number | null
  name: string
  birthDate: string | null
  document: string | null
  phone: string | null
  email: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'FORMER'
  joinedAt: string | null
}

interface Unit {
  id: number
  name: string
}

interface StudentFormState {
  id: number | null
  name: string
  unitId: string
  birthDate: string
  document: string
  phone: string
  email: string
  status: Student['status']
}

const STATUS_LABEL: Record<Student['status'], string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  SUSPENDED: 'Suspenso',
  FORMER: 'Ex-aluno',
}

const students = ref<Student[]>([])
const units = ref<Unit[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): StudentFormState {
  return { id: null, name: '', unitId: '', birthDate: '', document: '', phone: '', email: '', status: 'ACTIVE' }
}

const form = reactive<StudentFormState>(emptyForm())

async function loadStudents(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    students.value = await api.get<Student[]>('/students')
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar os alunos.'
  } finally {
    isLoading.value = false
  }
}

async function loadUnits(): Promise<void> {
  try {
    units.value = await api.get<Unit[]>('/units')
  } catch {
    // Não bloqueia a tela de alunos se as unidades falharem — o campo fica sem opções.
  }
}

function unitName(unitId: number | null): string {
  if (!unitId) return '—'
  return units.value.find((u) => u.id === unitId)?.name ?? '—'
}

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  isModalOpen.value = true
}

function openEditModal(student: Student): void {
  Object.assign(form, {
    id: student.id,
    name: student.name,
    unitId: student.unitId ? String(student.unitId) : '',
    birthDate: student.birthDate ? student.birthDate.slice(0, 10) : '',
    document: student.document ?? '',
    phone: student.phone ?? '',
    email: student.email ?? '',
    status: student.status,
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
    formError.value = 'Informe o nome do aluno.'
    return
  }

  isSubmitting.value = true
  const payload = {
    name: form.name.trim(),
    unitId: form.unitId ? Number(form.unitId) : undefined,
    birthDate: form.birthDate || undefined,
    document: form.document || undefined,
    phone: form.phone || undefined,
    email: form.email || undefined,
    status: form.status,
  }

  try {
    if (form.id) {
      await api.patch(`/students/${form.id}`, payload)
    } else {
      await api.post('/students', payload)
    }
    isModalOpen.value = false
    await loadStudents()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar o aluno.'
  } finally {
    isSubmitting.value = false
  }
}

async function inactivate(student: Student): Promise<void> {
  if (!confirm(`Marcar "${student.name}" como inativo? O histórico dele é preservado.`)) {
    return
  }
  try {
    await api.delete(`/students/${student.id}`)
    await loadStudents()
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível inativar o aluno.'
  }
}

onMounted(() => {
  void loadStudents()
  void loadUnits()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Alunos</h1>
        <p class="mt-1 text-sm text-slate-500">Alunos matriculados no grupo.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Novo aluno
      </button>
    </div>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Nome</th>
            <th class="px-4 py-3 font-medium">Unidade</th>
            <th class="px-4 py-3 font-medium">Contato</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="students.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Nenhum aluno cadastrado ainda.</td>
          </tr>
          <tr v-for="student in students" v-else :key="student.id" class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ student.name }}</td>
            <td class="px-4 py-3 text-slate-600">{{ unitName(student.unitId) }}</td>
            <td class="px-4 py-3 text-slate-600">{{ student.phone || student.email || '—' }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="
                  student.status === 'ACTIVE'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                "
              >
                {{ STATUS_LABEL[student.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button type="button" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="openEditModal(student)">
                Editar
              </button>
              <button
                v-if="student.status === 'ACTIVE'"
                type="button"
                class="ml-3 text-sm font-medium text-red-600 hover:text-red-700"
                @click="inactivate(student)"
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
        <h2 class="text-lg font-semibold text-slate-900">{{ form.id ? 'Editar aluno' : 'Novo aluno' }}</h2>

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
              <label class="mb-1 block text-sm font-medium text-slate-700">Nascimento</label>
              <input
                v-model="form.birthDate"
                type="date"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Telefone</label>
              <input
                v-model="form.phone"
                type="text"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
              <input
                v-model="form.email"
                type="email"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
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
