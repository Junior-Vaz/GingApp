<script setup lang="ts" generic="T extends string">
// Tab pill com indicador deslizante (SSOT de todo filtro/tab redondo do app — pedido do owner
// pra unificar o estilo visual de scope/filtros, PLANO_PROJETO.md §10.24). O indicador mede a
// posição real do botão ativo (offsetLeft/offsetWidth) em vez de dividir a largura por N, então
// funciona tanto com opções de largura igual quanto desigual.
import { nextTick, onMounted, ref, watch } from 'vue'

interface TabOption<V extends string> {
  value: V
  label: string
}

const props = defineProps<{
  modelValue: T
  options: TabOption<T>[]
}>()

const emit = defineEmits<{ 'update:modelValue': [T] }>()

const buttonEls = ref<(HTMLElement | null)[]>([])
const thumbLeft = ref(0)
const thumbWidth = ref(0)

function setButtonRef(el: Element | null, index: number): void {
  buttonEls.value[index] = el as HTMLElement | null
}

function updateThumb(): void {
  const index = props.options.findIndex((option) => option.value === props.modelValue)
  const el = buttonEls.value[index]
  if (!el) return
  thumbLeft.value = el.offsetLeft
  thumbWidth.value = el.offsetWidth
}

onMounted(() => {
  void nextTick(updateThumb)
})

watch(
  () => [props.modelValue, props.options],
  () => {
    void nextTick(updateThumb)
  },
  { deep: true },
)
</script>

<template>
  <div class="relative flex gap-1 overflow-x-auto rounded-full bg-surface p-1 scrollbar-none">
    <span
      class="absolute inset-y-1 rounded-full bg-accent transition-all duration-300 ease-fluid"
      :style="{ left: `${thumbLeft}px`, width: `${thumbWidth}px` }"
    />
    <button
      v-for="(option, index) in options"
      :key="option.value"
      :ref="(el) => setButtonRef(el as Element | null, index)"
      type="button"
      class="relative z-10 shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ease-fluid active:scale-95"
      :class="modelValue === option.value ? 'text-white' : 'text-text-muted'"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
