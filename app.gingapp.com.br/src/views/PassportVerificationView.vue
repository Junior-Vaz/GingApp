<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, ApiError } from '../utils/api'

interface PublicPassport {
  student: { name: string }
  organization: { name: string }
  unit: { name: string } | null
  currentGraduation: { name: string } | null
  stats: { aulas: number; rodas: number; eventos: number; graduacoes: number; certificados: number }
}

const route = useRoute()
const code = String(route.params.code ?? '')

const passport = ref<PublicPassport | null>(null)
const isLoading = ref(true)
const notFound = ref(false)

onMounted(async () => {
  try {
    passport.value = await api.get<PublicPassport>(`/public/passport/${code}`)
  } catch (error) {
    notFound.value = !(error instanceof ApiError) || error.status === 404
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-10">
    <p class="text-xs font-medium uppercase tracking-widest text-text-faint">GingApp · Passaporte do Capoeirista</p>

    <div v-if="isLoading" class="text-sm text-text-muted">Carregando…</div>

    <div v-else-if="notFound" class="w-full max-w-sm rounded-card-lg bg-surface p-6 text-center">
      <p class="text-lg font-semibold text-danger">Passaporte não encontrado</p>
      <p class="mt-2 text-sm text-text-muted">Este link não corresponde a nenhum Passaporte público ativo.</p>
    </div>

    <div v-else-if="passport" class="w-full max-w-sm rounded-card-lg bg-surface p-6 text-center">
      <p class="text-lg font-semibold text-text">{{ passport.student.name }}</p>
      <p class="mt-1 text-sm text-text-muted">
        {{ passport.organization.name }}<span v-if="passport.unit"> · {{ passport.unit.name }}</span>
      </p>
      <p v-if="passport.currentGraduation" class="mt-1 text-sm font-medium text-accent">
        {{ passport.currentGraduation.name }}
      </p>

      <div class="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-center">
        <div>
          <p class="text-lg font-semibold text-accent">{{ passport.stats.aulas }}</p>
          <p class="text-[11px] text-text-muted">Aulas</p>
        </div>
        <div>
          <p class="text-lg font-semibold text-accent">{{ passport.stats.rodas }}</p>
          <p class="text-[11px] text-text-muted">Rodas</p>
        </div>
        <div>
          <p class="text-lg font-semibold text-accent">{{ passport.stats.eventos }}</p>
          <p class="text-[11px] text-text-muted">Eventos</p>
        </div>
        <div>
          <p class="text-lg font-semibold text-accent">{{ passport.stats.graduacoes }}</p>
          <p class="text-[11px] text-text-muted">Graduações</p>
        </div>
        <div>
          <p class="text-lg font-semibold text-accent">{{ passport.stats.certificados }}</p>
          <p class="text-[11px] text-text-muted">Certificados</p>
        </div>
      </div>

      <p class="mt-5 text-xs text-text-faint">Esses números representam histórico, não ranking.</p>
    </div>
  </div>
</template>
