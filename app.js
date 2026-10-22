const state = {
  user: null,
  lessons: [],
  units: [],
  completions: [],
  pft: []
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

function show(el, on) {
  el.classList.toggle('hidden', !on);
}

function setUserLabel() {
  const u = state.user;
  document.getElementById('user-label').textContent =
    `${u.name} · ${u.role === 'admin' ? 'Admin' : 'Teacher'} · ${u.school || ''}`;
}

function buildTabs() {
  const tabs = document.getElementById('main-tabs');
  const isAdmin = state.user.role === 'admin';
  const items = isAdmin
    ? [
        { id: 'admin', label: 'District' },
        { id: 'lessons', label: 'Lessons (preview)' },
        { id: 'pft', label: 'PFT data' }
      ]
    : [
        { id: 'lessons', label: 'Lessons' },
        { id: 'progress', label: 'My progress' },
        { id: 'pft', label: 'PFT results' }
      ];
  tabs.innerHTML = items
    .map((t, i) => `<button type="button" class="tab ${i === 0 ? 'active' : ''}" data-view="${t.id}">${t.label}</button>`)
    .join('');
  tabs.querySelectorAll('.tab').forEach((btn) => {
    btn.onclick = () => {
      tabs.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      showView(btn.dataset.view);
    };
  });
  showView(items[0].id);
}

function showView(id) {
  ['lessons', 'progress', 'pft', 'admin'].forEach((v) => {
    const el = document.getElementById('view-' + v);
    if (el) show(el, v === id);
  });
  if (id === 'lessons') renderLessons();
  if (id === 'progress') renderProgress();
  if (id === 'pft') renderPft();
  if (id === 'admin') renderAdmin();
}

async function loadCore() {
  const data = await api('/api/lessons');
  state.lessons = data.lessons || [];
  state.units = data.units || [];
  const comps = await api('/api/completions');
  state.completions = comps.completions || [];
  const pft = await api('/api/pft');
  state.pft = pft.results || [];

  const unitSel = document.getElementById('filter-unit');
  unitSel.innerHTML =
    `<option value="all">All units</option>` +
    state.units.map((u) => `<option value="${u.id}">${u.title}</option>`).join('');
  unitSel.onchange = renderLessons;
  document.getElementById('filter-equip').onchange = renderLessons;
}

function renderLessons() {
  const unit = document.getElementById('filter-unit').value;
  const equip = document.getElementById('filter-equip').value;
  let list = state.lessons.slice();
  if (unit !== 'all') list = list.filter((l) => l.unitId === unit);
  if (equip !== 'all') {
    const strict = list.filter((l) => l.equipment === equip);
    list = strict.length
      ? strict
      : list.filter((l) => l.equipment === 'None' || l.equipment === 'Minimal' || equip === 'all');
  }
  const done = new Set(
    state.completions.filter((c) => state.user.role === 'teacher' ? c.teacherId === state.user.id : true).map((c) => c.lessonId)
  );
  const el = document.getElementById('lesson-list');
  el.innerHTML = list
    .map(
      (l) => `
    <div class="lesson-item" data-id="${l.id}">
      <strong>${l.sequence}. ${l.title}</strong>
      ${done.has(l.id) ? '<span class="badge">Done</span>' : ''}
      <div class="hint">
        <span class="badge">${(l.gradeBands || []).join(', ')}</span>
        <span class="badge">${l.equipment}</span>
        ${(l.timeOptions || []).join(' / ')} min
      </div>
    </div>`
    )
    .join('');
  el.querySelectorAll('.lesson-item').forEach((item) => {
    item.onclick = () => openLesson(item.dataset.id);
  });
}

function openLesson(id) {
  const l = state.lessons.find((x) => x.id === id);
  if (!l) return;
  const root = document.getElementById('modal-root');
  root.className = 'modal-bg';
  root.innerHTML = `
    <div class="modal">
      <h3>${l.title}</h3>
      <p><em>${l.iCan || ''}</em></p>
      <p class="hint" style="margin-top:0.5rem"><strong>Setup:</strong> ${l.setup || ''}</p>
      <p class="hint"><strong>Main:</strong> ${l.mainActivity || ''}</p>
      <p class="hint"><strong>Tip:</strong> ${l.teacherTip || ''}</p>
      <div class="row" style="margin-top:1rem">
        <div>
          <label class="hint">Minutes</label>
          <select id="complete-mins">
            ${(l.timeOptions || [25]).map((m) => `<option value="${m}">${m}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap">
        ${
          state.user.role === 'teacher'
            ? `<button type="button" class="btn btn-primary" id="btn-complete">Mark complete</button>`
            : ''
        }
        <button type="button" class="btn" id="btn-close-modal">Close</button>
      </div>
    </div>`;
  root.onclick = (e) => {
    if (e.target === root) root.className = 'hidden';
  };
  document.getElementById('btn-close-modal').onclick = () => {
    root.className = 'hidden';
  };
  const completeBtn = document.getElementById('btn-complete');
  if (completeBtn) {
    completeBtn.onclick = async () => {
      const minutes = Number(document.getElementById('complete-mins').value);
      await api('/api/completions', {
        method: 'POST',
        body: JSON.stringify({
          lessonId: l.id,
          minutes,
          standards: (l.standards || []).map((s) => s.code)
        })
      });
      const comps = await api('/api/completions');
      state.completions = comps.completions || [];
      root.className = 'hidden';
      renderLessons();
    };
  }
}

function renderProgress() {
  const mine = state.completions.filter((c) => c.teacherId === state.user.id);
  const lessons = new Set(mine.map((c) => c.lessonId)).size;
  const minutes = mine.reduce((s, c) => s + (c.minutes || 0), 0);
  document.getElementById('my-stats').innerHTML = `
    <div class="stat"><div class="num">${lessons}</div><div class="lbl">Lessons</div></div>
    <div class="stat"><div class="num">${minutes}</div><div class="lbl">Minutes</div></div>
    <div class="stat"><div class="num">${mine.length}</div><div class="lbl">Logs</div></div>`;
  document.getElementById('my-recent').innerHTML = mine.length
    ? [...mine]
        .reverse()
        .slice(0, 15)
        .map((c) => {
          const l = state.lessons.find((x) => x.id === c.lessonId);
          return `<div class="lesson-item" style="cursor:default"><strong>${l ? l.title : c.lessonId}</strong><div class="hint">${c.date} · ${c.minutes} min</div></div>`;
        })
        .join('')
    : '<p class="hint">No completions yet.</p>';
}

function renderPft() {
  const mine =
    state.user.role === 'teacher'
      ? state.pft.filter((p) => p.teacherId === state.user.id)
      : state.pft;
  document.getElementById('pft-list').innerHTML = mine.length
    ? [...mine]
        .reverse()
        .slice(0, 20)
        .map(
          (p) =>
            `<div class="lesson-item" style="cursor:default"><strong>Gr ${p.grade}</strong> · ${p.student}<div class="hint">${p.date} · ${p.aerobicType}: ${p.aerobic || '—'} · Curl ${p.curl || '—'}</div></div>`
        )
        .join('')
    : '<p class="hint">No official PFT results yet.</p>';
}

async function renderAdmin() {
  const data = await api('/api/admin/overview');
  const d = data.district;
  document.getElementById('district-stats').innerHTML = `
    <div class="stat"><div class="num">${d.teacherCount}</div><div class="lbl">Teachers</div></div>
    <div class="stat"><div class="num">${d.totalMinutes}</div><div class="lbl">Minutes</div></div>
    <div class="stat"><div class="num">${d.totalCompletions}</div><div class="lbl">Completions</div></div>
    <div class="stat"><div class="num">${d.totalPftRows}</div><div class="lbl">PFT rows</div></div>`;
  const tbody = document.querySelector('#teachers-table tbody');
  tbody.innerHTML = data.teachers
    .map(
      (t) =>
        `<tr>
          <td>${t.name}<div class="hint">${t.email}</div></td>
          <td>${t.school || ''}</td>
          <td>${t.lessonsCompleted}</td>
          <td>${t.totalMinutes}</td>
          <td>${t.pftStudents}</td>
        </tr>`
    )
    .join('');
}

async function enterApp(user) {
  state.user = user;
  show(document.getElementById('login-screen'), false);
  show(document.getElementById('app-screen'), true);
  setUserLabel();
  buildTabs();
  await loadCore();
}

document.getElementById('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const err = document.getElementById('login-error');
  show(err, false);
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
    });
    await enterApp(data.user);
  } catch (ex) {
    err.textContent = ex.message || 'Login failed';
    show(err, true);
  }
};

document.getElementById('logout-btn').onclick = async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (_) {}
  state.user = null;
  show(document.getElementById('app-screen'), false);
  show(document.getElementById('login-screen'), true);
};

document.getElementById('pft-save').onclick = async () => {
  const student = document.getElementById('pft-student').value.trim();
  if (!student) {
    alert('Student name or ID required');
    return;
  }
  await api('/api/pft', {
    method: 'POST',
    body: JSON.stringify({
      grade: document.getElementById('pft-grade').value,
      year: document.getElementById('pft-year').value,
      student,
      aerobicType: document.getElementById('pft-aero-type').value,
      aerobic: document.getElementById('pft-aero').value,
      curl: document.getElementById('pft-curl').value,
      trunk: document.getElementById('pft-trunk').value,
      upperType: document.getElementById('pft-upper-type').value,
      upper: document.getElementById('pft-upper').value,
      flexType: document.getElementById('pft-flex-type').value,
      flex: document.getElementById('pft-flex').value
    })
  });
  const pft = await api('/api/pft');
  state.pft = pft.results || [];
  document.getElementById('pft-student').value = '';
  renderPft();
  alert('Saved');
};

// Session restore
(async () => {
  try {
    const data = await api('/api/me');
    if (data.user) await enterApp(data.user);
  } catch (_) {
    // stay on login
  }
})();
