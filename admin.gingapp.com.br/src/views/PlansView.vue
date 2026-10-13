<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/utils/api'
import { pluralWord } from '@/utils/plural'

interface Plan {
  id: number
  name: string
  code: string
  priceCents: number
  billingPeriod: string
  maxUnits: number | null
  maxStudents: number | null
  isActive: boolean
}

interface PlanFormState {
  id: number | null
  name: string
  code: string
  price: string
  billingPeriod: string
  maxUnits: string
  maxStudents: string
}

const plans = ref<Plan[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): PlanFormState {
  return { id: null, name: '', code: '', price: '', billingPeriod: 'MONTHLY', maxUnits: '', maxStudents: '' }
}

const form = reactive<PlanFormState>(emptyForm())

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

async function loadPlans(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    plans.value = await api.get<Plan[]>('/plans')
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar os planos.'
  } finally {
    isLoading.value = false
  }
}

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  isModalOpen.value = true
}

function openEditModal(plan: Plan): void {
  Object.assign(form, {
    id: plan.id,
    name: plan.name,
    code: plan.code,
    price: (plan.priceCents / 100).toString(),
    billingPeriod: plan.billingPeriod,
    maxUnits: plan.maxUnits?.toString() ?? '',
    maxStudents: plan.maxStudents?.toString() ?? '',
  })
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
}

async function submitForm(): Promise<void> {
  formError.value = ''
  if (!form.name.trim() || !form.code.trim()) {
    formError.value = 'Informe nome e código do plano.'
    return
  }

  isSubmitting.value = true
  const payload = {
    name: form.name.trim(),
    code: form.code.trim().toUpperCase(),
    priceCents: Math.round(Number(form.price || 0) * 100),
    billingPeriod: form.billingPeriod,
    maxUnits: form.maxUnits ? Number(form.maxUnits) : form.id ? null : undefined,
    maxStudents: form.maxStudents ? Number(form.maxStudents) : form.id ? null : undefined,
  }

  try {
    if (form.id) {
      await api.patch(`/plans/${form.id}`, payload)
    } else {
      await api.post('/plans', payload)
    }
    isModalOpen.value = false
    await loadPlans()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar o plano.'
  } finally {
    isSubmitting.value = false
  }
}

async function deactivate(plan: Plan): Promise<void> {
  if (!confirm(`Desativar o plano "${plan.name}"? Assinaturas já ativas não são afetadas.`)) {
    return
  }
  try {
    await api.delete(`/plans/${plan.id}`)
    await loadPlans()
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível desativar o plano.'
  }
}

onMounted(() => {
  void loadPlans()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Planos</h1>
        <p class="mt-1 text-sm text-slate-500">Catálogo de planos oferecidos aos grupos.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Novo plano
      </button>
    </div>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Plano</th>
            <th class="px-4 py-3 font-medium">Código</th>
            <th class="px-4 py-3 font-medium">Preço</th>
            <th class="px-4 py-3 font-medium">Limites</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="plans.length === 0">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Nenhum plano cadastrado ainda.</td>
          </tr>
          <tr v-for="plan in plans" v-else :key="plan.id" class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ plan.name }}</td>
            <td class="px-4 py-3 text-slate-600">{{ plan.code }}</td>
            <td class="px-4 py-3 text-slate-600">
              {{ formatPrice(plan.priceCents) }} / {{ plan.billingPeriod === 'YEARLY' ? 'ano' : 'mês' }}
            </td>
            <td class="px-4 py-3 text-slate-600">
              {{ plan.maxStudents ?? '∞' }} {{ plan.maxStudents === null ? 'alunos' : pluralWord(plan.maxStudents, 'aluno') }} · {{ plan.maxUnits ?? '∞' }}
              {{ plan.maxUnits === null ? 'unidades' : pluralWord(plan.maxUnits, 'unidade') }}
            </td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="plan.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
              >
                {{ plan.isActive ? 'Ativo' : 'Inativo' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button type="button" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="openEditModal(plan)">
                Editar
              </button>
              <button
                v-if="plan.isActive"
                type="button"
                class="ml-3 text-sm font-medium text-red-600 hover:text-red-700"
                @click="deactivate(plan)"
              >
                Desativar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal criar/editar -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">{{ form.id ? 'Editar plano' : 'Novo plano' }}</h2>

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
              <label class="mb-1 block text-sm font-medium text-slate-700">Código</label>
              <input
                v-model="form.code"
                type="text"
                required
                :disabled="Boolean(form.id)"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Preço (R$/período)</label>
              <input
                v-model="form.price"
                type="number"
                min="0"
                step="0.01"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Periodicidade</label>
              <select
                v-model="form.billingPeriod"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              >
                <option value="MONTHLY">Mensal</option>
                <option value="YEARLY">Anual</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Máx. alunos</label>
              <input
                v-model="form.maxStudents"
                type="number"
                min="1"
                placeholder="Ilimitado"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Máx. unidades</label>
              <input
                v-model="form.maxUnits"
                type="number"
                min="1"
                placeholder="Ilimitado"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
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
