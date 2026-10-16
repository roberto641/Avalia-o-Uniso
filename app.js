import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendSignInLinkToEmail, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, onSnapshot, collection, query, where, addDoc, updateDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';
const { CRITERIA, WEIGHTS, POLICY_VERSION, MARKETING_WEIGHTS, MARKETING_POLICY_VERSION,
  calculate, calculateMarketing, calculateRecord, weightsForVersion } = globalThis.UNISO_SCORING;
const { QUESTIONNAIRES, QUESTIONNAIRE_VERSION } = globalThis.UNISO_QUESTIONNAIRES;
const TYPES = { DESEMPENHO: 'Avaliação e Desempenho', EXPERIENCIA: 'Experiência', PROMOCAO: 'Promoção', PERIODICA: 'Avaliação periódica' };
const questionKey = index => `q${String(index + 1).padStart(2, '0')}`;
const $ = id => document.getElementById(id);

if (Object.values(firebaseConfig).some(v => v === 'PREENCHER')) {
  $('setup').hidden = false;
} else {
  boot();
}

function boot() {
  const firebase = initializeApp(firebaseConfig);
  const auth = getAuth(firebase);
  const db = getFirestore(firebase);

  let profile;
  let records = [];
  let historyUnsubscribe = null;
  let statusFilter = 'ALL';
  const isMarketing = () => profile?.role === 'marketing';
  const currentWeights = () => isMarketing() ? MARKETING_WEIGHTS : WEIGHTS;
  const currentScore = scores => isMarketing() ? calculateMarketing(scores) : calculate(scores);

  function refreshCriterionWeights() {
    document.querySelectorAll('#criteria select').forEach(select => {
      select.previousElementSibling.textContent =
        `${CRITERIA.find(([key]) => key === select.dataset.key)[1]} (peso ${currentWeights()[select.dataset.key]})`;
    });
  }

  const normalized = value =>
    (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/\s+/g, ' ')
      .trim();

  const dateTime = value =>
    value?.toDate?.()?.toLocaleString('pt-BR') || '—';

  $('criteria').replaceChildren(...CRITERIA.map(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'criterion';

    const text = document.createElement('label');
    text.htmlFor = `score-${key}`;
    text.textContent = `${label} (peso ${WEIGHTS[key]})`;

    const select = document.createElement('select');
    select.id = `score-${key}`;
    select.dataset.key = key;
    select.required = true;
    select.append(new Option('Selecione', ''));

    for (let n = 0; n <= 10; n++) {
      select.append(new Option(String(n), String(n)));
    }

    select.addEventListener('change', update);
    row.append(text, select);
    return row;
  }));

  $('assessmentType').addEventListener('change', configureType);
  function configureType() {
    const type = $('assessmentType').value;
    const performance = type === 'DESEMPENHO';
    const employeeQuestionnaire = !performance;
    $('scoreSection').hidden = !performance;
    $('scoreSummary').hidden = !performance;
    $('narrativeSection').hidden = performance;
    $('employeeEmailWrap').hidden = !employeeQuestionnaire;
    $('employeeEmail').required = employeeQuestionnaire;
    $('managerExtras').hidden = employeeQuestionnaire;
    $('submit').textContent = employeeQuestionnaire ? 'Criar convite e enviar link ao colaborador' : 'Registrar avaliação e abrir relatório';
    $('submitHelp').textContent = employeeQuestionnaire
      ? 'O colaborador responderá por um link enviado ao e-mail informado. Depois, o gestor registrará suas considerações antes de encaminhar a avaliação ao RH.'
      : 'A avaliação ficará registrada no histórico. O relatório abre em outra aba para imprimir ou salvar como PDF.';
    document.querySelectorAll('#criteria select').forEach(select => { select.required = performance; });
    const questions = QUESTIONNAIRES[type] || [];
    $('narrativeTitle').textContent = `Questionário de ${TYPES[type] || type}`;
    $('narrativeHelp').textContent = 'Estas perguntas serão enviadas ao colaborador pelo link individual.';
    const list = document.createElement('ol');
    list.append(...questions.map(question => {
      const item = document.createElement('li');
      item.textContent = question;
      return item;
    }));
    $('narrativeQuestions').replaceChildren(list);
    update();
  }
  configureType();

  onAuthStateChanged(auth, async user => {
    if (historyUnsubscribe) {
      historyUnsubscribe();
      historyUnsubscribe = null;
    }

    profile = null;
    $('assessmentType').disabled = false;
    $('weightHint').textContent = 'A nota final é ponderada pelos pesos aprovados (soma 65, normalizada para 100). Assiduidade representa 30/65 da nota.';
    refreshCriterionWeights();
    $('login').hidden = !!user;
    $('app').hidden = true;
    $('logout').hidden = !user;

    records = [];
    statusFilter = 'ALL';
    $('employeeSearch').value = '';

    if (!user) return;

    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      profile = snap.data();

      if (
        !profile?.active ||
        !['admin', 'gestor', 'rh', 'diretoria', 'marketing'].includes(profile.role)
      ) {
        throw Error('Perfil sem autorização para acessar avaliações.');
      }

      $('app').hidden = false;
      $('identity').textContent = `${profile.name} • ${profile.role}`;
      $('assessmentType').value = isMarketing() ? 'DESEMPENHO' : $('assessmentType').value;
      $('assessmentType').disabled = isMarketing();
      $('weightHint').textContent = isMarketing()
        ? 'Pesos do Marketing: soma 65, normalizada para 100. Qualidade e precisão do trabalho representa 13/65 da nota.'
        : 'A nota final é ponderada pelos pesos aprovados (soma 65, normalizada para 100). Assiduidade representa 30/65 da nota.';
      $('assessmentSummary').querySelectorAll('button[data-status]').forEach(button => {
        button.hidden = isMarketing() && button.dataset.status !== 'ALL';
      });
      refreshCriterionWeights();
      configureType();
      $('evaluatorName').textContent = profile.name;
      $('assessmentForm').hidden = false;

      $('tabNew').hidden = !['admin', 'gestor', 'marketing'].includes(profile.role);

      if (['admin', 'gestor', 'marketing'].includes(profile.role)) {
        selectPage('new');
      } else {
        selectPage('history');
        loadHistory();
      }
    } catch (e) {
      $('login').hidden = false;
      $('loginError').textContent = e.message;
      await signOut(auth);
    }
  });

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginError').textContent = '';

    const form = new FormData(e.target);

    try {
      await signInWithEmailAndPassword(
        auth,
        form.get('email'),
        form.get('password')
      );
    } catch (err) {
      const help = err.code === 'auth/operation-not-allowed'
        ? 'Ative E-mail/Senha em Authentication > Método de login no projeto Uniso RH.'
        : err.code === 'auth/too-many-requests'
          ? 'Muitas tentativas. Aguarde antes de tentar novamente.'
          : 'Confira o e-mail e a senha. Se você usou o link de avaliação com este e-mail, redefina a senha.';
      $('loginError').textContent = `${help} (${err.code || 'erro desconhecido'})`;
    }
  });

  const resetButton = $('resetPassword');
  if (resetButton) resetButton.onclick = async () => {
    const email = $('loginForm').elements.email.value.trim();
    if (!email || !$('loginForm').elements.email.checkValidity()) {
      $('loginError').textContent = 'Informe seu e-mail válido antes de solicitar a redefinição.';
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      $('loginError').textContent = 'Se a conta estiver cadastrada, você receberá um e-mail para redefinir a senha.';
    } catch (err) {
      $('loginError').textContent = `Não foi possível solicitar a redefinição: ${err.code || err.message}`;
    }
  };

  $('logout').onclick = () => signOut(auth);

  function selectPage(page) {
    $('formPage').hidden = page !== 'new';
    $('historyPage').hidden = page !== 'history';
    $('tabNew').classList.toggle('selected', page === 'new');
    $('tabHistory').classList.toggle('selected', page === 'history');
  }

  $('tabHistory').onclick = () => {
    selectPage('history');
    loadHistory();
  };

    $('refreshHistory').onclick = loadHistory;
  $('employeeSearch').oninput = renderHistory;

  $('clearFilters').onclick = () => {
    statusFilter = 'ALL';
    $('employeeSearch').value = '';
    renderHistory();
  };

  $('assessmentSummary').onclick = event => {
    const button = event.target.closest('button[data-status]');

    if (!button || !$('assessmentSummary').contains(button)) {
      return;
    }

    statusFilter = button.dataset.status;
    renderHistory();
  };

  $('tabNew').onclick = () => {
    const form = $('assessmentForm');

    const hasContent =
      [...form.querySelectorAll('input,textarea')]
        .some(field => field.value.trim()) ||
      [...document.querySelectorAll('#criteria select')]
        .some(select => select.value !== '');

    if (
      hasContent &&
      !window.confirm(
        'Iniciar outra avaliação? O conteúdo ainda não registrado será perdido. Avaliações já registradas permanecem no histórico.'
      )
    ) {
      return;
    }

    form.reset();
    configureType();

    document.querySelectorAll('#criteria select').forEach(select => {
      select.value = '';
    });

    $('formError').textContent = '';
    $('submit').disabled = false;
    update();
    selectPage('new');
    form.querySelector('input[name="employee"]').focus();
  };

  function update() {
    if ($('assessmentType').value !== 'DESEMPENHO') return;
    const selected = [...document.querySelectorAll('#criteria select')];
    const complete = selected.every(s => s.value !== '');

    const summary = complete
      ? currentScore(
          Object.fromEntries(
            selected.map(s => [s.dataset.key, Number(s.value)])
          )
        )
      : null;

    $('total').textContent = summary
      ? `${summary.total} / 100`
      : '— / 100';

    $('average').textContent = summary
      ? summary.average.toFixed(1)
      : '—';

    $('utilization').textContent = summary
      ? `${summary.total}/100`
      : '—';

    $('classification').textContent =
      summary?.classification ?? 'Aguardando notas';

    $('critical').textContent = summary
      ? summary.critical.join(', ') || 'Nenhum'
      : '—';
  }

  $('assessmentForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('formError').textContent = '';

    if (!profile || !['admin', 'gestor', 'marketing'].includes(profile.role)) {
      $('formError').textContent =
        'Entre como gestor autorizado antes de gerar o relatório.';
      return;
    }

    const values = Object.fromEntries(new FormData(e.target));

    const type = isMarketing() ? 'DESEMPENHO' : values.type;
    values.type = type;
    const scores = type === 'DESEMPENHO' ? Object.fromEntries(
      [...document.querySelectorAll('#criteria select')].map(s => [s.dataset.key, Number(s.value)])
    ) : null;
    const questions = QUESTIONNAIRES[type] || [];
    const questionnaireLabels = Object.fromEntries(questions.map((label, i) => [questionKey(i), label]));
    const employeeQuestionnaire = type !== 'DESEMPENHO';
    const questionnaireAnswers = {};
    let result = null;

    try {
      if (type === 'DESEMPENHO') result = currentScore(scores);
      else if (!questions.length) throw Error('Tipo de avaliação sem questionário configurado.');
    } catch (err) {
      $('formError').textContent = err.message;
      return;
    }

    if (values.periodStart > values.periodEnd) {
      $('formError').textContent =
        'O fim do período deve ser igual ou posterior ao início.';
      return;
    }

    const preview = employeeQuestionnaire ? null : window.open('', '_blank');

    if (!employeeQuestionnaire && !preview) {
      $('formError').textContent =
        'Permita a abertura de janelas para este site e clique novamente.';
      return;
    }

    $('submit').disabled = true;
    let registered = false;

    try {
      const payload = {
        employee: values.employee.trim(),
        employeeNameKey: normalized(values.employee),
        position: values.position.trim(),
        department: values.department.trim(),
        type: values.type,
        questionnaireVersion: type === 'DESEMPENHO' ? null : QUESTIONNAIRE_VERSION,
        questionnaireLabels,
        questionnaireAnswers,
        employeeEmail: employeeQuestionnaire ? values.employeeEmail.trim().toLowerCase() : '',
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        scores: scores || {},
        total: result?.total ?? null,
        rawTotal: result?.rawTotal ?? null,
        scoringVersion: type === 'DESEMPENHO'
          ? (isMarketing() ? MARKETING_POLICY_VERSION : POLICY_VERSION) : null,
        scoringWeights: type === 'DESEMPENHO' ? { ...currentWeights() } : {},
        notes: values.notes?.trim() || '',
        plan: Object.fromEntries(
          ['goal', 'action', 'owner']
            .map(key => [key, values[key]?.trim() || ''])
        ),
        evaluator: profile.name,
        evaluatorUid: auth.currentUser.uid,
        evaluatorRole: profile.role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: employeeQuestionnaire ? 'AGUARDANDO_COLABORADOR' : 'AGUARDANDO_RH',
        rhNote: '',
        rhUid: '',
        rhName: '',
        rhAt: null,
        directorNote: '',
        directorUid: '',
        directorName: '',
        directorAt: null
      };

      let ref;
      if (isMarketing()) {
        ref = doc(collection(db, 'assessments'));
        const managerRecord = {
          employee: payload.employee,
          employeeNameKey: payload.employeeNameKey,
          position: payload.position,
          department: payload.department,
          type: payload.type,
          periodStart: payload.periodStart,
          periodEnd: payload.periodEnd,
          scores: payload.scores,
          total: payload.total,
          rawTotal: payload.rawTotal,
          scoringVersion: payload.scoringVersion,
          scoringWeights: payload.scoringWeights,
          notes: payload.notes,
          plan: payload.plan,
          evaluator: payload.evaluator,
          evaluatorUid: payload.evaluatorUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        const batch = writeBatch(db);
        batch.set(ref, payload);
        batch.set(doc(db, 'marketingAssessments', ref.id), managerRecord);
        await batch.commit();
      } else {
        ref = await addDoc(collection(db, 'assessments'), payload);
      }
      registered = true;

      if (employeeQuestionnaire) {
        try {
          const url = new URL('./periodic.html', location.href);
          url.searchParams.set('invite', ref.id);
          await sendSignInLinkToEmail(auth, payload.employeeEmail, {
            url: url.href, handleCodeInApp: true
          });
          $('formError').textContent = 'Convite registrado e link enviado ao colaborador. Aguardando resposta.';
        } catch (sendError) {
          $('formError').textContent = `Convite registrado, mas o link não foi enviado: ${sendError.message}. Confira a configuração do login por link e entre em contato com o suporte antes de reenviar.`;
        }
        return;
      }

      $('formError').textContent =
        'Avaliação registrada. Aguardando análise do RH.';

      try {
        showReport(
          preview,
          values,
          scores,
          result,
          profile.name,
          { ...payload, id: ref.id }
        );
      } catch (err) {
        preview.close();
        $('formError').textContent =
          `Avaliação registrada, mas não foi possível abrir o relatório: ${err.message}. Consulte o histórico.`;
      }
    } catch (err) {
      preview?.close();
      $('formError').textContent =
        `Não foi possível registrar a avaliação: ${err.message}`;
    } finally {
      $('submit').disabled = registered;
    }
  });

  function loadHistory() {
    if (!auth.currentUser || !profile) return;

    $('historyStatus').textContent = 'Carregando avaliações...';

    try {
      if (historyUnsubscribe) {
        historyUnsubscribe();
        historyUnsubscribe = null;
      }

      const base = collection(db, isMarketing() ? 'marketingAssessments' : 'assessments');
      const source = ['gestor', 'marketing'].includes(profile.role)
        ? query(base, where('evaluatorUid', '==', auth.currentUser.uid))
        : base;

      historyUnsubscribe = onSnapshot(
        source,
        data => {
          records = data.docs
            .map(item => ({ id: item.id, ...item.data() }))
            .sort(
              (a, b) =>
                (b.createdAt?.seconds || 0) -
                (a.createdAt?.seconds || 0)
            );

          $('historyStatus').textContent =
            `${records.length} avaliação(ões) disponível(is) para seu perfil.`;

          renderHistory();
        },
        err => {
          $('historyStatus').textContent =
            `Não foi possível consultar o histórico: ${err.message}`;
        }
      );
    } catch (err) {
      $('historyStatus').textContent =
        `Não foi possível consultar o histórico: ${err.message}`;
    }
  }

  function renderHistory() {
    const target = $('assessmentList');
    target.replaceChildren();

    const counts = {
      ALL: records.length,
      AGUARDANDO_COLABORADOR: 0,
      AGUARDANDO_GESTOR: 0,
      AGUARDANDO_RH: 0,
      AGUARDANDO_DIRETORIA: 0,
      CONCLUIDA: 0
    };

    for (const item of records) {
      if (item.status in counts && item.status !== 'ALL') {
        counts[item.status]++;
      }
    }

    $('countAll').textContent = counts.ALL;
    $('countEmployee').textContent = counts.AGUARDANDO_COLABORADOR;
    $('countManager').textContent = counts.AGUARDANDO_GESTOR;
    $('countRh').textContent = counts.AGUARDANDO_RH;
    $('countDirector').textContent = counts.AGUARDANDO_DIRETORIA;
    $('countDone').textContent = counts.CONCLUIDA;

    for (
      const button of
      $('assessmentSummary').querySelectorAll('button[data-status]')
    ) {
      const selected = button.dataset.status === statusFilter;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }

    const words = normalized($('employeeSearch').value)
      .split(' ')
      .filter(Boolean);

    const found = records.filter(item =>
      (statusFilter === 'ALL' || item.status === statusFilter) &&
      words.every(word => normalized(item.employee).includes(word))
    );

    $('summaryStatus').textContent =
      `${found.length} avaliação(ões) exibida(s) nesta seleção.`;

    if (!found.length) {
      const p = document.createElement('p');
      p.textContent = 'Nenhuma avaliação encontrada.';
      target.append(p);
    }

    for (const item of found) {
      const box = document.createElement('article');
      box.className = 'item';

      const name = document.createElement('strong');
      name.textContent = item.employee;

      const info = document.createElement('small');
      info.textContent =
        `${item.department} • ${TYPES[item.type] || item.type} • ${item.type === 'DESEMPENHO' || item.scores && Object.keys(item.scores).length === 10 ? `${item.total}/100 • ` : ''}${dateTime(item.createdAt)} • Gestor: ${item.evaluator}`;

      const status = document.createElement('p');

      const rh = document.createElement('span');
      rh.className = 'badge ' + (item.rhAt ? 'done' : 'pending');
      rh.textContent = item.rhAt
        ? 'RH: concluído'
        : ['AGUARDANDO_COLABORADOR', 'AGUARDANDO_GESTOR'].includes(item.status)
          ? 'RH: próxima etapa' : 'Aguardando análise do RH';

      const director = document.createElement('span');
      director.className = 'badge ' + (
        item.directorAt
          ? 'done'
          : ['AGUARDANDO_RH', 'AGUARDANDO_GESTOR', 'AGUARDANDO_COLABORADOR'].includes(item.status)
            ? 'upcoming'
            : 'pending'
      );

      director.textContent = item.directorAt
        ? 'Diretoria: concluída'
        : ['AGUARDANDO_RH', 'AGUARDANDO_GESTOR', 'AGUARDANDO_COLABORADOR'].includes(item.status)
          ? 'Diretoria: próxima etapa'
          : 'Aguardando análise da diretoria';

      if (item.status === 'AGUARDANDO_COLABORADOR') {
        const employee = document.createElement('span');
        employee.className = 'badge pending';
        employee.textContent = 'Aguardando resposta do colaborador';
        status.append(employee, document.createTextNode(' '));
      }
      if (item.status === 'AGUARDANDO_GESTOR') {
        const manager = document.createElement('span');
        manager.className = 'badge pending';
        manager.textContent = 'Aguardando considerações do gestor';
        status.append(manager, document.createTextNode(' '));
      }
      if (isMarketing()) status.textContent = 'Registro do gestor';
      else status.append(rh, document.createTextNode(' '), director);

      const view = document.createElement('button');
      view.type = 'button';
      view.textContent = 'Visualizar / imprimir';

      view.onclick = () => {
        const preview = window.open('', '_blank');

        if (!preview) {
          $('historyStatus').textContent =
            'Permita pop-ups para abrir o relatório.';
          return;
        }

        try {
          showReport(
            preview,
            itemValues(item),
            item.scores,
            item.type === 'DESEMPENHO' || Object.keys(item.scores || {}).length === 10
              ? calculateRecord(item.scores, item.scoringVersion) : null,
            item.evaluator,
            item
          );
        } catch (err) {
          preview.close();
          $('historyStatus').textContent = err.message;
        }
      };

      box.append(name, info, status, view);

      if (item.status === 'AGUARDANDO_COLABORADOR' &&
          item.evaluatorUid === auth.currentUser.uid && item.employeeEmail) {
        const resend = document.createElement('button');
        resend.type = 'button';
        resend.textContent = 'Reenviar link ao colaborador';
        resend.onclick = async () => {
          resend.disabled = true;
          try {
            const url = new URL('./periodic.html', location.href);
            url.searchParams.set('invite', item.id);
            await sendSignInLinkToEmail(auth, item.employeeEmail, { url: url.href, handleCodeInApp: true });
            $('historyStatus').textContent = 'Novo link enviado ao colaborador.';
          } catch (err) {
            $('historyStatus').textContent = `Falha no envio do link: ${err.message}`;
          } finally { resend.disabled = false; }
        };
        box.append(resend);
      }

      if (
        ['admin', 'gestor'].includes(profile.role) &&
        item.evaluatorUid === auth.currentUser.uid &&
        item.status === 'AGUARDANDO_GESTOR'
      ) {
        box.append(managerReviewForm(item));
      }

      if (
        (profile.role === 'rh' || profile.role === 'admin') &&
        item.status === 'AGUARDANDO_RH'
      ) {
        box.append(reviewForm(item, 'rh'));
      }

      if (
        (profile.role === 'diretoria' || profile.role === 'admin') &&
        item.status === 'AGUARDANDO_DIRETORIA'
      ) {
        box.append(reviewForm(item, 'director'));
      }

      target.append(box);
    }
  }

  function itemValues(item) {
    return { ...item, ...item.plan };
  }

  function managerReviewForm(item) {
    const form = document.createElement('form');
    const title = document.createElement('h3');
    title.textContent = 'Considerações do gestor e plano de melhoria';
    form.append(title);

    const fields = [
      ['notes', 'Observações e evidências', 2000, true],
      ['goal', 'O que desenvolver', 500, false],
      ['action', 'Ação recomendada', 800, true],
      ['owner', 'Responsável', 120, false]
    ];
    const inputs = {};
    for (const [key, labelText, maxLength, multiline] of fields) {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement(multiline ? 'textarea' : 'input');
      input.name = key;
      input.maxLength = maxLength;
      input.required = true;
      if (multiline) input.rows = 3;
      label.append(input);
      form.append(label);
      inputs[key] = input;
    }
    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'primary';
    button.textContent = 'Registrar considerações e encaminhar ao RH';
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    form.append(button, error);

    form.onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
      if (Object.values(values).some(value => !value)) {
        error.textContent = 'Preencha as observações e todos os campos do plano.';
        return;
      }
      if (!window.confirm('Encaminhar esta avaliação ao RH? As considerações não poderão ser alteradas depois.')) return;
      button.disabled = true;
      error.textContent = '';
      try {
        await updateDoc(doc(db, 'assessments', item.id), {
          notes: values.notes,
          plan: { goal: values.goal, action: values.action, owner: values.owner },
          managerUid: auth.currentUser.uid,
          managerName: profile.name,
          managerAt: serverTimestamp(),
          status: 'AGUARDANDO_RH',
          updatedAt: serverTimestamp()
        });
      } catch (err) {
        error.textContent = `Não foi possível encaminhar ao RH: ${err.message}`;
        button.disabled = false;
      }
    };
    return form;
  }

  function reviewForm(item, stage) {
    const form = document.createElement('form');

    const label = document.createElement('label');
    label.textContent = stage === 'rh'
      ? 'Observações pontuais do RH'
      : 'Observações da diretoria executiva';

    const note = document.createElement('textarea');
    note.rows = 4;
    note.maxLength = 2000;
    note.required = true;

    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'primary';
    button.textContent = stage === 'rh'
      ? 'Concluir análise do RH'
      : 'Concluir análise da diretoria';

    const error = document.createElement('p');
    error.setAttribute('role', 'alert');

    form.append(label);
    label.append(note);
    form.append(button, error);

    form.onsubmit = async event => {
      event.preventDefault();

      if (!note.value.trim()) {
        error.textContent = 'Preencha a observação.';
        return;
      }

      if (
        !window.confirm(
          'Concluir esta análise? Após registrar, a observação não poderá ser alterada.'
        )
      ) {
        return;
      }

      button.disabled = true;
      error.textContent = '';

      try {
        const fields = stage === 'rh'
          ? {
              status: 'AGUARDANDO_DIRETORIA',
              rhNote: note.value.trim(),
              rhUid: auth.currentUser.uid,
              rhName: profile.name,
              rhAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            }
          : {
              status: 'CONCLUIDA',
              directorNote: note.value.trim(),
              directorUid: auth.currentUser.uid,
              directorName: profile.name,
              directorAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            };

        await updateDoc(doc(db, 'assessments', item.id), fields);
        loadHistory();
      } catch (err) {
        error.textContent =
          `Não foi possível registrar: ${err.message}`;
        button.disabled = false;
      }
    };

    return form;
  }

  function showReport(preview, values, scores, result, evaluator, record) {
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
        h1 { font-size: 18pt; margin: 0; }
        h2 { font-size: 12pt; color: #176c78; margin: 18px 0 6px; }
        .subtitle { color: #52616a; font-size: 9pt; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin: 12px 0; }
        .meta div { overflow-wrap: anywhere; }
        table { width: 100%; border-collapse: collapse; font-size: 10pt; }
        th, td { text-align: left; padding: 6px; border-bottom: 1px solid #c9d9de; }
        th:last-child, td:last-child { text-align: right; width: 72px; }
        thead { display: table-header-group; }
        tr { break-inside: avoid; }
        .result { padding: 12px; background: #eaf6f7; margin-top: 14px; break-inside: avoid; }
        .pre { white-space: pre-wrap; overflow-wrap: anywhere; }
        .signatures { display: flex; gap: 12px; margin-top: 50px; text-align: center; font-size: 9pt; }
        .signatures div { flex: 1; border-top: 1px solid #444; padding-top: 5px; }
        @media print {
          body { margin: 0; max-width: none; }
          .actions { display: none; }
        }
      </style></head><body><div class="actions"></div><main></main></body></html>`);
    d.close();

    const actions = d.querySelector('.actions');
    const print = d.createElement('button');

    print.type = 'button';
    print.textContent = 'Imprimir ou salvar como PDF';
    print.addEventListener('click', () => preview.print());

    actions.append(
      print,
      d.createTextNode(
        '  Na impressão, escolha sua impressora ou “Salvar como PDF”.'
      )
    );

    const main = d.querySelector('main');
    const header = d.createElement('header');
    header.className = 'head';

    const logo = d.createElement('img');
    logo.src = new URL('./uniso-logo.png', location.href).href;
    logo.alt = 'UNISO';

    const heading = d.createElement('div');
    const title = d.createElement('h1');
    title.textContent = (TYPES[values.type] || 'Avaliação de Desempenho').toLocaleUpperCase('pt-BR');

    const subtitle = d.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent =
      'UNISO • Emitido em ' + new Date().toLocaleString('pt-BR');

    heading.append(title, subtitle);
    header.append(logo, heading);
    main.append(header);

    const addTitle = label => {
      const node = d.createElement('h2');
      node.textContent = label;
      main.append(node);
    };

    addTitle('Identificação');

    const meta = d.createElement('div');
    meta.className = 'meta';
    main.append(meta);

    for (const [label, value] of [
      ['Colaborador', values.employee],
      ['Cargo', values.position],
      ['Setor', values.department],
      ['Tipo', TYPES[values.type] || values.type],
      ['Período', `${values.periodStart} a ${values.periodEnd}`],
      ['Gestor avaliador', evaluator]
    ]) {
      const item = d.createElement('div');
      const strong = d.createElement('strong');
      strong.textContent = label + ': ';
      item.append(strong, d.createTextNode(value));
      meta.append(item);
    }

    if (result) {
    addTitle('Critérios e notas');

    const table = d.createElement('table');
    const thead = d.createElement('thead');
    const tbody = d.createElement('tbody');
    const headRow = d.createElement('tr');

    for (const text of ['Critério', 'Peso', 'Nota']) {
      const cell = d.createElement('th');
      cell.textContent = text;
      headRow.append(cell);
    }

    thead.append(headRow);
    table.append(thead, tbody);
    main.append(table);

    CRITERIA.forEach(([key, label], i) => {
      const row = d.createElement('tr');

      for (const value of [
        `${i + 1}. ${label}`,
        String(record?.scoringVersion ? (record.scoringWeights?.[key] ?? weightsForVersion(record.scoringVersion)[key]) : '—'),
        `${scores[key]}/10`
      ]) {
        const cell = d.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }

      tbody.append(row);
    });

    const summary = d.createElement('div');
    summary.className = 'result';

    summary.textContent =
      `Nota final: ${result.total}/100  •  Média simples: ${result.average.toFixed(1)}${record?.scoringVersion ? '  •  Pesos normalizados pela soma 65' : '  •  Regra anterior sem ponderação'}`;

    summary.append(
      d.createElement('br'),
      d.createTextNode(`Classificação: ${result.classification}`)
    );

    summary.append(
      d.createElement('br'),
      d.createTextNode(
        `Alerta crítico: ${result.critical.join(', ') || 'Nenhum'}`
      )
    );

    main.append(summary);
    } else {
      addTitle('Perguntas e respostas');
      const labels = record?.questionnaireLabels || {};
      const answers = record?.questionnaireAnswers || {};
      for (const [key, label] of Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))) {
        const heading = d.createElement('strong');
        heading.textContent = label;
        const answer = d.createElement('p');
        answer.className = 'pre';
        answer.textContent = answers[key] || 'Aguardando resposta.';
        main.append(heading, answer);
      }
    }

    if (result || values.notes || ['goal', 'action', 'owner'].some(key => values[key])) {
    addTitle('Observações e evidências');

    const notes = d.createElement('div');
    notes.className = 'pre';
    notes.textContent = values.notes || 'Sem observações.';
    main.append(notes);

    addTitle('Plano de melhoria');

    const plan = d.createElement('div');
    plan.className = 'pre';

    plan.textContent = [
      ['O que desenvolver', values.goal],
      ['Ação recomendada', values.action],
      ['Responsável', values.owner]
    ]
      .filter(([, value]) => value?.trim())
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n') || 'Não informado.';

    main.append(plan);
    }

    if (!isMarketing()) {
    addTitle('Acompanhamento das análises');

    const tracking = d.createElement('div');
    tracking.className = 'pre';

    tracking.textContent =
      `${record?.status === 'AGUARDANDO_COLABORADOR' ? 'Colaborador: aguardando resposta\n' : ''}` +
      `${record?.type !== 'DESEMPENHO' ? `Gestor: ${record?.managerAt
        ? 'Considerações registradas em ' + dateTime(record.managerAt)
        : 'Aguardando considerações'}\n` : ''}` +
      `RH: ${record?.rhAt
        ? 'Concluído em ' + dateTime(record.rhAt)
        : 'Aguardando análise do RH'}\n` +
      `Diretoria: ${record?.directorAt
        ? 'Concluída em ' + dateTime(record.directorAt)
        : 'Aguardando análise da diretoria'}`;

    main.append(tracking);

    if (record?.rhAt) {
      addTitle('Observações pontuais do RH');

      const rh = d.createElement('div');
      rh.className = 'pre';
      rh.textContent =
        `${record.rhNote}\nResponsável: ${record.rhName} • ${dateTime(record.rhAt)}`;

      main.append(rh);
    }

    if (record?.directorAt) {
      addTitle('Observações da diretoria executiva');

      const director = d.createElement('div');
      director.className = 'pre';
      director.textContent =
        `${record.directorNote}\nResponsável: ${record.directorName} • ${dateTime(record.directorAt)}`;

      main.append(director);
    }
    }

    const signatures = d.createElement('div');
    signatures.className = 'signatures';

    for (const label of isMarketing()
      ? ['Gestor avaliador']
      : ['Gestor avaliador', 'Coordenação de RH', 'Diretoria Executiva']) {
      const field = d.createElement('div');
      field.textContent = label;
      signatures.append(field);
    }

    main.append(signatures);
    preview.focus();
  }
}
