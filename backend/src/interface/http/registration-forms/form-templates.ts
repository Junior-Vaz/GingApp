import { FieldType, MapsTo } from './form-definition';

/** Modelos prontos (GET /event-forms/templates). Textos em portugues, todos editaveis depois no construtor. */
export const TEMPLATE_KEYS = ['CAMPEONATO', 'BATIZADO', 'CURSO', 'RODA', 'SIMPLES'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplateField {
  key: string;
  type: FieldType;
  label: string;
  helpText?: string;
  required?: boolean;
  options?: string[];
  showIf?: { fieldKey: string; equals: string | number | boolean };
  mapsTo?: MapsTo;
}

export interface TemplateSection {
  title: string;
  description?: string;
  fields: TemplateField[];
}

export interface FormTemplate {
  key: TemplateKey;
  name: string;
  description: string;
  /** Pix manual por padrao (o Mestre ainda precisa preencher a chave antes de publicar). */
  paid: boolean;
  intro: string;
  sections: TemplateSection[];
}

const nome: TemplateField = { key: 'nome_completo', type: 'SHORT_TEXT', label: 'Nome completo', required: true, mapsTo: 'name' };
const apelido: TemplateField = {
  key: 'apelido',
  type: 'SHORT_TEXT',
  label: 'Apelido',
  helpText: 'Caso não tenha, escreva "Não tenho".',
  required: true,
  mapsTo: 'nickname',
};
const nascimento: TemplateField = { key: 'data_nascimento', type: 'DATE', label: 'Data de nascimento', required: true, mapsTo: 'birthDate' };
const cpf: TemplateField = { key: 'cpf', type: 'CPF', label: 'CPF', helpText: 'Opcional. Usado só para identificar a sua inscrição.', mapsTo: 'document' };
const telefone: TemplateField = { key: 'telefone', type: 'PHONE', label: 'Telefone / WhatsApp', helpText: 'Com DDD.', required: true, mapsTo: 'phone' };
const email: TemplateField = { key: 'email', type: 'EMAIL', label: 'E-mail', required: true, mapsTo: 'email' };
const graduacao: TemplateField = { key: 'graduacao', type: 'SHORT_TEXT', label: 'Graduação / corda', mapsTo: 'cord' };
const grupo: TemplateField = { key: 'grupo', type: 'SHORT_TEXT', label: 'Grupo / associação', mapsTo: 'group' };
const professor: TemplateField = { key: 'professor', type: 'SHORT_TEXT', label: 'Professor / mestre', mapsTo: 'teacher' };

/**
 * Menores de idade (LGPD art. 14 / ECA): modelos que pedem nascimento/CPF perguntam se o participante e menor e, se
 * for, exigem os dados e a AUTORIZACAO do responsavel (campos condicionais, showIf = "Sim"). Chaves estaveis.
 */
const MENOR = { fieldKey: 'menor_idade', equals: 'Sim' } as const;
const menorIdade: TemplateField = {
  key: 'menor_idade',
  type: 'SINGLE_CHOICE',
  label: 'O participante é menor de 18 anos?',
  options: ['Sim', 'Não'],
  required: true,
};
function responsavelSection(autorizacao: string): TemplateSection {
  return {
    title: 'Dados do responsável',
    description: 'Preencha somente se o participante for menor de 18 anos.',
    fields: [
      { key: 'responsavel_nome', type: 'SHORT_TEXT', label: 'Nome completo do responsável', required: true, showIf: MENOR },
      { key: 'responsavel_cpf', type: 'CPF', label: 'CPF do responsável', required: true, showIf: MENOR },
      { key: 'responsavel_telefone', type: 'PHONE', label: 'Telefone / WhatsApp do responsável', helpText: 'Com DDD.', required: true, showIf: MENOR },
      { key: 'responsavel_parentesco', type: 'SHORT_TEXT', label: 'Parentesco com o participante', helpText: 'Ex.: mãe, pai, avó, tutor legal.', required: true, showIf: MENOR },
      { key: 'responsavel_autorizacao', type: 'CONSENT', label: autorizacao, required: true, showIf: MENOR },
    ],
  };
}
/** Uso de imagem: SEMPRE um aceite separado e OPCIONAL (nunca condicao para se inscrever). */
const termoImagem: TemplateField = {
  key: 'termo_imagem',
  type: 'CONSENT',
  label: 'Autorizo o uso da imagem do participante em fotos e vídeos do evento para divulgação do grupo (opcional).',
  required: false,
};

export const FORM_TEMPLATES: Record<TemplateKey, FormTemplate> = {
  CAMPEONATO: {
    key: 'CAMPEONATO',
    name: 'Campeonato',
    description:
      'Dados do competidor (com responsável quando menor de idade), capoeira (graduação, grupo, professor, categoria), termos e pagamento por Pix com comprovante.',
    paid: true,
    intro: 'Preencha os dados abaixo para se inscrever no campeonato. Leia os termos com atenção e anexe o comprovante do Pix no final.',
    sections: [
      { title: 'Dados do competidor', fields: [nome, apelido, nascimento, cpf, telefone, email, menorIdade] },
      responsavelSection(
        'Sou o responsável legal pelo participante menor de idade e autorizo a participação dele no campeonato, assumindo a responsabilidade por ela.',
      ),
      {
        title: 'Capoeira',
        fields: [
          graduacao,
          grupo,
          professor,
          {
            key: 'categoria',
            type: 'SELECT',
            label: 'Categoria',
            helpText: 'Ajuste as categorias do seu campeonato.',
            options: ['Infantil (até 12 anos)', 'Juvenil (13 a 17 anos)', 'Adulto (18 anos ou mais)'],
          },
        ],
      },
      {
        title: 'Termos',
        fields: [
          {
            key: 'termo_responsabilidade',
            type: 'CONSENT',
            label:
              'Declaro que o participante está em boas condições de saúde para participar do campeonato e assumo a ' +
              'responsabilidade pela participação (a minha ou a do menor que inscrevo).',
            required: true,
          },
          termoImagem,
        ],
      },
      {
        title: 'Pagamento',
        fields: [
          {
            key: 'instrucoes_pagamento',
            type: 'INFO',
            label: 'Pagamento da inscrição',
            helpText: 'Faça o Pix no valor indicado para a chave mostrada nesta página e anexe o comprovante abaixo.',
          },
          {
            key: 'comprovante',
            type: 'FILE',
            label: 'Comprovante do Pix',
            helpText: 'Imagem (JPG, PNG ou WEBP) ou PDF, até 5 MB.',
            required: true,
          },
        ],
      },
    ],
  },
  BATIZADO: {
    key: 'BATIZADO',
    name: 'Batizado / troca de corda',
    description: 'Dados do participante (com responsável quando menor de idade), graduação atual e termos.',
    paid: false,
    intro: 'Inscrição para o batizado e troca de cordas. Preencha os dados do participante.',
    sections: [
      { title: 'Participante', fields: [nome, apelido, nascimento, telefone, email, menorIdade] },
      responsavelSection('Sou o responsável legal pelo participante menor de idade e autorizo a participação dele no batizado.'),
      {
        title: 'Capoeira',
        fields: [{ ...graduacao, label: 'Graduação / corda atual' }, professor],
      },
      {
        title: 'Termos',
        fields: [
          {
            key: 'termo_autorizacao',
            type: 'CONSENT',
            label: 'Confirmo os dados acima e a participação no batizado.',
            required: true,
          },
          termoImagem,
        ],
      },
    ],
  },
  CURSO: {
    key: 'CURSO',
    name: 'Curso / oficina',
    description: 'Dados de contato e experiência na capoeira (com pergunta condicional).',
    paid: false,
    intro: 'Inscrição no curso/oficina. As vagas são limitadas.',
    sections: [
      {
        title: 'Seus dados',
        fields: [
          nome,
          telefone,
          email,
          { key: 'pratica_capoeira', type: 'SINGLE_CHOICE', label: 'Já pratica capoeira?', options: ['Sim', 'Não'], required: true },
          { ...grupo, showIf: { fieldKey: 'pratica_capoeira', equals: 'Sim' } },
        ],
      },
    ],
  },
  RODA: {
    key: 'RODA',
    name: 'Roda / encontro',
    description: 'Inscrição rápida: nome, contato e grupo.',
    paid: false,
    intro: 'Confirme a sua presença na roda.',
    sections: [{ title: 'Seus dados', fields: [nome, telefone, grupo] }],
  },
  SIMPLES: {
    key: 'SIMPLES',
    name: 'Inscrição simples',
    description: 'Só nome, telefone e e-mail. Acrescente o que precisar.',
    paid: false,
    intro: '',
    sections: [{ title: 'Seus dados', fields: [nome, telefone, email] }],
  },
};

export function listTemplates(): Array<{ key: TemplateKey; name: string; description: string }> {
  return TEMPLATE_KEYS.map((key) => ({ key, name: FORM_TEMPLATES[key].name, description: FORM_TEMPLATES[key].description }));
}
