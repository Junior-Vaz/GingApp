<script setup lang="ts">
// Campo de senha com "mostrar/ocultar" e aviso de Caps Lock (só aviso: não muda nada na autenticação).
// Os atributos do <input> (id, autocomplete, required, aria-*, placeholder...) passam direto para o campo.
import { ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

defineOptions({ inheritAttrs: false })
defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const visible = ref(false)
const capsLock = ref(false)

function trackCapsLock(event: KeyboardEvent): void {
  if (typeof event.getModifierState === 'function') capsLock.value = event.getModifierState('CapsLock')
}
</script>

<template>
  <div>
    <div class="relative">
      <input
        v-bind="$attrs"
        :type="visible ? 'text' : 'password'"
        :value="modelValue"
        class="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-3 pr-12 text-sm text-slate-900 transition-colors hover:border-slate-400"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keydown="trackCapsLock"
        @keyup="trackCapsLock"
        @blur="capsLock = false"
      />
      <button
        type="button"
        class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-500 hover:text-slate-900"
        :aria-label="visible ? 'Ocultar senha' : 'Mostrar senha'"
        :aria-pressed="visible"
        data-testid="toggle-password"
        @click="visible = !visible"
      >
        <AppIcon :name="visible ? 'eyeOff' : 'eye'" :size="18" />
      </button>
    </div>
    <p
      v-if="capsLock"
      role="status"
      data-testid="caps-lock-warning"
      class="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-900"
    >
      <AppIcon name="alert" :size="14" class="text-amber-700" />
      Caps Lock está ligado. A senha diferencia maiúsculas de minúsculas.
    </p>
  </div>
</template>
