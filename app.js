import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import { firebaseConfig } from './config.js';
import './scoring.js';
const { CRITERIA, calculate } = globalThis.UNISO_SCORING;
const $ = id => document.getElementById(id);
if (Object.values(firebaseConfig).some(v => v === 'PREENCHER')) $('setup').hidden = false;
else boot();
function boot() {
  const firebase = initializeApp(firebaseConfig);
  const auth = getAuth(firebase), db = getFirestore(firebase);
  const functions = getFunctions(firebase, 'southamerica-east1');
  const finalize = httpsCallable(functions, 'finalizeAssessment');
  const fetchPdf = httpsCallable(functions, 'fetchAssessmentPdf');
  let profile, current;
  const pdfUrls = new Set();
  window.addEventListener('pagehide', () => pdfUrls.forEach(url => URL.revokeObjectURL(url)));
  const newPdfActions = document.createElement('p');
  $('submit').after(newPdfActions);
  $('criteria').replaceChildren(...CRITERIA.map(([key, label]) => {
    const row = document.createElement('div'); row.className = 'criterion';
    const text = document.createElement('label'); text.htmlFor = `score-${key}`; text.textContent = label;
    const select = document.createElement('select'); select.id = `score-${key}`; select.dataset.key = key; select.required = true;
    select.append(new Option('Selecione', ''));
    for (let n = 0; n <= 10; n++) select.append(new Option(String(n), String(n)));
    select.addEventListener('change', update); row.append(text, select); return row;
  }));
  onAuthStateChanged(auth, async user => {
    current = user; profile = null;
    $('login').hidden = !!user; $('app').hidden = true; $('logout').hidden = !user;
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      profile = snap.data();
      if (!profile?.active || !['admin','gestor','rh','diretoria'].includes(profile.role)) throw Error('Usuário não autorizado no cadastro.');
      $('app').hidden = false; $('identity').textContent = `${profile.name} • ${profile.role}`;
      $('evaluatorName').textContent = profile.name;
      $('assessmentForm').hidden = !['admin','gestor'].includes(profile.role);
      $('tabNew').hidden = !['admin','gestor'].includes(profile.role);
      if (['rh','diretoria'].includes(profile.role)) showHistory();
    } catch(e) { $('login').hidden = false; $('loginError').textContent = e.message; await signOut(auth); }
  });
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('loginError').textContent = '';
    const form = new FormData(e.target);
    try { await signInWithEmailAndPassword(auth, form.get('email'), form.get('password')); }
    catch { $('loginError').textContent = 'Não foi possível entrar. Verifique as credenciais e a autorização.'; }
  });
  $('logout').onclick = () => signOut(auth);
  $('tabNew').onclick = () => { $('formPage').hidden = false; $('historyPage').hidden = true; $('tabNew').classList.add('selected'); $('tabHistory').classList.remove('selected'); };
  $('tabHistory').onclick = showHistory;
  $('reload').onclick = loadHistory;
  function showHistory() {
    $('formPage').hidden = true; $('historyPage').hidden = false;
    $('tabHistory').classList.add('selected'); $('tabNew').classList.remove('selected');
    loadHistory();
  }
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
  $('assessmentForm').addEventListener('submit', async e => {
    e.preventDefault(); $('formError').textContent = ''; newPdfActions.replaceChildren();
    const form = e.target, values = Object.fromEntries(new FormData(form));
    const scores = Object.fromEntries([...document.querySelectorAll('#criteria select')].map(s => [s.dataset.key, Number(s.value)]));
    let result;
    try { result = calculate(scores); } catch(err) { $('formError').textContent = err.message; return; }
    if (values.periodStart > values.periodEnd) { $('formError').textContent = 'O fim do período deve ser igual ou posterior ao início.'; return; }
    if (!window.confirm(`Finalizar avaliação de ${values.employee} com ${result.total}/100? O registro não poderá ser editado.`)) return;
    const button = $('submit'); button.disabled = true; button.textContent = 'Registrando...';
    let registered;
    try {
      const payload = { employee: values.employee, position: values.position, department: values.department, type: values.type,
        periodStart: values.periodStart, periodEnd: values.periodEnd, scores, notes: values.notes,
        plan: result.actionRequired ? { goal: values.goal, action: values.action, owner: values.owner, deadline: values.deadline, followUp: values.followUp } : null };
      const { data } = await finalize(payload);
      registered = data;
      const pdf = await getPdf(data.id);
      newPdfActions.replaceChildren(pdfLinks(pdf));
      $('formError').textContent = `${data.code} registrada. Abra o PDF para imprimir ou salvar.`;
      form.reset(); document.querySelectorAll('#criteria select').forEach(s => s.value = ''); update();
    } catch(err) {
      $('formError').textContent = registered
        ? `${registered.code} já foi registrada. Não envie novamente; abra o histórico para recuperar o PDF. ${err.message || ''}`
        : `${err.message || 'Falha ao registrar.'} Nenhuma confirmação de registro foi recebida; confira o histórico antes de tentar novamente.`;
    }
    finally { button.disabled = false; button.textContent = 'Finalizar e gerar PDF'; }
  });
  async function getPdf(id) {
    const { data } = await fetchPdf({ id });
    const binary = atob(data.base64), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    pdfUrls.add(url);
    return { url, filename: data.filename };
  }
  function pdfLinks(pdf) {
    const container = document.createElement('span');
    const view = document.createElement('a');
    view.href = pdf.url; view.target = '_blank'; view.rel = 'noopener'; view.textContent = 'Visualizar PDF';
    const save = document.createElement('a');
    save.href = pdf.url; save.download = pdf.filename; save.textContent = 'Salvar PDF';
    container.append(view, document.createTextNode('  |  '), save);
    return container;
  }
  async function loadHistory() {
    const container = $('history'); container.textContent = 'Carregando...';
    try {
      const base = collection(db, 'assessments');
      const q = profile.role === 'gestor' ? query(base, where('evaluatorUid','==', current.uid), limit(30)) : query(base, orderBy('createdAt','desc'), limit(30));
      const results = await getDocs(q); container.replaceChildren();
      if (results.empty) { container.textContent = 'Nenhuma avaliação encontrada.'; return; }
      results.forEach(snap => {
        const d = snap.data(), row = document.createElement('div'); row.className = 'item';
        const title = document.createElement('strong'); title.textContent = `${d.employee} • ${d.result.total}/100`;
        const detail = document.createElement('small'); detail.textContent = `${d.date} • ${d.department} • ${d.result.classification}`;
        const button = document.createElement('button'); button.textContent = 'Carregar PDF';
        button.onclick = async () => {
          button.disabled = true;
          try { button.replaceWith(pdfLinks(await getPdf(snap.id))); }
          catch(e) { alert(e.message); button.disabled = false; }
        };
        row.append(title, detail, button); container.append(row);
      });
    } catch(e) { container.textContent = `Falha ao carregar o histórico: ${e.message}`; }
  }
}
