<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '../utils/api'

interface Student {
  id: number
}

interface GraduationLevel {
  id: number
  name: string
  order: number
  color: string | null
}

interface StudentGraduation {
  id: number
  studentId: number
  graduationLevelId: number
  graduatedAt: string
  notes: string | null
  createdAt: string
  graduationLevel: GraduationLevel
}

const isLoading = ref(true)
const loadError = ref('')
const hasStudent = ref(true)

// Vem do backend já do mais recente para o mais antigo.
const graduations = ref<StudentGraduation[]>([])

const currentGraduation = computed<StudentGraduation | null>(() => graduations.value[0] ?? null)

// Timeline exibida em ordem cronológica crescente (mais antiga primeiro).
const timeline = computed<StudentGraduation[]>(() => [...graduations.value].reverse())

function formatDate(iso: string): string {
  // timeZone: 'UTC': graduatedAt vem do painel via <input type="date"> (meia-noite UTC) —
  // sem forçar UTC, um fuso negativo pode até mostrar o mês errado perto da virada do mês.
  return new Date(iso).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const students = await api.get<Student[]>('/students/me')
    // TODO: seletor de aluno quando houver mais de um dependente
    const student = students[0]
    if (!student) {
      hasStudent.value = false
      return
    }
    graduations.value = await api.get<StudentGraduation[]>(`/graduations/students/${student.id}`)
  } catch (error) {
    loadError.value =
      error instanceof ApiError ? error.message : 'Não foi possível carregar sua jornada.'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Jornada</h1>
      <p class="text-sm text-text-muted">Sua evolução e graduações no grupo</p>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/15 px-4 py-3 text-sm text-danger">{{ loadError }}</p>

    <p v-else-if="!isLoading && !hasStudent" class="rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
      Nenhum aluno vinculado a esta conta.
    </p>

    <template v-else>
      <section v-if="currentGraduation" class="rounded-card-lg bg-surface p-5">
        <p class="text-xs text-text-muted">Graduação atual</p>
        <p class="mt-1 text-lg font-semibold text-accent">{{ currentGraduation.graduationLevel.name }}</p>
      </section>
      <p v-else-if="!isLoading" class="rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
        Nenhuma graduação registrada ainda.
      </p>

      <section v-if="timeline.length > 0" class="flex flex-col gap-4">
        <h2 class="text-sm font-medium text-text-muted">Linha do tempo</h2>
        <ol class="flex flex-col gap-5">
          <li v-for="grad in timeline" :key="grad.id" class="flex items-start gap-4">
            <span class="mt-1 flex h-3 w-3 flex-shrink-0 rounded-full bg-accent" />
            <div class="flex-1 rounded-card bg-surface px-4 py-3">
              <p class="text-sm font-medium text-text">{{ grad.graduationLevel.name }}</p>
              <p class="text-xs text-text-muted">{{ formatDate(grad.graduatedAt) }}</p>
              <p v-if="grad.notes" class="mt-1 text-xs text-text-faint">{{ grad.notes }}</p>
            </div>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>
