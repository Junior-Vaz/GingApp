import { RopeStyle } from '@prisma/client';

/**
 * Modelos GENÉRICOS de sistema de graduação (sem marca de nenhum grupo real) para o painel criar um sistema pronto
 * em um clique (POST /graduations/systems/from-template). Estáticos: a ordem dos níveis é a do array (1 = mais baixo).
 * Invariantes (cobertas por test/graduation-rope.spec.ts): <= 30 níveis, SOLID = 1 cor, SPLIT/BRAIDED = 2 ou 3 cores,
 * hex #RRGGBB, sem cores consecutivas iguais.
 */
export interface GraduationTemplateLevel {
  name: string;
  style: RopeStyle;
  colors: string[];
}

export interface GraduationTemplate {
  code: string;
  name: string;
  description: string;
  levels: GraduationTemplateLevel[];
}

const C = {
  crua: '#E8DFC8',
  amarela: '#FACC15',
  laranja: '#F97316',
  azul: '#2563EB',
  verde: '#16A34A',
  roxa: '#7C3AED',
  marrom: '#78350F',
  vermelha: '#DC2626',
  branca: '#FFFFFF',
} as const;

const { SOLID, SPLIT, BRAIDED } = RopeStyle;

const solid = (name: string, color: string): GraduationTemplateLevel => ({ name, style: SOLID, colors: [color] });
const split = (name: string, ...colors: string[]): GraduationTemplateLevel => ({ name, style: SPLIT, colors });
const braided = (name: string, ...colors: string[]): GraduationTemplateLevel => ({ name, style: BRAIDED, colors });

export const GRADUATION_TEMPLATES: GraduationTemplate[] = [
  {
    code: 'cores-simples-tradicional',
    name: 'Cores simples tradicional',
    description:
      'Sequência tradicional de cores, com uma corda dividida entre cada cor e a seguinte (Crua, Crua/Amarela, Amarela...). 15 níveis.',
    levels: [
      solid('Crua', C.crua),
      split('Crua/Amarela', C.crua, C.amarela),
      solid('Amarela', C.amarela),
      split('Amarela/Laranja', C.amarela, C.laranja),
      solid('Laranja', C.laranja),
      split('Laranja/Azul', C.laranja, C.azul),
      solid('Azul', C.azul),
      split('Azul/Verde', C.azul, C.verde),
      solid('Verde', C.verde),
      split('Verde/Roxa', C.verde, C.roxa),
      solid('Roxa', C.roxa),
      split('Roxa/Marrom', C.roxa, C.marrom),
      solid('Marrom', C.marrom),
      split('Marrom/Vermelha', C.marrom, C.vermelha),
      solid('Vermelha', C.vermelha),
    ],
  },
  {
    code: 'cores-classicas-10-graus',
    name: 'Sistema por cores clássicas (10 graus)',
    description:
      'Dez graus combinando verde, amarelo, azul e branco: cordas lisas, divididas e trançadas (a última com 3 cores).',
    levels: [
      solid('Verde', C.verde),
      split('Verde/Amarela', C.verde, C.amarela),
      solid('Amarela', C.amarela),
      split('Amarela/Azul', C.amarela, C.azul),
      solid('Azul', C.azul),
      split('Azul/Branca', C.azul, C.branca),
      solid('Branca', C.branca),
      braided('Verde/Amarela trançada', C.verde, C.amarela),
      braided('Amarela/Azul trançada', C.amarela, C.azul),
      braided('Verde/Amarela/Azul trançada', C.verde, C.amarela, C.azul),
    ],
  },
  {
    code: 'infantil-cores',
    name: 'Infantil por cores',
    description: 'Sete cordas lisas e coloridas, para turmas infantis que trocam de cor a cada etapa.',
    levels: [
      solid('Crua', C.crua),
      solid('Amarela', C.amarela),
      solid('Laranja', C.laranja),
      solid('Verde', C.verde),
      solid('Azul', C.azul),
      solid('Roxa', C.roxa),
      solid('Vermelha', C.vermelha),
    ],
  },
  {
    code: 'divididas',
    name: 'Divididas (metade/metade)',
    description: 'Cordas divididas ao meio (duas cores lado a lado); a última tem três faixas.',
    levels: [
      split('Crua/Amarela', C.crua, C.amarela),
      split('Amarela/Laranja', C.amarela, C.laranja),
      split('Laranja/Verde', C.laranja, C.verde),
      split('Verde/Azul', C.verde, C.azul),
      split('Azul/Roxa', C.azul, C.roxa),
      split('Roxa/Marrom', C.roxa, C.marrom),
      split('Marrom/Vermelha', C.marrom, C.vermelha),
      split('Verde/Amarela/Azul', C.verde, C.amarela, C.azul),
    ],
  },
  {
    code: 'trancadas',
    name: 'Trançadas',
    description: 'Cordas trançadas (listras diagonais) de duas cores; as duas últimas combinam três cores.',
    levels: [
      braided('Crua/Amarela', C.crua, C.amarela),
      braided('Amarela/Laranja', C.amarela, C.laranja),
      braided('Laranja/Verde', C.laranja, C.verde),
      braided('Verde/Azul', C.verde, C.azul),
      braided('Azul/Roxa', C.azul, C.roxa),
      braided('Roxa/Marrom', C.roxa, C.marrom),
      braided('Verde/Amarela/Azul', C.verde, C.amarela, C.azul),
      braided('Amarela/Azul/Branca', C.amarela, C.azul, C.branca),
    ],
  },
];

export const findGraduationTemplate = (code: string): GraduationTemplate | undefined =>
  GRADUATION_TEMPLATES.find((t) => t.code === code);
