<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, ApiError } from '../utils/api'
import AppIcon from '../components/icons/AppIcon.vue'
import StatTile from '../components/ui/StatTile.vue'

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
  <div class="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 py-10">
    <p class="text-xs font-semibold uppercase tracking-widest text-text-faint">GingApp · Passaporte do Capoeirista</p>

    <div v-if="isLoading" class="text-sm text-text-muted">Carregando…</div>

    <div v-else-if="notFound" class="flex w-full max-w-sm flex-col items-center gap-3 rounded-card-lg bg-surface p-8 text-center">
      <span class="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AppIcon name="alert-circle" :size="26" />
      </span>
      <p class="text-lg font-bold text-text">Passaporte não encontrado</p>
      <p class="text-sm text-text-muted">Este link não corresponde a nenhum Passaporte público ativo.</p>
    </div>

    <div v-else-if="passport" class="flex w-full max-w-sm flex-col items-center gap-3 rounded-card-lg bg-surface p-8 text-center">
      <span class="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-xl font-bold text-white">
        {{ passport.student.name.charAt(0) }}
      </span>
      <p class="text-lg font-bold text-text">{{ passport.student.name }}</p>
      <p class="text-sm text-text-muted">
        {{ passport.organization.name }}<span v-if="passport.unit"> · {{ passport.unit.name }}</span>
      </p>
      <span v-if="passport.currentGraduation" class="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
        {{ passport.currentGraduation.name }}
      </span>

      <div class="mt-3 grid w-full grid-cols-3 gap-2.5 border-t border-border pt-4">
        <StatTile icon="calendar" label="Aulas" :value="passport.stats.aulas" tone="neutral" surface="elevated" />
        <StatTile icon="drum" label="Rodas" :value="passport.stats.rodas" tone="neutral" surface="elevated" />
        <StatTile icon="ticket" label="Eventos" :value="passport.stats.eventos" tone="neutral" surface="elevated" />
        <StatTile icon="graduation" label="Graduações" :value="passport.stats.graduacoes" tone="neutral" surface="elevated" />
        <StatTile icon="trophy" label="Certificados" :value="passport.stats.certificados" tone="neutral" surface="elevated" />
      </div>

      <p class="mt-1 text-xs text-text-faint">Esses números representam histórico, não ranking.</p>
    </div>
  </div>
</template>
