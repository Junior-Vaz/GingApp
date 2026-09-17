<script setup lang="ts">
import AppIcon, { type IconName } from '../icons/AppIcon.vue'

/**
 * Card de feed com imagem de capa (ou um placeholder ilustrado quando não há foto) — usado no
 * feed da Home (PLANO_PROJETO.md §10.21). Sem `imageUrl` (nenhum Roda/Event tem foto hoje, é
 * campo novo e opcional), cai num fundo degradê com o ícone do tipo bem grande, nunca uma
 * imagem quebrada.
 */
withDefaults(
  defineProps<{
    icon: IconName
    imageUrl?: string | null
    badge: string
    title: string
    meta: string
    subtitle?: string
    to?: string
  }>(),
  { imageUrl: null, subtitle: undefined, to: undefined },
)
</script>

<template>
  <component :is="to ? 'router-link' : 'div'" :to="to" class="block overflow-hidden rounded-card-lg bg-surface">
    <div class="relative h-36 w-full bg-gradient-to-br from-accent/25 to-accent/5">
      <img v-if="imageUrl" :src="imageUrl" alt="" class="h-full w-full object-cover" />
      <div v-else class="flex h-full w-full items-center justify-center">
        <AppIcon :name="icon" :size="44" class="text-accent/50" />
      </div>

      <span class="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-text shadow-sm">
        <AppIcon name="external-link" :size="15" />
      </span>

      <span class="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-text shadow-sm">
        <span class="h-1.5 w-1.5 rounded-full bg-accent" />
        {{ badge }}
      </span>
    </div>

    <div class="p-4">
      <div class="flex items-start justify-between gap-3">
        <h3 class="min-w-0 flex-1 truncate text-sm font-semibold text-text">{{ title }}</h3>
        <span class="shrink-0 text-xs font-semibold text-accent">{{ meta }}</span>
      </div>
      <p v-if="subtitle" class="mt-1 flex items-center gap-1 truncate text-xs text-text-muted">
        <AppIcon name="map-pin" :size="12" class="shrink-0" />
        {{ subtitle }}
      </p>
    </div>
  </component>
</template>
