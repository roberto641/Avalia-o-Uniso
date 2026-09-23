const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const PDFDocument = require('pdfkit');
const path = require('node:path');
const { CRITERIA, POLICY_VERSION, calculate } = require('./scoring');

initializeApp();
const db = getFirestore();
const ROLES = ['admin', 'gestor', 'rh', 'diretoria'];
const permittedText = (value, max, label) => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max)
    throw new HttpsError('invalid-argument', `Preencha ${label} (até ${max} caracteres).`);
  return value.trim();
};
const optionalText = (value, max, label) => {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > max)
    throw new HttpsError('invalid-argument', `O campo ${label} excedeu ${max} caracteres.`);
  return value.trim();
};

async function authorize(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login.');
  const user = await db.doc(`users/${request.auth.uid}`).get();
  const profile = user.data();
  if (!profile || profile.active !== true || !ROLES.includes(profile.role))
    throw new HttpsError('permission-denied', 'Usuário sem autorização.');
  return profile;
}

async function makePdf(data) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdf = new PDFDocument({ size: 'A4', margin: 42, info: { Title: 'Avaliação de Desempenho UNISO' } });
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.font(path.join(__dirname, 'assets', 'DejaVuSans.ttf'));
    pdf.image(path.join(__dirname, 'assets', 'uniso-logo.png'), 42, 34, { width: 72 });
    pdf.fontSize(17).fillColor('#174e54').text('AVALIAÇÃO DE DESEMPENHO', 124, 49);
    pdf.fontSize(9).fillColor('#555').text(`UNISO-AD-${data.year}-${data.id.slice(0, 8).toUpperCase()}  |  Política: ${POLICY_VERSION}`, 42, 130);
    pdf.fillColor('#111').fontSize(10);
    const fields = [
      `Colaborador: ${data.employee}`, `Cargo: ${data.position}   |   Setor: ${data.department}`,
      `Gestor: ${data.evaluator}   |   Período: ${data.periodStart} a ${data.periodEnd}`,
      `Data da avaliação: ${data.date}   |   Tipo: ${data.type}`
    ];
    fields.forEach(line => pdf.text(line, { lineGap: 4 }));
    pdf.moveDown(1).fontSize(12).fillColor('#174e54').text('Critérios e notas');
    pdf.moveDown(.3).fontSize(9).fillColor('#111');
    CRITERIA.forEach(([key, label], i) => {
      const y = pdf.y;
      pdf.text(`${i + 1}. ${label}`, 45, y, { width: 450 });
      pdf.text(`${data.scores[key]}/10`, 510, y, { width: 42, align: 'right' });
      pdf.moveDown(.43);
    });
    pdf.moveDown(.5).fontSize(11).fillColor('#174e54')
      .text(`Pontos: ${data.result.total}/100    Média: ${data.result.average.toFixed(1)}    Aproveitamento: ${data.result.utilization}%`);
    pdf.fontSize(10).text(`Classificação: ${data.result.classification}`);
    pdf.fillColor('#111').text(`Alerta crítico: ${data.result.critical.length ? data.result.critical.join(', ') : 'Nenhum'}`);
    pdf.moveDown(.6).fontSize(10).text('Observações:', { underline: true });
    pdf.fontSize(9).text(data.notes || 'Sem observações.', { width: 510 });
    pdf.moveDown(.6).fontSize(10).text('Plano de ação:', { underline: true });
    const plan = data.plan;
    pdf.fontSize(9).text(plan ? `Desenvolver: ${plan.goal}\nAção: ${plan.action}\nResponsável: ${plan.owner}\nPrazo: ${plan.deadline}\nAcompanhamento: ${plan.followUp}` : 'Não requerido nesta avaliação.', { width: 510 });
    if (pdf.y > 650) pdf.addPage();
    pdf.moveDown(1.3).fontSize(9).text('________________________     ________________________     ________________________', { align: 'center' });
    pdf.text('Gestor avaliador                    Coordenação de RH                      Diretoria Executiva', { align: 'center' });
    pdf.moveDown(.8).fontSize(8).fillColor('#666').text('Assinaturas previstas para impressão. O registro eletrônico identifica o avaliador e a data de emissão.', { align: 'center' });
    pdf.end();
  });
}

exports.finalizeAssessment = onCall({ region: 'southamerica-east1', maxInstances: 10 }, async request => {
  const user = await authorize(request);
  if (!['admin', 'gestor'].includes(user.role)) throw new HttpsError('permission-denied', 'Perfil sem permissão de avaliação.');
  const input = request.data || {};
  let result;
  try { result = calculate(input.scores); }
  catch (e) { throw new HttpsError('invalid-argument', e.message); }
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const validDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!validDate(input.periodStart) || !validDate(input.periodEnd) || input.periodStart > input.periodEnd)
    throw new HttpsError('invalid-argument', 'Informe um período válido.');
  let plan = null;
  if (result.actionRequired) {
    const p = input.plan || {};
    if (!validDate(p.deadline) || !validDate(p.followUp)) throw new HttpsError('invalid-argument', 'Informe datas válidas no plano.');
    plan = {
      goal: permittedText(p.goal, 500, 'o objetivo do plano'),
      action: permittedText(p.action, 800, 'a ação do plano'),
      owner: permittedText(p.owner, 120, 'o responsável'),
      deadline: p.deadline, followUp: p.followUp
    };
  }
  const doc = db.collection('assessments').doc();
  const record = {
    id: doc.id, year: date.slice(0, 4), date,
    employee: permittedText(input.employee, 120, 'o colaborador'),
    position: permittedText(input.position, 120, 'o cargo'),
    department: permittedText(input.department, 120, 'o setor'),
    evaluator: permittedText(user.name, 120, 'o nome do gestor no cadastro'),
    evaluatorUid: request.auth.uid,
    periodStart: input.periodStart, periodEnd: input.periodEnd,
    type: permittedText(input.type, 60, 'o tipo'),
    scores: input.scores, result,
    notes: optionalText(input.notes, 2000, 'observações'), plan,
    policyVersion: POLICY_VERSION
  };
  const pdf = await makePdf(record);
  const pdfPath = `assessments/${doc.id}.pdf`;
  await getStorage().bucket().file(pdfPath).save(pdf, { contentType: 'application/pdf', resumable: false });
  await doc.create({ ...record, pdfPath, createdAt: FieldValue.serverTimestamp() });
  return { id: doc.id, code: `UNISO-AD-${record.year}-${doc.id.slice(0,8).toUpperCase()}`, result };
});

exports.fetchAssessmentPdf = onCall({ region: 'southamerica-east1' }, async request => {
  const user = await authorize(request);
  const id = request.data?.id;
  if (typeof id !== 'string' || !/^[\w-]{10,80}$/.test(id))
    throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const snap = await db.doc(`assessments/${id}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Avaliação não encontrada.');
  const record = snap.data();
  if (!['admin','rh','diretoria'].includes(user.role) && record.evaluatorUid !== request.auth.uid)
    throw new HttpsError('permission-denied', 'Avaliação não autorizada.');
  const [pdf] = await getStorage().bucket().file(record.pdfPath).download();
  return { filename: `UNISO-AD-${record.year}-${id.slice(0,8).toUpperCase()}.pdf`, base64: pdf.toString('base64') };
});
