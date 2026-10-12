<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchPasswordResetByEmail } from '@/utils/password'

const router = useRouter()
const authStore = useAuthStore()

const email = ref('')
const password = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')
const isDev = import.meta.env.DEV
// O link "Esqueci minha senha" só aparece se o backend declarar a recuperação por e-mail (falha = oculto).
const canResetByEmail = ref(false)

onMounted(async () => {
  canResetByEmail.value = await fetchPasswordResetByEmail()
})

async function handleSubmit(): Promise<void> {
  errorMessage.value = ''
  isSubmitting.value = true

  try {
    await authStore.login(email.value, password.value)
    await router.push({ name: 'dashboard' })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Não foi possível entrar.'
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

      <form class="space-y-4" @submit.prevent="handleSubmit">
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

        <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ isSubmitting ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>

      <p v-if="canResetByEmail" class="mt-4 text-center text-sm">
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
