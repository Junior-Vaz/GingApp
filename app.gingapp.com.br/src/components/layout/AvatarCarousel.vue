<script setup lang="ts">
export interface AvatarCarouselItem {
  id: number | string
  label: string
  subtitle?: string
  highlighted?: boolean
  initials?: string
}

withDefaults(
  defineProps<{
    items?: AvatarCarouselItem[]
  }>(),
  {
    // Placeholder — troca por "próximas aulas"/turmas do aluno quando a API
    // de lessons/classes estiver disponível (ver PLANO_PROJETO.md §5.6).
    items: () => [
      { id: 1, label: 'Hoje', subtitle: 'Infantil', highlighted: true, initials: 'HJ' },
      { id: 2, label: 'Qua', subtitle: 'Cordas', initials: 'QA' },
      { id: 3, label: 'Sex', subtitle: 'Roda', initials: 'SX' },
      { id: 4, label: 'Sáb', subtitle: 'Grupo A', initials: 'SB' },
      { id: 5, label: 'Dom', subtitle: 'Evento', initials: 'DM' },
    ],
  },
)
</script>

<template>
  <div class="scrollbar-none flex gap-4 overflow-x-auto px-5 py-1">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="flex w-16 flex-shrink-0 flex-col items-center gap-2 text-center"
    >
      <span
        class="flex h-16 w-16 items-center justify-center rounded-full text-sm font-semibold"
        :class="
          item.highlighted
            ? 'bg-accent text-white ring-2 ring-accent ring-offset-2 ring-offset-bg'
            : 'bg-surface text-text-muted ring-1 ring-border'
        "
      >
        {{ item.initials }}
      </span>
      <span class="w-full truncate text-xs font-medium text-text">{{ item.label }}</span>
      <span v-if="item.subtitle" class="w-full truncate text-[10px] text-text-faint">{{
        item.subtitle
      }}</span>
    </button>
  </div>
</template>
