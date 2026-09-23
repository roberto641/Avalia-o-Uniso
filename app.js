import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import { firebaseConfig } from './config.js';
import { CRITERIA, calculate } from './scoring.js';
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
    e.preventDefault(); $('formError').textContent = '';
    const form = e.target, values = Object.fromEntries(new FormData(form));
    const scores = Object.fromEntries([...document.querySelectorAll('#criteria select')].map(s => [s.dataset.key, Number(s.value)]));
    let result;
    try { result = calculate(scores); } catch(err) { $('formError').textContent = err.message; return; }
    if (values.periodStart > values.periodEnd) { $('formError').textContent = 'O fim do período deve ser igual ou posterior ao início.'; return; }
    if (!window.confirm(`Finalizar avaliação de ${values.employee} com ${result.total}/100? O registro não poderá ser editado.`)) return;
    const button = $('submit'); button.disabled = true; button.textContent = 'Registrando...';
    try {
      const payload = { employee: values.employee, position: values.position, department: values.department, type: values.type,
        periodStart: values.periodStart, periodEnd: values.periodEnd, scores, notes: values.notes,
        plan: result.actionRequired ? { goal: values.goal, action: values.action, owner: values.owner, deadline: values.deadline, followUp: values.followUp } : null };
      const { data } = await finalize(payload);
      alert(`${data.code} registrada. O PDF será baixado agora.`);
      await download(data.id);
      form.reset(); document.querySelectorAll('#criteria select').forEach(s => s.value = ''); update();
    } catch(err) { $('formError').textContent = err.message || 'Falha ao finalizar. Tente novamente após verificar o histórico.'; }
    finally { button.disabled = false; button.textContent = 'Finalizar e gerar PDF'; }
  });
  async function download(id) {
    const { data } = await fetchPdf({ id });
    const binary = atob(data.base64), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = data.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
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
        const button = document.createElement('button'); button.textContent = 'Baixar PDF';
        button.onclick = async () => { button.disabled = true; try { await download(snap.id); } catch(e) { alert(e.message); } finally { button.disabled = false; } };
        row.append(title, detail, button); container.append(row);
      });
    } catch(e) { container.textContent = `Falha ao carregar o histórico: ${e.message}`; }
  }
}
