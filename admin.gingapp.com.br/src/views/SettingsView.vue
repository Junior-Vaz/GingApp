<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import PaginationBar from '@/components/PaginationBar.vue'
import { api, errorMessage } from '@/utils/api'
import { formatDateTime } from '@/utils/format'

interface PlatformSetting {
  id: number
  key: string
  /** null quando isSecret = true: o backend nunca devolve o valor de um segredo. */
  value: unknown
  isSecret: boolean
  hasValue: boolean
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

interface SettingFormState {
  key: string
  valueText: string
  isSecret: boolean
}

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300
const KEY_PATTERN = /^[a-z0-9_.-]{1,100}$/
const MAX_VALUE_BYTES = 10 * 1024

const settings = ref<PlatformSetting[]>([])
const total = ref(0)
const offset = ref(0)
const search = ref('')
const isLoading = ref(false)
const listError = ref('')
const notice = ref('')

const isModalOpen = ref(false)
const editingKey = ref<string | null>(null)
const editingWasSecret = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): SettingFormState {
  return { key: '', valueText: '', isSecret: false }
}

const form = reactive<SettingFormState>(emptyForm())

let requestSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

/** Texto curto do valor para a tabela (JSON compacto, truncado). Nunca chamado para segredos. */
function previewValue(value: unknown): string {
  const text = JSON.stringify(value) ?? ''
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

async function load(): Promise<void> {
  const seq = ++requestSeq
  isLoading.value = true
  listError.value = ''
  try {
    const page = await api.getPage<PlatformSetting>('/platform-settings', {
      q: search.value.trim(),
      limit: PAGE_SIZE,
      offset: offset.value,
    })
    if (seq !== requestSeq) return // resposta antiga: outra busca já foi disparada
    settings.value = page.items
    total.value = page.total
  } catch (error) {
    if (seq !== requestSeq) return
    listError.value = errorMessage(error, 'Não foi possível carregar as configurações.')
  } finally {
    if (seq === requestSeq) isLoading.value = false
  }
}

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    offset.value = 0
    void load()
  }, SEARCH_DEBOUNCE_MS)
})

function changeOffset(value: number): void {
  offset.value = value
  void load()
}

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  editingKey.value = null
  editingWasSecret.value = false
  formError.value = ''
  isModalOpen.value = true
}

function openEditModal(setting: PlatformSetting): void {
  editingKey.value = setting.key
  editingWasSecret.value = setting.isSecret
  form.key = setting.key
  form.isSecret = setting.isSecret
  // Segredo: o valor atual não existe no cliente; o usuário precisa digitar um novo.
  form.valueText = setting.isSecret ? '' : JSON.stringify(setting.value, null, 2)
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
  // Não deixa um valor (possivelmente segredo) digitado na memória do formulário.
  Object.assign(form, emptyForm())
}

/** Valida o JSON digitado; devolve o valor parseado ou lança Error com a mensagem para o usuário. */
function parseValue(text: string): unknown {
  if (!text.trim()) {
    throw new Error('Informe o valor (um JSON válido).')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(
      'O valor não é um JSON válido. Texto precisa estar entre aspas ("exemplo"); também são aceitos números, true/false, objetos {…} e listas […].',
    )
  }
  if (parsed === null) {
    throw new Error('O valor não pode ser null.')
  }
  if (new TextEncoder().encode(JSON.stringify(parsed)).length > MAX_VALUE_BYTES) {
    throw new Error('O valor excede o limite de 10 KB (JSON serializado).')
  }
  return parsed
}

async function submitForm(): Promise<void> {
  formError.value = ''
  const isEditing = editingKey.value !== null
  const key = isEditing ? (editingKey.value as string) : form.key.trim()

  if (!KEY_PATTERN.test(key)) {
    formError.value = 'Chave inválida: use de 1 a 100 caracteres entre a-z, 0-9, "_", "." e "-".'
    return
  }

  let value: unknown
  try {
    value = parseValue(form.valueText)
  } catch (error) {
    formError.value = (error as Error).message
    return
  }

  isSubmitting.value = true
  try {
    await api.put(`/platform-settings/${encodeURIComponent(key)}`, { value, isSecret: form.isSecret })
    closeModal()
    notice.value = isEditing ? `Configuração "${key}" atualizada.` : `Configuração "${key}" salva.`
    await load()
  } catch (error) {
    formError.value = errorMessage(error, 'Não foi possível salvar a configuração.')
  } finally {
    isSubmitting.value = false
  }
}

