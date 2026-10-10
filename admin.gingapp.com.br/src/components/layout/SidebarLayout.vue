<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChangePasswordModal from '@/components/ChangePasswordModal.vue'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const isChangePasswordOpen = ref(false)

const navItems = computed(() =>
  routes
    .filter((r) => typeof r.path === 'string' && r.meta?.navLabel)
    .map((r) => ({ path: r.path, label: r.meta!.navLabel as string })),
)

function isActive(path: string): boolean {
  return route.path === path
}

function handleLogout(): void {
  authStore.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="flex min-h-screen bg-slate-50 text-slate-900">
    <aside class="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div class="flex h-16 items-center gap-2 border-b border-slate-200 px-6">
        <img src="/logo.png" alt="GingApp" class="h-8 w-auto object-contain" />
        <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Admin</span>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 py-4">
        <ul class="space-y-0.5">
          <li v-for="item in navItems" :key="item.path">
            <RouterLink
              :to="item.path"
              class="block rounded-md px-3 py-2 text-sm font-medium transition-colors"
              :class="
                isActive(item.path)
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              "
            >
              {{ item.label }}
            </RouterLink>
          </li>
        </ul>
      </nav>

      <div class="border-t border-slate-200 p-3">
        <p class="truncate px-3 text-sm text-slate-500">{{ authStore.user?.name ?? 'Usuário' }}</p>
        <button
          type="button"
          data-testid="change-password"
          class="mt-1 w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          @click="isChangePasswordOpen = true"
        >
          Alterar senha
        </button>
        <button
          type="button"
          class="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          @click="handleLogout"
        >
          Sair
        </button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-6xl px-8 py-8">
        <RouterView />
      </div>
    </main>

    <ChangePasswordModal v-if="isChangePasswordOpen" @close="isChangePasswordOpen = false" />
  </div>
</template>
