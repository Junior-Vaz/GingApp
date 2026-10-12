<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PaginationBar from '@/components/PaginationBar.vue'
import { useAuthStore } from '@/stores/auth'
import { api, errorMessage } from '@/utils/api'
import { formatDateTime } from '@/utils/format'

type RequestStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'REJECTED'

interface DeletionRequest {
  id: number
  status: RequestStatus | string
  reason: string | null
  requestedAt: string
  resolvedAt: string | null
  resolutionNote: string | null
  userId: number
  userName: string
  userEmail: string
  organizationId: number | null
  organizationName: string | null
}

interface OrganizationOption {
  id: number
  name: string
}

const PAGE_SIZE = 25
const STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluído',
  REJECTED: 'Rejeitado',
}
const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as RequestStatus[]
const STATUS_CLASS: Record<RequestStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-sky-100 text-sky-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-slate-100 text-slate-600',
}

const authStore = useAuthStore()
/** Só super admin trata o pedido (PATCH responde 403 ao resto); qualquer PLATFORM lista. */
const canHandle = computed(() => authStore.user?.userType === 'PLATFORM' && authStore.user?.isSuperAdmin === true)

const requests = ref<DeletionRequest[]>([])
const total = ref(0)
const offset = ref(0)
const isLoading = ref(false)
const error = ref('')
const notice = ref('')
const organizations = ref<OrganizationOption[]>([])
const filters = reactive({ status: '', organizationId: '', from: '', to: '' })

const target = ref<DeletionRequest | null>(null)
const form = reactive({ status: 'IN_PROGRESS' as RequestStatus, note: '' })
const isSaving = ref(false)
const formError = ref('')

function statusLabel(status: string): string {
  return STATUS_LABEL[status as RequestStatus] ?? status
}

async function load(): Promise<void> {
  isLoading.value = true
  error.value = ''
  try {
    const page = await api.getPage<DeletionRequest>('/data-deletion-requests', {
      status: filters.status,
      organizationId: filters.organizationId,
      from: filters.from,
      to: filters.to,
      limit: PAGE_SIZE,
      offset: offset.value,
    })
    requests.value = page.items
    total.value = page.total
  } catch (e) {
    error.value = errorMessage(e, 'Não foi possível carregar os pedidos.')
  } finally {
    isLoading.value = false
  }
}

function applyFilters(): void {
  offset.value = 0
  void load()
}

function clearFilters(): void {
  Object.assign(filters, { status: '', organizationId: '', from: '', to: '' })
  applyFilters()
}

function changePage(value: number): void {
  offset.value = value
  void load()
}

function openHandle(request: DeletionRequest): void {
  target.value = request
  form.status = (STATUS_OPTIONS.includes(request.status as RequestStatus) ? request.status : 'IN_PROGRESS') as RequestStatus
  form.note = request.resolutionNote ?? ''
  formError.value = ''
}

function closeHandle(): void {
  target.value = null
}

async function submitHandle(): Promise<void> {
  const request = target.value
  if (!request || isSaving.value) return
  formError.value = ''
  const note = form.note.trim()
  if (form.status === 'REJECTED' && !note) {
    formError.value = 'Informe a justificativa ao rejeitar o pedido.'
    return
  }
  isSaving.value = true
  try {
    await api.patch(`/data-deletion-requests/${request.id}`, { status: form.status, note: note || undefined })
    closeHandle()
    notice.value = `Pedido #${request.id} atualizado para "${statusLabel(form.status)}".`
    await load()
  } catch (e) {
    formError.value = errorMessage(e, 'Não foi possível atualizar o pedido.')
  } finally {
    isSaving.value = false
  }
}

