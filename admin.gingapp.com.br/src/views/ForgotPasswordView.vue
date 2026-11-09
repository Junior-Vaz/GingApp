<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AuthShell from '@/components/auth/AuthShell.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import {
  FORGOT_PASSWORD_NEUTRAL_MESSAGE,
  forgotPasswordErrorMessage,
  requestPasswordReset,
} from '@/utils/password'

const email = ref('')
const isSubmitting = ref(false)
const sent = ref(false)
const errorMessage = ref('')
const emailInput = ref<HTMLInputElement | null>(null)

onMounted(() => emailInput.value?.focus())

async function handleSubmit(): Promise<void> {
  if (isSubmitting.value) return
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    await requestPasswordReset(email.value.trim())
    sent.value = true
  } catch (failure) {
    errorMessage.value = forgotPasswordErrorMessage(failure)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <AuthShell>
    <h1 class="text-xl font-extrabold text-slate-900">Esqueci minha senha</h1>

    <p
      v-if="sent"
      role="status"
      data-testid="forgot-neutral"
      class="mt-4 rounded-lg bg-secondary px-3 py-3 text-sm text-slate-800"
    >
      {{ FORGOT_PASSWORD_NEUTRAL_MESSAGE }}
    </p>

    <form v-else class="mt-4 space-y-4" @submit.prevent="handleSubmit">
      <p class="text-sm text-slate-600">Informe o e-mail da sua conta para receber o link de redefinição.</p>
      <div>
        <label for="forgot-email" class="mb-1.5 block text-sm font-medium text-slate-700">E-mail</label>
        <input
          id="forgot-email"
          ref="emailInput"
          v-model="email"
          type="email"
          required
          autocomplete="email"
          autocapitalize="none"
          spellcheck="false"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 transition-colors hover:border-slate-400"
          placeholder="equipe@gingapp.com.br"
          :aria-invalid="errorMessage ? true : undefined"
          :aria-describedby="errorMessage ? 'forgot-error' : undefined"
        />
      </div>

      <p
        v-if="errorMessage"
        id="forgot-error"
        role="alert"
        data-testid="forgot-error"
        class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        {{ errorMessage }}
      </p>

      <button type="submit" :disabled="isSubmitting" :aria-busy="isSubmitting" class="btn btn-primary min-h-11 w-full">
        <AppIcon v-if="isSubmitting" name="loader" :size="16" class="animate-spin motion-reduce:animate-none" />
        {{ isSubmitting ? 'Enviando…' : 'Enviar link' }}
      </button>
    </form>

    <p class="mt-5 text-center text-sm">
      <RouterLink to="/login" class="inline-flex min-h-10 items-center gap-1.5 font-medium text-slate-700 underline hover:text-slate-900">
        <AppIcon name="arrowLeft" :size="14" />
        Voltar ao login
      </RouterLink>
    </p>
  </AuthShell>
</template>
