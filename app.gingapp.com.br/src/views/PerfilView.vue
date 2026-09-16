<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header class="flex flex-col items-center gap-3 text-center">
      <span class="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-2xl font-bold text-white">
        {{ auth.user?.name?.charAt(0) ?? 'A' }}
      </span>
      <div>
        <h1 class="text-lg font-semibold text-text">{{ auth.user?.name ?? 'Aluno' }}</h1>
        <p class="text-sm text-text-muted">{{ auth.user?.email }}</p>
      </div>
    </header>

    <section class="flex flex-col gap-3">
      <router-link to="/app/notificacoes" class="rounded-card bg-surface p-4 text-sm text-text">
        Notificações
      </router-link>
      <router-link to="/app/financeiro" class="rounded-card bg-surface p-4 text-sm text-text">
        Financeiro
      </router-link>
      <button
        type="button"
        class="rounded-card bg-surface p-4 text-left text-sm font-medium text-danger"
        @click="handleLogout"
      >
        Sair da conta
      </button>
    </section>
  </div>
</template>
