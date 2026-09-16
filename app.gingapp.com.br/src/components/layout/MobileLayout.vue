<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

interface NavItem {
  name: string
  label: string
  icon: 'home' | 'compass' | 'calendar' | 'users' | 'user'
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
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              :stroke="isActive(item.name) ? 'currentColor' : 'currentColor'"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <template v-if="item.icon === 'home'">
                <path d="M3 12l9-9 9 9" />
                <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
              </template>
              <template v-else-if="item.icon === 'compass'">
                <circle cx="12" cy="12" r="9" />
                <polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5 15.5 8.5" />
              </template>
              <template v-else-if="item.icon === 'calendar'">
                <rect x="3" y="4" width="18" height="17" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </template>
              <template v-else-if="item.icon === 'users'">
                <path d="M16.5 20v-1.5a3.5 3.5 0 0 0-3.5-3.5H6a3.5 3.5 0 0 0-3.5 3.5V20" />
                <circle cx="9.25" cy="8" r="3.25" />
                <path d="M21.5 20v-1.5a3.25 3.25 0 0 0-2.5-3.16" />
                <path d="M15 4.2a3.25 3.25 0 0 1 0 6.35" />
              </template>
              <template v-else-if="item.icon === 'user'">
                <path d="M19 20v-1.5a4 4 0 0 0-4-4h-6a4 4 0 0 0-4 4V20" />
                <circle cx="12" cy="7.5" r="3.75" />
              </template>
            </svg>
            <span>{{ item.label }}</span>
          </router-link>
        </li>
      </ul>
    </nav>
  </div>
</template>
