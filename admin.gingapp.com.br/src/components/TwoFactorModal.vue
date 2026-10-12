<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/utils/api'
import {
  codeProblem,
  disableTwoFactor,
  enableTwoFactor,
  fetchTwoFactorStatus,
  isAuthenticatorCode,
  startTwoFactorSetup,
  type TwoFactorSetup,
} from '@/utils/twoFactor'

const emit = defineEmits<{ close: [] }>()
const authStore = useAuthStore()

// loading -> off | on; off -> setup -> codes (códigos mostrados UMA vez) -> on
type Step = 'loading' | 'off' | 'setup' | 'codes' | 'on'
const step = ref<Step>('loading')
const recoveryRemaining = ref(0)
const setup = ref<TwoFactorSetup | null>(null)
const enableCode = ref('')
const recoveryCodes = ref<string[]>([])
const copied = ref(false)

const disablePassword = ref('')
const disableCode = ref('')
const useRecovery = ref(false)

const isBusy = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    const status = await fetchTwoFactorStatus()
    recoveryRemaining.value = status.recoveryCodesRemaining
    authStore.updateUser({ twoFactorEnabled: status.twoFactorEnabled, recoveryCodesRemaining: status.recoveryCodesRemaining })
    step.value = status.twoFactorEnabled ? 'on' : 'off'
  } catch (failure) {
    error.value = errorMessage(failure, 'Não foi possível consultar a verificação em duas etapas.')
    step.value = 'off'
  }
})

function close(): void {
  // Segredo, códigos e senha digitada não ficam na memória do formulário depois de fechar.
  setup.value = null
  recoveryCodes.value = []
  enableCode.value = ''
  disablePassword.value = ''
  disableCode.value = ''
  emit('close')
}

async function beginSetup(): Promise<void> {
  if (isBusy.value) return
  error.value = ''
  isBusy.value = true
  try {
    setup.value = await startTwoFactorSetup()
    enableCode.value = ''
    step.value = 'setup'
  } catch (failure) {
    error.value = errorMessage(failure, 'Não foi possível iniciar a ativação.')
  } finally {
    isBusy.value = false
  }
}

async function confirmEnable(): Promise<void> {
  if (isBusy.value) return
  error.value = ''
  if (!isAuthenticatorCode(enableCode.value)) {
    error.value = codeProblem(enableCode.value, false) ?? ''
    return
  }
  isBusy.value = true
  try {
    recoveryCodes.value = await enableTwoFactor(enableCode.value)
    recoveryRemaining.value = recoveryCodes.value.length
    authStore.updateUser({ twoFactorEnabled: true, recoveryCodesRemaining: recoveryCodes.value.length })
    setup.value = null
    enableCode.value = ''
    step.value = 'codes'
  } catch (failure) {
    enableCode.value = ''
    error.value = errorMessage(failure, 'Não foi possível ativar. Confira o código e tente novamente.')
  } finally {
    isBusy.value = false
  }
}

async function copyCodes(): Promise<void> {
  try {
    await navigator.clipboard.writeText(recoveryCodes.value.join('\n'))
    copied.value = true
  } catch {
    copied.value = false
    error.value = 'Não foi possível copiar. Selecione os códigos e copie manualmente.'
  }
}

function finishCodes(): void {
  recoveryCodes.value = [] // nunca exibidos de novo
  copied.value = false
  step.value = 'on'
}

function toggleRecovery(): void {
  useRecovery.value = !useRecovery.value
  disableCode.value = ''
  error.value = ''
}

