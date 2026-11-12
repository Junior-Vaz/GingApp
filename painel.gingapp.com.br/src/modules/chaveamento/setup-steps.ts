export interface GuideStep {
  title: string;
  hint?: string;
}

export const SETUP_STEPS: readonly GuideStep[] = [
  { title: "Adicione atletas", hint: "Do evento, alunos ou de fora." },
  { title: "Sorteie a chave", hint: "Aleatório, por sementes ou sem mesmo grupo." },
  { title: "Inicie as lutas", hint: "A mesa de controle chama a próxima." },
];
