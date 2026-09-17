<script setup lang="ts">
import AppIcon, { type IconName } from '../icons/AppIcon.vue'

/**
 * Card de feed hero — imagem de capa ocupa o card inteiro (ou um fundo degradê com o ícone do
 * tipo, quando não há `imageUrl`), com um filtro escuro transparente por cima pra dar contraste,
 * e o texto (badge/título/meta/localização) direto sobre a imagem — sem painel branco embaixo
 * (redesign pedido pelo owner, PLANO_PROJETO.md §10.24: "imagem com filtro transparente por cima,
 * e textos por cima sem um container branco por baixo").
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
  <component
    :is="to ? 'router-link' : 'div'"
    :to="to"
    class="relative block h-48 overflow-hidden rounded-card-lg shadow-md transition-transform duration-150 active:scale-[0.98]"
  >
    <img v-if="imageUrl" :src="imageUrl" alt="" class="absolute inset-0 h-full w-full object-cover" />
    <template v-else>
      <div class="absolute inset-0 bg-gradient-to-br from-accent-hover to-accent/60" />
      <div class="absolute inset-0 flex items-center justify-center">
        <AppIcon :name="icon" :size="56" class="text-white/30" />
      </div>
    </template>

    <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/5" />

    <span
      class="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm"
    >
      <span class="h-1.5 w-1.5 rounded-full bg-white" />
      {{ badge }}
    </span>

    <span
      class="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm"
    >
      <AppIcon name="external-link" :size="15" />
    </span>

    <div class="absolute inset-x-0 bottom-0 p-4">
      <div class="flex items-end justify-between gap-3">
        <h3 class="min-w-0 flex-1 text-sm font-semibold leading-snug text-white line-clamp-2">{{ title }}</h3>
        <span class="shrink-0 text-xs font-semibold text-white">{{ meta }}</span>
      </div>
      <p v-if="subtitle" class="mt-1 flex items-center gap-1 truncate text-xs text-white/75">
        <AppIcon name="map-pin" :size="12" class="shrink-0" />
        {{ subtitle }}
      </p>
    </div>
  </component>
</template>
