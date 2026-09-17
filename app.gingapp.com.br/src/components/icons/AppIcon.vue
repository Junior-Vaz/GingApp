<script setup lang="ts">
/**
 * Ícone SVG único e compartilhado — mesmo estilo (viewBox 24x24, stroke-width 2, linhas
 * arredondadas, cor via `currentColor`) que já existia só dentro de MobileLayout.vue.
 * Centralizado aqui pra nunca duplicar path de ícone entre telas (SSOT), e pra nunca mais usar
 * emoji como ícone decorativo — UI minimalista, sem emojis.
 */
export type IconName =
  | 'home'
  | 'compass'
  | 'calendar'
  | 'users'
  | 'user'
  | 'drum'
  | 'graduation'
  | 'book'
  | 'trophy'
  | 'sparkles'
  | 'chat'
  | 'plane'
  | 'flame'
  | 'bell'
  | 'check-circle'
  | 'wallet'
  | 'ticket'
  | 'megaphone'
  | 'chevron-right'
  | 'chevron-down'
  | 'pencil'
  | 'instagram'
  | 'facebook'
  | 'whatsapp'
  | 'youtube'
  | 'tiktok'
  | 'arrow-left'
  | 'alert-circle'
  | 'external-link'
  | 'map-pin'

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 22 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <template v-if="name === 'home'">
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </template>

    <template v-else-if="name === 'compass'">
      <circle cx="12" cy="12" r="9" />
      <polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5 15.5 8.5" />
    </template>

    <template v-else-if="name === 'calendar'">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </template>

    <template v-else-if="name === 'users'">
      <path d="M16.5 20v-1.5a3.5 3.5 0 0 0-3.5-3.5H6a3.5 3.5 0 0 0-3.5 3.5V20" />
      <circle cx="9.25" cy="8" r="3.25" />
      <path d="M21.5 20v-1.5a3.25 3.25 0 0 0-2.5-3.16" />
      <path d="M15 4.2a3.25 3.25 0 0 1 0 6.35" />
    </template>

    <template v-else-if="name === 'user'">
      <path d="M19 20v-1.5a4 4 0 0 0-4-4h-6a4 4 0 0 0-4 4V20" />
      <circle cx="12" cy="7.5" r="3.75" />
    </template>

    <template v-else-if="name === 'drum'">
      <ellipse cx="12" cy="7" rx="7" ry="3" />
      <path d="M5 7v9c0 1.66 3.13 3 7 3s7-1.34 7-3V7" />
      <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />
    </template>

    <template v-else-if="name === 'graduation'">
      <path d="M2 9 12 4l10 5-10 5L2 9Z" />
      <path d="M6 11v4.5c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V11" />
      <line x1="22" y1="9" x2="22" y2="14" />
    </template>

    <template v-else-if="name === 'book'">
      <path d="M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3Z" />
      <line x1="9" y1="8" x2="16" y2="8" />
      <line x1="9" y1="12" x2="16" y2="12" />
    </template>

    <template v-else-if="name === 'trophy'">
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5H5a3 3 0 0 0 3 4" />
      <path d="M16 5h3a3 3 0 0 1-3 4" />
      <line x1="12" y1="13" x2="12" y2="17" />
      <line x1="9" y1="21" x2="15" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </template>

    <template v-else-if="name === 'sparkles'">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8Z" />
      <path d="M19 16l.6 2.1L22 19l-2.4.9L19 22l-.6-2.1L16 19l2.4-.9Z" />
    </template>

    <template v-else-if="name === 'chat'">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.4A8.5 8.5 0 0 1 4 12a8.4 8.4 0 0 1 8.4-8.5A8.38 8.38 0 0 1 21 11.5Z" />
    </template>

    <template v-else-if="name === 'plane'">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </template>

    <template v-else-if="name === 'flame'">
      <path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c0-1-1-2-1-3 2 1 3 3 3 5a5 5 0 0 1-10 0c0-5 4-6 5-10Z" />
    </template>

    <template v-else-if="name === 'bell'">
      <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </template>

    <template v-else-if="name === 'check-circle'">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </template>

    <template v-else-if="name === 'wallet'">
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <circle cx="16" cy="13" r="1.25" />
    </template>

    <template v-else-if="name === 'ticket'">
      <path
        d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z"
      />
      <line x1="10" y1="7" x2="10" y2="17" stroke-dasharray="2 2" />
    </template>

    <template v-else-if="name === 'megaphone'">
      <path d="M3 11v2a2 2 0 0 0 2 2h1l1 5h2l-1-5h1l9 4V7l-9 4H5a2 2 0 0 0-2 2Z" />
      <path d="M18 9.5a3 3 0 0 1 0 5" />
    </template>

    <template v-else-if="name === 'chevron-right'">
      <path d="M9 6l6 6-6 6" />
    </template>

    <template v-else-if="name === 'chevron-down'">
      <path d="M6 9l6 6 6-6" />
    </template>

    <template v-else-if="name === 'arrow-left'">
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </template>

    <template v-else-if="name === 'alert-circle'">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16.5" x2="12" y2="16.51" />
    </template>

    <template v-else-if="name === 'external-link'">
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </template>

    <template v-else-if="name === 'map-pin'">
      <path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.3" />
    </template>

    <template v-else-if="name === 'pencil'">
      <path d="M4 20l4-1 10.3-10.3a1.5 1.5 0 0 0 0-2.1l-1-1a1.5 1.5 0 0 0-2.1 0L5 16l-1 4Z" />
      <path d="M13.5 6.5l3 3" />
    </template>

    <!-- Ícones de redes sociais — versões simplificadas em traço (mesmo estilo do resto do
    conjunto), não os logos oficiais pixel-a-pixel; suficiente pra reconhecer a plataforma num
    botão pequeno sem sair do sistema de ícones minimalista do app. -->
    <template v-else-if="name === 'instagram'">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </template>

    <template v-else-if="name === 'facebook'">
      <path d="M15 4h-2a3 3 0 0 0-3 3v3H8v3h2v7h3v-7h2.4l.5-3H13V7a1 1 0 0 1 1-1h1V4Z" />
    </template>

    <template v-else-if="name === 'whatsapp'">
      <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" />
      <path
        d="M8.5 9.7c0-.6.5-1.1 1-1.1h.6c.3 0 .5.2.6.4l.5 1.2c.1.3.1.6-.1.8l-.5.6c.4 1 1.2 1.8 2.2 2.2l.6-.5c.2-.2.5-.2.8-.1l1.2.5c.2.1.4.3.4.6v.6c0 .5-.5 1-1.1 1-3.4 0-6.2-2.8-6.2-6.2Z"
      />
    </template>

    <template v-else-if="name === 'youtube'">
      <rect x="2.5" y="6" width="19" height="12" rx="4" />
      <path d="M10.5 9.5l5 2.5-5 2.5v-5Z" />
    </template>

    <template v-else-if="name === 'tiktok'">
      <path d="M13.5 3v11.8a3.3 3.3 0 1 1-3.3-3.3" />
      <path d="M13.5 7a4 4 0 0 0 4 4" />
    </template>
  </svg>
</template>
