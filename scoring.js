const CRITERIA = [
  ['interesse', 'Interesse pelo trabalho'],
  ['iniciativa', 'Iniciativa'],
  ['disciplina', 'Disciplina e cumprimento de normas'],
  ['assiduidade', 'Assiduidade'],
  ['pontualidade', 'Pontualidade'],
  ['relacionamento', 'Relacionamento interpessoal'],
  ['cooperacao', 'Cooperação / trabalho em equipe'],
  ['qualidade', 'Qualidade e precisão do trabalho'],
  ['produtividade', 'Produtividade, metas e prazos'],
  ['responsabilidade', 'Responsabilidade pelos resultados']
];
const POLICY_VERSION = 'proposta-2026-09-v1';

function calculate(scores) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores) ||
      Object.keys(scores).length !== CRITERIA.length) throw new Error('Preencha os dez critérios.');
  for (const [key] of CRITERIA) {
    if (!Number.isInteger(scores[key]) || scores[key] < 0 || scores[key] > 10)
      throw new Error('Cada nota deve ser um número inteiro de 0 a 10.');
  }
  const total = CRITERIA.reduce((sum, [key]) => sum + scores[key], 0);
  const classification = total >= 90 ? 'Excelente desempenho'
    : total >= 80 ? 'Muito bom desempenho'
    : total >= 70 ? 'Bom desempenho / dentro do esperado'
    : total >= 60 ? 'Em desenvolvimento'
    : 'Pontuação mínima não atingida - Acompanhar o colaborador';
  const critical = CRITERIA.filter(([key]) => scores[key] <= 4).map(([, label]) => label);
  return {
    possible: 100, total, average: total / 10, utilization: total,
    classification, critical, actionRequired: total < 70 || CRITERIA.some(([key]) => scores[key] <= 5)
  };
}
globalThis.UNISO_SCORING = { CRITERIA, POLICY_VERSION, calculate };
if (typeof module !== 'undefined') module.exports = { CRITERIA, POLICY_VERSION, calculate };
