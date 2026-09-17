<script setup lang="ts">
// Dropdown estilizado — envolve um <select> nativo (mantém acessibilidade/teclado/mobile picker
// de graça) só trocando a casca visual: sem seta padrão do navegador, pílula arredondada como o
// resto do app, ícone chevron-down próprio (PLANO_PROJETO.md §10.28, pedido do owner: "melhore os
// dropdowns mais estilosos" — antes eram <select> cru com a aparência default do SO).
import AppIcon from '../icons/AppIcon.vue'

withDefaults(defineProps<{ modelValue: string; disabled?: boolean }>(), { disabled: false })
defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <div class="relative" :class="disabled ? 'opacity-50' : ''">
    <select
      :value="modelValue"
      :disabled="disabled"
      class="w-full appearance-none rounded-full bg-surface py-2 pl-3.5 pr-8 text-xs font-medium text-text outline-none transition-shadow focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <slot />
    </select>
    <AppIcon
      name="chevron-down"
      :size="14"
      class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint"
    />
  </div>
</template>
