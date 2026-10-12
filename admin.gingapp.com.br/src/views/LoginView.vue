<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchPasswordResetByEmail } from '@/utils/password'
import { codeProblem, isChallengeExpired, proofBody } from '@/utils/twoFactor'

const router = useRouter()
const authStore = useAuthStore()

const email = ref('')
const password = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')
const isDev = import.meta.env.DEV
// O link "Esqueci minha senha" só aparece se o backend declarar a recuperação por e-mail (falha = oculto).
const canResetByEmail = ref(false)

// 2º passo (2FA): o desafio vive SÓ aqui, na memória do componente (nunca em storage/store).
const challengeToken = ref<string | null>(null)
const useRecovery = ref(false)
const twoFactorCode = ref('')

onMounted(async () => {
  canResetByEmail.value = await fetchPasswordResetByEmail()
})

async function handleSubmit(): Promise<void> {
  errorMessage.value = ''
  isSubmitting.value = true

  try {
    const result = await authStore.login(email.value, password.value)
    if (result.status === 'two-factor') {
      challengeToken.value = result.challengeToken
      password.value = '' // a senha já cumpriu o papel; não fica no formulário durante o 2º passo
      return
    }
    await router.push({ name: 'dashboard' })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Não foi possível entrar.'
  } finally {
    isSubmitting.value = false
  }
}

function resetTwoFactor(): void {
  challengeToken.value = null
  twoFactorCode.value = ''
  useRecovery.value = false
}

function backToCredentials(): void {
  resetTwoFactor()
  errorMessage.value = ''
}

function toggleRecovery(): void {
  useRecovery.value = !useRecovery.value
  twoFactorCode.value = ''
  errorMessage.value = ''
}

async function handleVerify(): Promise<void> {
  if (isSubmitting.value || !challengeToken.value) return
  errorMessage.value = ''
  const problem = codeProblem(twoFactorCode.value, useRecovery.value)
  if (problem) {
    errorMessage.value = problem
    return
  }

  isSubmitting.value = true
  try {
    await authStore.verifyTwoFactor(challengeToken.value, proofBody(twoFactorCode.value, useRecovery.value))
    resetTwoFactor()
    await router.push({ name: 'dashboard' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível verificar o código.'
    errorMessage.value = message
    twoFactorCode.value = ''
    // Desafio expirado: o código certo não adianta mais, volta ao passo 1 mantendo a mensagem.
    if (isChallengeExpired(message)) resetTwoFactor()
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
    <div class="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div class="mb-8 text-center">
        <img src="/logo.png" alt="GingApp" class="mx-auto h-12 w-auto object-contain" />
        <p class="mt-1 text-sm text-slate-500">Painel administrativo — equipe interna</p>
      </div>

      <p v-if="isDev" data-testid="dev-hint" class="mb-4 text-center text-xs text-slate-400">
        Dev: owner@gingapp.com.br / Dev@12345 (seed de desenvolvimento)
      </p>

      <form v-if="!challengeToken" class="space-y-4" data-testid="login-form" @submit.prevent="handleSubmit">
        <div>
          <label for="email" class="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            placeholder="equipe@gingapp.com.br"
          />
        </div>

        <div>
          <label for="password" class="mb-1 block text-sm font-medium text-slate-700">Senha</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            placeholder="••••••••"
          />
        </div>

        <p v-if="errorMessage" role="alert" class="text-sm text-red-600">{{ errorMessage }}</p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ isSubmitting ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>

      <form v-else class="space-y-4" data-testid="two-factor-form" @submit.prevent="handleVerify">
        <p class="text-sm text-slate-600">
          Verificação em duas etapas.
          {{ useRecovery ? 'Digite um dos seus códigos de recuperação.' : 'Digite o código de 6 dígitos do seu aplicativo autenticador.' }}
        </p>

        <div>
          <label for="two-factor-code" class="mb-1 block text-sm font-medium text-slate-700">
            {{ useRecovery ? 'Código de recuperação' : 'Código de 6 dígitos' }}
          </label>
          <input
            id="two-factor-code"
            v-model="twoFactorCode"
            type="text"
            required
            autofocus
            autocomplete="one-time-code"
            :inputmode="useRecovery ? 'text' : 'numeric'"
            :maxlength="useRecovery ? 11 : 7"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tracking-widest text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            :placeholder="useRecovery ? 'xxxxx-xxxxx' : '000000'"
          />
        </div>

        <p v-if="errorMessage" role="alert" class="text-sm text-red-600">{{ errorMessage }}</p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ isSubmitting ? 'Verificando…' : 'Verificar' }}
        </button>

        <div class="flex items-center justify-between text-sm">
          <button type="button" data-testid="toggle-recovery" class="text-slate-600 underline" @click="toggleRecovery">
            {{ useRecovery ? 'Usar código do autenticador' : 'Usar código de recuperação' }}
          </button>
          <button type="button" data-testid="two-factor-back" class="text-slate-600 underline" @click="backToCredentials">
            Voltar
          </button>
        </div>
      </form>

      <p v-if="canResetByEmail && !challengeToken" class="mt-4 text-center text-sm">
        <RouterLink to="/esqueci-senha" data-testid="forgot-link" class="text-slate-600 underline">
          Esqueci minha senha
        </RouterLink>
      </p>

      <p data-testid="legal-links" class="mt-6 text-center text-xs text-slate-400">
        <RouterLink to="/termos" class="underline">Termos de Uso</RouterLink>
        ·
        <RouterLink to="/privacidade" class="underline">Política de Privacidade</RouterLink>
      </p>
    </div>
  </div>
</template>
