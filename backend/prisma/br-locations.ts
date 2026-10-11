// Dados de referência geográficos do Brasil para o bootstrap de PRODUÇÃO (prisma/bootstrap.ts).
//
// Fonte: conhecimento público do IBGE (nomes oficiais dos municípios), curado À MÃO neste arquivo —
// não há (e não se usa) nenhuma fonte externa em tempo de execução. Cobre as 27 UFs (SSOT em
// src/shared/geo/br-states.ts) e, por UF, a CAPITAL + os principais municípios (maiores populações
// e polos regionais/turísticos). NÃO são os ~5.570 municípios: o conjunto completo pode ser acrescentado
// aqui depois sem nenhuma mudança de código (o bootstrap faz upsert por nome normalizado, só criando
// o que falta e nunca alterando linhas existentes).
//
// Convenção: a PRIMEIRA cidade de cada UF é a capital.

export const CITIES_BY_UF: Readonly<Record<string, readonly string[]>> = {
  AC: ['Rio Branco', 'Cruzeiro do Sul', 'Sena Madureira', 'Tarauacá', 'Feijó', 'Brasiléia'],
  AL: ['Maceió', 'Arapiraca', 'Palmeira dos Índios', 'Rio Largo', 'União dos Palmares', 'Penedo', 'São Miguel dos Campos', 'Delmiro Gouveia'],
  AP: ['Macapá', 'Santana', 'Laranjal do Jari', 'Oiapoque', 'Mazagão'],
  AM: ['Manaus', 'Parintins', 'Itacoatiara', 'Manacapuru', 'Coari', 'Tefé', 'Tabatinga', 'Maués'],
  BA: [
    'Salvador', 'Feira de Santana', 'Vitória da Conquista', 'Camaçari', 'Itabuna', 'Juazeiro', 'Lauro de Freitas',
    'Ilhéus', 'Jequié', 'Teixeira de Freitas', 'Barreiras', 'Alagoinhas', 'Porto Seguro', 'Simões Filho',
    'Paulo Afonso', 'Eunápolis', 'Santo Antônio de Jesus', 'Valença', 'Candeias', 'Guanambi', 'Jacobina',
    'Serrinha', 'Senhor do Bonfim', 'Dias d\'Ávila', 'Luís Eduardo Magalhães', 'Cachoeira', 'Santo Amaro',
    'São Félix', 'Lençóis', 'Mucugê', 'Itaparica', 'Brumado',
  ],
  CE: [
    'Fortaleza', 'Caucaia', 'Juazeiro do Norte', 'Maracanaú', 'Sobral', 'Crato', 'Itapipoca', 'Maranguape',
    'Iguatu', 'Quixadá', 'Pacatuba', 'Aquiraz', 'Canindé', 'Russas', 'Tianguá', 'Aracati', 'Eusébio',
  ],
  DF: ['Brasília'],
  ES: [
    'Vitória', 'Vila Velha', 'Serra', 'Cariacica', 'Linhares', 'Cachoeiro de Itapemirim', 'Colatina', 'Guarapari',
    'São Mateus', 'Aracruz', 'Viana', 'Nova Venécia', 'Domingos Martins',
  ],
  GO: [
    'Goiânia', 'Aparecida de Goiânia', 'Anápolis', 'Rio Verde', 'Luziânia', 'Águas Lindas de Goiás',
    'Valparaíso de Goiás', 'Trindade', 'Formosa', 'Novo Gama', 'Senador Canedo', 'Itumbiara', 'Catalão', 'Jataí',
    'Planaltina', 'Caldas Novas', 'Santo Antônio do Descoberto', 'Goianésia', 'Mineiros', 'Cidade Ocidental',
    'Goiás', 'Pirenópolis', 'Alto Paraíso de Goiás', 'Inhumas', 'Morrinhos',
  ],
  MA: [
    'São Luís', 'Imperatriz', 'São José de Ribamar', 'Timon', 'Caxias', 'Codó', 'Paço do Lumiar', 'Açailândia',
    'Bacabal', 'Balsas', 'Santa Inês', 'Pinheiro', 'Chapadinha', 'Barreirinhas',
  ],
  MT: [
    'Cuiabá', 'Várzea Grande', 'Rondonópolis', 'Sinop', 'Tangará da Serra', 'Cáceres', 'Sorriso',
    'Lucas do Rio Verde', 'Primavera do Leste', 'Barra do Garças', 'Alta Floresta', 'Pontes e Lacerda',
    'Nova Mutum', 'Campo Verde', 'Chapada dos Guimarães',
  ],
  MS: [
    'Campo Grande', 'Dourados', 'Três Lagoas', 'Corumbá', 'Ponta Porã', 'Naviraí', 'Nova Andradina', 'Sidrolândia',
    'Aquidauana', 'Maracaju', 'Paranaíba', 'Rio Brilhante', 'Coxim', 'Bonito',
  ],
  MG: [
    'Belo Horizonte', 'Uberlândia', 'Contagem', 'Juiz de Fora', 'Betim', 'Montes Claros', 'Ribeirão das Neves',
    'Uberaba', 'Governador Valadares', 'Ipatinga', 'Santa Luzia', 'Sete Lagoas', 'Divinópolis', 'Poços de Caldas',
    'Patos de Minas', 'Pouso Alegre', 'Teófilo Otoni', 'Barbacena', 'Sabará', 'Varginha', 'Conselheiro Lafaiete',
    'Itabira', 'Vespasiano', 'Araguari', 'Passos', 'Ituiutaba', 'Ubá', 'Lavras', 'Muriaé', 'Nova Lima',
    'Ouro Preto', 'Diamantina', 'Tiradentes', 'São João del-Rei', 'Itajubá', 'Caratinga', 'Unaí', 'Curvelo',
    'Paracatu', 'Mariana',
  ],
  PA: [
    'Belém', 'Ananindeua', 'Santarém', 'Marabá', 'Castanhal', 'Parauapebas', 'Abaetetuba', 'Cametá', 'Bragança',
    'Marituba', 'Altamira', 'Tucuruí', 'Barcarena', 'Paragominas', 'Redenção', 'Itaituba',
  ],
  PB: ['João Pessoa', 'Campina Grande', 'Santa Rita', 'Patos', 'Bayeux', 'Sousa', 'Cabedelo', 'Cajazeiras', 'Guarabira', 'Mamanguape'],
  PR: [
    'Curitiba', 'Londrina', 'Maringá', 'Ponta Grossa', 'Cascavel', 'São José dos Pinhais', 'Foz do Iguaçu', 'Colombo',
    'Guarapuava', 'Paranaguá', 'Araucária', 'Toledo', 'Apucarana', 'Pinhais', 'Campo Largo', 'Almirante Tamandaré',
    'Umuarama', 'Paranavaí', 'Cambé', 'Sarandi', 'Fazenda Rio Grande', 'Piraquara', 'Cianorte', 'Telêmaco Borba',
    'Pato Branco', 'Francisco Beltrão', 'Campo Mourão', 'Arapongas', 'Castro', 'União da Vitória', 'Morretes',
  ],
  PE: [
    'Recife', 'Jaboatão dos Guararapes', 'Olinda', 'Caruaru', 'Petrolina', 'Paulista', 'Cabo de Santo Agostinho',
    'Camaragibe', 'Garanhuns', 'Vitória de Santo Antão', 'Igarassu', 'São Lourenço da Mata', 'Abreu e Lima',
    'Santa Cruz do Capibaribe', 'Ipojuca', 'Serra Talhada', 'Araripina', 'Gravatá', 'Carpina', 'Goiana',
    'Belo Jardim', 'Arcoverde', 'Ouricuri', 'Escada', 'Pesqueira', 'Surubim', 'Bezerros',
  ],
  PI: ['Teresina', 'Parnaíba', 'Picos', 'Piripiri', 'Floriano', 'Campo Maior', 'Barras', 'União', 'Altos', 'Pedro II', 'José de Freitas'],
  RJ: [
    'Rio de Janeiro', 'São Gonçalo', 'Duque de Caxias', 'Nova Iguaçu', 'Niterói', 'Belford Roxo', 'São João de Meriti',
    'Campos dos Goytacazes', 'Petrópolis', 'Volta Redonda', 'Magé', 'Itaboraí', 'Mesquita', 'Nova Friburgo',
    'Barra Mansa', 'Macaé', 'Cabo Frio', 'Nilópolis', 'Queimados', 'Angra dos Reis', 'Teresópolis', 'Resende',
    'Maricá', 'Itaguaí', 'Araruama', 'Japeri', 'Rio das Ostras', 'Paracambi', 'Três Rios', 'Valença', 'Paraty',
    'Armação dos Búzios', 'Seropédica',
  ],
  RN: [
    'Natal', 'Mossoró', 'Parnamirim', 'São Gonçalo do Amarante', 'Macaíba', 'Ceará-Mirim', 'Caicó', 'Assu',
    'Currais Novos', 'São José de Mipibu', 'Santa Cruz', 'Nova Cruz',
  ],
  RS: [
    'Porto Alegre', 'Caxias do Sul', 'Canoas', 'Pelotas', 'Santa Maria', 'Gravataí', 'Viamão', 'Novo Hamburgo',
    'São Leopoldo', 'Rio Grande', 'Alvorada', 'Passo Fundo', 'Sapucaia do Sul', 'Uruguaiana', 'Santa Cruz do Sul',
    'Cachoeirinha', 'Bagé', 'Bento Gonçalves', 'Erechim', 'Guaíba', 'Cachoeira do Sul', 'Santana do Livramento',
    'Esteio', 'Ijuí', 'Alegrete', 'Lajeado', 'Farroupilha', 'Santo Ângelo', 'Gramado', 'Canela',
  ],
  RO: ['Porto Velho', 'Ji-Paraná', 'Ariquemes', 'Vilhena', 'Cacoal', 'Jaru', 'Rolim de Moura', 'Guajará-Mirim'],
  RR: ['Boa Vista', 'Rorainópolis', 'Caracaraí', 'Cantá', 'Pacaraima'],
  SC: [
    'Florianópolis', 'Joinville', 'Blumenau', 'São José', 'Chapecó', 'Itajaí', 'Criciúma', 'Jaraguá do Sul', 'Lages',
    'Palhoça', 'Balneário Camboriú', 'Brusque', 'Tubarão', 'São Bento do Sul', 'Caçador', 'Concórdia', 'Camboriú',
    'Navegantes', 'Rio do Sul', 'Araranguá', 'Gaspar', 'Biguaçu', 'Indaial', 'Mafra', 'Canoinhas', 'Itapema',
    'Imbituba', 'Garopaba',
  ],
  SP: [
    'São Paulo', 'Guarulhos', 'Campinas', 'São Bernardo do Campo', 'Santo André', 'Osasco', 'São José dos Campos',
    'Ribeirão Preto', 'Sorocaba', 'Santos', 'Mauá', 'São José do Rio Preto', 'Mogi das Cruzes', 'Diadema', 'Jundiaí',
    'Piracicaba', 'Carapicuíba', 'Bauru', 'Itaquaquecetuba', 'São Vicente', 'Franca', 'Praia Grande', 'Guarujá',
    'Taubaté', 'Limeira', 'Suzano', 'Taboão da Serra', 'Sumaré', 'Barueri', 'Embu das Artes', 'São Carlos',
    'Indaiatuba', 'Cotia', 'Americana', 'Marília', 'Itapevi', 'Araraquara', 'Jacareí', 'Hortolândia',
    'Presidente Prudente', 'Rio Claro', 'Araçatuba', 'Santa Bárbara d\'Oeste', 'Ferraz de Vasconcelos',
    'Francisco Morato', 'Itapecerica da Serra', 'Itu', 'Bragança Paulista', 'Pindamonhangaba', 'Atibaia',
    'Franco da Rocha', 'Cubatão', 'Sertãozinho', 'Mogi Guaçu', 'Botucatu', 'Ourinhos', 'Jaú', 'Catanduva',
    'Votorantim', 'Aparecida', 'Ubatuba', 'São Sebastião', 'Ilhabela', 'Caraguatatuba', 'Guaratinguetá',
  ],
  SE: [
    'Aracaju', 'Nossa Senhora do Socorro', 'Lagarto', 'Itabaiana', 'São Cristóvão', 'Estância', 'Tobias Barreto',
    'Itaporanga d\'Ajuda', 'Laranjeiras', 'Propriá', 'Barra dos Coqueiros',
  ],
  TO: [
    'Palmas', 'Araguaína', 'Gurupi', 'Porto Nacional', 'Paraíso do Tocantins', 'Colinas do Tocantins', 'Guaraí',
    'Tocantinópolis', 'Dianópolis', 'Formoso do Araguaia',
  ],
};

/** Normaliza um nome para comparação (sem acento, minúsculo, espaços colapsados). */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
