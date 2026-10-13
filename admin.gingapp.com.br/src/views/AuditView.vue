<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import PaginationBar from '@/components/PaginationBar.vue'
import { api, errorMessage } from '@/utils/api'
import { auditActionLabel, auditActionOptions } from '@/utils/audit'
import { formatDateTime } from '@/utils/format'

interface AuditLog {
  id: number
  createdAt: string
  action: string
  entity: string
  entityId: string | null
  organizationId: number | null
  organizationName: string | null
  userId: number | null
  userName: string | null
  userEmail: string | null
  ip: string | null
  meta: Record<string, unknown> | null
}

interface OrganizationOption {
  id: number
  name: string
}

const PAGE_SIZE = 25
const actionOptions = auditActionOptions()

const logs = ref<AuditLog[]>([])
const total = ref(0)
const offset = ref(0)
const isLoading = ref(false)
const error = ref('')
const organizations = ref<OrganizationOption[]>([])
const filters = reactive({ organizationId: '', action: '', userId: '', from: '', to: '' })

async function load(): Promise<void> {
  isLoading.value = true
  error.value = ''
  try {
    const page = await api.getPage<AuditLog>('/audit-logs', {
      organizationId: filters.organizationId,
      action: filters.action,
      userId: filters.userId,
      from: filters.from,
      to: filters.to,
      limit: PAGE_SIZE,
      offset: offset.value,
    })
    logs.value = page.items
    total.value = page.total
  } catch (e) {
    error.value = errorMessage(e, 'Não foi possível carregar a auditoria.')
  } finally {
    isLoading.value = false
  }
}

function applyFilters(): void {
  offset.value = 0
  void load()
}

function clearFilters(): void {
  Object.assign(filters, { organizationId: '', action: '', userId: '', from: '', to: '' })
  applyFilters()
}

function changePage(value: number): void {
  offset.value = value
  void load()
}

function metaText(meta: AuditLog['meta']): string {
  return meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : ''
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
    <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Auditoria</h1>
    <p class="mt-1 text-sm text-slate-500">Registro das ações sensíveis feitas na plataforma e nos grupos.</p>

    <form
      class="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6"
      data-testid="audit-filters"
      @submit.prevent="applyFilters"
    >
      <label class="text-sm font-medium text-slate-700">
        Grupo
        <select v-model="filters.organizationId" data-testid="filter-organization" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">Todos</option>
          <option v-for="org in organizations" :key="org.id" :value="String(org.id)">{{ org.name }}</option>
        </select>
      </label>
      <label class="text-sm font-medium text-slate-700">
        Ação
        <select v-model="filters.action" data-testid="filter-action" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">Todas</option>
          <option v-for="option in actionOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="text-sm font-medium text-slate-700">
        Usuário (id)
        <input v-model="filters.userId" data-testid="filter-user" type="number" min="1" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
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

    <p v-if="error" role="alert" class="mt-4 text-sm text-red-600">{{ error }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div class="overflow-x-auto" data-testid="audit-scroll">
      <table class="w-full min-w-[760px] table-fixed text-left text-sm" data-testid="audit-table">
        <colgroup>
          <col class="w-[9.5rem]" />
          <col class="w-[11rem]" />
          <col class="w-[9rem]" />
          <col class="w-[12rem]" />
          <col class="w-[7.5rem]" />
          <col />
        </colgroup>
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Data</th>
            <th class="px-4 py-3 font-medium">Ação</th>
            <th class="px-4 py-3 font-medium">Grupo</th>
            <th class="px-4 py-3 font-medium">Usuário</th>
            <th class="px-4 py-3 font-medium">IP</th>
            <th class="px-4 py-3 font-medium">Detalhes</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="logs.length === 0">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Nenhum registro encontrado.</td>
          </tr>
          <tr v-for="log in logs" v-else :key="log.id" :data-testid="`audit-${log.id}`" class="align-top hover:bg-slate-50">
            <td class="px-4 py-3 text-slate-600">{{ formatDateTime(log.createdAt) }}</td>
            <td class="break-words px-4 py-3 font-medium text-slate-900 [overflow-wrap:anywhere]">
              {{ auditActionLabel(log.action) }}
              <span v-if="log.entityId" class="block text-xs font-normal text-slate-400">{{ log.entity }} #{{ log.entityId }}</span>
            </td>
            <td class="break-words px-4 py-3 text-slate-600 [overflow-wrap:anywhere]">{{ log.organizationName ?? '—' }}</td>
            <td class="break-words px-4 py-3 text-slate-600 [overflow-wrap:anywhere]">
              {{ log.userName ?? '—' }}
              <span v-if="log.userEmail" class="block text-xs text-slate-400">{{ log.userEmail }}</span>
            </td>
            <td class="break-words px-4 py-3 text-slate-600 [overflow-wrap:anywhere]">{{ log.ip ?? '—' }}</td>
            <td class="max-w-md break-words px-4 py-3 font-mono text-xs text-slate-500 [overflow-wrap:anywhere]">{{ metaText(log.meta) }}</td>
          </tr>
        </tbody>
      </table>
      </div>
      <PaginationBar :total="total" :offset="offset" :limit="PAGE_SIZE" :disabled="isLoading" @update:offset="changePage" />
    </div>
  </div>
</template>
