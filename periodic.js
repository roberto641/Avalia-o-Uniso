import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const $ = id => document.getElementById(id);
const { QUESTIONNAIRES } = globalThis.UNISO_QUESTIONNAIRES;
const auth = getAuth(initializeApp(firebaseConfig));
const db = getFirestore(auth.app);
const current = new URL(location.href);
const continuation = current.searchParams.get('continueUrl');
const invitation = current.searchParams.get('invite') || (continuation ? new URL(continuation).searchParams.get('invite') : '');
let record;
let loading = false;

function message(value) { $('message').textContent = value; }

async function load() {
  if (loading || !auth.currentUser || !invitation) return;
  loading = true;
  try {
    const snap = await getDoc(doc(db, 'assessments', invitation));
    if (!snap.exists()) throw Error('Convite não encontrado ou sem acesso para este e-mail.');
    record = snap.data();
    if (record.type !== 'PERIODICA' || record.employeeEmail !== auth.currentUser.email?.toLowerCase())
      throw Error('Este convite pertence a outro endereço de e-mail.');
    if (record.status !== 'AGUARDANDO_COLABORADOR') {
      message('Este questionário já foi enviado ou não está mais aberto.');
      $('emailForm').hidden = true;
      $('periodicForm').hidden = true;
      return;
    }
    $('identity').textContent = `Colaborador: ${record.employee} • Período: ${record.periodStart} a ${record.periodEnd}`;
    const labels = record.questionnaireLabels || Object.fromEntries(QUESTIONNAIRES.PERIODICA.map((label, index) => [`q${String(index + 1).padStart(2, '0')}`, label]));
    $('questions').replaceChildren(...Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([key, label], i) => {
      const container = document.createElement('label');
      container.textContent = `${i + 1}. ${label}`;
      const answer = document.createElement('textarea');
      answer.name = key;
      answer.rows = 4;
      answer.maxLength = 4000;
      answer.required = true;
      container.append(answer);
      return container;
    }));
    $('emailForm').hidden = true;
    $('periodicForm').hidden = false;
    $('exit').hidden = false;
    message('Preencha todas as respostas e envie para análise do RH.');
  } catch (err) { message(err.message); }
  finally { loading = false; }
}

$('emailForm').onsubmit = async event => {
  event.preventDefault();
  try {
    message('Validando seu e-mail…');
    const email = $('email').value.trim().toLowerCase();
    await signInWithEmailLink(auth, email, location.href);
    history.replaceState(null, '', new URL(`./periodic.html?invite=${encodeURIComponent(invitation)}`, location.href));
    await load();
  } catch (err) { message(`Não foi possível validar o link: ${err.message}`); }
};

$('periodicForm').onsubmit = async event => {
  event.preventDefault();
  const answers = Object.fromEntries(new FormData(event.target));
  if (Object.values(answers).some(value => !String(value).trim())) {
    message('Responda a todas as perguntas.');
    return;
  }
  $('submit').disabled = true;
  try {
    await updateDoc(doc(db, 'assessments', invitation), {
      questionnaireAnswers: Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, String(value).trim()])),
      employeeUid: auth.currentUser.uid,
      employeeSubmittedAt: serverTimestamp(),
      status: 'AGUARDANDO_RH',
      updatedAt: serverTimestamp()
    });
    $('periodicForm').hidden = true;
    message('Respostas recebidas. A avaliação agora aguarda análise do RH.');
  } catch (err) {
    message(`Não foi possível enviar: ${err.message}`);
    $('submit').disabled = false;
  }
};

$('exit').onclick = () => signOut(auth);

if (!invitation) message('Convite incompleto. Abra o link recebido por e-mail.');
else if (isSignInWithEmailLink(auth, location.href)) {
  $('emailForm').hidden = false;
  message('Confirme o e-mail que recebeu o convite para abrir o questionário.');
} else {
  onAuthStateChanged(auth, user => {
    if (user) load();
    else { $('periodicForm').hidden = true; $('emailForm').hidden = true; message('Abra o link de acesso recebido no seu e-mail.'); }
  });
}