async function remove(setting: PlatformSetting): Promise<void> {
  if (!confirm(`Excluir a configuração "${setting.key}"? Esta ação não pode ser desfeita.`)) {
    return
  }
  listError.value = ''
  try {
    await api.delete(`/platform-settings/${encodeURIComponent(setting.key)}`)
    notice.value = `Configuração "${setting.key}" excluída.`
    // Se era o único item da última página, volta uma página.
    if (settings.value.length === 1 && offset.value > 0) {
      offset.value = Math.max(0, offset.value - PAGE_SIZE)
    }
    await load()
  } catch (error) {
    listError.value = errorMessage(error, 'Não foi possível excluir a configuração.')
  }
}

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Configurações</h1>
        <p class="mt-1 text-sm text-slate-500">Configurações globais da plataforma.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Nova configuração
      </button>
    </div>

    <p
      role="note"
      data-testid="settings-warning"
      class="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      Estas configurações são armazenadas, mas ainda não são lidas por nenhum recurso do sistema.
    </p>

    <div class="mt-4">
      <input
        v-model="search"
        type="search"
        placeholder="Buscar por chave…"
        aria-label="Buscar por chave"
        class="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
      />
    </div>

    <p v-if="notice" role="status" class="mt-4 text-sm text-emerald-700">{{ notice }}</p>
    <p v-if="listError" role="alert" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Chave</th>
            <th class="px-4 py-3 font-medium">Valor</th>
            <th class="px-4 py-3 font-medium">Atualizado em</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading && settings.length === 0">
            <td colspan="4" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="settings.length === 0">
            <td colspan="4" class="px-4 py-8 text-center text-slate-400">
              {{ search.trim() ? 'Nenhuma configuração encontrada para a busca.' : 'Nenhuma configuração cadastrada ainda.' }}
            </td>
          </tr>
          <tr v-for="setting in settings" v-else :key="setting.id" class="hover:bg-slate-50" data-testid="setting-row">
            <td class="px-4 py-3 font-mono text-xs font-medium text-slate-900">{{ setting.key }}</td>
            <td class="px-4 py-3 text-slate-600">
              <template v-if="setting.isSecret">
                <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">segredo</span>
                <span class="ml-2 text-slate-400">••••••••</span>
              </template>
              <code v-else class="break-all text-xs">{{ previewValue(setting.value) }}</code>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ formatDateTime(setting.updatedAt) }}</td>
            <td class="px-4 py-3 text-right">
              <button
                type="button"
                class="mr-3 text-sm font-medium text-slate-600 hover:text-slate-900"
                @click="openEditModal(setting)"
              >
                Editar
              </button>
              <button
                type="button"
                class="text-sm font-medium text-red-600 hover:text-red-700"
                @click="remove(setting)"
              >
                Excluir
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <PaginationBar :total="total" :offset="offset" :limit="PAGE_SIZE" :disabled="isLoading" @update:offset="changeOffset" />
    </div>

    <!-- Modal criar/editar -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true">
        <h2 class="text-lg font-semibold text-slate-900">
          {{ editingKey ? 'Editar configuração' : 'Nova configuração' }}
        </h2>

        <form class="mt-4 space-y-4" @submit.prevent="submitForm">
          <div>
            <label for="setting-key" class="mb-1 block text-sm font-medium text-slate-700">Chave</label>
            <input
              id="setting-key"
              v-model="form.key"
              type="text"
              :disabled="editingKey !== null"
              maxlength="100"
              placeholder="ex.: billing.trial_days"
              class="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 disabled:bg-slate-100 disabled:text-slate-500"
            />
            <p class="mt-1 text-xs text-slate-400">Apenas a-z, 0-9, "_", "." e "-" (até 100 caracteres).</p>
          </div>

          <div>
            <label for="setting-value" class="mb-1 block text-sm font-medium text-slate-700">Valor (JSON)</label>
            <textarea
              id="setting-value"
              v-model="form.valueText"
              rows="6"
              spellcheck="false"
              :placeholder="
                editingWasSecret
                  ? 'O valor atual de um segredo não é exibido. Digite um novo valor para substituí-lo.'
                  : '{ &quot;exemplo&quot;: 1 }'
              "
              class="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
            <p class="mt-1 text-xs text-slate-400">
              Qualquer JSON, exceto null, até 10 KB. Texto deve ir entre aspas (ex.: "abc").
            </p>
          </div>

          <div>
            <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input v-model="form.isSecret" type="checkbox" class="rounded border-slate-300" />
              Segredo
            </label>
            <p class="mt-1 text-xs text-slate-400">
              Um segredo é gravado, mas nunca mais é exibido (nem aqui). Para alterá-lo, informe um valor novo.
            </p>
          </div>

          <p v-if="formError" role="alert" class="text-sm text-red-600">{{ formError }}</p>

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
