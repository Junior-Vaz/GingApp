import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { vi } from 'vitest'
import type { Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { AUTH_TOKEN_KEY, AUTH_USER_KEY, useAuthStore, type AuthUser } from '@/stores/auth'

export interface Call {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  headers: Record<string, string>
}

export interface MockReply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

export type Handler = (call: Call) => MockReply | undefined | Promise<MockReply | undefined>

/**
 * Substitui o fetch global. O handler recebe cada chamada (método, caminho sem o prefixo /api,
 * query, corpo JSON); devolver undefined = 404. Todas as chamadas ficam em `calls`.
 */
export function mockFetch(handler: Handler): { calls: Call[]; fetchMock: ReturnType<typeof vi.fn> } {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname.replace(/^\/api/, ''),
      query: url.searchParams,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    calls.push(call)
    const reply = (await handler(call)) ?? { status: 404, body: { message: 'Not Found' } }
    const status = reply.status ?? 200
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body)
    return new Response(status === 204 ? null : text, { status, headers: reply.headers })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

export function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    name: 'Owner',
    email: 'owner@gingapp.com.br',
    userType: 'PLATFORM',
    isSuperAdmin: true,
    ...overrides,
  }
}

/** Cria um pinia ativo já com sessão (token + usuário) como após o login. */
export function loginAs(user: AuthUser = makeUser()) {
  localStorage.setItem(AUTH_TOKEN_KEY, 'test-token')
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAuthStore()
  return { pinia, store }
}

export function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div>login</div>' } },
      { path: '/dashboard', name: 'dashboard', component: { template: '<div />' } },
      { path: '/organizations/:id', component: { template: '<div />' } },
    ],
  })
}

export async function mountView(
  component: Component,
  user: AuthUser = makeUser(),
): Promise<{ wrapper: VueWrapper; router: ReturnType<typeof makeRouter>; store: ReturnType<typeof useAuthStore> }> {
  const { pinia, store } = loginAs(user)
  const router = makeRouter()
  await router.push('/')
  await router.isReady()
  const wrapper = mount(component, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router, store }
}

export { flushPromises }
