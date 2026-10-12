/* Service worker do Firebase Cloud Messaging (FCM) do GingApp.
 *
 * É SEPARADO do sw.js do PWA (vite-plugin-pwa/workbox): o app o registra com escopo próprio
 * (/firebase-cloud-messaging-push-scope), então os dois nunca disputam o controle das páginas nem o precache. Este arquivo
 * NÃO faz cache de nada e nunca toca em respostas da API.
 *
 * Um service worker não enxerga a config de runtime do app, então ela vem na URL de registro:
 *   /firebase-messaging-sw.js?apiKey=...&authDomain=...&projectId=...&messagingSenderId=...&appId=...
 * (são chaves públicas do SDK web, servidas por GET /api/push/config). Sem elas este worker fica inerte.
 *
 * Comportamento do SDK: com o app ABERTO e visível o SDK repassa a mensagem à página (onMessage -> toast + sino) e não
 * mostra nada; com o app fechado/em segundo plano o SDK mostra a `notification` da mensagem sozinho e chama
 * onBackgroundMessage. Mensagens só com `data` (sem `notification`) são exibidas aqui.
 * Payload do backend: { title, body, url, tag } - sem dados sensíveis.
 */

// Mantenha igual à versão do pacote `firebase` do app (package.json). Versão fixa: o gstatic é imutável por versão.
const FIREBASE_SDK_VERSION = "12.19.0";
const ICON = "/icon-192.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Só caminhos do próprio app: qualquer URL de outra origem cai na raiz. */
function resolveTarget(notification) {
  const data = (notification && notification.data) || {};
  const fcm = data.FCM_MSG || {};
  const candidate =
    (typeof data.url === "string" && data.url) ||
    (fcm.data && typeof fcm.data.url === "string" && fcm.data.url) ||
    (fcm.fcmOptions && typeof fcm.fcmOptions.link === "string" && fcm.fcmOptions.link) ||
    (fcm.notification && typeof fcm.notification.click_action === "string" && fcm.notification.click_action) ||
    "/";
  let target = new URL("/", self.location.origin);
  try {
    const parsed = new URL(candidate, self.location.origin);
    if (parsed.origin === self.location.origin) target = parsed;
  } catch (error) {
    /* mantem a raiz */
  }
  return target;
}

// Registrado ANTES do SDK (que também escuta notificationclick): este trata o clique e interrompe os demais, para
// nunca abrir duas janelas.
self.addEventListener("notificationclick", (event) => {
  event.stopImmediatePropagation();
  event.notification.close();
  const target = resolveTarget(event.notification);
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

const params = new URL(self.location.href).searchParams;
const config = {};
for (const key of ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"]) {
  const value = params.get(key);
  if (value) config[key] = value;
}

if (config.apiKey && config.projectId && config.messagingSenderId && config.appId) {
  importScripts(
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js`,
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-messaging-compat.js`,
  );
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    // Com `notification` no payload o SDK já exibiu (com ícone/badge/tag vindos do backend): não duplicar.
    if (payload && payload.notification) return;
    const data = (payload && payload.data) || {};
    const title = typeof data.title === "string" && data.title ? data.title : "GingApp";
    return self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: ICON,
      badge: ICON,
      tag: typeof data.tag === "string" && data.tag ? data.tag : "gingapp",
      renotify: true,
      data: { url: typeof data.url === "string" ? data.url : "/" },
    });
  });
}
