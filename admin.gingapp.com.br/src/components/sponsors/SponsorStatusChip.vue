<script setup lang="ts">
import { computed } from 'vue'
import { EFFECTIVE_STATUS_META, type EffectiveStatus } from '@/utils/sponsors'

const props = defineProps<{ status: EffectiveStatus | string }>()

const meta = computed(() => EFFECTIVE_STATUS_META[props.status as EffectiveStatus])
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset"
    :class="meta ? meta.classes : 'bg-slate-100 text-slate-700 ring-slate-300'"
    :title="meta?.hint"
    :data-status="status"
    data-testid="status-chip"
  >
    <span aria-hidden="true" class="h-1.5 w-1.5 rounded-full bg-current"></span>
    {{ meta ? meta.label : status }}
  </span>
</template>
