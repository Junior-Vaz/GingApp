<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import MoneyField from '@/components/finance/MoneyField.vue'
import FieldShell from '@/components/sponsors/FieldShell.vue'
import { ApiError, errorMessage } from '@/utils/api'
import {
  FINANCE_LIMITS,
  financeErrorText,
  settingsPayload,
  settingsServerErrors,
  settingsToForm,
  validateSettingsForm,
  WRITE_ONLY_SUPER_HINT,
  type SettingsFieldErrors,
  type SettingsFormState,
} from '@/utils/finance'
import { financeApi } from '@/utils/financeApi'

const props = defineProps<{ canWrite: boolean }>()

const FIELDS = ['monthlyGoal', 'openingReserve', 'entityName', 'introText', 'surplusText'] as const

const form = reactive<SettingsFormState>({ monthlyGoal: '', openingReserve: '', entityName: '', introText: '', surplusText: '' })
const fieldErrors = reactive<SettingsFieldErrors>({})
const generalErrors = ref<string[]>([])
const isLoading = ref(false)
const loadError = ref('')
const isSaving = ref(false)
const notice = ref('')

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400 aria-[invalid=true]:border-red-600 disabled:bg-slate-100 disabled:text-slate-600'

function clearErrors(): void {
  for (const key of FIELDS) delete fieldErrors[key]
  generalErrors.value = []
}

async function load(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    const settings = await financeApi.getSettings()
    Object.assign(
      form,
      settingsToForm({
        monthlyGoalCents: settings?.monthlyGoalCents ?? 0,
        openingReserveCents: settings?.openingReserveCents ?? 0,
        entityName: settings?.entityName ?? null,
        introText: settings?.introText ?? null,
        surplusText: settings?.surplusText ?? null,
      }),
    )
  } catch (e) {
    loadError.value = errorMessage(e, 'Não foi possível carregar as configurações.')
  } finally {
    isLoading.value = false
  }
}

async function submit(): Promise<void> {
  if (isSaving.value || !props.canWrite) return
  clearErrors()
  notice.value = ''
  const problems = validateSettingsForm(form)
  if (Object.keys(problems).length > 0) {
    Object.assign(fieldErrors, problems)
    return
  }
  isSaving.value = true
  try {
    const saved = await financeApi.updateSettings(settingsPayload(form))
    if (saved && typeof saved.monthlyGoalCents === 'number') {
      Object.assign(
        form,
        settingsToForm({
          monthlyGoalCents: saved.monthlyGoalCents,
          openingReserveCents: saved.openingReserveCents ?? 0,
          entityName: saved.entityName ?? null,
          introText: saved.introText ?? null,
          surplusText: saved.surplusText ?? null,
        }),
      )
    }
    notice.value = 'Configurações salvas. A meta nova vale para os meses ainda não publicados; os já publicados não mudam.'
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const server = settingsServerErrors(e)
      Object.assign(fieldErrors, server.fields)
      generalErrors.value = server.general
    } else {
      generalErrors.value = [financeErrorText(e, 'settings')]
    }
  } finally {
    isSaving.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <section aria-labelledby="settings-title" data-testid="settings-tab">
    <h2 id="settings-title" class="text-lg font-semibold text-slate-900">Configurações</h2>
    <p class="mt-1 text-sm text-slate-600">Estes dados aparecem na página pública de transparência (meta, reserva e os textos). Mudar a meta não altera meses já publicados.</p>
    <p v-if="!canWrite" class="mt-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700" data-testid="read-only-hint">{{ WRITE_ONLY_SUPER_HINT }}</p>

    <p v-if="loadError" role="alert" data-testid="load-error" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      {{ loadError }}
      <button type="button" class="ml-2 font-medium underline" data-testid="retry" @click="load">Tentar de novo</button>
    </p>
    <p v-if="isLoading" class="mt-4 text-sm text-slate-600" data-testid="loading">Carregando…</p>

    <!-- Com erro de carga o formulário NÃO aparece: salvar o formulário vazio zeraria a meta e a reserva. -->
    <form v-else-if="!loadError" class="mt-4 max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" novalidate data-testid="settings-form" @submit.prevent="submit">
      <p v-if="notice" role="status" data-testid="notice" class="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{{ notice }}</p>
      <div v-if="generalErrors.length" role="alert" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="form-errors">
        <p v-for="message in generalErrors" :key="message">{{ message }}</p>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MoneyField id="st-goal" v-model="form.monthlyGoal" label="Meta mensal" required :error="fieldErrors.monthlyGoal" :disabled="!canWrite" hint="Quanto a plataforma precisa por mês. Use 0,00 para não mostrar meta." testid="field-monthlyGoal" />
        <MoneyField id="st-reserve" v-model="form.openingReserve" label="Reserva inicial" required :error="fieldErrors.openingReserve" :disabled="!canWrite" hint="Saldo antes do primeiro mês publicado. Nunca negativo." testid="field-openingReserve" />
      </div>

      <FieldShell id="st-entity" label="Quem recebe e opera" hint="Ex.: nome da associação. Aparece na página pública." :error="fieldErrors.entityName" :counter="`${form.entityName.trim().length}/${FINANCE_LIMITS.entityNameMax}`" :counter-over="form.entityName.trim().length > FINANCE_LIMITS.entityNameMax" v-slot="{ describedby, invalid }">
        <input id="st-entity" v-model="form.entityName" type="text" autocomplete="off" :disabled="!canWrite" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-entityName" />
      </FieldShell>

      <FieldShell id="st-intro" label="Texto de apresentação" hint="Em português simples: por que a plataforma é gratuita e como ela se sustenta." :error="fieldErrors.introText" :counter="`${form.introText.trim().length}/${FINANCE_LIMITS.introTextMax}`" :counter-over="form.introText.trim().length > FINANCE_LIMITS.introTextMax" v-slot="{ describedby, invalid }">
        <textarea id="st-intro" v-model="form.introText" rows="4" :disabled="!canWrite" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-introText"></textarea>
      </FieldShell>

      <FieldShell id="st-surplus" label="Para onde vai o excedente" hint="O que acontece quando sobra dinheiro no mês." :error="fieldErrors.surplusText" :counter="`${form.surplusText.trim().length}/${FINANCE_LIMITS.surplusTextMax}`" :counter-over="form.surplusText.trim().length > FINANCE_LIMITS.surplusTextMax" v-slot="{ describedby, invalid }">
        <textarea id="st-surplus" v-model="form.surplusText" rows="4" :disabled="!canWrite" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-surplusText"></textarea>
      </FieldShell>

      <div v-if="canWrite" class="flex justify-end pt-2">
        <button type="submit" data-testid="settings-save" :disabled="isSaving" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
          {{ isSaving ? 'Salvando…' : 'Salvar configurações' }}
        </button>
      </div>
    </form>
  </section>
</template>
