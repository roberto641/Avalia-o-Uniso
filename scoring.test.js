const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CRITERIA, calculate } = require('../shared/scoring');
const scored = n => Object.fromEntries(CRITERIA.map(([key]) => [key, n]));
test('intervalos da classificação', () => {
  for (const [total, expected] of [[59,'Pontuação mínima'],[60,'Em desenvolvimento'],[70,'Bom desempenho'],[80,'Muito bom'],[90,'Excelente']]) {
    const s = scored(Math.floor(total / 10));
    for (let i = 0; i < total % 10; i++) s[CRITERIA[i][0]]++;
    assert.equal(calculate(s).total, total);
    assert.ok(calculate(s).classification.startsWith(expected));
  }
});
test('nota baixa abre plano mesmo com pontuação alta', () => {
  const s = scored(10); s.iniciativa = 4;
  assert.equal(calculate(s).total, 94);
  assert.equal(calculate(s).critical.length, 1);
  assert.equal(calculate(s).actionRequired, true);
});
test('não aceita ausência de nota, fração ou nota fora do intervalo', () => {
  assert.throws(() => calculate({}), /dez critérios/);
  const s = scored(8); s.iniciativa = 8.5;
  assert.throws(() => calculate(s), /inteiro/);
  s.iniciativa = 11;
  assert.throws(() => calculate(s), /inteiro/);
});
