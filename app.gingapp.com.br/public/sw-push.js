/* Web Push do GingApp. Carregado pelo sw.js gerado pelo vite-plugin-pwa (workbox.importScripts).
 * Payload esperado (backend, shared/push): { title, body, url, tag } - sem dados sensiveis.
 * Nada daqui toca em cache nem em respostas da API. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "GingApp";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: typeof data.tag === "string" && data.tag ? data.tag : "gingapp",
    renotify: true,
    data: { url: typeof data.url === "string" ? data.url : "/" },
  };
  // userVisibleOnly: todo push precisa mostrar uma notificacao (o iOS revoga a inscricao se nao mostrar).
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Só abre caminhos do proprio app: qualquer URL de outra origem cai na raiz.
  let target = new URL("/", self.location.origin);
  try {
    const candidate = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
    if (candidate.origin === self.location.origin) target = candidate;
  } catch (error) {
    /* mantem a raiz */
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        const focused = "focus" in client ? await client.focus() : client;
        if (focused && "navigate" in focused) {
          try {
            return await focused.navigate(target.href);
          } catch (error) {
            /* cai para openWindow */
          }
        }
        break;
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
