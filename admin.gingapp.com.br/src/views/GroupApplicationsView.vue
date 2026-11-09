<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ApplicationDetailDialog from '@/components/groupApplications/ApplicationDetailDialog.vue'
import ApplicationStatusChip from '@/components/groupApplications/ApplicationStatusChip.vue'
import ApproveDialog from '@/components/groupApplications/ApproveDialog.vue'
import RejectDialog from '@/components/groupApplications/RejectDialog.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import { usePendingApplicationsStore } from '@/stores/pendingApplications'
import { useAuthStore } from '@/stores/auth'
import { ApiError, errorMessage } from '@/utils/api'
import { formatDateTime } from '@/utils/format'
import {
  applicationErrorText,
  claimedRoleText,
  DECISION_ONLY_SUPER_HINT,
  decisionServerErrors,
  isStaleListError,
  STATUS_TABS,
  type GroupApplication,
  type GroupApplicationStatus,
} from '@/utils/groupApplications'
import { groupApplicationsApi } from '@/utils/groupApplicationsApi'

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

const authStore = useAuthStore()
const pending = usePendingApplicationsStore()
// Mesmo critério das outras telas (Financeiro, Patrocínio): só PLATFORM + super admin decide; o servidor é a barreira real.
const canDecide = computed(() => authStore.user?.userType === 'PLATFORM' && authStore.user?.isSuperAdmin === true)

const status = ref<GroupApplicationStatus>('PENDING')
const search = ref('')
const offset = ref(0)
const items = ref<GroupApplication[]>([])
const total = ref(0)
const isLoading = ref(false)
const listError = ref('')
const notice = ref('')

const detail = ref<GroupApplication | null>(null)
const approveTarget = ref<GroupApplication | null>(null)
const rejectTarget = ref<GroupApplication | null>(null)
const isDeciding = ref(false)
const decisionError = ref('')
const decisionServerError = ref<unknown>(null)

let requestSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400'
const tabBase = 'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'

