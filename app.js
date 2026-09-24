import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';
import './scoring.js';
const { CRITERIA, calculate } = globalThis.UNISO_SCORING;
const $ = id => document.getElementById(id);
if (Object.values(firebaseConfig).some(v => v === 'PREENCHER')) $('setup').hidden = false;
else boot();
function boot() {
  const firebase = initializeApp(firebaseConfig);
  const auth = getAuth(firebase), db = getFirestore(firebase);
  let profile;
  $('submit').textContent = 'Visualizar relatório / imprimir / salvar PDF';
  $('criteria').replaceChildren(...CRITERIA.map(([key, label]) => {
    const row = document.createElement('div'); row.className = 'criterion';
    const text = document.createElement('label'); text.htmlFor = `score-${key}`; text.textContent = label;
    const select = document.createElement('select'); select.id = `score-${key}`; select.dataset.key = key; select.required = true;
    select.append(new Option('Selecione', ''));
    for (let n = 0; n <= 10; n++) select.append(new Option(String(n), String(n)));
    select.addEventListener('change', update); row.append(text, select); return row;
  }));
  onAuthStateChanged(auth, async user => {
    profile = null;
    $('login').hidden = !!user; $('app').hidden = true; $('logout').hidden = !user;
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      profile = snap.data();
      if (!profile?.active || !['admin','gestor'].includes(profile.role)) throw Error('Perfil sem autorização para preencher avaliações.');
      $('app').hidden = false; $('identity').textContent = `${profile.name} • ${profile.role}`;
      $('evaluatorName').textContent = profile.name;
      $('assessmentForm').hidden = false;
      $('formPage').hidden = false;
    } catch(e) { $('login').hidden = false; $('loginError').textContent = e.message; await signOut(auth); }
  });
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('loginError').textContent = '';
    const form = new FormData(e.target);
    try { await signInWithEmailAndPassword(auth, form.get('email'), form.get('password')); }
    catch { $('loginError').textContent = 'Não foi possível entrar. Verifique as credenciais e a autorização.'; }
  });
  $('logout').onclick = () => signOut(auth);
  $('tabNew').onclick = () => {
    const form = $('assessmentForm');
    const hasContent = [...form.querySelectorAll('input,textarea')].some(field => field.value.trim()) ||
      [...document.querySelectorAll('#criteria select')].some(select => select.value !== '');
    if (hasContent && !window.confirm('Iniciar outra avaliação? Os dados preenchidos serão apagados. Salve ou imprima o relatório antes de continuar.')) return;
    form.reset();
    document.querySelectorAll('#criteria select').forEach(select => { select.value = ''; });
    $('formError').textContent = '';
    update();
    $('formPage').hidden = false;
    form.querySelector('input[name="employee"]').focus();
  };
  function update() {
    const selected = [...document.querySelectorAll('#criteria select')];
    const complete = selected.every(s => s.value !== '');
    const summary = complete ? calculate(Object.fromEntries(selected.map(s => [s.dataset.key, Number(s.value)]))) : null;
    $('total').textContent = summary ? `${summary.total} / 100` : '— / 100';
    $('average').textContent = summary ? summary.average.toFixed(1) : '—';
    $('utilization').textContent = summary ? `${summary.utilization}%` : '—';
    $('classification').textContent = summary?.classification ?? 'Aguardando notas';
    $('critical').textContent = summary ? summary.critical.join(', ') || 'Nenhum' : '—';
    $('plan').hidden = !summary?.actionRequired;
    for (const input of $('plan').querySelectorAll('input,textarea')) input.required = !!summary?.actionRequired;
  }
  $('assessmentForm').addEventListener('submit', e => {
    e.preventDefault(); $('formError').textContent = '';
    if (!profile || !['admin', 'gestor'].includes(profile.role)) {
      $('formError').textContent = 'Entre como gestor autorizado antes de gerar o relatório.';
      return;
    }
    const values = Object.fromEntries(new FormData(e.target));
    const scores = Object.fromEntries([...document.querySelectorAll('#criteria select')]
      .map(s => [s.dataset.key, Number(s.value)]));
    let result;
    try { result = calculate(scores); }
    catch(err) { $('formError').textContent = err.message; return; }
    if (values.periodStart > values.periodEnd) {
      $('formError').textContent = 'O fim do período deve ser igual ou posterior ao início.';
      return;
    }
    const preview = window.open('', '_blank');
    if (!preview) {
      $('formError').textContent = 'Permita a abertura de janelas para este site e clique novamente.';
      return;
    }
    try { showReport(preview, values, scores, result, profile.name); }
    catch(err) {
      preview.close();
      $('formError').textContent = `Não foi possível montar o relatório: ${err.message}`;
    }
  });
  function showReport(preview, values, scores, result, evaluator) {
    const d = preview.document;
    d.open();
    d.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Avaliação de Desempenho - UNISO</title>
      <style>
        @page { size: A4; margin: 15mm; }
        * { box-sizing: border-box; }
        body { margin: 24px auto; max-width: 185mm; color: #183039; font: 11pt/1.42 Arial, sans-serif; }
        .actions { background: #eef8f9; padding: 12px; margin-bottom: 18px; border-radius: 6px; }
        button { background: #176c78; color: white; border: 0; border-radius: 5px; padding: 10px 15px; cursor: pointer; }
        .head { display: flex; align-items: center; gap: 22px; border-bottom: 2px solid #79cbd0; padding-bottom: 14px; }
        .head img { width: 75px; height: auto; }
        h1 { font-size: 18pt; margin: 0; } h2 { font-size: 12pt; color: #176c78; margin: 18px 0 6px; }
        .subtitle { color: #52616a; font-size: 9pt; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin: 12px 0; }
        .meta div { overflow-wrap: anywhere; }
        table { width: 100%; border-collapse: collapse; font-size: 10pt; }
        th, td { text-align: left; padding: 6px; border-bottom: 1px solid #c9d9de; }
        th:last-child, td:last-child { text-align: right; width: 72px; }
        thead { display: table-header-group; } tr { break-inside: avoid; }
        .result { padding: 12px; background: #eaf6f7; margin-top: 14px; break-inside: avoid; }
        .pre { white-space: pre-wrap; overflow-wrap: anywhere; }
        .signatures { display: flex; gap: 12px; margin-top: 50px; text-align: center; font-size: 9pt; }
        .signatures div { flex: 1; border-top: 1px solid #444; padding-top: 5px; }
        @media print { body { margin: 0; max-width: none; } .actions { display: none; } }
      </style></head><body><div class="actions"></div><main></main></body></html>`);
    d.close();
    const actions = d.querySelector('.actions');
    const print = d.createElement('button');
    print.type = 'button'; print.textContent = 'Imprimir ou salvar como PDF';
    print.addEventListener('click', () => preview.print());
    actions.append(print, d.createTextNode('  Na impressão, escolha sua impressora ou “Salvar como PDF”.'));
    const main = d.querySelector('main');
    const header = d.createElement('header'); header.className = 'head';
    const logo = d.createElement('img'); logo.src = new URL('./uniso-logo.png', location.href).href; logo.alt = 'UNISO';
    const heading = d.createElement('div');
    const title = d.createElement('h1'); title.textContent = 'AVALIAÇÃO DE DESEMPENHO';
    const subtitle = d.createElement('div'); subtitle.className = 'subtitle';
    subtitle.textContent = 'UNISO • Emitido em ' + new Date().toLocaleString('pt-BR');
    heading.append(title, subtitle); header.append(logo, heading); main.append(header);
    const addTitle = label => {
      const node = d.createElement('h2'); node.textContent = label; main.append(node);
    };
    addTitle('Identificação');
    const meta = d.createElement('div'); meta.className = 'meta'; main.append(meta);
    for (const [label, value] of [
      ['Colaborador', values.employee], ['Cargo', values.position],
      ['Setor', values.department], ['Tipo', values.type],
      ['Período', `${values.periodStart} a ${values.periodEnd}`], ['Gestor avaliador', evaluator]
    ]) {
      const item = d.createElement('div');
      const strong = d.createElement('strong'); strong.textContent = label + ': ';
      item.append(strong, d.createTextNode(value)); meta.append(item);
    }
    addTitle('Critérios e notas');
    const table = d.createElement('table'), thead = d.createElement('thead'), tbody = d.createElement('tbody');
    const headRow = d.createElement('tr');
    for (const text of ['Critério', 'Nota']) {
      const cell = d.createElement('th'); cell.textContent = text; headRow.append(cell);
    }
    thead.append(headRow); table.append(thead, tbody); main.append(table);
    CRITERIA.forEach(([key, label], i) => {
      const row = d.createElement('tr');
      for (const value of [`${i + 1}. ${label}`, `${scores[key]}/10`]) {
        const cell = d.createElement('td'); cell.textContent = value; row.append(cell);
      }
      tbody.append(row);
    });
    const summary = d.createElement('div'); summary.className = 'result';
    summary.textContent = `Total: ${result.total}/100  •  Média: ${result.average.toFixed(1)}  •  Aproveitamento: ${result.utilization}%`;
    summary.append(d.createElement('br'), d.createTextNode(`Classificação: ${result.classification}`));
    summary.append(d.createElement('br'), d.createTextNode(`Alerta crítico: ${result.critical.join(', ') || 'Nenhum'}`));
    main.append(summary);
    addTitle('Observações e evidências');
    const notes = d.createElement('div'); notes.className = 'pre';
    notes.textContent = values.notes || 'Sem observações.'; main.append(notes);
    addTitle('Plano de ação');
    const plan = d.createElement('div'); plan.className = 'pre';
    plan.textContent = result.actionRequired
      ? `O que desenvolver: ${values.goal}\nAção recomendada: ${values.action}\nResponsável: ${values.owner}\nPrazo: ${values.deadline}\nAcompanhamento: ${values.followUp}`
      : 'Não requerido nesta avaliação.';
    main.append(plan);
    const signatures = d.createElement('div'); signatures.className = 'signatures';
    for (const label of ['Gestor avaliador', 'Coordenação de RH', 'Diretoria Executiva']) {
      const field = d.createElement('div'); field.textContent = label; signatures.append(field);
    }
    main.append(signatures);
    preview.focus();
  }
}
