import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { formatCivilDateBR } from '../../../shared/dates/format-br';

/** Dados do certificado impresso. Nada além do que a verificação pública já mostraria (+ graduação, só na rota autenticada). */
export interface CertificatePdfData {
  organizationName: string;
  studentName: string;
  title: string;
  /** Nome do nível de graduação vinculado (opcional). */
  graduationName?: string | null;
  issuedAt: Date;
  verificationCode: string;
  /** URL pública de verificação (APP_URL/verificar/<código>); sem ela o PDF sai só com o código. */
  verificationUrl?: string | null;
}

const INK = '#1f2933';
const MUTED = '#52606d';
const ACCENT = '#b4531a';

/**
 * Gera o certificado em PDF (A4 paisagem) com pdfkit + QR de verificação (lib `qrcode`, a mesma dos frontends).
 * Só fontes padrão (Helvetica): cobre os acentos do português. Devolve o arquivo inteiro em memória (poucos KB).
 */
export async function renderCertificatePdf(data: CertificatePdfData): Promise<Buffer> {
  const qr = data.verificationUrl
    ? await QRCode.toBuffer(data.verificationUrl, { type: 'png', margin: 1, width: 240, errorCorrectionLevel: 'M' })
    : null;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    info: {
      Title: `Certificado - ${data.title}`.slice(0, 200),
      Author: data.organizationName.slice(0, 200),
      Producer: 'GingApp',
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const W = doc.page.width;
  const H = doc.page.height;
  const left = 70;
  const textWidth = W - left * 2;

  // Moldura dupla.
  doc.lineWidth(3).strokeColor(ACCENT).rect(24, 24, W - 48, H - 48).stroke();
  doc.lineWidth(0.8).strokeColor(ACCENT).rect(32, 32, W - 64, H - 64).stroke();

  doc.fillColor(MUTED).font('Helvetica').fontSize(13).text(data.organizationName.toUpperCase(), left, 70, {
    width: textWidth,
    align: 'center',
    characterSpacing: 1.5,
  });
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(40).text('CERTIFICADO', left, 100, {
    width: textWidth,
    align: 'center',
    characterSpacing: 4,
  });

  doc.fillColor(MUTED).font('Helvetica').fontSize(14).text('Certificamos que', left, 175, {
    width: textWidth,
    align: 'center',
  });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(30).text(data.studentName, left, 200, {
    width: textWidth,
    align: 'center',
  });
  const afterName = doc.y + 14;
  doc.fillColor(MUTED).font('Helvetica').fontSize(14).text('recebeu o certificado', left, afterName, {
    width: textWidth,
    align: 'center',
  });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(data.title, left, doc.y + 8, {
    width: textWidth,
    align: 'center',
  });
  if (data.graduationName) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(14).text(`Graduação: ${data.graduationName}`, left, doc.y + 8, {
      width: textWidth,
      align: 'center',
    });
  }

  // Rodapé: data e código à esquerda, QR à direita.
  const footerTop = H - 150;
  doc.fillColor(INK).font('Helvetica').fontSize(12).text(`Emitido em ${formatCivilDateBR(data.issuedAt)}`, left, footerTop, {
    width: 360,
  });
  doc.fillColor(MUTED).fontSize(10).text(`Código de verificação: ${data.verificationCode}`, left, footerTop + 22, { width: 420 });
  if (data.verificationUrl) {
    doc.text('Confira a autenticidade lendo o QR Code ou acessando:', left, footerTop + 40, { width: 420 });
    doc.fillColor(ACCENT).text(data.verificationUrl, left, footerTop + 54, { width: 420 });
  }
  if (qr) {
    doc.image(qr, W - left - 90, footerTop - 20, { width: 90, height: 90 });
  }

  doc.end();
  return done;
}
