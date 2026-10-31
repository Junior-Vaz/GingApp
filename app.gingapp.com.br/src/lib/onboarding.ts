import { isPushSupported, needsIosInstall } from "@/lib/push";

export type NotificationPermissionState = NotificationPermission | "unsupported";

export function readNotificationPermission(): NotificationPermissionState {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/**
 * O aparelho PODE receber o convite de notificações? Navegador com push, permissão ainda não decidida ("default") e,
 * no iPhone/iPad, só com o app instalado (fora dele o push não existe: quem cuida é o convite de instalar).
 * O servidor ligar o push (GET /push/config) é checado à parte, pelo próprio cartão.
 */
export function canOfferPush(): boolean {
  return isPushSupported() && !needsIosInstall() && readNotificationPermission() === "default";
}
