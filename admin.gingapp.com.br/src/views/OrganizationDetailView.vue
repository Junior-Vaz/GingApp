<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { api, ApiError } from '@/utils/api'
import { takeFlash } from '@/utils/flash'
import {
  NEW_PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  RESET_MESTRE_SUCCESS,
  passwordErrorMessage,
  passwordProblem,
  resetMestrePassword,
} from '@/utils/password'

interface FeatureOverride {
  id: number
  featureKey: string
  enabled: boolean
  note: string | null
}

/** MESTRE do grupo (GET /organizations/:id). `id` é o id do USUÁRIO (o usado no reset); `status` é o do vínculo. */
interface Mestre {
  id: number
  name: string
  email: string
  status: string
}

interface Organization {
  id: number
  name: string
  slug: string
  type: string
  status: string
  mestres?: Mestre[]
}

interface Plan {
  id: number
  name: string
  code: string
  priceCents: number
  maxStudents: number | null
  isActive: boolean
}

type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'

interface Subscription {
  id: number
  organizationId: number
  planId: number
  status: SubscriptionStatus
  currentPeriodEnd: string | null
  canceledAt: string | null
  plan: Plan
}

const OPEN_STATUSES: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE']
const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: 'Em teste',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Pagamento pendente',
  CANCELED: 'Cancelada',
  EXPIRED: 'Expirada',
}

const route = useRoute()
const authStore = useAuthStore()
const organizationId = Number(route.params.id)

const organization = ref<Organization | null>(null)
const subscription = ref<Subscription | null>(null)
const plans = ref<Plan[]>([])
const isLoading = ref(false)
const loadError = ref('')
// Aviso de uso único deixado pela tela anterior (ex.: "Grupo criado — informe ao MESTRE...").
const notice = ref(takeFlash())

const selectedPlanId = ref('')
const isSaving = ref(false)
const actionError = ref('')

const featureOverrides = ref<FeatureOverride[]>([])
const overrideForm = reactive({ featureKey: '', enabled: true, note: '' })
const isSavingOverride = ref(false)
const overrideError = ref('')

// Redefinição de senha do MESTRE (modal).
const resetTarget = ref<Mestre | null>(null)
const resetForm = reactive({ password: '', passwordConfirm: '' })
const isResetting = ref(false)
const resetError = ref('')

const mestres = computed(() => organization.value?.mestres ?? [])

/**
 * Só um super admin PLATFORM redefine a senha de um MESTRE (o backend responde 403 para o resto): mesmo
 * critério das telas Team e Novo grupo. Além disso o vínculo do MESTRE precisa estar ACTIVE (o backend
 * responde 404 para os demais).
 */
const canReset = computed(() => {
  const me = authStore.user
  return !!me && me.userType === 'PLATFORM' && me.isSuperAdmin
})

const activePlans = computed(() => plans.value.filter((p) => p.isActive))
const hasOpenSubscription = computed(
  () => subscription.value !== null && OPEN_STATUSES.includes(subscription.value.status),
)

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

async function loadAll(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    const [loadedOrganization, subscriptions, allPlans, overrides] = await Promise.all([
      api.get<Organization>(`/organizations/${organizationId}`),
      api.get<Subscription[]>('/subscriptions'),
      api.get<Plan[]>('/plans'),
      api.get<FeatureOverride[]>(`/organizations/${organizationId}/feature-overrides`),
    ])

    organization.value = loadedOrganization ?? null
    plans.value = allPlans
    featureOverrides.value = overrides

    const orgSubscriptions = subscriptions.filter((s) => s.organizationId === organizationId)
    subscription.value = orgSubscriptions[0] ?? null
    selectedPlanId.value = subscription.value ? String(subscription.value.planId) : ''
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar a organização.'
  } finally {
    isLoading.value = false
  }
}

async function saveOverride(): Promise<void> {
  overrideError.value = ''
  if (!overrideForm.featureKey.trim()) {
    overrideError.value = 'Informe a chave da feature.'
    return
  }

  isSavingOverride.value = true
  try {
    await api.post(`/organizations/${organizationId}/feature-overrides`, {
      featureKey: overrideForm.featureKey.trim(),
      enabled: overrideForm.enabled,
      note: overrideForm.note.trim() || undefined,
    })
    Object.assign(overrideForm, { featureKey: '', enabled: true, note: '' })
    await loadAll()
  } catch (error) {
    overrideError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar o override.'
  } finally {
    isSavingOverride.value = false
  }
}

