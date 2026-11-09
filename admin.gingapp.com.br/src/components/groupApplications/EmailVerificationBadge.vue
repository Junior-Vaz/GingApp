<script setup lang="ts">
import { computed } from 'vue'
import StatusChip from '@/components/ui/StatusChip.vue'
import { emailVerificationMeta } from '@/utils/groupApplications'

/** Selo da confirmação do e-mail do solicitante. Valor ausente (servidor antigo) = não mostra nada. */
const props = defineProps<{ verification: string | null | undefined }>()

const meta = computed(() => emailVerificationMeta(props.verification))
</script>

<template>
  <StatusChip v-if="meta" :tone="meta.tone" :title="meta.hint" :data-verification="verification" data-testid="email-verification">{{ meta.label }}</StatusChip>
</template>
