<script setup lang="ts">
import { useAuthStore } from '../stores/auth'
import AvatarCarousel from '../components/layout/AvatarCarousel.vue'

const auth = useAuthStore()

const quickLinks = [
  { to: '/app/frequencia', label: 'Frequência', icon: '✓' },
  { to: '/app/financeiro', label: 'Financeiro', icon: '$' },
  { to: '/app/eventos', label: 'Eventos', icon: '★' },
  { to: '/app/rodas', label: 'Rodas', icon: '◎' },
]

const feed = [
  { id: 1, title: 'Roda de domingo', place: 'Praça Central', tag: 'Comunidade' },
  { id: 2, title: 'Batizado 2026', place: 'Ginásio Municipal', tag: 'Evento' },
]
</script>

<template>
  <div class="flex flex-col gap-7 pb-6">
    <header class="flex items-center justify-between px-5 pt-6">
      <div>
        <p class="text-sm text-text-muted">Olá, {{ auth.user?.name?.split(' ')[0] ?? 'capoeirista' }} 👋</p>
        <h1 class="text-xl font-semibold text-text">{{ auth.user?.organizationName ?? 'Seu grupo' }}</h1>
      </div>
      <router-link
        to="/app/notificacoes"
        class="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-text-muted"
        aria-label="Notificações"
      >
        🔔
      </router-link>
    </header>

    <section class="flex flex-col gap-3">
      <h2 class="px-5 text-sm font-medium text-text-muted">Próximas aulas</h2>
      <AvatarCarousel />
    </section>

    <section class="grid grid-cols-4 gap-3 px-5">
      <router-link
        v-for="link in quickLinks"
        :key="link.to"
        :to="link.to"
        class="flex flex-col items-center gap-2 rounded-card bg-surface py-4 text-center transition-colors active:bg-surface-hover"
      >
        <span class="text-lg text-accent">{{ link.icon }}</span>
        <span class="text-[11px] font-medium text-text-muted">{{ link.label }}</span>
      </router-link>
    </section>

    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between px-5">
        <h2 class="text-sm font-medium text-text-muted">Comunidade em destaque</h2>
        <router-link to="/app/comunidade" class="text-xs font-medium text-accent">Ver tudo</router-link>
      </div>

      <div class="flex flex-col gap-4 px-5">
        <article
          v-for="post in feed"
          :key="post.id"
          class="overflow-hidden rounded-card-lg bg-surface shadow-md shadow-black/10"
        >
          <div class="flex h-36 items-center justify-center bg-gradient-to-br from-accent/30 to-bg-elevated text-3xl">
            📸
          </div>
          <div class="flex flex-col gap-1 p-4">
            <span class="w-fit rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
              {{ post.tag }}
            </span>
            <h3 class="text-sm font-semibold text-text">{{ post.title }}</h3>
            <p class="text-xs text-text-muted">{{ post.place }}</p>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
