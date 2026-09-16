<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface FinancialRecord {
  id: number
  studentId: number | null
  unitId: number | null
  description: string
  amountCents: number
  type: string | null
  dueDate: string
  paidAt: string | null
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'
}

interface Student {
  id: number
  name: string
}

interface FinanceFormState {
  id: number | null
  description: string
  studentId: string
  type: string
  amountReais: string
  dueDate: string
  status: FinancialRecord['status']
  paidAt: string
}

const STATUS_LABEL: Record<FinancialRecord['status'], string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  OVERDUE: 'Vencido',
  CANCELLED: 'Cancelado',
}

const STATUS_BADGE_CLASS: Record<FinancialRecord['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  OVERDUE: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-600',
}

const records = ref<FinancialRecord[]>([])
const students = ref<Student[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): FinanceFormState {
  return {
    id: null,
    description: '',
    studentId: '',
    type: '',
    amountReais: '',
    dueDate: '',
    status: 'PENDING',
    paidAt: '',
  }
}

const form = reactive<FinanceFormState>(emptyForm())

const isPaidStatus = computed(() => form.status === 'PAID')

async function loadRecords(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    records.value = await api.get<FinancialRecord[]>('/finance')
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar os registros financeiros.'
  } finally {
    isLoading.value = false
  }
}

async function loadStudents(): Promise<void> {
  try {
    students.value = await api.get<Student[]>('/students')
  } catch {
    // Não bloqueia a tela financeira se os alunos falharem — o campo fica sem opções.
  }
}

function studentName(studentId: number | null): string {
  if (!studentId) return '—'
  return students.value.find((s) => s.id === studentId)?.name ?? '—'
}

function formatCurrency(amountCents: number): string {
  return (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  isModalOpen.value = true
}

function openEditModal(record: FinancialRecord): void {
  Object.assign(form, {
    id: record.id,
    description: record.description,
    studentId: record.studentId ? String(record.studentId) : '',
    type: record.type ?? '',
    amountReais: (record.amountCents / 100).toFixed(2),
    dueDate: record.dueDate.slice(0, 10),
    status: record.status,
    paidAt: record.paidAt ? record.paidAt.slice(0, 10) : '',
  })
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
}

async function submitForm(): Promise<void> {
  formError.value = ''
  if (!form.description.trim()) {
    formError.value = 'Informe a descrição do lançamento.'
    return
  }
  // form.amountReais vem como number do v-model em <input type="number"> (Vue 3 converte
  // automaticamente), não como string — Number() aqui é só uma normalização segura.
  const amountReais = Number(form.amountReais)
  if (!amountReais || amountReais <= 0) {
    formError.value = 'Informe um valor válido (maior que zero).'
    return
  }
  if (!form.dueDate) {
    formError.value = 'Informe a data de vencimento.'
    return
  }

  isSubmitting.value = true
  const amountCents = Math.round(amountReais * 100)

  try {
    if (form.id) {
      const payload = {
        description: form.description.trim(),
        studentId: form.studentId ? Number(form.studentId) : undefined,
        type: form.type || undefined,
        amountCents,
        dueDate: form.dueDate,
        status: form.status,
        paidAt: form.status === 'PAID' && form.paidAt ? form.paidAt : undefined,
      }
      await api.patch(`/finance/${form.id}`, payload)
    } else {
      const payload = {
        description: form.description.trim(),
        studentId: form.studentId ? Number(form.studentId) : undefined,
        type: form.type || undefined,
        amountCents,
        dueDate: form.dueDate,
      }
      await api.post('/finance', payload)
    }
    isModalOpen.value = false
    await loadRecords()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar o registro financeiro.'
  } finally {
    isSubmitting.value = false
  }
}

async function removeRecord(record: FinancialRecord): Promise<void> {
  if (!confirm(`Excluir o lançamento "${record.description}"? Esta ação não pode ser desfeita.`)) {
    return
  }
  try {
    await api.delete(`/finance/${record.id}`)
    await loadRecords()
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível excluir o registro financeiro.'
  }
}

onMounted(() => {
  void loadRecords()
  void loadStudents()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Financeiro</h1>
        <p class="mt-1 text-sm text-slate-500">Mensalidades e cobranças do grupo.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Novo lançamento
      </button>
    </div>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Descrição</th>
            <th class="px-4 py-3 font-medium">Aluno</th>
            <th class="px-4 py-3 font-medium">Valor</th>
            <th class="px-4 py-3 font-medium">Vencimento</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="records.length === 0">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Nenhum lançamento financeiro ainda.</td>
          </tr>
          <tr v-for="record in records" v-else :key="record.id" class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">
              {{ record.description }}
              <span v-if="record.type" class="ml-1 text-xs font-normal text-slate-400">({{ record.type }})</span>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ studentName(record.studentId) }}</td>
            <td class="px-4 py-3 text-slate-600">{{ formatCurrency(record.amountCents) }}</td>
            <td class="px-4 py-3 text-slate-600">{{ formatDate(record.dueDate) }}</td>
            <td class="px-4 py-3">
              <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="STATUS_BADGE_CLASS[record.status]">
                {{ STATUS_LABEL[record.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button type="button" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="openEditModal(record)">
                Editar
              </button>
              <button
                type="button"
                class="ml-3 text-sm font-medium text-red-600 hover:text-red-700"
                @click="removeRecord(record)"
              >
                Excluir
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal criar/editar -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">{{ form.id ? 'Editar lançamento' : 'Novo lançamento' }}</h2>

        <form class="mt-4 space-y-4" @submit.prevent="submitForm">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Descrição</label>
            <input
              v-model="form.description"
              type="text"
              required
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Aluno</label>
              <select
                v-model="form.studentId"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              >
                <option value="">—</option>
                <option v-for="student in students" :key="student.id" :value="student.id">{{ student.name }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Tipo</label>
              <input
                v-model="form.type"
                type="text"
                placeholder="Mensalidade"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Valor (R$)</label>
              <input
                v-model="form.amountReais"
                type="number"
                step="0.01"
                min="0.01"
                required
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Vencimento</label>
              <input
                v-model="form.dueDate"
                type="date"
                required
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
          </div>

          <div v-if="form.id" class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Status</label>
              <select
                v-model="form.status"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              >
                <option v-for="(label, value) in STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div v-if="isPaidStatus">
              <label class="mb-1 block text-sm font-medium text-slate-700">Data de pagamento</label>
              <input
                v-model="form.paidAt"
                type="date"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
              <p class="mt-1 text-xs text-slate-400">Deixe em branco para usar a data/hora atual automaticamente.</p>
            </div>
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
