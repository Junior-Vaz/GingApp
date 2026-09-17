<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon, { type IconName } from '../icons/AppIcon.vue'

interface NavItem {
  name: string
  label: string
  icon: IconName
}

// As 5 rotas principais do §5.2 do plano — a bottom nav mostra só estas;
// as demais rotas do app (/app/frequencia, /app/financeiro, /app/eventos,
// /app/rodas, /app/notificacoes) são acessadas a partir delas.
const navItems: NavItem[] = [
  { name: 'home', label: 'Início', icon: 'home' },
  { name: 'jornada', label: 'Jornada', icon: 'compass' },
  { name: 'aulas', label: 'Aulas', icon: 'calendar' },
  { name: 'comunidade', label: 'Comunidade', icon: 'users' },
  { name: 'perfil', label: 'Perfil', icon: 'user' },
]

const route = useRoute()
const isActive = computed(() => (name: string) => route.name === name)

// Menu flutuante redondo com indicador deslizante (PLANO_PROJETO.md §10.24, pedido do owner).
// As 5 colunas têm largura igual (grid-cols-5), então o indicador desliza em múltiplos exatos de
// 100% da própria largura — não precisa medir pixel de botão, só o índice da rota ativa.
const activeIndex = computed(() => {
  const index = navItems.findIndex((item) => item.name === route.name)
  return index === -1 ? 0 : index
})
</script>

<template>
  <div class="flex h-dvh flex-col bg-bg text-text">
    <main class="safe-top flex-1 overflow-y-auto pb-28">
      <router-view />
    </main>

    <nav class="safe-bottom fixed inset-x-0 bottom-4 z-20 flex justify-center px-4" aria-label="Navegação principal">
      <ul class="relative grid w-full max-w-[22rem] grid-cols-5 rounded-full bg-surface p-1.5 shadow-lg">
        <span
          class="pointer-events-none absolute inset-y-1.5 left-1.5 rounded-full bg-accent transition-transform duration-300 ease-out"
          style="width: calc((100% - 0.75rem) / 5)"
          :style="{ transform: `translateX(calc(${activeIndex} * 100%))` }"
        />
        <li v-for="item in navItems" :key="item.name" class="relative z-10">
          <router-link
            :to="{ name: item.name }"
            class="flex flex-col items-center justify-center gap-0.5 rounded-full py-2 text-[10px] font-medium transition-colors"
            :class="isActive(item.name) ? 'text-white' : 'text-text-muted'"
          >
            <AppIcon :name="item.icon" :size="19" />
            <span>{{ item.label }}</span>
          </router-link>
        </li>
      </ul>
    </nav>
  </div>
</template>
