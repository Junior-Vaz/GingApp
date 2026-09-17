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
</script>

<template>
  <div class="flex h-dvh flex-col bg-bg text-text">
    <main class="safe-top flex-1 overflow-y-auto pb-24">
      <router-view />
    </main>

    <nav
      class="safe-bottom fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 backdrop-blur"
      aria-label="Navegação principal"
    >
      <ul class="mx-auto flex max-w-md items-stretch justify-between px-2">
        <li v-for="item in navItems" :key="item.name" class="flex-1">
          <router-link
            :to="{ name: item.name }"
            class="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors"
            :class="isActive(item.name) ? 'text-accent' : 'text-text-muted'"
          >
            <AppIcon :name="item.icon" :size="22" />
            <span>{{ item.label }}</span>
          </router-link>
        </li>
      </ul>
    </nav>
  </div>
</template>
