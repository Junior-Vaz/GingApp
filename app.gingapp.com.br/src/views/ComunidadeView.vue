<script setup lang="ts">
// Calendário da capoeira (projeto.txt §42) — agrega Rodas + Eventos públicos de TODAS as
// organizações via GET /calendar (público, sem autenticação por trás — usamos o token do
// app.gingapp.com.br só porque já está logado, não porque o endpoint exige). Antes desta
// versão, a tela só combinava GET /rodas + GET /events (que só trazia os eventos do próprio
// grupo) — não era um calendário nacional de verdade.
import { computed, onMounted, ref, watch } from 'vue'
import { api, ApiError } from '../utils/api'

type Scope = 'today' | 'week' | 'month' | ''

interface State {
  id: number
  name: string
}

interface City {
  id: number
  name: string
}

interface CalendarItem {
  id: number
  source: 'RODA' | 'EVENTO'
  type: string
  title: string
  description: string | null
  date: string
  location: string | null
  state: { id: number; name: string; uf: string } | null
  city: { id: number; name: string } | null
}

const TYPE_LABEL: Record<string, string> = {
  RODA: 'Roda',
  BATIZADO: 'Batizado',
  WORKSHOP: 'Workshop',
  CAMPEONATO: 'Campeonato',
  FESTIVAL: 'Festival',
  ENCONTRO: 'Encontro',
  FORMATURA: 'Formatura',
  VIAGEM: 'Viagem',
  AULA_ESPECIAL: 'Aula especial',
  OUTRO: 'Outro',
}

const TYPE_ICON: Record<string, string> = {
  RODA: '🥁',
  BATIZADO: '🎓',
  WORKSHOP: '🎓',
  CAMPEONATO: '🏆',
  FESTIVAL: '🎉',
  ENCONTRO: '🤝',
  FORMATURA: '🎓',
  VIAGEM: '✈️',
  AULA_ESPECIAL: '🥋',
  OUTRO: '📅',
}

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: '', label: 'Tudo' },
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
]

const items = ref<CalendarItem[]>([])
const states = ref<State[]>([])
const cities = ref<City[]>([])
const isLoading = ref(true)
const loadError = ref('')

const scope = ref<Scope>('')
const stateId = ref('')
const cityId = ref('')
const typeFilter = ref('')

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
}

const typeOptions = computed(() => Object.entries(TYPE_LABEL))

async function loadStates(): Promise<void> {
  try {
    states.value = await api.get<State[]>('/rodas/reference/states')
  } catch {
    // Filtro de estado fica vazio se isso falhar — não bloqueia o calendário.
  }
}

async function loadCitiesFor(id: string): Promise<void> {
  if (!id) {
    cities.value = []
    return
  }
  try {
    cities.value = await api.get<City[]>(`/rodas/reference/cities?stateId=${id}`)
  } catch {
    cities.value = []
  }
}

watch(stateId, (value) => {
  cityId.value = ''
  void loadCitiesFor(value)
})

async function loadCalendar(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams()
    if (scope.value) params.set('scope', scope.value)
    if (stateId.value) params.set('stateId', stateId.value)
    if (cityId.value) params.set('cityId', cityId.value)
    if (typeFilter.value) params.set('type', typeFilter.value)

    const query = params.toString()
    items.value = await api.get<CalendarItem[]>(`/calendar${query ? `?${query}` : ''}`)
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar o calendário.'
  } finally {
    isLoading.value = false
  }
}

watch([scope, stateId, cityId, typeFilter], () => {
  void loadCalendar()
})

onMounted(() => {
  void loadCalendar()
  void loadStates()
})
</script>

<template>
  <div class="flex flex-col gap-5 pb-6 pt-6">
    <header class="px-5">
      <h1 class="text-xl font-semibold text-text">Calendário</h1>
      <p class="text-sm text-text-muted">Rodas e eventos da capoeira, no Brasil todo</p>
    </header>

    <div class="flex gap-2 overflow-x-auto px-5 scrollbar-none">
      <button
        v-for="option in SCOPE_OPTIONS"
        :key="option.value"
        type="button"
        class="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors"
        :class="scope === option.value ? 'bg-accent text-white' : 'bg-surface text-text-muted'"
        @click="scope = option.value"
      >
        {{ option.label }}
      </button>
    </div>

    <div class="grid grid-cols-3 gap-2 px-5">
      <select
        v-model="typeFilter"
        class="rounded-card bg-surface px-2 py-2 text-xs text-text outline-none"
      >
        <option value="">Todos os tipos</option>
        <option v-for="[value, label] in typeOptions" :key="value" :value="value">{{ label }}</option>
      </select>
      <select v-model="stateId" class="rounded-card bg-surface px-2 py-2 text-xs text-text outline-none">
        <option value="">Estado</option>
        <option v-for="state in states" :key="state.id" :value="state.id">{{ state.name }}</option>
      </select>
      <select
        v-model="cityId"
        :disabled="!stateId"
        class="rounded-card bg-surface px-2 py-2 text-xs text-text outline-none disabled:opacity-50"
      >
        <option value="">Cidade</option>
        <option v-for="city in cities" :key="city.id" :value="city.id">{{ city.name }}</option>
      </select>
    </div>

    <p v-if="loadError" class="mx-5 rounded-card bg-danger/15 px-4 py-3 text-sm text-danger">
      {{ loadError }}
    </p>

    <p v-else-if="isLoading" class="px-5 text-center text-sm text-text-faint">Carregando…</p>

    <p v-else-if="items.length === 0" class="mx-5 rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
      Nada encontrado com esses filtros.
    </p>

    <section v-else class="flex flex-col gap-3 px-5">
      <div
        v-for="item in items"
        :key="`${item.source}-${item.id}`"
        class="flex items-center gap-3 rounded-card-lg bg-surface p-4"
      >
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-accent-soft text-xl">
          {{ TYPE_ICON[item.type] ?? '📅' }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-text">{{ item.title }}</p>
          <p class="text-xs text-text-muted">
            {{ formatDate(item.date) }}<span v-if="item.location"> · {{ item.location }}</span>
          </p>
          <p v-if="item.city || item.state" class="text-xs text-text-faint">
            {{ [item.city?.name, item.state?.uf].filter(Boolean).join(' - ') }}
          </p>
        </div>
        <span class="shrink-0 rounded-full bg-bg-elevated px-2 py-0.5 text-[10px] font-medium text-text-muted">
          {{ TYPE_LABEL[item.type] ?? item.type }}
        </span>
      </div>
    </section>
  </div>
</template>
