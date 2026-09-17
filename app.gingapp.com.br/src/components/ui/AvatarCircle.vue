<script setup lang="ts">
// Avatar redondo com foto real (Student.photo) — cai pra um círculo com a inicial do nome quando
// não há foto (mesmo padrão que já existia hardcoded só dentro do PerfilView.vue; centralizado
// aqui pra reusar na Home também, PLANO_PROJETO.md §10.28: "coloque a foto de perfil na home").
withDefaults(
  defineProps<{
    photo?: string | null
    name?: string | null
    size?: number
  }>(),
  { photo: null, name: null, size: 44 },
)
</script>

<template>
  <img
    v-if="photo"
    :src="photo"
    alt="Foto de perfil"
    class="shrink-0 rounded-full object-cover"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
  <span
    v-else
    class="flex shrink-0 items-center justify-center rounded-full bg-accent font-bold text-white"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.4}px` }"
  >
    {{ name?.charAt(0)?.toUpperCase() ?? 'A' }}
  </span>
</template>
