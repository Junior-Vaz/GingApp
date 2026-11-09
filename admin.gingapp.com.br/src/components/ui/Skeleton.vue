<script setup lang="ts">
// Bloco de carregamento (esqueleto). O texto de leitor de tela fica no chamador (ex.: um `sr-only` "Carregando…").
withDefaults(defineProps<{ height?: string; width?: string }>(), { height: '1rem', width: '100%' })
</script>

<template>
  <span class="skeleton block" :style="{ height, width }" aria-hidden="true" />
</template>
