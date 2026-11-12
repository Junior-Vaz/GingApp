// Capturado do backend REAL (e2e backend/test/forms-photo-capture.e2e-spec.ts, FORM_CAPTURE_DIR, 12/11): GET /public/forms/:slug de um
// formulario com campo PHOTO obrigatorio + FILE, os uploads (POST /public/forms/:slug/files) e o envio (POST .../submissions), com os
// erros que o app trata (413, 415, 429, 503, 400 de foto obrigatoria/token invalido). Copiado byte a byte de D:/tmp/form-capture
// (so reformatado); nao editar a mao.

/** JSON puro (sem any): a verdade bruta, como o servidor mandou. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const REAL_FORM_WITH_PHOTO: Json = {
  "slug": "campeonato-formcap-1794459346808-4yf6e",
  "title": "Campeonato formcap 1794459346808",
  "intro": null,
  "bannerUrl": null,
  "status": "OPEN",
  "isOpen": true,
  "closedReason": null,
  "event": null,
  "paymentMode": "NONE",
  "priceCents": null,
  "pix": null,
  "sections": [
    {
      "id": 1592,
      "order": 0,
      "title": "Dados do atleta",
      "description": null
    },
    {
      "id": 1593,
      "order": 1,
      "title": "Foto e comprovante",
      "description": null
    }
  ],
  "fields": [
    {
      "key": "nome",
      "type": "SHORT_TEXT",
      "label": "Nome completo",
      "helpText": null,
      "required": true,
      "options": null,
      "validation": null,
      "showIf": null,
      "sectionId": 1592,
      "order": 0,
      "mapsTo": "name"
    },
    {
      "key": "nascimento",
      "type": "DATE",
      "label": "Data de nascimento",
      "helpText": null,
      "required": true,
      "options": null,
      "validation": null,
      "showIf": null,
      "sectionId": 1592,
      "order": 1,
      "mapsTo": "birthDate"
    },
    {
      "key": "email",
      "type": "EMAIL",
      "label": "E-mail",
      "helpText": null,
      "required": true,
      "options": null,
      "validation": null,
      "showIf": null,
      "sectionId": 1592,
      "order": 2,
      "mapsTo": "email"
    },
    {
      "key": "categoria",
      "type": "SELECT",
      "label": "Categoria",
      "helpText": null,
      "required": true,
      "options": [
        "Adulto até 70 kg",
        "Adulto acima de 70 kg",
        "Infantil"
      ],
      "validation": null,
      "showIf": null,
      "sectionId": 1592,
      "order": 3,
      "mapsTo": null
    },
    {
      "key": "foto",
      "type": "PHOTO",
      "label": "Foto do participante",
      "helpText": "Foto de rosto, bem iluminada. Para menores, tirada ou enviada pelo responsável.",
      "required": true,
      "options": null,
      "validation": null,
      "showIf": null,
      "sectionId": 1593,
      "order": 4,
      "mapsTo": null
    },
    {
      "key": "comprovante",
      "type": "FILE",
      "label": "Comprovante do Pix",
      "helpText": "Foto ou PDF do comprovante.",
      "required": false,
      "options": null,
      "validation": null,
      "showIf": null,
      "sectionId": 1593,
      "order": 5,
      "mapsTo": null
    }
  ],
  "consent": {
    "text": "Ao enviar esta inscrição, você concorda que os dados informados sejam usados pelo grupo organizador somente para gerenciar esta inscrição e o evento, conforme a Lei Geral de Proteção de Dados (LGPD - Lei 13.709/2018). Os dados e os anexos serão apagados ou anonimizados 12 meses depois do encerramento das inscrições (ou do envio, quando o formulário não tem data de encerramento). Para pedir acesso, correção ou exclusão dos seus dados, solicite ao organizador do formulário.",
    "version": 1
  },
  "spotsLeft": null,
  "startedToken": "1794459347510.XPmdAcvrcZhYVrV6P4vVjjEWWdUxgWvLoDIWHhqDEnk"
};

export const REAL_UPLOAD_PHOTO_201: Json = {
  "fileToken": "rEygCzSSiSA78IlgMh7jR3vBstcvELH4ZKTkLBPghuk",
  "originalName": "foto.webp",
  "mimeType": "image/webp",
  "sizeBytes": 618
};

export const REAL_UPLOAD_FILE_201: Json = {
  "fileToken": "djxWTZvZAOCeAfk2NgCUIwQBVr860slDmLiNqn-qQwU",
  "originalName": "comprovante.png",
  "mimeType": "image/png",
  "sizeBytes": 5748
};

export const REAL_UPLOAD_PHOTO_413: Json = {
  "message": "O arquivo passa do limite permitido.",
  "error": "Payload Too Large",
  "statusCode": 413,
  "code": "FILE_TOO_LARGE"
};

export const REAL_UPLOAD_PHOTO_415_PDF: Json = {
  "statusCode": 415,
  "error": "Unsupported Media Type",
  "code": "FILE_TYPE_NOT_ALLOWED",
  "message": "Formato não aceito: envie uma foto em JPG, PNG ou WEBP."
};

export const REAL_UPLOAD_PHOTO_415_UNREADABLE: Json = {
  "statusCode": 415,
  "error": "Unsupported Media Type",
  "code": "FILE_TYPE_NOT_ALLOWED",
  "message": "Formato não aceito: envie uma foto em JPG, PNG ou WEBP."
};

export const REAL_UPLOAD_PHOTO_429: Json = {
  "statusCode": 429,
  "error": "Too Many Requests",
  "code": "TOO_MANY_REQUESTS",
  "message": "Muitos arquivos enviados agora. Envie a inscrição com os arquivos já anexados ou tente de novo mais tarde."
};

export const REAL_UPLOAD_PHOTO_503: Json = {
  "statusCode": 503,
  "error": "Service Unavailable",
  "code": "PHOTO_PROCESSING_UNAVAILABLE",
  "message": "O envio de foto está indisponível no momento. Tente novamente mais tarde ou envie a inscrição sem a foto."
};

export const REAL_SUBMISSION_201: Json = {
  "protocol": "INS-4WWJEZ",
  "status": "CONFIRMED",
  "paymentStatus": "NOT_REQUIRED",
  "message": "Inscrição confirmada! Guarde o número do protocolo.",
  "payment": null,
  "proofRequired": false
};

export const REAL_SUBMISSION_400_PHOTO_MISSING: Json = {
  "statusCode": 400,
  "error": "Bad Request",
  "code": "VALIDATION",
  "message": "Confira os campos destacados.",
  "fields": {
    "foto": "Campo obrigatório."
  }
};

export const REAL_SUBMISSION_400_PHOTO_INVALID_TOKEN: Json = {
  "statusCode": 400,
  "error": "Bad Request",
  "code": "VALIDATION",
  "message": "Confira os campos destacados.",
  "fields": {
    "foto": "Arquivo inválido ou expirado: envie o arquivo de novo."
  }
};
