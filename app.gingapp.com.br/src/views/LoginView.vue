<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

async function handleSubmit() {
  error.value = ''
  if (!email.value || !password.value) {
    error.value = 'Informe e-mail e senha.'
    return
  }

  loading.value = true
  try {
    await auth.login({ email: email.value, password: password.value })
    const redirect = (route.query.redirect as string) || '/app'
    router.push(redirect)
  } catch {
    error.value = 'Não foi possível entrar. Verifique suas credenciais.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="safe-top safe-bottom flex min-h-dvh flex-col justify-center bg-bg px-6 py-10">
    <div class="mx-auto w-full max-w-sm">
      <div class="mb-10 flex flex-col items-center gap-3 text-center">
        <span class="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-2xl font-bold text-white">
          G
        </span>
        <h1 class="text-2xl font-semibold text-text">GingApp</h1>
        <p class="text-sm text-text-muted">Entre para acompanhar sua jornada na capoeira</p>
      </div>

      <form class="flex flex-col gap-4 rounded-card-lg bg-surface p-6 shadow-lg shadow-black/20" @submit.prevent="handleSubmit">
        <div class="flex flex-col gap-1.5">
          <label for="email" class="text-xs font-medium text-text-muted">E-mail</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="username"
            placeholder="voce@email.com"
            class="rounded-xl border border-border bg-bg-elevated px-4 py-3 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="password" class="text-xs font-medium text-text-muted">Senha</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            class="rounded-xl border border-border bg-bg-elevated px-4 py-3 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
          />
        </div>

        <p v-if="error" class="text-xs text-danger">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="mt-2 rounded-xl bg-accent py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
        >
          {{ loading ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>

      <p class="mt-6 text-center text-xs text-text-faint">
        Dev: aluno@gingabrasil.com.br / Dev@12345 (seed de desenvolvimento)
      </p>
    </div>
  </div>
</template>
