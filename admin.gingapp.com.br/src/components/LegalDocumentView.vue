<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchLegalDocument, type LegalDocument, type LegalDocumentType } from '@/utils/legal'

const props = defineProps<{ type: LegalDocumentType }>()

const doc = ref<LegalDocument | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    doc.value = await fetchLegalDocument(props.type)
  } catch {
    failed.value = true
  }
})

function formatDate(iso: string): string {
  return iso.split('-').reverse().join('/')
}
</script>

<template>
  <article class="text-sm leading-relaxed text-slate-700" :data-testid="`legal-${type}`">
    <p v-if="failed" role="alert" class="text-red-600">Não foi possível carregar este documento. Tente novamente mais tarde.</p>
    <p v-else-if="!doc" class="text-slate-400">Carregando…</p>
    <template v-else>
      <p role="note" data-testid="legal-notice" class="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
        {{ doc.notice }}
      </p>
      <h1 class="text-xl font-bold text-slate-900">{{ doc.title }}</h1>
      <p class="mt-1 text-xs text-slate-400">Versão {{ doc.version }} · atualizado em {{ formatDate(doc.updatedAt) }}</p>
      <section v-for="section in doc.sections" :key="section.heading" class="mt-5">
        <h2 class="text-base font-semibold text-slate-900">{{ section.heading }}</h2>
        <p v-for="(paragraph, index) in section.paragraphs" :key="index" class="mt-2">{{ paragraph }}</p>
      </section>
    </template>
  </article>
</template>
