import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, vi } from 'vitest'

// Desmonta os componentes montados em cada teste (inclusive os que usam Teleport/modais).
enableAutoUnmount(afterEach)

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})
