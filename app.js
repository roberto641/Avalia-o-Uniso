import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, onSnapshot, collection, query, where, addDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';
import './scoring.js';

const { CRITERIA, calculate } = globalThis.UNISO_SCORING;
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
    text.textContent = label;

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

  onAuthStateChanged(auth, async user => {
    if (historyUnsubscribe) {
      historyUnsubscribe();
      historyUnsubscribe = null;
    }

    profile = null;
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
        !['admin', 'gestor', 'rh', 'diretoria'].includes(profile.role)
      ) {
        throw Error('Perfil sem autorização para acessar avaliações.');
      }

      $('app').hidden = false;
      $('identity').textContent = `${profile.name} • ${profile.role}`;
      $('evaluatorName').textContent = profile.name;
      $('assessmentForm').hidden = false;

      $('tabNew').hidden = !['admin', 'gestor'].includes(profile.role);

      if (['admin', 'gestor'].includes(profile.role)) {
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
    } catch {
      $('loginError').textContent =
        'Não foi possível entrar. Verifique as credenciais e a autorização.';
    }
  });

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

  $('assessmentSummary').onclick = event => {
    const button = event.target.closest('button[data-status]');

    if (!button || !$('assessmentSummary').contains(button)) {
      return;
    }

    statusFilter = button.dataset.status;
    $('employeeSearch').value = '';
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
    const selected = [...document.querySelectorAll('#criteria select')];
    const complete = selected.every(s => s.value !== '');

    const summary = complete
      ? calculate(
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
      ? `${summary.utilization}%`
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

    if (!profile || !['admin', 'gestor'].includes(profile.role)) {
      $('formError').textContent =
        'Entre como gestor autorizado antes de gerar o relatório.';
      return;
    }

    const values = Object.fromEntries(new FormData(e.target));

    const scores = Object.fromEntries(
      [...document.querySelectorAll('#criteria select')]
        .map(s => [s.dataset.key, Number(s.value)])
    );

    let result;

    try {
      result = calculate(scores);
    } catch (err) {
      $('formError').textContent = err.message;
      return;
    }

    if (values.periodStart > values.periodEnd) {
      $('formError').textContent =
        'O fim do período deve ser igual ou posterior ao início.';
      return;
    }

    const preview = window.open('', '_blank');

    if (!preview) {
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
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        scores,
        total: result.total,
        notes: values.notes?.trim() || '',
        plan: Object.fromEntries(
          ['goal', 'action', 'owner', 'deadline', 'followUp']
            .map(key => [key, values[key]?.trim() || ''])
        ),
        evaluator: profile.name,
        evaluatorUid: auth.currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'AGUARDANDO_RH',
        rhNote: '',
        rhUid: '',
        rhName: '',
        rhAt: null,
        directorNote: '',
        directorUid: '',
        directorName: '',
        directorAt: null
      };

      const ref = await addDoc(collection(db, 'assessments'), payload);
      registered = true;

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
      preview.close();
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

      const base = collection(db, 'assessments');
      const source = profile.role === 'gestor'
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
        `${item.department} • ${item.total}/100 • ${dateTime(item.createdAt)} • Gestor: ${item.evaluator}`;

      const status = document.createElement('p');

      const rh = document.createElement('span');
      rh.className = 'badge ' + (item.rhAt ? 'done' : 'pending');
      rh.textContent = item.rhAt
        ? 'RH: concluído'
        : 'Aguardando análise do RH';

      const director = document.createElement('span');
      director.className = 'badge ' + (
        item.directorAt
          ? 'done'
          : item.status === 'AGUARDANDO_RH'
            ? 'upcoming'
            : 'pending'
      );

      director.textContent = item.directorAt
        ? 'Diretoria: concluída'
        : item.status === 'AGUARDANDO_RH'
          ? 'Diretoria: próxima etapa'
          : 'Aguardando análise da diretoria';

      status.append(rh, document.createTextNode(' '), director);

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
            calculate(item.scores),
            item.evaluator,
            item
          );
        } catch (err) {
          preview.close();
          $('historyStatus').textContent = err.message;
        }
      };

      box.append(name, info, status, view);

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
    title.textContent = 'AVALIAÇÃO DE DESEMPENHO';

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
      ['Tipo', values.type],
      ['Período', `${values.periodStart} a ${values.periodEnd}`],
      ['Gestor avaliador', evaluator]
    ]) {
      const item = d.createElement('div');
      const strong = d.createElement('strong');
      strong.textContent = label + ': ';
      item.append(strong, d.createTextNode(value));
      meta.append(item);
    }

    addTitle('Critérios e notas');

    const table = d.createElement('table');
    const thead = d.createElement('thead');
    const tbody = d.createElement('tbody');
    const headRow = d.createElement('tr');

    for (const text of ['Critério', 'Nota']) {
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
      `Total: ${result.total}/100  •  Média: ${result.average.toFixed(1)}  •  Aproveitamento: ${result.utilization}%`;

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
      ['Responsável', values.owner],
      ['Prazo', values.deadline],
      ['Acompanhamento', values.followUp]
    ]
      .filter(([, value]) => value?.trim())
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n') || 'Não informado.';

    main.append(plan);

    addTitle('Acompanhamento das análises');

    const tracking = d.createElement('div');
    tracking.className = 'pre';

    tracking.textContent =
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

    const signatures = d.createElement('div');
    signatures.className = 'signatures';

    for (const label of [
      'Gestor avaliador',
      'Coordenação de RH',
      'Diretoria Executiva'
    ]) {
      const field = d.createElement('div');
      field.textContent = label;
      signatures.append(field);
    }

    main.append(signatures);
    preview.focus();
  }
}