async function toggleOverride(override: FeatureOverride): Promise<void> {
  try {
    await api.patch(`/organizations/${organizationId}/feature-overrides/${override.id}`, {
      enabled: !override.enabled,
    })
    await loadAll()
  } catch (error) {
    overrideError.value = error instanceof ApiError ? error.message : 'Não foi possível atualizar o override.'
  }
}

async function removeOverride(override: FeatureOverride): Promise<void> {
  if (!confirm(`Remover o override de "${override.featureKey}"? Volta ao comportamento padrão do plano.`)) {
    return
  }
  try {
    await api.delete(`/organizations/${organizationId}/feature-overrides/${override.id}`)
    await loadAll()
  } catch (error) {
    overrideError.value = error instanceof ApiError ? error.message : 'Não foi possível remover o override.'
  }
}

async function assignPlan(): Promise<void> {
  actionError.value = ''
  if (!selectedPlanId.value) {
    actionError.value = 'Escolha um plano.'
    return
  }

  isSaving.value = true
  try {
    if (subscription.value && hasOpenSubscription.value) {
      await api.patch(`/subscriptions/${subscription.value.id}`, { planId: Number(selectedPlanId.value) })
    } else {
      await api.post('/subscriptions', { organizationId, planId: Number(selectedPlanId.value) })
    }
    await loadAll()
  } catch (error) {
    actionError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar a assinatura.'
  } finally {
    isSaving.value = false
  }
}

async function cancelSubscription(): Promise<void> {
  if (!subscription.value) return
  if (!confirm('Cancelar a assinatura desta organização? O plano deixa de ser aplicado imediatamente.')) {
    return
  }

  actionError.value = ''
  isSaving.value = true
  try {
    await api.post(`/subscriptions/${subscription.value.id}/cancel`)
    await loadAll()
  } catch (error) {
    actionError.value = error instanceof ApiError ? error.message : 'Não foi possível cancelar a assinatura.'
  } finally {
    isSaving.value = false
  }
}

function closeReset(): void {
  resetTarget.value = null
  // Nunca deixa a senha digitada na memória do formulário depois de enviada/cancelada.
  resetForm.password = ''
  resetForm.passwordConfirm = ''
}

function openReset(mestre: Mestre): void {
  if (!canReset.value || mestre.status !== 'ACTIVE') return
  resetError.value = ''
  resetForm.password = ''
  resetForm.passwordConfirm = ''
  resetTarget.value = mestre
}

