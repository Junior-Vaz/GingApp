// Dados ESTÁTICOS do grupo demo (prisma/demo.ts). Só descrições: nenhuma data absoluta aqui —
// tudo que depende do calendário (nascimento, matrícula, graduação, aulas, cobranças, eventos)
// é calculado em demo.ts a partir do "hoje" da execução, para a demonstração nunca envelhecer.
//
// Tudo é fictício: nomes, e-mails (domínio demo) e telefones (padrão 99999-0xxx) não pertencem a
// pessoas reais. Nenhum CPF/documento é gerado de propósito.

import { OrgRole, StudentStatus } from '@prisma/client';

export type UnitKey = 'matriz' | 'anapolis' | 'brasilia';
export type ClassKey = 'infantil' | 'iniciante' | 'avancado' | 'juvenil' | 'adultoAnapolis' | 'brasilia';
export type AccountKey = 'mestre' | 'professor1' | 'professor2' | 'professor3' | 'aluno1' | 'aluno2' | 'aluno3' | 'aluno4';

/** Ponto no mapa da comunidade (GET /map/places). */
export interface DemoCoordinates {
  latitude: number;
  longitude: number;
}

export interface UnitSpec {
  key: UnitKey;
  name: string;
  address: string;
  city: string;
  state: string;
  isMain: boolean;
  /** Coordenadas reais aproximadas do endereço (mapa da comunidade). */
  coordinates: DemoCoordinates;
}

export const UNITS: UnitSpec[] = [
  { key: 'matriz', name: 'Matriz — Goiânia', address: 'Rua 7, 450 — Setor Central', city: 'Goiânia', state: 'GO', isMain: true,
    coordinates: { latitude: -16.6772, longitude: -49.2531 } },
  { key: 'anapolis', name: 'Filial — Anápolis', address: 'Av. Brasil Norte, 1280 — Jundiaí', city: 'Anápolis', state: 'GO', isMain: false,
    coordinates: { latitude: -16.3069, longitude: -48.9494 } },
  { key: 'brasilia', name: 'Filial — Brasília', address: 'SQS 308, Bloco C — Asa Sul', city: 'Brasília', state: 'DF', isMain: false,
    coordinates: { latitude: -15.8247, longitude: -47.9143 } },
];

/**
 * Coordenadas dos locais de eventos/rodas do demo, pelo texto exato de `location`. Local que não está aqui herda
 * as coordenadas da unidade do evento (ver stepEvents). Só preenche onde a latitude ainda é nula (idempotente).
 */
export const DEMO_LOCATION_COORDINATES: Record<string, DemoCoordinates> = {
  'Praça Cívica, Goiânia': { latitude: -16.6799, longitude: -49.2550 },
  'Parque Vaca Brava, Goiânia': { latitude: -16.7086, longitude: -49.2692 },
  'Praça Bom Jesus, Anápolis': { latitude: -16.3263, longitude: -48.9528 },
  'Parque da Cidade Sarah Kubitschek, Brasília': { latitude: -15.7989, longitude: -47.9028 },
  'Ginásio Poliesportivo do Setor Central, Goiânia': { latitude: -16.6830, longitude: -49.2610 },
  'Casa de Cultura da Asa Sul, Brasília': { latitude: -15.8160, longitude: -47.9060 },
  'Caldas Novas, GO': { latitude: -17.7441, longitude: -48.6258 },
};

/** Estados/cidades de referência (tabelas públicas compartilhadas): só são criados se ainda não existirem. */
export const STATES: Array<{ uf: string; name: string }> = [
  { uf: 'GO', name: 'Goiás' },
  { uf: 'DF', name: 'Distrito Federal' },
];
export const CITIES: Array<{ uf: string; name: string }> = [
  { uf: 'GO', name: 'Goiânia' },
  { uf: 'GO', name: 'Anápolis' },
  { uf: 'DF', name: 'Brasília' },
];
export const COMMUNITY = { uf: 'GO', name: 'Comunidade Goiás', description: 'Rodas e eventos de capoeira em Goiás.' };

export interface AccountSpec {
  key: AccountKey;
  /** parte local do e-mail (antes do @domínio demo). */
  local: string;
  name: string;
  role: OrgRole;
  phone: string;
  /** unidades em que o professor está autorizado (UserUnitAccess). */
  units?: UnitKey[];
}