onMounted(async () => {
  void load()
  try {
    organizations.value = (await api.getPage<OrganizationOption>('/organizations', { limit: 200 })).items
  } catch {
    // O filtro por grupo é opcional: sem a lista, a tela continua funcionando.
  }
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Pedidos LGPD</h1>
    <p class="mt-1 text-sm text-slate-500">
      Pedidos de exclusão/anonimização de dados feitos pelos próprios usuários (LGPD, art. 18).
    </p>
    <p class="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="manual-note">
      Marcar um pedido como <strong>Concluído</strong> apenas registra a decisão (data e nota): nada é apagado ou anonimizado
      automaticamente. A exclusão/anonimização é um processo manual, documentado em <code>docs/EASYPANEL.md</code>.
    </p>
    <p
      v-if="!canHandle"
      data-testid="readonly-note"
      class="mt-3 rounded-md border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600"
    >
      Somente super admins ativos podem tratar os pedidos. Você pode apenas consultar a lista.
    </p>

    <form
      class="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      data-testid="lgpd-filters"
      @submit.prevent="applyFilters"
    >
      <label class="text-sm font-medium text-slate-700">
        Status
        <select v-model="filters.status" data-testid="filter-status" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">Todos</option>
          <option v-for="status in STATUS_OPTIONS" :key="status" :value="status">{{ STATUS_LABEL[status] }}</option>
        </select>
      </label>
      <label class="text-sm font-medium text-slate-700">
        Grupo
        <select v-model="filters.organizationId" data-testid="filter-organization" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">Todos</option>
          <option v-for="org in organizations" :key="org.id" :value="String(org.id)">{{ org.name }}</option>
        </select>
      </label>
      <label class="text-sm font-medium text-slate-700">
        De
        <input v-model="filters.from" data-testid="filter-from" type="date" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label class="text-sm font-medium text-slate-700">
        Até
        <input v-model="filters.to" data-testid="filter-to" type="date" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <div class="flex items-end gap-2">
        <button type="submit" data-testid="filter-apply" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Filtrar</button>
        <button type="button" data-testid="filter-clear" class="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100" @click="clearFilters">Limpar</button>
      </div>
    </form>

    <p v-if="notice" role="status" class="mt-4 text-sm text-emerald-700">{{ notice }}</p>
    <p v-if="error" role="alert" class="mt-4 text-sm text-red-600">{{ error }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm" data-testid="lgpd-table">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Pedido em</th>
            <th class="px-4 py-3 font-medium">Solicitante</th>
            <th class="px-4 py-3 font-medium">Grupo</th>
            <th class="px-4 py-3 font-medium">Motivo</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium">Resolução</th>
            <th v-if="canHandle" class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td :colspan="canHandle ? 7 : 6" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="requests.length === 0">
            <td :colspan="canHandle ? 7 : 6" class="px-4 py-8 text-center text-slate-400">Nenhum pedido encontrado.</td>
          </tr>
          <tr v-for="request in requests" v-else :key="request.id" :data-testid="`lgpd-${request.id}`" class="align-top hover:bg-slate-50">
            <td class="whitespace-nowrap px-4 py-3 text-slate-600">{{ formatDateTime(request.requestedAt) }}</td>
            <td class="px-4 py-3 font-medium text-slate-900">
              {{ request.userName }}
              <span class="block text-xs font-normal text-slate-400">{{ request.userEmail }}</span>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ request.organizationName ?? '—' }}</td>
            <td class="max-w-xs break-words px-4 py-3 text-slate-600">{{ request.reason ?? '—' }}</td>
            <td class="px-4 py-3">
              <span
                data-testid="lgpd-status"
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="STATUS_CLASS[request.status as RequestStatus] ?? 'bg-slate-100 text-slate-600'"
              >
                {{ statusLabel(request.status) }}
              </span>
            </td>
            <td class="max-w-xs break-words px-4 py-3 text-slate-600">
              <template v-if="request.resolvedAt || request.resolutionNote">
                <span v-if="request.resolvedAt" class="block text-xs text-slate-400">{{ formatDateTime(request.resolvedAt) }}</span>
                {{ request.resolutionNote ?? '' }}
              </template>
              <template v-else>—</template>
            </td>
            <td v-if="canHandle" class="px-4 py-3 text-right">
              <button type="button" data-action="handle" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="openHandle(request)">
                Tratar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <PaginationBar :total="total" :offset="offset" :limit="PAGE_SIZE" :disabled="isLoading" @update:offset="changePage" />
    </div>

    <div v-if="target" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true">
        <h2 class="text-lg font-semibold text-slate-900">Tratar pedido #{{ target.id }}</h2>
        <p class="mt-1 text-sm text-slate-500">{{ target.userName }} — {{ target.userEmail }}</p>

        <form class="mt-4 space-y-4" @submit.prevent="submitHandle">
          <div>
            <label for="lgpd-new-status" class="mb-1 block text-sm font-medium text-slate-700">Status</label>
            <select id="lgpd-new-status" v-model="form.status" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option v-for="status in STATUS_OPTIONS" :key="status" :value="status">{{ STATUS_LABEL[status] }}</option>
            </select>
          </div>
          <div>
            <label for="lgpd-note" class="mb-1 block text-sm font-medium text-slate-700">
              Nota {{ form.status === 'REJECTED' ? '(obrigatória)' : '(opcional)' }}
            </label>
            <textarea id="lgpd-note" v-model="form.note" rows="3" maxlength="1000" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"></textarea>
          </div>
          <p v-if="form.status === 'DONE'" class="text-xs text-amber-700">
            Concluído só registra a decisão: lembre-se de executar a exclusão/anonimização manualmente.
          </p>

          <p v-if="formError" role="alert" class="text-sm text-red-600">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="closeHandle">Cancelar</button>
            <button type="submit" :disabled="isSaving" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              {{ isSaving ? 'Salvando…' : 'Salvar' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
