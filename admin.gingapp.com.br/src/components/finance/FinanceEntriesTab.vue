<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import MoneyField from '@/components/finance/MoneyField.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import FieldShell from '@/components/sponsors/FieldShell.vue'
import { ApiError, errorMessage } from '@/utils/api'
import {
  ALL_CATEGORIES,
  CATEGORIES_BY_TYPE,
  emptyEntryForm,
  entryPayload,
  entryServerErrors,
  entryToForm,
  FINANCE_LIMITS,
  financeErrorText,
  formatCents,
  formatDay,
  isCategoryOfType,
  isMonthKey,
  LEDGER_TYPES,
  ledgerTypeLabel,
  LOCKED_HINT,
  monthLabel,
  monthOfDay,
  validateEntryForm,
  type EntryFieldErrors,
  type EntryFormState,
  type LedgerEntry,
  type LedgerType,
} from '@/utils/finance'
import { financeApi } from '@/utils/financeApi'
import { saveBlob, spDay } from '@/utils/sponsors'

const props = defineProps<{ canWrite: boolean; initialMonth?: string }>()

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300
const FORM_FIELDS = ['type', 'category', 'amount', 'occurredOn', 'description'] as const

const entries = ref<LedgerEntry[]>([])
const total = ref(0)
const offset = ref(0)
const isLoading = ref(false)
const listError = ref('')
const notice = ref('')

// filtros
const filterMonth = ref(props.initialMonth && isMonthKey(props.initialMonth) ? props.initialMonth : '')
const filterType = ref<LedgerType | ''>('')
const filterCategory = ref('')
const search = ref('')

// formulário
const formOpen = ref(false)
const editing = ref<LedgerEntry | null>(null)
const form = reactive<EntryFormState>(emptyEntryForm(''))
const fieldErrors = reactive<EntryFieldErrors>({})
const generalErrors = ref<string[]>([])
const isSaving = ref(false)
const typeSelect = ref<HTMLSelectElement | null>(null)
let openerEl: HTMLElement | null = null

// exclusão
const deleteTarget = ref<LedgerEntry | null>(null)
const isDeleting = ref(false)
const deleteError = ref('')

// CSV
const isExporting = ref(false)
const csvError = ref('')

let requestSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400 aria-[invalid=true]:border-red-600'

const filterCategories = computed(() => (filterType.value ? CATEGORIES_BY_TYPE[filterType.value] : ALL_CATEGORIES))
const formCategories = computed(() => CATEGORIES_BY_TYPE[form.type] ?? [])

async function load(): Promise<void> {
  const seq = ++requestSeq
  isLoading.value = true
  listError.value = ''
  try {
    const page = await financeApi.listEntries({
      month: filterMonth.value,
      type: filterType.value,
      category: filterCategory.value,
      q: search.value.trim(),
      limit: PAGE_SIZE,
      offset: offset.value,
    })
    if (seq !== requestSeq) return
    entries.value = page.items
    total.value = page.total
  } catch (e) {
    if (seq !== requestSeq) return
    listError.value = errorMessage(e, 'Não foi possível carregar os lançamentos.')
  } finally {
    if (seq === requestSeq) isLoading.value = false
  }
}

function reloadFromStart(): void {
  offset.value = 0
  void load()
}

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(reloadFromStart, SEARCH_DEBOUNCE_MS)
})
watch([filterMonth, filterType, filterCategory], reloadFromStart)
// escolher um tipo que não contém a categoria filtrada limpa a categoria (senão a lista fica vazia sem explicação)
watch(filterType, (type) => {
  if (type && filterCategory.value && !isCategoryOfType(type, filterCategory.value)) filterCategory.value = ''
})
watch(
  () => props.initialMonth,
  (month) => {
    if (month && isMonthKey(month)) filterMonth.value = month
  },
)

function changeOffset(value: number): void {
  offset.value = value
  void load()
}

function clearErrors(): void {
  for (const key of FORM_FIELDS) delete fieldErrors[key]
  generalErrors.value = []
}