export const ACCOUNTS: AccountSpec[] = [
  { key: 'mestre', local: 'mestre', name: 'Mestre Ricardo Menezes', role: OrgRole.MESTRE, phone: '(62) 99999-0001' },
  { key: 'professor1', local: 'professor1', name: 'Professor Thiago Barbosa', role: OrgRole.PROFESSOR, phone: '(62) 99999-0002', units: ['matriz'] },
  { key: 'professor2', local: 'professor2', name: 'Professora Larissa Nogueira', role: OrgRole.PROFESSOR, phone: '(62) 99999-0003', units: ['anapolis', 'matriz'] },
  { key: 'professor3', local: 'professor3', name: 'Professor Anderson Costa', role: OrgRole.PROFESSOR, phone: '(61) 99999-0004', units: ['brasilia'] },
  { key: 'aluno1', local: 'aluno1', name: 'Rafael Oliveira', role: OrgRole.ALUNO, phone: '(62) 99999-0011' },
  { key: 'aluno2', local: 'aluno2', name: 'Juliana Ferreira', role: OrgRole.ALUNO, phone: '(62) 99999-0012' },
  { key: 'aluno3', local: 'aluno3', name: 'Pedro Henrique Lacerda', role: OrgRole.ALUNO, phone: '(62) 99999-0013' },
  { key: 'aluno4', local: 'aluno4', name: 'Márcia Souza', role: OrgRole.RESPONSAVEL, phone: '(62) 99999-0014' },
];

export interface ClassSpec {
  key: ClassKey;
  name: string;
  description: string;
  unit: UnitKey;
  /** 0 = domingo ... 6 = sábado (mesma convenção do painel). */
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: AccountKey;
  /** Anotações que giram entre as aulas da turma. */
  topics: string[];
}

export const CLASSES: ClassSpec[] = [
  {
    key: 'infantil',
    name: 'Infantil (6 a 12 anos) — Terça 17h',
    description: 'Ludicidade, ginga, cantigas e musicalidade para as crianças. Uniforme: camiseta do grupo.',
    unit: 'matriz',
    weekday: 2,
    startTime: '17:00',
    endTime: '18:00',
    teacher: 'professor1',
    topics: [
      'Jogos de roda e ginga lúdica',
      'Cantigas e palmas — introdução ao berimbau',
      'Movimentos básicos: ginga, esquiva e cocorinha',
      'Rolê, queda de rins e brincadeiras de equilíbrio',
      'Treino de golpes simples em duplas',
    ],
  },
  {
    key: 'iniciante',
    name: 'Adulto Iniciante — Segunda 19h',
    description: 'Fundamentos para quem está começando: ginga, golpes básicos, ritmos e história da capoeira.',
    unit: 'matriz',
    weekday: 1,
    startTime: '19:00',
    endTime: '20:30',
    teacher: 'professor1',
    topics: [
      'Aquecimento, alongamento e ginga',
      'Golpes básicos: armada, martelo e meia-lua de frente',
      'Sequência de movimentos e treino em duplas',
      'Introdução à bateria: pandeiro e atabaque',
      'Jogo de dentro e roda de treino',
    ],
  },
  {
    key: 'avancado',
    name: 'Avançados e Graduados — Quarta 20h',
    description: 'Aprimoramento técnico, acrobacias, jogo de dentro e preparação para os batizados.',
    unit: 'matriz',
    weekday: 3,
    startTime: '20:00',
    endTime: '21:30',
    teacher: 'mestre',
    topics: [
      'Sequências avançadas e floreios',
      'Jogo de dentro e leitura do jogo',
      'Maculelê e samba de roda',
      'Condicionamento físico e flexibilidade',
      'Cantos, ladainhas e corridos',
    ],
  },
  {
    key: 'juvenil',
    name: 'Juvenil (13 a 17 anos) — Quinta 18h',
    description: 'Turma da filial de Anápolis para adolescentes: técnica, musicalidade e cultura afro-brasileira.',
    unit: 'anapolis',
    weekday: 4,
    startTime: '18:00',
    endTime: '19:15',
    teacher: 'professor2',
    topics: [
      'Aquecimento e sequência de ataque e defesa',
      'Treino de bateria — toques de berimbau',
      'Golpes combinados e esquivas',
      'Roda de treino e canto',
      'Maculelê — sequência com bastões',
    ],
  },
  {
    key: 'adultoAnapolis',
    name: 'Adulto — Sexta 19h30',
    description: 'Turma adulta da filial de Anápolis, todos os níveis.',
    unit: 'anapolis',
    weekday: 5,
    startTime: '19:30',
    endTime: '21:00',
    teacher: 'professor2',
    topics: [
      'Ginga e deslocamentos',
      'Golpes e contragolpes em duplas',
      'Treino de roda e jogo de baixo',
      'Samba de roda e percussão',
      'Condicionamento e acrobacias básicas',
    ],
  },
  {
    key: 'brasilia',
    name: 'Todos os níveis — Sábado 9h',
    description: 'Treinão de sábado da filial de Brasília, aberto a todos os graduados.',
    unit: 'brasilia',
    weekday: 6,
    startTime: '09:00',
    endTime: '11:00',
    teacher: 'professor3',
    topics: [
      'Treino técnico e roda de sábado',
      'Fundamentos e correção de movimentos',
      'Jogo de dentro e jogo de fora',
      'Bateria completa e canto',
      'Treino funcional e alongamento',
    ],
  },
];

