// Capturado do backend REAL (e2e group-applications.e2e-spec.ts, 09/11, com confirmacao de e-mail e Instagram).
export const REAL_ADESAO: Record<string, Record<string, unknown>> = {
  "post201Unverified": {
    "statusToken": "bwiUlX3c6P2pcHRXsEA2YrF3TR20SFcUMxl8fAB43xw",
    "status": "UNVERIFIED",
    "emailVerification": "PENDING"
  },
  "post201Pending": {
    "statusToken": "YXEuRG0sglrgWrVryoQ8qe6fw_oM2t2eXP1hDyMiupY",
    "status": "PENDING",
    "emailVerification": "SKIPPED"
  },
  "statusUnverified": {
    "status": "UNVERIFIED",
    "groupName": "E2E Adesao 1794193176541292 grupo 107",
    "createdAt": "2026-11-09T02:59:41.068Z",
    "decidedAt": null,
    "rejectionReason": null,
    "loginUrl": null,
    "emailVerification": "PENDING",
    "canResend": false,
    "resendAvailableAt": "2026-11-09T03:04:41.063Z"
  },
  "statusUnverifiedCanResend": {
    "status": "UNVERIFIED",
    "groupName": "E2E Adesao 1794193176541292 grupo 117",
    "createdAt": "2026-11-09T02:59:41.629Z",
    "decidedAt": null,
    "rejectionReason": null,
    "loginUrl": null,
    "emailVerification": "PENDING",
    "canResend": true,
    "resendAvailableAt": null
  },
  "statusPendingVerified": {
    "status": "PENDING",
    "groupName": "E2E Adesao 1794193176541292 grupo 68",
    "createdAt": "2026-11-09T02:59:38.821Z",
    "decidedAt": null,
    "rejectionReason": null,
    "loginUrl": null,
    "emailVerification": "VERIFIED"
  },
  "statusPendingSkipped": {
    "status": "PENDING",
    "groupName": "E2E Adesao 1794193176541292 grupo 103",
    "createdAt": "2026-11-09T02:59:40.826Z",
    "decidedAt": null,
    "rejectionReason": null,
    "loginUrl": null,
    "emailVerification": "SKIPPED"
  },
  "statusApproved": {
    "status": "APPROVED",
    "groupName": "E2E Adesao 1794193176541292 grupo 72",
    "createdAt": "2026-11-09T02:59:39.272Z",
    "decidedAt": "2026-11-09T02:59:39.299Z",
    "rejectionReason": null,
    "loginUrl": "https://painel.e2e.test/login",
    "emailVerification": "VERIFIED"
  },
  "statusRejected": {
    "status": "REJECTED",
    "groupName": "E2E Adesao 1794193176541292 grupo 82",
    "createdAt": "2026-11-09T02:59:40.324Z",
    "decidedAt": "2026-11-09T02:59:40.375Z",
    "rejectionReason": "Não encontramos o grupo 1794193176541292; envie o Instagram.",
    "loginUrl": null,
    "emailVerification": "VERIFIED"
  },
  "confirm200": {
    "status": "PENDING"
  },
  "confirm404": {
    "message": "Link inválido ou vencido. Confira o acompanhamento do pedido ou faça um novo pedido.",
    "error": "Not Found",
    "statusCode": 404
  },
  "resend204": {
    "status": 204,
    "body": "",
    "cacheControl": "no-store"
  },
  "resend429Cooldown": {
    "statusCode": 429,
    "error": "Too Many Requests",
    "code": "RESEND_COOLDOWN",
    "message": "Aguarde 5 minutos para pedir um novo e-mail de confirmação."
  },
  "resend429Limit": {
    "statusCode": 429,
    "error": "Too Many Requests",
    "code": "RESEND_LIMIT",
    "message": "Este pedido já recebeu o máximo de 3 e-mails de confirmação. Confira a caixa de spam ou faça um novo pedido depois que este vencer."
  }
};
