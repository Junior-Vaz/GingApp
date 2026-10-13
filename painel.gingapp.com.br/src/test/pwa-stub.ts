// Stub do módulo virtual do vite-plugin-pwa nos testes (o plugin não roda no vitest).
export function registerSW() {
  return () => Promise.resolve();
}