export interface GuardianSpec {
  name: string;
  relationship: string;
  phone: string;
  /** conta de login do responsável (aluno4), quando existir. */
  login?: AccountKey;
  /** consentimento para perfil público (Passaporte) — só vale para menores. */
  consent?: boolean;
}

export interface StudentSpec {
  /** chave estável (também vira parte do e-mail fictício). */
  key: string;
  name: string;
  /** idade em anos completos hoje (a data de nascimento é calculada em relação à execução). */
  age: number;
  unit: UnitKey;
  classes: ClassKey[];
  /** ordem (1..8) da corda atual; 0 = ainda sem graduação (aluno novo). */
  level: number;
  /** em qual batizado (0 = o mais recente já realizado) a corda atual foi recebida. */
  lastBatizado?: number;
  /** troca de corda extraordinária há N dias (vale só se for depois do último batizado). */
  extraordinaryDaysAgo?: number;
  /** aluno novo (level 0): matriculou-se há N dias. */
  joinedDaysAgo?: number;
  status?: StudentStatus;
  /** quando deixou o grupo/foi suspenso (dias atrás) — para status != ACTIVE. */
  leftDaysAgo?: number;
  /** conta de login do próprio aluno. */
  login?: AccountKey;
  guardian?: GuardianSpec;
  /** probabilidade de presença nas aulas (média geral ≈ 75%). */
  rate: number;
  /** mensalidade em centavos. */
  fee: number;
  /** mensalidade do mês anterior em atraso (status OVERDUE). */
  overdue?: boolean;
  /** Passaporte: 'published' (público), 'draft' (criado e não publicado). */
  passport?: 'published' | 'draft';
}