async function submitReset(): Promise<void> {
  const mestre = resetTarget.value
  if (!mestre || isResetting.value) return // Enter repetido durante o envio não envia duas vezes
  resetError.value = ''
  const problem = passwordProblem(resetForm.password, resetForm.passwordConfirm)
  if (problem) {
    resetError.value = problem
    return
  }

  isResetting.value = true
  try {
    await resetMestrePassword(organizationId, mestre.id, resetForm.password)
    closeReset()
    notice.value = RESET_MESTRE_SUCCESS
  } catch (error) {
    // A senha digitada nunca fica no formulário depois de enviada, nem em caso de erro.
    resetForm.password = ''
    resetForm.passwordConfirm = ''
    resetError.value = passwordErrorMessage(error, 'Não foi possível redefinir a senha.')
  } finally {
    isResetting.value = false
  }
}

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <div>
    <RouterLink to="/organizations" class="text-sm font-medium text-slate-500 hover:text-slate-900">
      &larr; Organizations
    </RouterLink>

    <h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
      {{ organization?.name ?? `Organization #${organizationId}` }}
    </h1>
    <p v-if="organization" class="mt-1 text-sm text-slate-500">{{ organization.slug }} · {{ organization.type }}</p>

    <p v-if="notice" role="status" class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      {{ notice }}
    </p>
    <p v-if="loadError" class="mt-4 text-sm text-red-600">{{ loadError }}</p>
    <p v-if="isLoading" class="mt-6 text-sm text-slate-400">Carregando…</p>

    <div v-else class="mt-6 rounded-xl border border-slate-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-slate-900">Assinatura</h2>

      <div v-if="subscription" class="mt-4 space-y-1 text-sm">
        <p>
          <span class="text-slate-500">Plano:</span>
          <span class="ml-1 font-medium text-slate-900">{{ subscription.plan.name }}</span>
          <span class="ml-1 text-slate-500">({{ formatPrice(subscription.plan.priceCents) }}/mês)</span>
        </p>
        <p>
          <span class="text-slate-500">Status:</span>
          <span
            class="ml-1 rounded-full px-2 py-0.5 text-xs font-medium"
            :class="hasOpenSubscription ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
          >
            {{ STATUS_LABEL[subscription.status] }}
          </span>
        </p>
        <p><span class="text-slate-500">Renova em:</span> <span class="ml-1">{{ formatDate(subscription.currentPeriodEnd) }}</span></p>
        <p v-if="subscription.canceledAt">
          <span class="text-slate-500">Cancelada em:</span> <span class="ml-1">{{ formatDate(subscription.canceledAt) }}</span>
        </p>
      </div>
      <p v-else class="mt-4 text-sm text-slate-400">Nenhuma assinatura ainda.</p>

      <div class="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-5">
        <div class="min-w-[220px]">
          <label class="mb-1 block text-sm font-medium text-slate-700">
            {{ hasOpenSubscription ? 'Trocar plano' : 'Atribuir plano' }}
          </label>
          <select
            v-model="selectedPlanId"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          >
            <option value="" disabled>Selecione…</option>
            <option v-for="plan in activePlans" :key="plan.id" :value="plan.id">
              {{ plan.name }} — {{ formatPrice(plan.priceCents) }}/mês
            </option>
          </select>
        </div>
        <button
          type="button"
          :disabled="isSaving"
          class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          @click="assignPlan"
        >
          {{ isSaving ? 'Salvando…' : hasOpenSubscription ? 'Trocar plano' : 'Atribuir plano' }}
        </button>
        <button
          v-if="hasOpenSubscription"
          type="button"
          :disabled="isSaving"
          class="rounded-md px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          @click="cancelSubscription"
        >
          Cancelar assinatura
        </button>
      </div>

      <p v-if="actionError" class="mt-3 text-sm text-red-600">{{ actionError }}</p>
    </div>

    <div v-if="!isLoading && organization" class="mt-6 rounded-xl border border-slate-200 bg-white p-6" data-testid="mestres">
      <h2 class="text-lg font-semibold text-slate-900">MESTREs do grupo</h2>
      <p class="mt-1 text-sm text-slate-500">
        Quem administra este grupo. Se o MESTRE perder o acesso, redefina a senha e informe a nova por canal seguro.
      </p>

      <div v-if="mestres.length > 0" class="mt-4 divide-y divide-slate-100 border-t border-slate-100">
        <div
          v-for="mestre in mestres"
          :key="mestre.id"
          class="flex items-center justify-between gap-3 py-3 text-sm"
          :data-testid="`mestre-${mestre.id}`"
        >
          <div class="min-w-0">
            <p class="truncate font-medium text-slate-900">{{ mestre.name }}</p>
            <p class="truncate text-slate-500">{{ mestre.email }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <span
              data-testid="mestre-status"
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              :class="mestre.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
            >
              {{ mestre.status === 'ACTIVE' ? 'Ativo' : 'Inativo' }}
            </span>
            <button
              v-if="canReset"
              type="button"
              data-action="reset-password"
              :disabled="mestre.status !== 'ACTIVE'"
              :title="mestre.status !== 'ACTIVE' ? 'Só é possível redefinir a senha de um MESTRE ativo.' : undefined"
              class="font-medium text-slate-600 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-slate-600"
              @click="openReset(mestre)"
            >
              Redefinir senha
            </button>
          </div>
        </div>
      </div>
      <p v-else class="mt-4 text-sm text-slate-400">Nenhum MESTRE vinculado a este grupo.</p>

      <p v-if="!canReset" data-testid="reset-readonly-note" class="mt-4 text-xs text-slate-500">
        Somente super admins ativos podem redefinir a senha de um MESTRE.
      </p>
    </div>

    <div v-if="!isLoading" class="mt-6 rounded-xl border border-slate-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-slate-900">Feature overrides</h2>
      <p class="mt-1 text-sm text-slate-500">
        Exceções pontuais fora da régua do plano (ex.: liberar algo em cortesia, desativar para suporte).
      </p>

      <div v-if="featureOverrides.length > 0" class="mt-4 divide-y divide-slate-100 border-t border-slate-100">
        <div
          v-for="override in featureOverrides"
          :key="override.id"
          class="flex items-center justify-between py-3 text-sm"
        >
          <div>
            <p class="font-medium text-slate-900">{{ override.featureKey }}</p>
            <p v-if="override.note" class="text-slate-500">{{ override.note }}</p>
          </div>
          <div class="flex items-center gap-3">
            <span
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              :class="override.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
            >
              {{ override.enabled ? 'Ativado' : 'Desativado' }}
            </span>
            <button type="button" class="font-medium text-slate-600 hover:text-slate-900" @click="toggleOverride(override)">
              {{ override.enabled ? 'Desativar' : 'Ativar' }}
            </button>
            <button type="button" class="font-medium text-red-600 hover:text-red-700" @click="removeOverride(override)">
              Remover
            </button>
          </div>
        </div>
      </div>
      <p v-else class="mt-4 text-sm text-slate-400">Nenhum override para esta organização.</p>

      <form class="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-5" @submit.prevent="saveOverride">
        <div class="min-w-[200px]">
          <label class="mb-1 block text-sm font-medium text-slate-700">Chave da feature</label>
          <input
            v-model="overrideForm.featureKey"
            type="text"
            placeholder="ex.: relatorios.avancados"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
        </div>
        <div class="min-w-[220px] flex-1">
          <label class="mb-1 block text-sm font-medium text-slate-700">Observação</label>
          <input
            v-model="overrideForm.note"
            type="text"
            placeholder="opcional"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
        </div>
        <label class="mb-2 flex items-center gap-2 text-sm text-slate-700">
          <input v-model="overrideForm.enabled" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
          Ativado
        </label>
        <button
          type="submit"
          :disabled="isSavingOverride"
          class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ isSavingOverride ? 'Salvando…' : '+ Adicionar override' }}
        </button>
      </form>

      <p v-if="overrideError" class="mt-3 text-sm text-red-600">{{ overrideError }}</p>
    </div>

    <div class="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
      Uso, atividade e unidades serão implementados nas próximas fases.
    </div>

    <!-- Modal redefinir senha do MESTRE -->
    <div v-if="resetTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <h2 id="reset-title" class="text-lg font-semibold text-slate-900">Redefinir senha do MESTRE</h2>
        <p class="mt-1 text-sm text-slate-500">
          {{ resetTarget.name }} ({{ resetTarget.email }}) — as sessões atuais dele serão encerradas.
        </p>

        <form class="mt-4 space-y-4" autocomplete="off" @submit.prevent="submitReset">
          <div>
            <label for="reset-mestre-password" class="mb-1 block text-sm font-medium text-slate-700">Nova senha</label>
            <input
              id="reset-mestre-password"
              v-model="resetForm.password"
              type="password"
              autocomplete="new-password"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
            <p class="mt-1 text-xs text-slate-400">
              De {{ NEW_PASSWORD_MIN_LENGTH }} a {{ PASSWORD_MAX_BYTES }} caracteres (bytes UTF-8); não pode ser a senha padrão de
              desenvolvimento. Informe-a ao MESTRE por canal seguro.
            </p>
          </div>
          <div>
            <label for="reset-mestre-password-confirm" class="mb-1 block text-sm font-medium text-slate-700">Confirmar nova senha</label>
            <input
              id="reset-mestre-password-confirm"
              v-model="resetForm.passwordConfirm"
              type="password"
              autocomplete="new-password"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <p v-if="resetError" role="alert" class="text-sm text-red-600">{{ resetError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="closeReset">
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="isResetting"
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {{ isResetting ? 'Redefinindo…' : 'Redefinir senha' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
