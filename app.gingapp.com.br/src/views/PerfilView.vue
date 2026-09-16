<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../utils/api'

interface Student {
  id: number
  name: string
}

const auth = useAuthStore()
const router = useRouter()

const students = ref<Student[]>([])
const loadError = ref('')

const ROLE_LABEL: Record<string, string> = {
  ALUNO: 'Aluno',
  RESPONSAVEL: 'Responsável',
  MESTRE: 'Mestre',
  PROFESSOR: 'Professor',
}

const roleLabel = computed(() => {
  const role = auth.user?.role
  return role ? (ROLE_LABEL[role] ?? role) : null
})

function handleLogout() {
  auth.logout()
  router.push('/login')
}

onMounted(async () => {
  try {
    students.value = await api.get<Student[]>('/students/me')
  } catch (error) {
    // Não bloqueia o perfil — a seção de alunos vinculados só some se falhar.
    loadError.value =
      error instanceof ApiError ? error.message : 'Não foi possível carregar os alunos vinculados.'
  }
})
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
      <div class="flex flex-col items-center gap-0.5">
        <span v-if="roleLabel" class="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
          {{ roleLabel }}
        </span>
        <p v-if="auth.user?.organizationName" class="mt-1 text-xs text-text-faint">
          {{ auth.user.organizationName }}
        </p>
      </div>
    </header>

    <section v-if="students.length > 0" class="flex flex-col gap-2 rounded-card-lg bg-surface p-4">
      <h2 class="text-xs font-medium text-text-muted">Aluno(s) vinculado(s)</h2>
      <ul class="flex flex-col gap-1">
        <li v-for="student in students" :key="student.id" class="text-sm text-text">
          {{ student.name }}
        </li>
      </ul>
    </section>
    <p v-else-if="loadError" class="text-xs text-text-faint">{{ loadError }}</p>

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
