/* eslint-disable */
// Capturado do backend REAL (e2e transparency.e2e-spec.ts, 05/11): GET /transparency e GET /platform-finance/months.
export const REAL_PUBLIC: unknown = {
  "generatedAt": "2026-11-06T02:13:21.350Z",
  "entityName": "Associação Ginga Aberta",
  "introText": "A plataforma é gratuita. Aqui você vê quanto custa e de onde vem o dinheiro.",
  "surplusText": "O que sobra vira reserva para os meses mais apertados.",
  "monthlyGoalCents": 300000,
  "reserveCents": 180000,
  "months": [
    {
      "month": "2026-10",
      "publishedAt": "2026-11-06T02:13:21.189Z",
      "note": "Mês com patrocínio e apoio.",
      "revenueCents": 280000,
      "expenseCents": 250000,
      "balanceCents": 30000,
      "revenueBySource": [
        {
          "category": "PATROCINIO",
          "label": "Patrocínios",
          "cents": 230000
        },
        {
          "category": "APOIO",
          "label": "Apoio de usuários",
          "cents": 50000
        }
      ],
      "expensesByCategory": [
        {
          "category": "HOSPEDAGEM",
          "label": "Hospedagem e servidores",
          "cents": 150000
        },
        {
          "category": "PESSOAS_SUPORTE",
          "label": "Pessoas e suporte",
          "cents": 80000
        },
        {
          "category": "EMAIL",
          "label": "E-mail",
          "cents": 20000
        }
      ],
      "activeStudents": 35,
      "activeGroups": 4,
      "costPerActiveStudentCents": 7143,
      "goalCents": 300000,
      "goalCoveragePct": 93
    },
    {
      "month": "2026-09",
      "publishedAt": "2026-11-06T02:13:21.137Z",
      "note": "Primeiro mês publicado.",
      "revenueCents": 200000,
      "expenseCents": 150000,
      "balanceCents": 50000,
      "revenueBySource": [
        {
          "category": "PATROCINIO",
          "label": "Patrocínios",
          "cents": 200000
        }
      ],
      "expensesByCategory": [
        {
          "category": "HOSPEDAGEM",
          "label": "Hospedagem e servidores",
          "cents": 120000
        },
        {
          "category": "MAPAS",
          "label": "Mapas",
          "cents": 30000
        }
      ],
      "activeStudents": 35,
      "activeGroups": 4,
      "costPerActiveStudentCents": 4286,
      "goalCents": 300000,
      "goalCoveragePct": 67
    }
  ]
};
export const REAL_MONTHS: unknown = {
  "items": [
    {
      "month": "2026-11",
      "published": false,
      "publishedAt": null,
      "note": null,
      "revenueCents": 999,
      "expenseCents": 0,
      "balanceCents": 999,
      "entries": 1,
      "expensesByCategory": [],
      "revenueByCategory": [
        {
          "category": "EDITAIS_OUTROS",
          "label": "Editais e outras receitas",
          "cents": 999
        }
      ],
      "liveActiveStudents": 35,
      "liveActiveGroups": 4,
      "snapshot": null
    },
    {
      "month": "2026-10",
      "published": true,
      "publishedAt": "2026-11-06T02:13:21.189Z",
      "note": "Mês com patrocínio e apoio.",
      "revenueCents": 280000,
      "expenseCents": 250000,
      "balanceCents": 30000,
      "entries": 5,
      "expensesByCategory": [
        {
          "category": "HOSPEDAGEM",
          "label": "Hospedagem e servidores",
          "cents": 150000
        },
        {
          "category": "PESSOAS_SUPORTE",
          "label": "Pessoas e suporte",
          "cents": 80000
        },
        {
          "category": "EMAIL",
          "label": "E-mail",
          "cents": 20000
        }
      ],
      "revenueByCategory": [
        {
          "category": "PATROCINIO",
          "label": "Patrocínios",
          "cents": 230000
        },
        {
          "category": "APOIO",
          "label": "Apoio de usuários",
          "cents": 50000
        }
      ],
      "liveActiveStudents": null,
      "liveActiveGroups": null,
      "snapshot": {
        "activeStudents": 35,
        "activeGroups": 4,
        "goalCents": 300000
      }
    },
    {
      "month": "2026-09",
      "published": true,
      "publishedAt": "2026-11-06T02:13:21.137Z",
      "note": "Primeiro mês publicado.",
      "revenueCents": 200000,
      "expenseCents": 150000,
      "balanceCents": 50000,
      "entries": 3,
      "expensesByCategory": [
        {
          "category": "HOSPEDAGEM",
          "label": "Hospedagem e servidores",
          "cents": 120000
        },
        {
          "category": "MAPAS",
          "label": "Mapas",
          "cents": 30000
        }
      ],
      "revenueByCategory": [
        {
          "category": "PATROCINIO",
          "label": "Patrocínios",
          "cents": 200000
        }
      ],
      "liveActiveStudents": null,
      "liveActiveGroups": null,
      "snapshot": {
        "activeStudents": 35,
        "activeGroups": 4,
        "goalCents": 300000
      }
    }
  ]
};
