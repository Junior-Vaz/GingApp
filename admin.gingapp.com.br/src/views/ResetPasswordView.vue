<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NEW_PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  RESET_LINK_MISSING,
  RESET_PASSWORD_SUCCESS,
  passwordErrorMessage,
  passwordProblem,
  resetPasswordWithToken,
} from '@/utils/password'

const route = useRoute()
const router = useRouter()

// O token vem na query do link do e-mail: guarda em memória e tira da URL (histórico, Referer, prints).
const rawToken = route.query.token
const token = ref(typeof rawToken === 'string' ? rawToken.trim() : '')

const form = reactive({ next: '', confirm: '' })
const isSubmitting = ref(false)
const error = ref('')
const done = ref(false)

onMounted(() => {
  if ('token' in route.query) {
    const { token: _removed, ...rest } = route.query
    void router.replace({ query: rest })
  }
})

async function submit(): Promise<void> {
  if (isSubmitting.value) return
  error.value = ''
  if (!token.value) {
    error.value = RESET_LINK_MISSING
    return
  }
  const problem = passwordProblem(form.next, form.confirm)
  if (problem) {
    error.value = problem
    return
  }

  isSubmitting.value = true
  try {
    await resetPasswordWithToken(token.value, form.next)
    done.value = true
    token.value = ''
  } catch (failure) {
    error.value = passwordErrorMessage(failure, 'Não foi possível redefinir a senha.')
  } finally {
    // Nunca deixa uma senha digitada na memória do formulário depois de enviada.
    form.next = ''
    form.confirm = ''
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
    <div class="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div class="mb-6 text-center">
        <img src="/logo.png" alt="GingApp" class="mx-auto h-12 w-auto object-contain" />
        <h1 class="mt-3 text-lg font-semibold text-slate-900">Redefinir senha</h1>
      </div>

      <div v-if="done" role="status" data-testid="reset-success" class="space-y-4">
        <p class="text-sm text-slate-700">{{ RESET_PASSWORD_SUCCESS }}</p>
        <RouterLink to="/login" data-testid="reset-login-link" class="text-sm text-slate-900 underline">
          Ir para o login
        </RouterLink>
      </div>

      <template v-else-if="!token && !error">
        <p role="alert" data-testid="reset-missing" class="text-sm text-red-600">{{ RESET_LINK_MISSING }}</p>
        <p class="mt-4 text-sm">
          <RouterLink to="/esqueci-senha" class="text-slate-900 underline">Solicitar novo link</RouterLink>
        </p>
      </template>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <div>
          <label for="reset-new-password" class="mb-1 block text-sm font-medium text-slate-700">Nova senha</label>
          <input
            id="reset-new-password"
            v-model="form.next"
            type="password"
            required
            autocomplete="new-password"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
          <p class="mt-1 text-xs text-slate-500">
            Mínimo de {{ NEW_PASSWORD_MIN_LENGTH }} caracteres (máximo {{ PASSWORD_MAX_BYTES }} bytes).
          </p>
        </div>
        <div>
          <label for="reset-confirm-password" class="mb-1 block text-sm font-medium text-slate-700">
            Confirmar nova senha
          </label>
          <input
            id="reset-confirm-password"
            v-model="form.confirm"
            type="password"
            required
            autocomplete="new-password"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
        </div>

        <p v-if="error" role="alert" data-testid="reset-error" class="text-sm text-red-600">{{ error }}</p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ isSubmitting ? 'Salvando…' : 'Redefinir senha' }}
        </button>

        <p class="text-center text-sm">
          <RouterLink to="/esqueci-senha" class="text-slate-600 underline">Solicitar novo link</RouterLink>
        </p>
      </form>
    </div>
  </div>
</template>