const todayDay = (): string => spDay(new Date())
const currentMonthKey = (): string => monthOfDay(todayDay())

async function openForm(entry: LedgerEntry | null): Promise<void> {
  if (!props.canWrite) return
  openerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null
  editing.value = entry
  Object.assign(form, entry ? entryToForm(entry) : emptyEntryForm(todayDay()))
  clearErrors()
  formOpen.value = true
  await nextTick()
  typeSelect.value?.focus()
}

function closeForm(): void {
  if (isSaving.value) return
  formOpen.value = false
  editing.value = null
  openerEl?.focus?.()
  openerEl = null
}

function onTypeChange(): void {
  if (form.category && !isCategoryOfType(form.type, form.category)) form.category = ''
}

async function submitForm(): Promise<void> {
  if (isSaving.value || !props.canWrite) return
  clearErrors()
  const problems = validateEntryForm(form, currentMonthKey())
  if (Object.keys(problems).length > 0) {
    Object.assign(fieldErrors, problems)
    return
  }
  isSaving.value = true
  try {
    const body = entryPayload(form)
    const wasEditing = editing.value !== null
    if (editing.value) await financeApi.updateEntry(editing.value.id, body)
    else await financeApi.createEntry(body)
    formOpen.value = false
    editing.value = null
    notice.value = wasEditing ? 'Lançamento atualizado.' : 'Lançamento criado.'
    await load()
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const server = entryServerErrors(e)
      Object.assign(fieldErrors, server.fields)
      generalErrors.value = server.general
    } else {
      generalErrors.value = [financeErrorText(e, 'entry')]
      // mês publicado/lançamento sumido por outra pessoa: a lista precisa refletir a realidade
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) void load()
    }
  } finally {
    isSaving.value = false
  }
}

function openDelete(entry: LedgerEntry): void {
  deleteTarget.value = entry
  deleteError.value = ''
}

function closeDelete(): void {
  if (isDeleting.value) return
  deleteTarget.value = null
}

async function confirmDelete(): Promise<void> {
  const entry = deleteTarget.value
  if (!entry || isDeleting.value) return
  isDeleting.value = true
  deleteError.value = ''
  try {
    await financeApi.deleteEntry(entry.id)
    deleteTarget.value = null
    notice.value = 'Lançamento excluído.'
    if (entries.value.length === 1 && offset.value > 0) offset.value = Math.max(0, offset.value - PAGE_SIZE)
    await load()
  } catch (e) {
    deleteError.value = financeErrorText(e, 'delete')
    if (e instanceof ApiError && (e.status === 409 || e.status === 404)) void load()
  } finally {
    isDeleting.value = false
  }
}

async function downloadCsv(): Promise<void> {
  if (isExporting.value) return
  isExporting.value = true
  csvError.value = ''
  try {
    const blob = await financeApi.getEntriesCsv(filterMonth.value || undefined)
    saveBlob(blob, `lancamentos-${filterMonth.value || 'todos'}.csv`)
  } catch (e) {
    csvError.value = errorMessage(e, 'Não foi possível baixar o CSV.')
  } finally {
    isExporting.value = false
  }
}

function onFormKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    closeForm()
  }
}

const hasFilters = computed(() => !!(filterMonth.value || filterType.value || filterCategory.value || search.value.trim()))

