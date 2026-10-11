import { LegalSection } from './legal-types';

/**
 * MODELO - revisar com assessoria juridica antes de publicar. Os trechos entre colchetes ([...]) sao
 * campos a preencher pelo titular do GingApp (razao social, CNPJ, encarregado/DPO, e-mail de contato).
 */
export const PRIVACY_POLICY_TITLE = 'Política de Privacidade do GingApp';

export const PRIVACY_POLICY_SECTIONS: readonly LegalSection[] = [
  {
    heading: '1. Quem é responsável pelos seus dados',
    paragraphs: [
      'Esta Política explica como os dados pessoais são tratados no GingApp, em conformidade com a Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018).',
      'Em relação aos dados dos alunos, responsáveis e professores cadastrados por um Grupo (nome, contato, frequência, graduações, financeiro etc.), o Grupo é o controlador: decide quais dados coletar e para quê. O GingApp, operado por [RAZÃO SOCIAL DO GINGAPP] (CNPJ [CNPJ]), atua como operador, tratando esses dados em nome do Grupo. Em relação aos dados da conta de acesso (e-mail, senha, registros de acesso e de aceite), o GingApp atua como controlador.',
    ],
  },
  {
    heading: '2. Quais dados são tratados',
    paragraphs: [
      'Dados de cadastro: nome, e-mail, telefone, data de nascimento, documento, foto, unidade e vínculo com o Grupo (aluno, responsável, professor ou mestre).',
      'Dados de uso da atividade do Grupo: turmas e aulas, presenças e justificativas, graduações, certificados, participação em eventos e rodas, comunicados e notificações recebidas, lançamentos financeiros (mensalidades, vencimentos e situação de pagamento).',
      'Dados do responsável pelo menor: nome, parentesco, telefone, e-mail e o consentimento dado para o perfil público do menor.',
      'Dados técnicos: endereço IP, data e hora de acesso e de aceite destes documentos, tipo de navegador e registros de segurança.',
      'Dados de saúde não são solicitados pela plataforma. Evite registrar informações de saúde nos campos livres; se o Grupo o fizer, trata-se de dado pessoal sensível, sob responsabilidade do Grupo.',
    ],
  },
  {
    heading: '3. Para que usamos os dados e em que base legal',
    paragraphs: [
      'Executar o serviço contratado pelo Grupo e a relação do aluno com o Grupo (cadastro, aulas, frequência, graduações, financeiro, comunicados) - base legal: execução de contrato e procedimentos preliminares.',
      'Manter a segurança, prevenir fraudes, registrar acessos e cumprir obrigações legais e regulatórias - base legal: obrigação legal/regulatória e legítimo interesse.',
      'Exibir o perfil público, o passaporte do praticante e a verificação pública de certificados - base legal: consentimento (do titular maior de idade ou do responsável legal, no caso de menores), que pode ser revogado a qualquer momento.',
      'Comunicar alterações da plataforma e destes documentos - base legal: legítimo interesse e execução de contrato.',
      'Não vendemos dados pessoais nem os utilizamos para publicidade de terceiros.',
    ],
  },
  {
    heading: '4. Crianças e adolescentes',
    paragraphs: [
      'O tratamento de dados de menores de 18 anos é feito no seu melhor interesse (art. 14 da LGPD). O cadastro do menor é feito pelo Grupo e depende da ciência e do consentimento específico de um dos pais ou do responsável legal.',
      'O perfil público e o passaporte de um menor só são publicados com o consentimento do Responsável, que pode revogá-lo a qualquer momento - nesse caso o perfil é despublicado. O Responsável pode acompanhar os dados do menor pelo aplicativo e exercer, em nome dele, os direitos descritos abaixo.',
      'Não coletamos dados de menores além do estritamente necessário para a atividade do Grupo.',
    ],
  },
  {
    heading: '5. Com quem compartilhamos',
    paragraphs: [
      'Com o seu Grupo: o Mestre e os professores autorizados veem os dados necessários à gestão do grupo. Grupos diferentes não enxergam os dados uns dos outros.',
      'Publicamente, apenas o que você (ou o Responsável) escolher publicar: perfil público e dados mínimos de verificação de certificados.',
      'Com prestadores de serviço essenciais à operação (hospedagem, banco de dados e infraestrutura), vinculados a deveres de confidencialidade e segurança.',
      'Com autoridades públicas, quando exigido por lei ou ordem judicial.',
    ],
  },
  {
    heading: '6. Transferência internacional',
    paragraphs: [
      'Os dados podem ser armazenados em servidores localizados no Brasil ou no exterior, de provedores que adotem nível adequado de proteção, conforme os arts. 33 a 36 da LGPD. [CONFIRMAR LOCALIZAÇÃO DA HOSPEDAGEM CONTRATADA.]',
    ],
  },
  {
    heading: '7. Por quanto tempo guardamos',
    paragraphs: [
      'Mantemos os dados enquanto a conta e o vínculo com o Grupo estiverem ativos e, depois, pelo prazo necessário para cumprir obrigações legais, resguardar direitos em processos e preservar o histórico do Grupo (por exemplo, registros financeiros). Alunos inativados deixam de acessar a plataforma, mas o histórico do Grupo não é apagado automaticamente.',
      'Cópias de segurança do banco de dados são mantidas por um período limitado e rotativo (padrão de 14 dias) e depois descartadas.',
    ],
  },
  {
    heading: '8. Como protegemos os dados',
    paragraphs: [
      'Senhas são armazenadas apenas em forma criptografada (hash), nunca em texto legível. O tráfego usa conexão segura (HTTPS). O acesso é controlado por papéis (mestre, professor, aluno, responsável), com isolamento entre grupos, expiração e revogação de sessões e limite de tentativas de login.',
      'Nenhum sistema é totalmente imune a incidentes. Em caso de incidente de segurança que possa causar risco ou dano relevante, comunicaremos os titulares e a Autoridade Nacional de Proteção de Dados (ANPD) nos termos da lei.',
    ],
  },
  {
    heading: '9. Seus direitos como titular',
    paragraphs: [
      'Nos termos do art. 18 da LGPD, você pode solicitar: confirmação de que tratamos seus dados; acesso aos dados; correção de dados incompletos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade; portabilidade; informação sobre compartilhamentos; e a revogação do consentimento.',
      'Como exercer: (a) acesso e portabilidade - baixe uma cópia dos seus dados em formato JSON pela própria plataforma, na opção "Meus dados" do perfil; (b) exclusão ou anonimização - registre o pedido na mesma opção. O pedido é registrado e analisado pela equipe; dados que o Grupo ou a lei exigem manter (como registros financeiros) podem ser preservados ou apenas anonimizados, e você será informado do resultado; (c) correção e demais pedidos - procure o seu Grupo ou o contato abaixo.',
      'Responsáveis podem exercer esses direitos em nome do menor sob sua responsabilidade.',
    ],
  },
  {
    heading: '10. Armazenamento no seu dispositivo',
    paragraphs: [
      'A plataforma guarda no navegador do seu dispositivo apenas o necessário para manter você conectado (token de sessão e preferências como o aluno selecionado). Não usamos cookies de publicidade nem de rastreamento de terceiros. Ao sair da conta esses dados são removidos.',
    ],
  },
  {
    heading: '11. Encarregado pelo tratamento de dados (DPO) e contato',
    paragraphs: [
      'Encarregado: [NOME DO ENCARREGADO]. Contato para assuntos de privacidade: [E-MAIL DO ENCARREGADO/PRIVACIDADE].',
      'Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).',
    ],
  },
  {
    heading: '12. Alterações desta Política',
    paragraphs: [
      'Esta Política pode ser atualizada para refletir mudanças na plataforma ou na lei. Cada versão tem um identificador e a plataforma pedirá um novo aceite quando houver uma versão nova. A data da última revisão consta no topo do documento.',
    ],
  },
];
