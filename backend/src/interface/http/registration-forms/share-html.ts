import { createHash } from 'node:crypto';
import { escapeHtml } from '../../../shared/mail/mail-templates';

/**
 * HTML minimo para a PRE-VISUALIZACAO do link /i/<slug> (WhatsApp, Instagram, Telegram...): so as tags Open Graph /
 * Twitter. O nginx do app manda para ca apenas os robos de preview; uma pessoa que caia aqui e redirecionada para a SPA
 * (meta refresh + link + script, com `?src=share` para o nginx nao devolver o robo de novo). TODO valor e escapado.
 */

export interface ShareCard {
  title: string;
  description: string;
  imageUrl: string;
  /** URL canonica (og:url): `${APP_URL}/i/<slug>`. */
  url: string;
  /** Para onde levar a pessoa (SPA). null = sem redirecionamento (404 neutro). */
  redirectUrl: string | null;
}

/** Texto sem marcacao (HTML/Markdown simples), espacos colapsados, cortado em `max` caracteres. */
export function plainExcerpt(text: string | null | undefined, max = 150): string {
  if (!text) return '';
  const plain = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`#>~]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** URL absoluta de imagem: "/api/uploads/x.webp" vira `${appUrl}/api/uploads/x.webp`; http(s) fica; resto = null. */
export function absoluteImageUrl(value: string | null | undefined, appUrl: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return `${appUrl}${value}`;
  return null;
}

export function renderShareHtml(card: ShareCard): { html: string; scriptHash: string | null } {
  const t = escapeHtml(card.title);
  const d = escapeHtml(card.description);
  const img = escapeHtml(card.imageUrl);
  const url = escapeHtml(card.url);
  // JSON.stringify + escape de "<" impede fechar o <script> por dentro da string.
  const script = card.redirectUrl ? `location.replace(${JSON.stringify(card.redirectUrl).replace(/</g, '\\u003c')});` : null;
  const redirect = card.redirectUrl ? escapeHtml(card.redirectUrl) : null;
  const html =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${t}</title>` +
    `<meta name="description" content="${d}">` +
    '<meta property="og:type" content="website">' +
    '<meta property="og:site_name" content="GingApp">' +
    '<meta property="og:locale" content="pt_BR">' +
    `<meta property="og:title" content="${t}">` +
    `<meta property="og:description" content="${d}">` +
    `<meta property="og:image" content="${img}">` +
    `<meta property="og:url" content="${url}">` +
    '<meta name="twitter:card" content="summary_large_image">' +
    `<meta name="twitter:title" content="${t}">` +
    `<meta name="twitter:description" content="${d}">` +
    `<meta name="twitter:image" content="${img}">` +
    (redirect ? `<meta http-equiv="refresh" content="0;url=${redirect}">` : '') +
    '<meta name="robots" content="noindex">' +
    '</head><body>' +
    `<h1>${t}</h1><p>${d}</p>` +
    (redirect ? `<p><a href="${redirect}">Abrir o formulário de inscrição</a></p>` : '') +
    (script ? `<script>${script}</script>` : '') +
    '</body></html>';
  const scriptHash = script ? createHash('sha256').update(script).digest('base64') : null;
  return { html, scriptHash };
}