export const STUDENTS: StudentSpec[] = [
  // ---------------------------------------------------------------- Matriz — crianças (com responsável)
  { key: 'davi', name: 'Davi Lucca Ribeiro', age: 8, unit: 'matriz', classes: ['infantil'], level: 1, lastBatizado: 1, rate: 0.9, fee: 11000,
    guardian: { name: 'Fernanda Ribeiro', relationship: 'Mãe', phone: '(62) 99999-0101', consent: false } },
  { key: 'maria-clara', name: 'Maria Clara Souza', age: 9, unit: 'matriz', classes: ['infantil'], level: 2, lastBatizado: 0, rate: 0.95, fee: 11000,
    passport: 'published',
    guardian: { name: 'Márcia Souza', relationship: 'Mãe', phone: '(62) 99999-0014', login: 'aluno4', consent: true } },
  { key: 'gabriel', name: 'Gabriel Souza', age: 11, unit: 'matriz', classes: ['infantil'], level: 3, lastBatizado: 0, rate: 0.85, fee: 11000,
    passport: 'draft',
    guardian: { name: 'Márcia Souza', relationship: 'Mãe', phone: '(62) 99999-0014', login: 'aluno4', consent: true } },
  { key: 'helena', name: 'Helena Barbosa Lima', age: 7, unit: 'matriz', classes: ['infantil'], level: 1, lastBatizado: 0, rate: 0.7, fee: 11000,
    guardian: { name: 'Ricardo Lima', relationship: 'Pai', phone: '(62) 99999-0102', consent: false } },
  { key: 'miguel', name: 'Miguel Araújo', age: 10, unit: 'matriz', classes: ['infantil'], level: 2, lastBatizado: 1, rate: 0.6, fee: 11000,
    guardian: { name: 'Patrícia Araújo', relationship: 'Mãe', phone: '(62) 99999-0103', consent: false } },
  { key: 'alice', name: 'Alice Fonseca', age: 6, unit: 'matriz', classes: ['infantil'], level: 0, joinedDaysAgo: 12, rate: 0.9, fee: 11000,
    guardian: { name: 'Juliana Fonseca', relationship: 'Mãe', phone: '(62) 99999-0104', consent: false } },
  { key: 'arthur', name: 'Arthur Gomes Pereira', age: 12, unit: 'matriz', classes: ['infantil'], level: 3, lastBatizado: 2, rate: 0.8, fee: 11000,
    guardian: { name: 'Sérgio Pereira', relationship: 'Pai', phone: '(62) 99999-0105', consent: false } },
  { key: 'laura', name: 'Laura Mendes', age: 9, unit: 'matriz', classes: ['infantil'], level: 1, lastBatizado: 0, rate: 0.75, fee: 11000,
    guardian: { name: 'Camila Mendes', relationship: 'Mãe', phone: '(62) 99999-0106', consent: false } },

  // ---------------------------------------------------------------- Matriz — adultos
  { key: 'rafael', name: 'Rafael Oliveira', age: 29, unit: 'matriz', classes: ['avancado', 'iniciante'], level: 4, lastBatizado: 0, rate: 0.9, fee: 15000,
    login: 'aluno1', passport: 'published' },
  { key: 'juliana', name: 'Juliana Ferreira', age: 34, unit: 'matriz', classes: ['avancado'], level: 5, lastBatizado: 1, rate: 0.95, fee: 15000,
    login: 'aluno2', passport: 'published' },
  { key: 'bruno', name: 'Bruno Carvalho', age: 41, unit: 'matriz', classes: ['avancado'], level: 6, lastBatizado: 2, rate: 0.8, fee: 15000,
    passport: 'published' },
  { key: 'carolina', name: 'Carolina Teixeira', age: 25, unit: 'matriz', classes: ['iniciante'], level: 2, lastBatizado: 0, extraordinaryDaysAgo: 17, rate: 0.7, fee: 15000,
    passport: 'draft' },
  { key: 'lucas', name: 'Lucas Martins', age: 22, unit: 'matriz', classes: ['iniciante'], level: 1, lastBatizado: 0, extraordinaryDaysAgo: 26, rate: 0.55, fee: 15000, overdue: true },
  { key: 'thais', name: 'Thaís Rocha', age: 31, unit: 'matriz', classes: ['avancado', 'iniciante'], level: 3, lastBatizado: 1, rate: 0.75, fee: 15000 },
  { key: 'eduardo', name: 'Eduardo Silveira', age: 47, unit: 'matriz', classes: ['avancado'], level: 7, lastBatizado: 1, rate: 0.9, fee: 15000,
    passport: 'published' },
  { key: 'felipe', name: 'Felipe Andrade', age: 27, unit: 'matriz', classes: ['iniciante'], level: 0, joinedDaysAgo: 5, rate: 0.8, fee: 15000 },

  // ---------------------------------------------------------------- Anápolis — adolescentes (com responsável)
  { key: 'pedro', name: 'Pedro Henrique Lacerda', age: 16, unit: 'anapolis', classes: ['juvenil'], level: 3, lastBatizado: 0, rate: 0.85, fee: 12000,
    login: 'aluno3',
    guardian: { name: 'Sandra Lacerda', relationship: 'Mãe', phone: '(62) 99999-0107', consent: false } },
  { key: 'isabela', name: 'Isabela Rodrigues', age: 14, unit: 'anapolis', classes: ['juvenil'], level: 2, lastBatizado: 0, rate: 0.8, fee: 12000,
    guardian: { name: 'Marcos Rodrigues', relationship: 'Pai', phone: '(62) 99999-0108', consent: false } },
  { key: 'joao-vitor', name: 'João Vitor Campos', age: 15, unit: 'anapolis', classes: ['juvenil'], level: 2, lastBatizado: 1, rate: 0.6, fee: 12000, overdue: true,
    guardian: { name: 'Adriana Campos', relationship: 'Mãe', phone: '(62) 99999-0109', consent: false } },
  { key: 'sofia', name: 'Sofia Nascimento', age: 13, unit: 'anapolis', classes: ['juvenil'], level: 1, lastBatizado: 0, rate: 0.75, fee: 12000,
    guardian: { name: 'Luciana Nascimento', relationship: 'Mãe', phone: '(62) 99999-0110', consent: false } },
  { key: 'matheus', name: 'Matheus Duarte', age: 17, unit: 'anapolis', classes: ['juvenil'], level: 4, lastBatizado: 1, rate: 0.5, fee: 12000,
    status: StudentStatus.INACTIVE, leftDaysAgo: 50,
    guardian: { name: 'Cláudia Duarte', relationship: 'Mãe', phone: '(62) 99999-0111', consent: false } },

  // ---------------------------------------------------------------- Anápolis — adultos
  { key: 'renata', name: 'Renata Albuquerque', age: 38, unit: 'anapolis', classes: ['adultoAnapolis'], level: 4, lastBatizado: 1, rate: 0.8, fee: 14000 },
  { key: 'diego', name: 'Diego Santana', age: 26, unit: 'anapolis', classes: ['adultoAnapolis'], level: 2, lastBatizado: 0, rate: 0.55, fee: 14000, overdue: true },
  { key: 'fernanda-c', name: 'Fernanda Cavalcanti', age: 30, unit: 'anapolis', classes: ['adultoAnapolis'], level: 3, lastBatizado: 0, rate: 0.6, fee: 14000,
    status: StudentStatus.SUSPENDED, leftDaysAgo: 25 },
  { key: 'vinicius', name: 'Vinícius Moreira', age: 35, unit: 'anapolis', classes: ['adultoAnapolis'], level: 1, lastBatizado: 1, rate: 0.4, fee: 14000,
    status: StudentStatus.INACTIVE, leftDaysAgo: 70 },

  // ---------------------------------------------------------------- Brasília — adultos
  { key: 'gustavo', name: 'Gustavo Pinheiro', age: 33, unit: 'brasilia', classes: ['brasilia'], level: 5, lastBatizado: 1, rate: 0.85, fee: 14000, overdue: true },
  { key: 'amanda', name: 'Amanda Leal', age: 28, unit: 'brasilia', classes: ['brasilia'], level: 2, lastBatizado: 0, rate: 0.7, fee: 14000 },
  { key: 'rodrigo', name: 'Rodrigo Fernandes', age: 44, unit: 'brasilia', classes: ['brasilia'], level: 3, lastBatizado: 2, rate: 0.5, fee: 14000,
    status: StudentStatus.FORMER, leftDaysAgo: 75 },
  { key: 'beatriz', name: 'Beatriz Santos', age: 23, unit: 'brasilia', classes: ['brasilia'], level: 0, joinedDaysAgo: 20, rate: 0.8, fee: 14000 },
  { key: 'leonardo', name: 'Leonardo Barros', age: 52, unit: 'brasilia', classes: ['brasilia'], level: 6, lastBatizado: 2, rate: 0.9, fee: 14000,
    passport: 'published' },
];

