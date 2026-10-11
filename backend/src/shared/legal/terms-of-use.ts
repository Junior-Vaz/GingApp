import { LegalSection } from './legal-types';

/**
 * MODELO - revisar com assessoria juridica antes de publicar. Os trechos entre colchetes ([...]) sao
 * campos a preencher pelo titular do GingApp (razao social, CNPJ, e-mail de contato, comarca).
 */
export const TERMS_OF_USE_TITLE = 'Termos de Uso do GingApp';

export const TERMS_OF_USE_SECTIONS: readonly LegalSection[] = [
  {
    heading: '1. Aceitação destes Termos',
    paragraphs: [
      'Estes Termos de Uso regulam o acesso e o uso da plataforma GingApp (aplicativo do aluno, painel do grupo e área administrativa), operada por [RAZÃO SOCIAL DO GINGAPP], inscrita no CNPJ sob o nº [CNPJ], doravante "GingApp".',
      'Ao entrar na plataforma e marcar a opção de aceite, você declara que leu, compreendeu e concorda com estes Termos e com a Política de Privacidade. Se não concordar, não utilize a plataforma.',
    ],
  },
  {
    heading: '2. O que é o GingApp',
    paragraphs: [
      'O GingApp é uma plataforma de gestão para grupos de capoeira: cadastro de alunos, professores e unidades, turmas, aulas e frequência, graduações e certificados, eventos e rodas, comunicados e controle financeiro do grupo.',
      'O GingApp fornece a tecnologia. Quem organiza as aulas, define as regras internas, cobra mensalidades e decide quais dados dos alunos são cadastrados é o Grupo (a escola, a associação ou o mestre) ao qual você está vinculado.',
    ],
  },
  {
    heading: '3. Definições',
    paragraphs: [
      'Grupo: a organização de capoeira que contratou o GingApp e administra seus próprios alunos e professores. Mestre: usuário responsável pela administração do Grupo. Professor: usuário da equipe do Grupo com acesso às turmas e aulas. Aluno (praticante): pessoa cadastrada pelo Grupo para praticar capoeira. Responsável: pai, mãe ou responsável legal de um aluno menor de 18 anos.',
      'Usuário: qualquer pessoa que acessa a plataforma com uma conta (Mestre, Professor, Aluno, Responsável ou integrante da equipe GingApp).',
    ],
  },
  {
    heading: '4. Conta de acesso e segurança',
    paragraphs: [
      'As contas de Aluno, Responsável e Professor normalmente são criadas pelo próprio Grupo, com uma senha provisória. No primeiro acesso você deve trocar essa senha por uma senha pessoal e forte.',
      'Você é responsável por manter sua senha em sigilo e por tudo o que for feito com a sua conta. Avise o seu Grupo imediatamente se suspeitar de uso indevido. Informe apenas dados verdadeiros e mantenha-os atualizados.',
    ],
  },
  {
    heading: '5. Crianças e adolescentes',
    paragraphs: [
      'O cadastro de menores de 18 anos é feito pelo Grupo e exige a ciência e o consentimento de um dos pais ou do responsável legal. O Responsável pode acessar os dados do menor sob sua responsabilidade e acompanhar aulas, frequência, graduações e financeiro.',
      'Recursos que expõem dados do menor fora do Grupo, como o perfil público e o passaporte do praticante, só são ativados com o consentimento específico do Responsável, que pode ser revogado a qualquer momento.',
    ],
  },
  {
    heading: '6. Uso permitido e condutas proibidas',
    paragraphs: [
      'Você se compromete a usar a plataforma de forma lícita e respeitosa. É proibido: acessar contas ou dados de outras pessoas ou de outros grupos; tentar burlar a segurança, sobrecarregar ou fazer engenharia reversa do sistema; publicar conteúdo ofensivo, discriminatório, ilegal ou que viole direitos de terceiros; usar a plataforma para enviar spam ou para fins comerciais não autorizados pelo GingApp.',
    ],
  },
  {
    heading: '7. Conteúdo enviado por você',
    paragraphs: [
      'Fotos, links de redes sociais, textos e demais conteúdos que você ou o seu Grupo cadastram continuam sendo de sua titularidade. Você concede ao GingApp apenas a licença necessária para armazenar, exibir e processar esse conteúdo dentro da plataforma, conforme as configurações de privacidade escolhidas.',
      'Você declara ter o direito de usar o conteúdo que cadastra (por exemplo, a autorização de uso de imagem das pessoas que aparecem nas fotos) e responde por ele.',
    ],
  },
  {
    heading: '8. Passaporte, perfil público e verificação de certificados',
    paragraphs: [
      'Certificados emitidos pelo Grupo podem ser verificados publicamente por meio de um código ou QR Code, que exibe apenas as informações necessárias para confirmar a autenticidade do documento.',
      'O perfil público do praticante é opcional e fica desativado por padrão. Ele só é publicado por escolha do próprio usuário maior de idade ou, no caso de menores, com o consentimento do Responsável.',
    ],
  },
  {
    heading: '9. Financeiro e mensalidades',
    paragraphs: [
      'Os lançamentos financeiros exibidos na plataforma (mensalidades, taxas, eventos) são registrados e controlados pelo Grupo. A relação de pagamento é entre você e o Grupo; o GingApp não é parte dela e, nesta versão, não processa pagamentos nem cobra o aluno diretamente.',
      'Dúvidas sobre valores, vencimentos, descontos ou baixas devem ser tratadas com o seu Grupo.',
    ],
  },
  {
    heading: '10. Atividade física e responsabilidade do Grupo',
    paragraphs: [
      'A prática de capoeira envolve atividade física. A organização das aulas, a avaliação das condições de saúde dos praticantes, a segurança dos locais e a supervisão de menores são de responsabilidade exclusiva do Grupo e de seus professores. O GingApp é apenas uma ferramenta de gestão e não presta serviços de ensino, de saúde ou de segurança.',
    ],
  },
  {
    heading: '11. Disponibilidade da plataforma',
    paragraphs: [
      'O GingApp busca manter a plataforma disponível e realiza cópias de segurança periódicas do banco de dados, mas não garante funcionamento ininterrupto ou livre de falhas. Podem ocorrer manutenções programadas ou indisponibilidades por motivos técnicos ou de terceiros.',
    ],
  },
  {
    heading: '12. Planos e assinatura do Grupo',
    paragraphs: [
      'O uso da plataforma pelo Grupo pode estar sujeito a plano e assinatura, com limites (por exemplo, de alunos) e condições comerciais próprias, combinados diretamente entre o GingApp e o Grupo. Alunos e Responsáveis não pagam ao GingApp para acessar o aplicativo.',
    ],
  },
  {
    heading: '13. Suspensão e encerramento',
    paragraphs: [
      'O Grupo pode inativar a conta de um aluno ou professor (por exemplo, ao encerrar o vínculo), o que bloqueia o acesso à plataforma, preservando o histórico do Grupo. O GingApp pode suspender contas que violem estes Termos, a lei ou ponham em risco a segurança da plataforma.',
      'Você pode solicitar o encerramento da sua conta e a exclusão ou anonimização dos seus dados, conforme descrito na Política de Privacidade.',
    ],
  },
  {
    heading: '14. Propriedade intelectual',
    paragraphs: [
      'A marca GingApp, o software, o design e os demais elementos da plataforma pertencem ao GingApp ou a seus licenciantes. Estes Termos não transferem qualquer direito de propriedade intelectual além da licença limitada, pessoal e revogável de uso da plataforma.',
    ],
  },
  {
    heading: '15. Limitação de responsabilidade',
    paragraphs: [
      'Na extensão permitida pela lei, o GingApp não responde por danos indiretos, lucros cessantes ou perdas decorrentes de uso indevido da conta pelo próprio usuário, de informações incorretas cadastradas pelo Grupo, de indisponibilidade causada por terceiros ou de eventos fora do seu controle razoável. Nada nestes Termos limita direitos que a lei garante ao consumidor ou ao titular de dados.',
    ],
  },
  {
    heading: '16. Privacidade e proteção de dados',
    paragraphs: [
      'O tratamento de dados pessoais segue a Lei Geral de Proteção de Dados (Lei nº 13.709/2018) e está descrito na Política de Privacidade, que integra estes Termos.',
    ],
  },
  {
    heading: '17. Alterações destes Termos',
    paragraphs: [
      'Estes Termos e a Política de Privacidade podem ser atualizados. Cada versão tem um identificador; quando houver uma versão nova, a plataforma pedirá um novo aceite no próximo acesso. O uso continuado após o aceite da nova versão significa concordância com ela.',
    ],
  },
  {
    heading: '18. Lei aplicável, foro e contato',
    paragraphs: [
      'Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de [COMARCA/CIDADE], salvo disposição legal em sentido diverso, em especial a que garante ao consumidor o foro do seu domicílio.',
      'Dúvidas, solicitações e reclamações: [E-MAIL DE CONTATO DO GINGAPP].',
    ],
  },
];
