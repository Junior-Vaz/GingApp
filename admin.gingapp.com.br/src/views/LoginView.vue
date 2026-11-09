<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AuthShell from '@/components/auth/AuthShell.vue'
import PasswordField from '@/components/auth/PasswordField.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
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

// Foco automático: e-mail ao abrir; código ao chegar no 2º passo (o atributo `autofocus` não vale em tela trocada por JS).
const emailInput = ref<HTMLInputElement | null>(null)
const codeInput = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  emailInput.value?.focus()
  canResetByEmail.value = await fetchPasswordResetByEmail()
})

watch(challengeToken, async (token, previous) => {
  await nextTick()
  if (token) codeInput.value?.focus()
  else if (previous) emailInput.value?.focus()
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
  void nextTick(() => codeInput.value?.focus())
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

const FIELD =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 transition-colors hover:border-slate-400'
</script>

<template>
  <AuthShell>
    <div v-if="!challengeToken">
      <h1 class="text-xl font-extrabold text-slate-900">Entrar no admin</h1>
      <p class="mt-1 text-sm text-slate-600">Painel administrativo — equipe interna</p>
    </div>
    <div v-else class="flex items-center gap-2">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
        <AppIcon name="shield" :size="20" />
      </span>
      <h1 class="text-lg font-extrabold text-slate-900">Verificação em duas etapas</h1>
    </div>

    <p v-if="isDev" data-testid="dev-hint" class="mt-4 rounded-md bg-slate-50 px-3 py-2 text-center text-xs text-slate-600">
      Dev: owner@gingapp.com.br / Dev@12345 (seed de desenvolvimento)
    </p>

    <form v-if="!challengeToken" class="mt-5 space-y-4" data-testid="login-form" @submit.prevent="handleSubmit">
      <div>
        <label for="email" class="mb-1.5 block text-sm font-medium text-slate-700">E-mail</label>
        <input
          id="email"
          ref="emailInput"
          v-model="email"
          type="email"
          required
          autocomplete="email"
          autocapitalize="none"
          spellcheck="false"
          :class="FIELD"
          placeholder="equipe@gingapp.com.br"
          :aria-invalid="errorMessage ? true : undefined"
          :aria-describedby="errorMessage ? 'login-error' : undefined"
        />
      </div>

      <div>
        <div class="mb-1.5 flex items-center justify-between gap-2">
          <label for="password" class="block text-sm font-medium text-slate-700">Senha</label>
          <RouterLink
            v-if="canResetByEmail"
            to="/esqueci-senha"
            data-testid="forgot-link"
            class="-my-2 inline-flex min-h-10 items-center rounded text-sm font-semibold text-primary underline"
          >
            Esqueci minha senha
          </RouterLink>
        </div>
        <PasswordField
          id="password"
          v-model="password"
          required
          autocomplete="current-password"
          placeholder="••••••••"
          :aria-invalid="errorMessage ? true : undefined"
          :aria-describedby="errorMessage ? 'login-error' : undefined"
        />
      </div>

      <p v-if="errorMessage" id="login-error" role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {{ errorMessage }}
      </p>

      <button type="submit" :disabled="isSubmitting" :aria-busy="isSubmitting" class="btn btn-primary min-h-11 w-full">
        <AppIcon v-if="isSubmitting" name="loader" :size="16" class="animate-spin motion-reduce:animate-none" />
        {{ isSubmitting ? 'Entrando…' : 'Entrar' }}
      </button>
    </form>

    <form v-else class="mt-5 space-y-4" data-testid="two-factor-form" @submit.prevent="handleVerify">
      <p class="text-sm text-slate-600">
        {{ useRecovery ? 'Digite um dos seus códigos de recuperação.' : 'Digite o código de 6 dígitos do seu aplicativo autenticador.' }}
      </p>

      <div>
        <label for="two-factor-code" class="mb-1.5 block text-sm font-medium text-slate-700">
          {{ useRecovery ? 'Código de recuperação' : 'Código de 6 dígitos' }}
        </label>
        <input
          id="two-factor-code"
          ref="codeInput"
          v-model="twoFactorCode"
          type="text"
          required
          autocomplete="one-time-code"
          :inputmode="useRecovery ? 'text' : 'numeric'"
          :maxlength="useRecovery ? 11 : 7"
          :class="[FIELD, 'tracking-widest']"
          :placeholder="useRecovery ? 'xxxxx-xxxxx' : '000000'"
          :aria-invalid="errorMessage ? true : undefined"
          :aria-describedby="errorMessage ? 'login-error' : undefined"
        />
      </div>

      <p v-if="errorMessage" id="login-error" role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {{ errorMessage }}
      </p>

      <button type="submit" :disabled="isSubmitting" :aria-busy="isSubmitting" class="btn btn-primary min-h-11 w-full">
        <AppIcon v-if="isSubmitting" name="loader" :size="16" class="animate-spin motion-reduce:animate-none" />
        {{ isSubmitting ? 'Verificando…' : 'Verificar' }}
      </button>

      <div class="flex items-center justify-between gap-2 text-sm">
        <button
          type="button"
          data-testid="toggle-recovery"
          class="-mx-1 min-h-10 rounded px-1 font-medium text-slate-700 underline hover:text-slate-900"
          @click="toggleRecovery"
        >
          {{ useRecovery ? 'Usar código do autenticador' : 'Usar código de recuperação' }}
        </button>
        <button
          type="button"
          data-testid="two-factor-back"
          class="-mx-1 min-h-10 rounded px-1 font-medium text-slate-700 underline hover:text-slate-900"
          @click="backToCredentials"
        >
          Voltar
        </button>
      </div>
    </form>

    <template #footer>
      <p data-testid="legal-links" class="mt-5 text-center text-xs text-slate-600">
        <RouterLink to="/termos" class="inline-flex min-h-8 items-center underline">Termos de Uso</RouterLink>
        ·
        <RouterLink to="/privacidade" class="inline-flex min-h-8 items-center underline">Política de Privacidade</RouterLink>
      </p>
    </template>
  </AuthShell>
</template>
