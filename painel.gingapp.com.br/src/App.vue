<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SidebarLayout from '@/components/layout/SidebarLayout.vue'

const route = useRoute()
const isAuthenticatedLayout = computed(() => route.meta.requiresAuth !== false)
</script>

<template>
  <SidebarLayout v-if="isAuthenticatedLayout" />
  <RouterView v-else />
</template>
