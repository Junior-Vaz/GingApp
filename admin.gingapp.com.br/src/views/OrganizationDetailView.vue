<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div>
    <RouterLink to="/organizations" class="text-sm font-medium text-slate-500 hover:text-slate-900">
      &larr; Organizations
    </RouterLink>

    <h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
      Organization #{{ route.params.id }}
    </h1>
    <p class="mt-1 text-sm text-slate-500">Em construção.</p>

    <div class="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
      Uso, atividade, unidades, plano e feature overrides serão implementados nas próximas fases.
    </div>
  </div>
</template>
