<script setup lang="ts">
// Card de Aviso — deliberadamente SEM imagem (PLANO_PROJETO.md §10.24: "Cards de Aviso não
// precisa ser um card com imagem não faz sentido"). Antes usava o mesmo FeedCard com imagem dos
// eventos/rodas, caindo sempre no placeholder ilustrado; um aviso é texto, não um card de mídia.
import AppIcon from '../icons/AppIcon.vue'

defineProps<{
  title: string
  body: string
  meta: string
}>()
</script>

<template>
  <div class="flex gap-3 rounded-card-lg bg-surface p-4">
    <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
      <AppIcon name="megaphone" :size="20" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex items-start justify-between gap-2">
        <h3 class="min-w-0 flex-1 text-sm font-semibold text-text">{{ title }}</h3>
        <span class="shrink-0 text-xs font-semibold text-accent">{{ meta }}</span>
      </div>
      <p class="mt-1 line-clamp-2 text-xs text-text-muted">{{ body }}</p>
    </div>
  </div>
</template>
