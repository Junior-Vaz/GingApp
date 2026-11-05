<script setup lang="ts">
/** Selo "Suspensa pela plataforma" (texto sempre visível; a cor nunca é a única informação). */
defineProps<{ reason?: string | null }>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-900 ring-1 ring-inset ring-red-300"
    :title="reason || 'Suspensa pela plataforma: não aparece no app e o Mestre não pode retomar.'"
    data-testid="suspended-badge"
  >
    <span aria-hidden="true" class="h-1.5 w-1.5 rounded-full bg-current"></span>
    Suspensa pela plataforma
  </span>
</template>
