<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const onCampaigns = computed(() => route.path.startsWith('/sponsors/campaigns'))
const onGroups = computed(() => route.path.startsWith('/sponsors/groups'))
const onSponsors = computed(() => !onCampaigns.value && !onGroups.value)

const base = 'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'
const on = 'bg-slate-900 text-white'
const off = 'text-slate-700 hover:bg-slate-200'
</script>

<template>
  <nav aria-label="Seções de Patrocinadores" class="mb-6 flex gap-1 rounded-lg bg-slate-100 p-1 w-fit" data-testid="sponsors-tabs">
    <RouterLink to="/sponsors" :class="[base, onSponsors ? on : off]" :aria-current="onSponsors ? 'page' : undefined" data-testid="tab-sponsors">
      Patrocinadores
    </RouterLink>
    <RouterLink to="/sponsors/campaigns" :class="[base, onCampaigns ? on : off]" :aria-current="onCampaigns ? 'page' : undefined" data-testid="tab-campaigns">
      Campanhas
    </RouterLink>
    <RouterLink to="/sponsors/groups" :class="[base, onGroups ? on : off]" :aria-current="onGroups ? 'page' : undefined" data-testid="tab-groups">
      Dos grupos
    </RouterLink>
  </nav>
</template>