onMounted(() => void load())
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <section aria-labelledby="entries-title" data-testid="entries-tab">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="entries-title" class="text-lg font-semibold text-slate-900">Lançamentos</h2>
        <p class="mt-1 text-sm text-slate-600">Receitas e despesas da plataforma. O texto de cada lançamento é só da equipe: a página pública mostra apenas totais por categoria.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-testid="export-csv" :disabled="isExporting" class="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60" @click="downloadCsv">
          {{ isExporting ? 'Gerando…' : 'Baixar CSV' }}
        </button>
        <button v-if="canWrite" type="button" data-testid="new-entry" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900" @click="openForm(null)">
          + Novo lançamento
        </button>
      </div>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label for="f-month" class="mb-1 block text-sm font-medium text-slate-800">Mês</label>
        <input id="f-month" v-model="filterMonth" type="month" data-testid="filter-month" :class="inputClass" />
      </div>
      <div>
        <label for="f-type" class="mb-1 block text-sm font-medium text-slate-800">Tipo</label>
        <select id="f-type" v-model="filterType" data-testid="filter-type" :class="inputClass">
          <option value="">Todos</option>
          <option v-for="t in LEDGER_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </div>
      <div>
        <label for="f-category" class="mb-1 block text-sm font-medium text-slate-800">Categoria</label>
        <select id="f-category" v-model="filterCategory" data-testid="filter-category" :class="inputClass">
          <option value="">Todas</option>
          <option v-for="c in filterCategories" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </div>
      <div>
        <label for="f-q" class="mb-1 block text-sm font-medium text-slate-800">Buscar na descrição</label>
        <input id="f-q" v-model="search" type="search" data-testid="filter-q" :class="inputClass" />
      </div>
    </div>

    <p v-if="notice" role="status" data-testid="notice" class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{{ notice }}</p>
    <p v-if="csvError" role="alert" data-testid="csv-error" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{{ csvError }}</p>
    <p v-if="listError" role="alert" data-testid="list-error" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      {{ listError }}
      <button type="button" class="ml-2 font-medium underline" data-testid="retry" @click="load">Tentar de novo</button>
    </p>

    <div class="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-left text-sm" data-testid="entries-table">
          <caption class="sr-only">Lançamentos do livro-caixa</caption>
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">Data</th>
              <th scope="col" class="px-4 py-3 font-medium">Tipo e categoria</th>
              <th scope="col" class="px-4 py-3 font-medium">Descrição (privada)</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Valor</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-if="isLoading">
              <td colspan="5" class="px-4 py-8 text-center text-slate-600" data-testid="loading">Carregando…</td>
            </tr>
            <tr v-else-if="entries.length === 0 && !listError">
              <td colspan="5" class="px-4 py-8 text-center text-slate-600" data-testid="empty">
                {{ hasFilters ? 'Nenhum lançamento encontrado para esses filtros.' : 'Nenhum lançamento ainda. Registre a primeira receita ou despesa.' }}
              </td>
            </tr>
            <tr v-for="entry in isLoading ? [] : entries" :key="entry.id" :data-testid="`entry-${entry.id}`" class="align-top hover:bg-slate-50">
              <td class="whitespace-nowrap px-4 py-3 text-slate-800">
                {{ formatDay(entry.occurredOn) }}
                <span class="block text-xs text-slate-600">{{ monthLabel(entry.month) }}</span>
              </td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1"
                  :class="entry.type === 'RECEITA' ? 'bg-emerald-100 text-emerald-900 ring-emerald-300' : 'bg-amber-100 text-amber-900 ring-amber-300'"
                >{{ ledgerTypeLabel(entry.type) }}</span>
                <span class="mt-1 block text-slate-800">{{ entry.categoryLabel }}</span>
              </td>
              <td class="max-w-sm px-4 py-3 text-slate-700"><span class="line-clamp-3 break-words" data-testid="entry-description">{{ entry.description }}</span></td>
              <td class="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums" :class="entry.type === 'RECEITA' ? 'text-emerald-800' : 'text-slate-900'">
                {{ entry.type === 'RECEITA' ? '+' : '−' }} {{ formatCents(entry.amountCents) }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                <span v-if="entry.locked" class="inline-flex items-center gap-1 text-xs font-medium text-slate-700" :title="LOCKED_HINT" data-testid="locked" :data-locked-entry="entry.id">
                  <svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4" fill="currentColor"><path d="M8 1a3 3 0 0 0-3 3v2H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3Zm-1.5 3a1.5 1.5 0 0 1 3 0v2h-3V4Z" /></svg>
                  Travado
                  <span class="sr-only">. {{ LOCKED_HINT }}</span>
                </span>
                <template v-else-if="canWrite">
                  <button type="button" data-action="edit" class="rounded px-2 py-1 text-sm font-medium text-slate-800 underline hover:bg-slate-100" :aria-label="`Editar lançamento de ${formatDay(entry.occurredOn)}`" @click="openForm(entry)">Editar</button>
                  <button type="button" data-action="delete" class="ml-1 rounded px-2 py-1 text-sm font-medium text-red-700 underline hover:bg-red-50" :aria-label="`Excluir lançamento de ${formatDay(entry.occurredOn)}`" @click="openDelete(entry)">Excluir</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar :total="total" :offset="offset" :limit="PAGE_SIZE" :disabled="isLoading" @update:offset="changeOffset" />
    </div>
    <p v-if="entries.some((e) => e.locked)" class="mt-2 text-xs text-slate-600" data-testid="locked-hint">{{ LOCKED_HINT }}</p>

    <!-- Formulário criar/editar -->
    <div v-if="formOpen" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-8" @keydown="onFormKeydown">
      <div role="dialog" aria-modal="true" aria-labelledby="entry-form-title" class="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl" data-testid="entry-form">
        <h2 id="entry-form-title" class="text-lg font-semibold text-slate-900">{{ editing ? 'Editar lançamento' : 'Novo lançamento' }}</h2>

        <form class="mt-4 space-y-4" novalidate @submit.prevent="submitForm">
          <div v-if="generalErrors.length" role="alert" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="form-errors">
            <p v-for="message in generalErrors" :key="message">{{ message }}</p>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldShell id="en-type" label="Tipo" required :error="fieldErrors.type" v-slot="{ describedby, invalid }">
              <select id="en-type" ref="typeSelect" v-model="form.type" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-type" @change="onTypeChange">
                <option v-for="t in LEDGER_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </FieldShell>
            <FieldShell id="en-category" label="Categoria" required :error="fieldErrors.category" v-slot="{ describedby, invalid }">
              <select id="en-category" v-model="form.category" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-category">
                <option value="">Escolha…</option>
                <option v-for="c in formCategories" :key="c.value" :value="c.value">{{ c.label }}</option>
              </select>
            </FieldShell>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MoneyField id="en-amount" v-model="form.amount" label="Valor" required :error="fieldErrors.amount" hint="Em reais, ex.: 1.234,56" testid="field-amount" />
            <FieldShell id="en-date" label="Data" required :error="fieldErrors.occurredOn" v-slot="{ describedby, invalid }">
              <input id="en-date" v-model="form.occurredOn" type="date" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-occurredOn" />
            </FieldShell>
          </div>

          <FieldShell
            id="en-description"
            label="Descrição (privada)"
            required
            hint="Só a equipe vê. Pode citar fornecedor; não aparece na página pública."
            :error="fieldErrors.description"
            :counter="`${form.description.trim().length}/${FINANCE_LIMITS.descriptionMax}`"
            :counter-over="form.description.trim().length > FINANCE_LIMITS.descriptionMax"
            v-slot="{ describedby, invalid }"
          >
            <textarea id="en-description" v-model="form.description" rows="3" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-description"></textarea>
          </FieldShell>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100" :disabled="isSaving" @click="closeForm">Cancelar</button>
            <button type="submit" data-testid="entry-save" :disabled="isSaving" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              {{ isSaving ? 'Salvando…' : 'Salvar' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Excluir -->
    <ConfirmDialog :open="deleteTarget !== null" title="Excluir lançamento?" confirm-label="Excluir" danger :busy="isDeleting" :error="deleteError" @cancel="closeDelete" @confirm="confirmDelete">
      <p v-if="deleteTarget">
        Você vai excluir o lançamento de <strong>{{ formatCents(deleteTarget.amountCents) }}</strong> ({{ deleteTarget.categoryLabel }}, {{ formatDay(deleteTarget.occurredOn) }}). Essa ação não pode ser desfeita.
      </p>
    </ConfirmDialog>
  </section>
</template>
