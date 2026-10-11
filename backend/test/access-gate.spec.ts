import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accessGateViolation,
  isTermsEnforced,
  MUST_CHANGE_PASSWORD_CODE,
  TERMS_NOT_ACCEPTED_CODE,
} from '../src/shared/access/access-gate';
import {
  buildTermsStatus,
  getLegalDocument,
  LEGAL_NOTICE,
  LEGAL_VERSION,
  termsAcceptanceRequired,
} from '../src/shared/legal/legal-documents';

/**
 * E10 + mustChangePassword: regras PURAS (sem banco). A prova por HTTP real está em
 * must-change-password.e2e-spec.ts e legal-terms.e2e-spec.ts.
 */
describe('portões de acesso (access-gate)', () => {
  const off = { enforceTerms: false };
  const on = { enforceTerms: true };

  it('sem usuário ou sem pendência: passa', () => {
    assert.equal(accessGateViolation(undefined, [], on), null);
    assert.equal(accessGateViolation({}, [], off), null);
    assert.equal(accessGateViolation({ mustChangePassword: false, acceptedTermsVersion: LEGAL_VERSION }, [], on), null);
  });

  it('senha provisória pendente: bloqueia com MUST_CHANGE_PASSWORD, exceto rotas isentas', () => {
    const user = { mustChangePassword: true, acceptedTermsVersion: LEGAL_VERSION };
    assert.equal(accessGateViolation(user, [], off)?.code, MUST_CHANGE_PASSWORD_CODE);
    assert.equal(accessGateViolation(user, ['terms'], off)?.code, MUST_CHANGE_PASSWORD_CODE, 'isentar só o aceite não libera a troca');
    assert.equal(accessGateViolation(user, ['mustChangePassword'], off), null);
  });

  it('aceite pendente: NÃO bloqueia por padrão; com TERMS_ENFORCEMENT bloqueia (TERMS_NOT_ACCEPTED), exceto rotas isentas', () => {
    const never = { mustChangePassword: false, acceptedTermsVersion: null };
    const old = { mustChangePassword: false, acceptedTermsVersion: '1999-01-01.1' };
    assert.equal(accessGateViolation(never, [], off), null, 'padrão: o frontend é quem exige o aceite');
    assert.equal(accessGateViolation(never, [], on)?.code, TERMS_NOT_ACCEPTED_CODE);
    assert.equal(accessGateViolation(old, [], on)?.code, TERMS_NOT_ACCEPTED_CODE, 'versão antiga volta a exigir');
    assert.equal(accessGateViolation(never, ['terms'], on), null);
    assert.equal(accessGateViolation(never, ['mustChangePassword'], on)?.code, TERMS_NOT_ACCEPTED_CODE);
  });

  it('a senha provisória vem antes do aceite quando as duas pendências existem', () => {
    const both = { mustChangePassword: true, acceptedTermsVersion: null };
    assert.equal(accessGateViolation(both, [], on)?.code, MUST_CHANGE_PASSWORD_CODE);
    assert.equal(accessGateViolation(both, ['mustChangePassword'], on)?.code, TERMS_NOT_ACCEPTED_CODE);
  });

  it('isTermsEnforced: só "true" liga', () => {
    assert.equal(isTermsEnforced({}), false);
    assert.equal(isTermsEnforced({ TERMS_ENFORCEMENT: 'false' }), false);
    assert.equal(isTermsEnforced({ TERMS_ENFORCEMENT: '1' }), false);
    assert.equal(isTermsEnforced({ TERMS_ENFORCEMENT: 'true' }), true);
  });
});

describe('textos legais (shared/legal)', () => {
  it('termos e política: versão única, aviso de modelo e conteúdo não vazio', () => {
    for (const type of ['terms', 'privacy'] as const) {
      const doc = getLegalDocument(type);
      assert.equal(doc.type, type);
      assert.equal(doc.version, LEGAL_VERSION);
      assert.equal(doc.notice, LEGAL_NOTICE);
      assert.match(doc.notice, /MODELO/);
      assert.match(doc.notice, /assessoria jurídica/);
      assert.ok(doc.sections.length >= 10, `${type} tem seções suficientes`);
      for (const section of doc.sections) {
        assert.ok(section.heading.length > 0 && section.paragraphs.length > 0 && section.paragraphs.every((p) => p.length > 20));
      }
    }
  });

  it('política cobre menores (consentimento do responsável), direitos do titular e retenção do backup', () => {
    const text = getLegalDocument('privacy')
      .sections.flatMap((s) => [s.heading, ...s.paragraphs])
      .join('\n');
    assert.match(text, /responsável legal/);
    assert.match(text, /art\. 14/);
    assert.match(text, /art\. 18/);
    assert.match(text, /14 dias/);
    const terms = getLegalDocument('terms')
      .sections.flatMap((s) => [s.heading, ...s.paragraphs])
      .join('\n');
    assert.match(terms, /menores de 18 anos/);
  });

  it('aceite pendente: nunca aceitou ou versão diferente da vigente', () => {
    assert.equal(termsAcceptanceRequired(null), true);
    assert.equal(termsAcceptanceRequired(undefined), true);
    assert.equal(termsAcceptanceRequired('2000-01-01.1'), true);
    assert.equal(termsAcceptanceRequired(LEGAL_VERSION), false);
    const accepted = new Date();
    assert.deepEqual(buildTermsStatus({ acceptedTermsVersion: LEGAL_VERSION, acceptedTermsAt: accepted }), {
      currentTermsVersion: LEGAL_VERSION,
      acceptedTermsVersion: LEGAL_VERSION,
      acceptedTermsAt: accepted,
      termsAcceptanceRequired: false,
    });
    assert.equal(buildTermsStatus({ acceptedTermsVersion: null, acceptedTermsAt: null }).termsAcceptanceRequired, true);
  });
});