async function load(): Promise<void> {
  const seq = ++requestSeq
  isLoading.value = true
  listError.value = ''
  try {
    const page = await groupApplicationsApi.list({ status: status.value, q: search.value.trim(), limit: PAGE_SIZE, offset: offset.value })
    if (seq !== requestSeq) return
    items.value = page.items
    total.value = page.total
  } catch (e) {
    if (seq !== requestSeq) return
    listError.value = errorMessage(e, 'Não foi possível carregar os pedidos de adesão.')
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
watch(status, reloadFromStart)

function changeOffset(value: number): void {
  offset.value = value
  void load()
}

function selectTab(key: GroupApplicationStatus): void {
  notice.value = ''
  status.value = key
}

function onTabKeydown(event: KeyboardEvent): void {
  const index = STATUS_TABS.findIndex((t) => t.key === status.value)
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % STATUS_TABS.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + STATUS_TABS.length) % STATUS_TABS.length
  else return
  event.preventDefault()
  status.value = STATUS_TABS[next]!.key
  void nextTick(() => document.getElementById(`applications-tab-${status.value}`)?.focus())
}

// ---------------------------------------------------------------- decisão

function resetDecision(): void {
  decisionError.value = ''
  decisionServerError.value = null
}

function openApprove(app: GroupApplication): void {
  if (!canDecide.value) return
  detail.value = null
  resetDecision()
  approveTarget.value = app
}

function openReject(app: GroupApplication): void {
  if (!canDecide.value) return
  detail.value = null
  resetDecision()
  rejectTarget.value = app
}

function closeDecision(): void {
  if (isDeciding.value) return
  approveTarget.value = null
  rejectTarget.value = null
  resetDecision()
}

async function afterDecision(): Promise<void> {
  await Promise.all([load(), pending.refresh()])
}

function onDecisionFailure(e: unknown, context: 'approve' | 'reject', slugSent = false): void {
  decisionServerError.value = e
  if (e instanceof ApiError && e.status === 400) {
    // Validação do servidor: mensagens de campo vão no campo (o diálogo lê `serverError`); o resto fica no aviso geral.
    const known = context === 'approve' ? ['slug', 'internalNote'] : ['reason', 'internalNote']
    decisionError.value = decisionServerErrors(e, known).general.join(' ')
  } else {
    decisionError.value = applicationErrorText(e, context, slugSent)
  }
  // Outra pessoa decidiu / o pedido sumiu: a lista (e o contador do menu) precisam refletir a realidade.
  if (isStaleListError(e)) void afterDecision()
}

async function confirmApprove(body: { slug?: string; internalNote?: string }): Promise<void> {
  const app = approveTarget.value
  if (!app || isDeciding.value || !canDecide.value) return
  isDeciding.value = true
  resetDecision()
  try {
    const result = await groupApplicationsApi.approve(app.id, body)
    approveTarget.value = null
    notice.value = `Pedido aprovado: o grupo "${result.organization.name}" (${result.organization.slug}) foi criado.`
    await afterDecision()
  } catch (e) {
    onDecisionFailure(e, 'approve', body.slug !== undefined)
  } finally {
    isDeciding.value = false
  }
}

async function confirmReject(body: { reason: string; internalNote?: string }): Promise<void> {
  const app = rejectTarget.value
  if (!app || isDeciding.value || !canDecide.value) return
  isDeciding.value = true
  resetDecision()
  try {
    await groupApplicationsApi.reject(app.id, body)
    rejectTarget.value = null
    notice.value = `Pedido de "${app.groupName}" não aprovado. O motivo ficará visível ao solicitante.`
    if (items.value.length === 1 && offset.value > 0) offset.value = Math.max(0, offset.value - PAGE_SIZE)
    await afterDecision()
  } catch (e) {
    onDecisionFailure(e, 'reject')
  } finally {
    isDeciding.value = false
  }
}

const emptyText = computed(() => {
  if (search.value.trim()) return 'Nenhum pedido encontrado para essa busca.'
  return {
    PENDING: 'Nenhum pedido pendente. Quando alguém pedir para cadastrar um grupo, ele aparece aqui.',
    APPROVED: 'Nenhum pedido aprovado ainda.',
    REJECTED: 'Nenhum pedido não aprovado.',
    EXPIRED: 'Nenhum pedido expirado.',
  }[status.value]
})

onMounted(() => {
  void load()
  void pending.refresh()
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div>
    <div>
      <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Pedidos de adesão</h1>
      <p class="mt-1 text-sm text-slate-600">
        Pedidos de cadastro de grupos feitos pelo site. O grupo só nasce depois que a equipe aprova; a senha escolhida pelo solicitante nunca aparece aqui.
      </p>
      <p v-if="!canDecide" class="mt-2 text-sm text-slate-600" data-testid="read-only-banner">{{ DECISION_ONLY_SUPER_HINT }}</p>
    </div>

    <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div role="tablist" aria-label="Situação dos pedidos" class="flex w-full max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 sm:w-fit" data-testid="applications-tabs" @keydown="onTabKeydown">
        <button
          v-for="tab in STATUS_TABS"
          :id="`applications-tab-${tab.key}`"
          :key="tab.key"
          type="button"
          role="tab"
          :aria-selected="status === tab.key"
          aria-controls="applications-panel"
          :tabindex="status === tab.key ? 0 : -1"
          :class="[tabBase, 'whitespace-nowrap', status === tab.key ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200']"
          :data-testid="`tab-${tab.key}`"
          @click="selectTab(tab.key)"
        >
          {{ tab.label }}<span v-if="tab.key === 'PENDING' && pending.count" class="ml-1.5 tabular-nums" data-testid="tab-pending-count">({{ pending.count }})</span>
        </button>
      </div>
      <div class="w-full sm:max-w-xs">
        <label for="applications-q" class="mb-1 block text-sm font-medium text-slate-800">Buscar</label>
        <input id="applications-q" v-model="search" type="search" placeholder="Grupo, solicitante, e-mail ou cidade" data-testid="filter-q" :class="inputClass" />
      </div>
    </div>

    <p v-if="notice" role="status" data-testid="notice" class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{{ notice }}</p>
    <p v-if="listError" role="alert" data-testid="list-error" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      {{ listError }}
      <button type="button" class="ml-2 font-medium underline" data-testid="retry" @click="load">Tentar de novo</button>
    </p>

    <div id="applications-panel" role="tabpanel" :aria-labelledby="`applications-tab-${status}`" class="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[860px] text-left text-sm" data-testid="applications-table">
          <caption class="sr-only">Pedidos de adesão de grupos</caption>
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">Data</th>
              <th scope="col" class="px-4 py-3 font-medium">Grupo</th>
              <th scope="col" class="px-4 py-3 font-medium">Cidade/UF</th>
              <th scope="col" class="px-4 py-3 font-medium">Solicitante</th>
              <th scope="col" class="px-4 py-3 font-medium">Cargo informado</th>
              <th scope="col" class="px-4 py-3 font-medium">Situação</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-if="isLoading">
              <td colspan="7" class="px-4 py-8 text-center text-slate-600" data-testid="loading">Carregando…</td>
            </tr>
            <tr v-else-if="items.length === 0 && !listError">
              <td colspan="7" class="px-4 py-8 text-center text-slate-600" data-testid="empty">{{ emptyText }}</td>
            </tr>
            <tr v-for="app in isLoading ? [] : items" :key="app.id" :data-testid="`application-${app.id}`" class="align-top hover:bg-slate-50">
              <td class="whitespace-nowrap px-4 py-3 text-slate-800">{{ formatDateTime(app.createdAt) }}</td>
              <td class="max-w-[14rem] break-words px-4 py-3 font-medium text-slate-900">{{ app.groupName }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-slate-800">{{ app.city }}/{{ app.state }}</td>
              <td class="max-w-[14rem] break-words px-4 py-3 text-slate-800">
                {{ app.applicantName }}
                <span class="block break-all text-xs text-slate-600">{{ app.email }}</span>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-slate-800">{{ claimedRoleText(app) }}</td>
              <td class="px-4 py-3"><ApplicationStatusChip :status="app.status" /></td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                <button type="button" data-action="open" class="rounded px-2 py-1 text-sm font-medium text-slate-800 underline hover:bg-slate-100" :aria-label="`Ver detalhes do pedido de ${app.groupName}`" @click="detail = app">Detalhes</button>
                <template v-if="canDecide && app.status === 'PENDING'">
                  <button type="button" data-action="approve" class="ml-1 rounded px-2 py-1 text-sm font-medium text-emerald-800 underline hover:bg-emerald-50" :aria-label="`Aprovar o pedido de ${app.groupName}`" @click="openApprove(app)">Aprovar</button>
                  <button type="button" data-action="reject" class="ml-1 rounded px-2 py-1 text-sm font-medium text-red-700 underline hover:bg-red-50" :aria-label="`Não aprovar o pedido de ${app.groupName}`" @click="openReject(app)">Não aprovar</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar :total="total" :offset="offset" :limit="PAGE_SIZE" :disabled="isLoading" @update:offset="changeOffset" />
    </div>

    <ApplicationDetailDialog :application="detail" :can-decide="canDecide" @close="detail = null" @approve="detail && openApprove(detail)" @reject="detail && openReject(detail)" />
    <ApproveDialog :application="approveTarget" :busy="isDeciding" :error="decisionError" :server-error="decisionServerError" @cancel="closeDecision" @confirm="confirmApprove" />
    <RejectDialog :application="rejectTarget" :busy="isDeciding" :error="decisionError" :server-error="decisionServerError" @cancel="closeDecision" @confirm="confirmReject" />
  </div>
</template>
