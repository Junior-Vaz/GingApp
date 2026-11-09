<script setup lang="ts">
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'

// Estado vazio padrão: ícone, título, explicação e (opcional) ação.
withDefaults(defineProps<{ title: string; description?: string; icon?: IconName }>(), { icon: 'inbox' })
</script>

<template>
  <div class="flex flex-col items-center px-6 py-10 text-center">
    <span class="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
      <AppIcon :name="icon" :size="22" />
    </span>
    <p class="mt-3 text-sm font-semibold text-slate-900">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-sm text-sm text-slate-600">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4"><slot /></div>
  </div>
</template>