export interface LevelSpec {
  order: number;
  name: string;
  /** Cor PRIMARIA (= colors[0]), mantida por compatibilidade. */
  color: string;
  /** Estilo da corda: lisa, dividida (listras verticais) ou trancada (listras diagonais). */
  style: 'SOLID' | 'SPLIT' | 'BRAIDED';
  /** 1 a 3 cores hex #RRGGBB (a ordem importa). */
  colors: string[];
}

/** Cordas do grupo (lisas, divididas e trancadas, com cores reais de corda de capoeira). */
export const GRADUATION_SYSTEM = {
  name: 'Cordas do Grupo Axé',
  description:
    'Sistema de graduação por cordas do Grupo Axé: da corda crua (iniciante) à trançada de três cores (instrutor), passando por cordas divididas e trançadas.',
};
export const LEVELS: LevelSpec[] = [
  { order: 1, name: 'Crua', color: '#E8DFC8', style: 'SOLID', colors: ['#E8DFC8'] },
  { order: 2, name: 'Verde', color: '#16A34A', style: 'SOLID', colors: ['#16A34A'] },
  { order: 3, name: 'Verde/Amarela', color: '#16A34A', style: 'SPLIT', colors: ['#16A34A', '#FACC15'] },
  { order: 4, name: 'Amarela', color: '#FACC15', style: 'SOLID', colors: ['#FACC15'] },
  { order: 5, name: 'Amarela/Azul', color: '#FACC15', style: 'BRAIDED', colors: ['#FACC15', '#2563EB'] },
  { order: 6, name: 'Azul', color: '#2563EB', style: 'SOLID', colors: ['#2563EB'] },
  { order: 7, name: 'Azul/Branca', color: '#2563EB', style: 'SPLIT', colors: ['#2563EB', '#FFFFFF'] },
  { order: 8, name: 'Verde/Amarela/Azul', color: '#16A34A', style: 'BRAIDED', colors: ['#16A34A', '#FACC15', '#2563EB'] },
];
/** Imagem já usada pelo seed do projeto (unsplash). Único URL externo do demo. */
export const DEMO_IMAGE_URL =
  'https://images.unsplash.com/photo-1583166614297-a97b68d5cead?q=80&w=800&auto=format&fit=crop';

export const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
