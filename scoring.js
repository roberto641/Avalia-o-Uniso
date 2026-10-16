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
const WEIGHTS = {
  interesse: 3, iniciativa: 4, disciplina: 3, assiduidade: 30,
  pontualidade: 3, relacionamento: 5, cooperacao: 5,
  qualidade: 5, produtividade: 4, responsabilidade: 3
};
const WEIGHT_SUM = CRITERIA.reduce((sum, [key]) => sum + WEIGHTS[key], 0); // 65
const POLICY_VERSION = 'uniso-weighted-2026-10-v1';
const MARKETING_WEIGHTS = {
  interesse: 6, iniciativa: 5, disciplina: 4, assiduidade: 5,
  pontualidade: 5, relacionamento: 4, cooperacao: 5,
  qualidade: 13, produtividade: 8, responsabilidade: 10
};
const MARKETING_WEIGHT_SUM = CRITERIA.reduce((sum, [key]) => sum + MARKETING_WEIGHTS[key], 0); // 65
const MARKETING_POLICY_VERSION = 'uniso-marketing-2026-10-v1';

function calculateWithWeights(scores, weights) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores) ||
      Object.keys(scores).length !== CRITERIA.length) throw new Error('Preencha os dez critérios.');
  for (const [key] of CRITERIA) {
    if (!Number.isInteger(scores[key]) || scores[key] < 0 || scores[key] > 10)
      throw new Error('Cada nota deve ser um número inteiro de 0 a 10.');
  }
  const rawTotal = CRITERIA.reduce((sum, [key]) => sum + scores[key], 0);
  const weightSum = CRITERIA.reduce((sum, [key]) => sum + weights[key], 0);
  const weightedSum = CRITERIA.reduce((sum, [key]) => sum + scores[key] * weights[key], 0);
  const total = Math.round(weightedSum * 100 / weightSum) / 10;
  const classification = total >= 90 ? 'Excelente desempenho'
    : total >= 80 ? 'Muito bom desempenho'
    : total >= 70 ? 'Bom desempenho / dentro do esperado'
    : total >= 60 ? 'Em desenvolvimento'
    : 'Pontuação mínima não atingida - Acompanhar o colaborador';
  const critical = CRITERIA.filter(([key]) => scores[key] <= 4).map(([, label]) => label);
  return {
    possible: 100, total, rawTotal, average: rawTotal / 10, utilization: total,
    classification, critical, actionRequired: total < 70 || CRITERIA.some(([key]) => scores[key] <= 5)
  };
}
function calculate(scores) { return calculateWithWeights(scores, WEIGHTS); }
function calculateMarketing(scores) { return calculateWithWeights(scores, MARKETING_WEIGHTS); }
function calculateLegacy(scores) {
  const weighted = calculate(scores);
  const total = weighted.rawTotal;
  const classification = total >= 90 ? 'Excelente desempenho'
    : total >= 80 ? 'Muito bom desempenho'
    : total >= 70 ? 'Bom desempenho / dentro do esperado'
    : total >= 60 ? 'Em desenvolvimento'
    : 'Pontuação mínima não atingida - Acompanhar o colaborador';
  return { ...weighted, total, utilization: total, classification,
    actionRequired: total < 70 || CRITERIA.some(([key]) => scores[key] <= 5) };
}
function weightsForVersion(version) {
  return version === MARKETING_POLICY_VERSION ? MARKETING_WEIGHTS : WEIGHTS;
}
function calculateRecord(scores, version) {
  if (!version) return calculateLegacy(scores);
  return calculateWithWeights(scores, weightsForVersion(version));
}
const scoring = { CRITERIA, WEIGHTS, WEIGHT_SUM, POLICY_VERSION,
  MARKETING_WEIGHTS, MARKETING_WEIGHT_SUM, MARKETING_POLICY_VERSION,
  calculate, calculateMarketing, calculateLegacy, calculateRecord, weightsForVersion };
globalThis.UNISO_SCORING = scoring;
if (typeof module !== 'undefined') module.exports = scoring;
