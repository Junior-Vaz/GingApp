// Capturado do backend REAL (e2e group-applications.e2e-spec.ts, 08/11): POST/GET publicos e lista do admin.
export const REAL_ADESAO: Record<string, { status: string; rejectionReason?: string | null; [key: string]: unknown }> = {
  "post201": {
    "statusToken": "R9pnuLPQOMABNNmZnjExeqFMNZuIdKtx1a3hPzK9ihk",
    "status": "PENDING"
  },
  "statusPending": {
    "status": "PENDING",
    "groupName": "E2E Adesao 1794188144830805 grupo 60",
    "createdAt": "2026-11-09T01:35:46.517Z",
    "decidedAt": null,
    "rejectionReason": null,
    "loginUrl": null
  },
  "statusApproved": {
    "status": "APPROVED",
    "groupName": "E2E Adesao 1794188144830805 grupo 64",
    "createdAt": "2026-11-09T01:35:46.917Z",
    "decidedAt": "2026-11-09T01:35:46.932Z",
    "rejectionReason": null,
    "loginUrl": "https://painel.e2e.test/login"
  },
  "statusRejected": {
    "status": "REJECTED",
    "groupName": "E2E Adesao 1794188144830805 grupo 74",
    "createdAt": "2026-11-09T01:35:47.736Z",
    "decidedAt": "2026-11-09T01:35:47.773Z",
    "rejectionReason": "Não encontramos o grupo 1794188144830805; envie o Instagram.",
    "loginUrl": null
  }
};
