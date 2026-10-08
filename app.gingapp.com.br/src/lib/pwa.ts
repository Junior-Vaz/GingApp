/**
 * Registra o service worker só em produção, fora de iframes e sem `?sw=off`.
 * O SW gerado pelo vite-plugin-pwa faz precache apenas de shell e assets - nunca de /api/.
 */
export async function registerAppWorker() {
  if (!("serviceWorker" in navigator)) return;
  const refused =
    !import.meta.env.PROD ||
    window.self !== window.top ||
    new URLSearchParams(location.search).get("sw") === "off";
  if (refused) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) =>
          [registration.active, registration.waiting, registration.installing].some(
            (worker) => worker && new URL(worker.scriptURL).pathname === "/sw.js",
          ),
        )
        .map((registration) => registration.unregister()),
    );
    return;
  }
  const { registerSW } = await import("virtual:pwa-register");
  registerSW({ immediate: true });
}
