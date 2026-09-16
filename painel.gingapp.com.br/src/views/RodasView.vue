<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { api, ApiError } from '@/utils/api'

interface Roda {
  id: number
  title: string
  description: string | null
  date: string
  location: string | null
  stateId: number | null
  cityId: number | null
}

interface State {
  id: number
  name: string
  uf: string
}

interface City {
  id: number
  name: string
  stateId: number
}

interface RodaFormState {
  id: number | null
  title: string
  description: string
  date: string
  location: string
  stateId: string
  cityId: string
}

const rodas = ref<Roda[]>([])
const states = ref<State[]>([])
const cities = ref<City[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): RodaFormState {
  return { id: null, title: '', description: '', date: '', location: '', stateId: '', cityId: '' }
}

const form = reactive<RodaFormState>(emptyForm())

function stateName(id: number | null): string {
  if (!id) return '—'
  return states.value.find((s) => s.id === id)?.name ?? '—'
}

async function loadRodas(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    rodas.value = await api.get<Roda[]>('/rodas')
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar as rodas.'
  } finally {
    isLoading.value = false
  }
}

async function loadStates(): Promise<void> {
  try {
    states.value = await api.get<State[]>('/rodas/reference/states')
  } catch {
    // Selects de estado/cidade ficam vazios se isso falhar — não bloqueia a tela.
  }
}

async function loadCitiesFor(stateId: string): Promise<void> {
  if (!stateId) {
    cities.value = []
    return
  }
  try {
    cities.value = await api.get<City[]>(`/rodas/reference/cities?stateId=${stateId}`)
  } catch {
    cities.value = []
  }
}

watch(
  () => form.stateId,
  (stateId) => {
    form.cityId = ''
    void loadCitiesFor(stateId)
  },
)

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  cities.value = []
  formError.value = ''
  isModalOpen.value = true
}

function openEditModal(roda: Roda): void {
  Object.assign(form, {
    id: roda.id,
    title: roda.title,
    description: roda.description ?? '',
    date: roda.date.slice(0, 16),
    location: roda.location ?? '',
    stateId: roda.stateId ? String(roda.stateId) : '',
    cityId: roda.cityId ? String(roda.cityId) : '',
  })
  if (roda.stateId) void loadCitiesFor(String(roda.stateId))
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
}

async function submitForm(): Promise<void> {
  formError.value = ''
  if (!form.title.trim() || !form.date) {
    formError.value = 'Informe título e data.'
    return
  }

  isSubmitting.value = true
  const payload = {
    title: form.title.trim(),
    description: form.description || undefined,
    date: new Date(form.date).toISOString(),
    location: form.location || undefined,
    stateId: form.stateId ? Number(form.stateId) : undefined,
    cityId: form.cityId ? Number(form.cityId) : undefined,
  }

  try {
    if (form.id) {
      await api.patch(`/rodas/${form.id}`, payload)
    } else {
      await api.post('/rodas', payload)
    }
    isModalOpen.value = false
    await loadRodas()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar a roda.'
  } finally {
    isSubmitting.value = false
  }
}

async function removeRoda(roda: Roda): Promise<void> {
  if (!confirm(`Excluir a roda "${roda.title}"? Os participantes registrados também serão removidos.`)) {
    return
  }
  try {
    await api.delete(`/rodas/${roda.id}`)
    await loadRodas()
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível excluir a roda.'
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

onMounted(() => {
  void loadRodas()
  void loadStates()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Rodas</h1>
        <p class="mt-1 text-sm text-slate-500">Rodas organizadas pelo grupo — visíveis publicamente na comunidade.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Nova roda
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
            <th class="px-4 py-3 font-medium">Estado</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="rodas.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Nenhuma roda cadastrada ainda.</td>
          </tr>
          <tr v-for="roda in rodas" v-else :key="roda.id" class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ roda.title }}</td>
            <td class="px-4 py-3 text-slate-600">{{ formatDate(roda.date) }}</td>
            <td class="px-4 py-3 text-slate-600">{{ roda.location || '—' }}</td>
            <td class="px-4 py-3 text-slate-600">{{ stateName(roda.stateId) }}</td>
            <td class="px-4 py-3 text-right">
              <button type="button" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="openEditModal(roda)">
                Editar
              </button>
              <button type="button" class="ml-3 text-sm font-medium text-red-600 hover:text-red-700" @click="removeRoda(roda)">
                Excluir
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">{{ form.id ? 'Editar roda' : 'Nova roda' }}</h2>

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

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Estado</label>
              <select
                v-model="form.stateId"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              >
                <option value="">—</option>
                <option v-for="state in states" :key="state.id" :value="state.id">{{ state.name }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Cidade</label>
              <select
                v-model="form.cityId"
                :disabled="!form.stateId"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">—</option>
                <option v-for="city in cities" :key="city.id" :value="city.id">{{ city.name }}</option>
              </select>
            </div>
          </div>

          <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="closeModal">
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
