const QUESTIONNAIRES = {
  EXPERIENCIA: [
    'Quais habilidades você demonstrou durante o período de experiência? Cite situações concretas.',
    'Como você participou das atividades e colaborou com a equipe?',
    'Quais tarefas você já executa com autonomia e em quais ainda precisa de apoio?',
    'Como recebeu e aplicou os feedbacks durante o período de experiência?',
    'Descreva um desafio enfrentado e como você contribuiu para resolvê-lo.',
    'Quais habilidades deseja desenvolver nos próximos meses?'
  ],
  PROMOCAO: [
    'Para você, o que é ser um bom líder?',
    'Seus colegas já te escolheram para liderar algum tipo de projeto?',
    'Por qual motivo você acha que seus colegas te escolheram para o projeto?',
    'Como você faz para extrair o melhor de cada pessoa de um time?',
    'Cite uma dificuldade que você teve enquanto líder e como fez para resolvê-la.',
    'Conte uma entrega que dependia do seu time e como você os orientou para alcançá-la.',
    'Como você lidaria com um colaborador que está infeliz em suas atividades?'
  ],
  PERIODICA: [
    'Qual era seus objetivos quando iniciou o mês? Quão distante ele está da realidade?',
    'Quais as 3 coisas mais maravilhosas que aconteceram nesse mês?',
    'Olhando um degrau acima, sendo mais estratégico, que mais?',
    'Quais contribuições / impactos seus foram maravilhosas?',
    'Quais contribuições / impactos dos seus colaboradores foram maravilhosas?',
    'Quando você foi mais feliz nesse mês?',
    'Disso tudo, o que mais te deixou orgulhoso?',
    'Quando você se sentiu mais satisfeito, pleno ou atingindo um propósito ou missão de vida?',
    'Quais as 3 piores coisas que aconteceram nesse mês?',
    'Olhando um degrau acima, sendo mais estratégico, que mais?',
    'Quais contribuições / impactos seus foram ruins?',
    'Quais contribuições / impactos dos seus colaboradores foram ruins?',
    'Que resultados te deixou frustrado ou menos feliz ou impotente nesse mês?',
    'Como você está sentindo a sua evolução na direção dos seus planos de carreira? Principalmente em relação às competências e habilidades que você foi buscar nessa função?',
    'Se você tivesse o dom de voltar no tempo e reviver algum desses momentos, ou outro momento qualquer, para qual situação você voltaria e por que voltaria? O que você mudaria?',
    'Como você acredita que seu time o vê? Qual o impacto que você tem sobre essas pessoas?',
    'Como você acredita que seus clientes o veem? Qual o impacto que você tem sobre essas pessoas?',
    'Como você acredita que seus colegas de trabalho/pares do mesmo nível hierárquico o veem? Qual o impacto que você tem sobre essas pessoas?',
    'Tem mais algum momento, sentimento ou memória que você lembra agora, que intuitivamente seu sistema traz esta lembrança à você, e que de alguma forma você acredita que isso é importante lembrar nesse momento? Quais insights você tem ao refletir sobre seus pontos fortes, pontos de melhoria e memórias passadas?',
    'O que eu posso fazer para te ajudar com seus objetivos de carreira, de resultados e como líder? O que eu preciso mudar? O que preciso continuar fazendo?'
  ]
};
const QUESTIONNAIRE_VERSION = '2026-10-v1';
globalThis.UNISO_QUESTIONNAIRES = { QUESTIONNAIRES, QUESTIONNAIRE_VERSION };
if (typeof module !== 'undefined') module.exports = { QUESTIONNAIRES, QUESTIONNAIRE_VERSION };
