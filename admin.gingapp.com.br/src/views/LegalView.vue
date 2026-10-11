<script setup lang="ts">
import LegalDocumentView from '@/components/LegalDocumentView.vue'
import type { LegalDocumentType } from '@/utils/legal'

defineProps<{ type: LegalDocumentType }>()
</script>

<template>
  <div class="min-h-screen bg-slate-50 px-4 py-10">
    <div class="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <img src="/logo.png" alt="GingApp" class="mb-6 h-10 w-auto object-contain" />
      <LegalDocumentView :type="type" />
      <nav class="mt-8 flex flex-wrap gap-4 border-t border-slate-200 pt-4 text-xs">
        <RouterLink to="/termos" class="underline">Termos de Uso</RouterLink>
        <RouterLink to="/privacidade" class="underline">Política de Privacidade</RouterLink>
        <RouterLink to="/login" class="underline">Voltar ao login</RouterLink>
      </nav>
    </div>
  </div>
</template>