async function confirmDisable(): Promise<void> {
  if (isBusy.value) return
  error.value = ''
  if (disablePassword.value === '') {
    error.value = 'Informe a sua senha.'
    return
  }
  const problem = codeProblem(disableCode.value, useRecovery.value)
  if (problem) {
    error.value = problem
    return
  }
  isBusy.value = true
  try {
    await disableTwoFactor(disablePassword.value, disableCode.value, useRecovery.value)
    authStore.updateUser({ twoFactorEnabled: false, recoveryCodesRemaining: 0 })
    recoveryRemaining.value = 0
    disablePassword.value = ''
    disableCode.value = ''
    useRecovery.value = false
    step.value = 'off'
  } catch (failure) {
    disablePassword.value = ''
    disableCode.value = ''
    error.value = errorMessage(failure, 'Não foi possível desativar.')
  } finally {
    isBusy.value = false
  }
}

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500'
const primaryClass =
  'rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
    <div
      class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="two-factor-title"
    >
      <h2 id="two-factor-title" class="text-lg font-semibold text-slate-900">Verificação em duas etapas</h2>

      <p v-if="step === 'loading'" class="mt-4 text-sm text-slate-500">Carregando…</p>

      <!-- Desativada -->
      <div v-else-if="step === 'off'" data-testid="two-factor-off" class="mt-4 space-y-4">
        <p class="text-sm text-slate-600">
          Proteja a sua conta com um código gerado por um aplicativo autenticador (Google Authenticator, Authy, 1Password…),
          além da senha.
        </p>
        <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="close">
            Fechar
          </button>
          <button type="button" data-testid="two-factor-start" :disabled="isBusy" :class="primaryClass" @click="beginSetup">
            {{ isBusy ? 'Preparando…' : 'Ativar verificação em duas etapas' }}
          </button>
        </div>
      </div>

      <!-- Ativação: QR + código -->
      <form v-else-if="step === 'setup' && setup" data-testid="two-factor-setup" class="mt-4 space-y-4" @submit.prevent="confirmEnable">
        <p class="text-sm text-slate-600">
          1. Leia o QR code com o aplicativo autenticador (ou digite a chave manualmente).<br />
          2. Digite abaixo o código de 6 dígitos que o aplicativo mostrar.
        </p>
        <img :src="setup.qrCodeDataUrl" alt="QR code para o aplicativo autenticador" class="mx-auto h-44 w-44" />
        <p class="text-center text-xs text-slate-500">
          Chave para digitação manual:
          <code data-testid="two-factor-secret" class="select-all break-all font-mono text-slate-800">{{ setup.secret }}</code>
        </p>
        <div>
          <label for="two-factor-enable-code" class="mb-1 block text-sm font-medium text-slate-700">Código de 6 dígitos</label>
          <input
            id="two-factor-enable-code"
            v-model="enableCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="7"
            placeholder="000000"
            :class="inputClass"
          />
        </div>
        <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="close">
            Cancelar
          </button>
          <button type="submit" :disabled="isBusy" :class="primaryClass">{{ isBusy ? 'Ativando…' : 'Ativar' }}</button>
        </div>
      </form>

      <!-- Códigos de recuperação: exibidos UMA vez -->
      <div v-else-if="step === 'codes'" data-testid="two-factor-codes" class="mt-4 space-y-4">
        <p role="status" class="text-sm text-emerald-700">Verificação em duas etapas ativada.</p>
        <p class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Guarde estes códigos de recuperação agora; eles não serão exibidos de novo. Cada um vale uma única vez e substitui o
          autenticador se você perder o aparelho.
        </p>
        <ul class="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-3 font-mono text-sm text-slate-800">
          <li v-for="code in recoveryCodes" :key="code" data-testid="recovery-code">{{ code }}</li>
        </ul>
        <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
        <p v-if="copied" role="status" data-testid="codes-copied" class="text-sm text-emerald-700">Códigos copiados.</p>
        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="copy-codes"
            class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            @click="copyCodes"
          >
            Copiar códigos
          </button>
          <button type="button" data-testid="codes-done" :class="primaryClass" @click="finishCodes">Já guardei</button>
        </div>
      </div>

      <!-- Ativada -->
      <div v-else-if="step === 'on'" data-testid="two-factor-on" class="mt-4 space-y-4">
        <p role="status" class="text-sm font-medium text-emerald-700">Ativada</p>
        <p class="text-sm text-slate-600" data-testid="recovery-remaining">
          Códigos de recuperação restantes: <strong>{{ recoveryRemaining }}</strong>
        </p>

        <form class="space-y-4 border-t border-slate-200 pt-4" autocomplete="off" @submit.prevent="confirmDisable">
          <p class="text-sm font-medium text-slate-700">Desativar</p>
          <div>
            <label for="two-factor-disable-password" class="mb-1 block text-sm font-medium text-slate-700">Senha atual</label>
            <input
              id="two-factor-disable-password"
              v-model="disablePassword"
              type="password"
              autocomplete="current-password"
              :class="inputClass"
            />
          </div>
          <div>
            <label for="two-factor-disable-code" class="mb-1 block text-sm font-medium text-slate-700">
              {{ useRecovery ? 'Código de recuperação' : 'Código de 6 dígitos' }}
            </label>
            <input
              id="two-factor-disable-code"
              v-model="disableCode"
              type="text"
              autocomplete="one-time-code"
              :inputmode="useRecovery ? 'text' : 'numeric'"
              :maxlength="useRecovery ? 11 : 7"
              :placeholder="useRecovery ? 'xxxxx-xxxxx' : '000000'"
              :class="inputClass"
            />
            <button type="button" data-testid="disable-toggle-recovery" class="mt-1 text-xs text-slate-600 underline" @click="toggleRecovery">
              {{ useRecovery ? 'Usar código do autenticador' : 'Usar código de recuperação' }}
            </button>
          </div>
          <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="close">
              Fechar
            </button>
            <button
              type="submit"
              data-testid="two-factor-disable"
              :disabled="isBusy"
              class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {{ isBusy ? 'Desativando…' : 'Desativar verificação' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
