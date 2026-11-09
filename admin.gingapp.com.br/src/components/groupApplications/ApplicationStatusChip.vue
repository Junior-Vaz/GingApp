<script setup lang="ts">
import { computed } from 'vue'
import StatusChip from '@/components/ui/StatusChip.vue'
import { STATUS_META, type GroupApplicationStatus } from '@/utils/groupApplications'

const props = defineProps<{ status: GroupApplicationStatus | string }>()

const meta = computed(() => STATUS_META[props.status as GroupApplicationStatus])
</script>

<template>
  <StatusChip :tone="meta ? meta.tone : 'neutral'" :title="meta?.hint" :data-status="status" data-testid="status-chip">
    <span aria-hidden="true" class="h-1.5 w-1.5 rounded-full bg-current"></span>
    {{ meta ? meta.label : status }}
  </StatusChip>
</template>
