<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthShell from '@/components/auth/AuthShell.vue'
import PasswordField from '@/components/auth/PasswordField.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
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
  document.getElementById('reset-new-password')?.focus()
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
  <AuthShell>
    <h1 class="text-xl font-extrabold text-slate-900">Redefinir senha</h1>

    <div v-if="done" role="status" data-testid="reset-success" class="mt-4 space-y-4">
      <p class="rounded-lg bg-secondary px-3 py-3 text-sm text-slate-800">{{ RESET_PASSWORD_SUCCESS }}</p>
      <RouterLink to="/login" data-testid="reset-login-link" class="btn btn-primary min-h-11 w-full">
        Ir para o login
      </RouterLink>
    </div>

    <template v-else-if="!token && !error">
      <p role="alert" data-testid="reset-missing" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {{ RESET_LINK_MISSING }}
      </p>
      <p class="mt-4 text-sm">
        <RouterLink to="/esqueci-senha" class="inline-flex min-h-10 items-center font-medium text-slate-900 underline">
          Solicitar novo link
        </RouterLink>
      </p>
    </template>

    <form v-else class="mt-4 space-y-4" @submit.prevent="submit">
      <div>
        <label for="reset-new-password" class="mb-1.5 block text-sm font-medium text-slate-700">Nova senha</label>
        <PasswordField
          id="reset-new-password"
          v-model="form.next"
          required
          autocomplete="new-password"
          :aria-invalid="error ? true : undefined"
          :aria-describedby="error ? 'reset-error' : undefined"
        />
        <p class="mt-1.5 text-xs text-slate-600">
          Mínimo de {{ NEW_PASSWORD_MIN_LENGTH }} caracteres (máximo {{ PASSWORD_MAX_BYTES }} bytes).
        </p>
      </div>
      <div>
        <label for="reset-confirm-password" class="mb-1.5 block text-sm font-medium text-slate-700">
          Confirmar nova senha
        </label>
        <PasswordField id="reset-confirm-password" v-model="form.confirm" required autocomplete="new-password" />
      </div>

      <p
        v-if="error"
        id="reset-error"
        role="alert"
        data-testid="reset-error"
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        {{ error }}
      </p>

      <button type="submit" :disabled="isSubmitting" :aria-busy="isSubmitting" class="btn btn-primary min-h-11 w-full">
        <AppIcon v-if="isSubmitting" name="loader" :size="16" class="animate-spin motion-reduce:animate-none" />
        {{ isSubmitting ? 'Salvando…' : 'Redefinir senha' }}
      </button>

      <p class="text-center text-sm">
        <RouterLink to="/esqueci-senha" class="inline-flex min-h-10 items-center font-medium text-slate-700 underline hover:text-slate-900">
          Solicitar novo link
        </RouterLink>
      </p>
    </form>
  </AuthShell>
</template>
