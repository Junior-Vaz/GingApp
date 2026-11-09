<script setup lang="ts">
import { computed } from 'vue'
import { instagramUrl } from '@/utils/groupApplications'

/**
 * Instagram informado pelo solicitante. O link é montado AQUI, só a partir de um handle que passa na validação do
 * cliente (`^[a-z0-9._]{1,30}$`); qualquer outro valor (inclusive `javascript:`) aparece como texto puro, sem `href`.
 * Vazio = "não informado".
 */
const props = defineProps<{ handle: string | null | undefined }>()

const text = computed(() => (typeof props.handle === 'string' ? props.handle.trim() : ''))
const url = computed(() => instagramUrl(props.handle))
</script>

<template>
  <a
    v-if="url"
    :href="url"
    target="_blank"
    rel="noopener noreferrer"
    class="break-all font-medium text-primary underline hover:text-primary-hover"
    data-testid="instagram-link"
    >@{{ text }}</a
  >
  <span v-else-if="text" class="break-all text-slate-800" data-testid="instagram-text">{{ text }}</span>
  <span v-else class="text-slate-500" data-testid="instagram-empty">não informado</span>
</template>
