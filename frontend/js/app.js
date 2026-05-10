/* ─── State ─── */
let allEmployees = [];
let allTasks = [];
let currentUser = null;

/* ─── Dark Mode ─── */
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('tbc_theme', theme);
  const icon  = document.getElementById('darkModeIcon');
  const label = document.getElementById('darkModeLabel');
  if (icon)  icon.textContent  = theme === 'dark' ? '☀️' : '🌙';
  if (label) label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
}

function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  setTheme(isDark ? 'light' : 'dark');
}

function renderAvatar(name, avatar, extraStyle = '') {
  if (avatar) {
    const s = `padding:0;overflow:hidden${extraStyle ? ';' + extraStyle : ''}`;
    return `<div class="avatar" style="${s}"><img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`;
  }
  return `<div class="avatar"${extraStyle ? ` style="${extraStyle}"` : ''}>${initials(name)}</div>`;
}

/* ─── Lead Tool State ─── */
const LEAD_SALESPEOPLE = [
  { id: 46604320, name: 'Tim Zimmer' },
  { id: 32099639, name: 'Ramon Herper' },
  { id: 45653587, name: 'Leon Scheffs' },
  { id: 30089244, name: 'Henry Salazar' },
];
const LEAD_AV_COLORS = [
  {bg:'#eeedfe',cl:'#3c3489'},{bg:'#ddf0e8',cl:'#0d5c38'},
  {bg:'#fde8e0',cl:'#8b3318'},{bg:'#e0eef9',cl:'#0d3d6b'},
];
let leadImgData = null;
let leadMode = 'scan';
let leadPerson = null;
let leadOwnerId = null;
let leadInstaUsername = '';
let leadInstaConfirmed = false;
let leadDetectedWebsite = null;
let leadDetectedInstagram = null;
let leadExistingCompanyId = null;
let leadExistingCompanyName = null;

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', async () => {
  currentUser = getUser();
  if (!currentUser) { window.location.href = '/'; return; }

  setTheme(localStorage.getItem('tbc_theme') || 'light');

  // Set greeting immediately from cached user — no API wait needed
  const _h = new Date().getHours();
  const greetEmoji = _h < 6 ? '🌙' : _h < 11 ? '🌅' : _h < 14 ? '☀️' : _h < 18 ? '🌤️' : _h < 21 ? '🌆' : '🌙';
  const greetWord  = _h < 6 ? 'Guten Nacht' : _h < 11 ? 'Guten Morgen' : _h < 14 ? 'Guten Mittag' : _h < 18 ? 'Guten Tag' : 'Guten Abend';
  document.getElementById('welcomeMsg').textContent = `${greetEmoji} ${greetWord}, ${currentUser.name.split(' ')[0]}!`;

  // Fetch fresh user data + brand name in parallel
  const [fresh, brand] = await Promise.all([
    api.get('/employees/' + currentUser.id).catch(() => null),
    api.get('/brand/name').catch(() => null),
  ]);
  if (fresh) currentUser = { ...currentUser, ...fresh };
  applyAppName(brand?.name || 'B Mobile');

  // Register service worker + (re)subscribe silently if user already granted permission
  registerPushSW().then(() => maybeResubscribePush()).catch(() => {});

  const roleLabels = { admin: 'Administrator', management: 'Management', sellsupport: 'Sales Support', newbusiness: 'New Business', customersuccess: 'Customer Success' };
  const roleLabel = roleLabels[currentUser.role] || currentUser.role;
  const av = document.getElementById('sidebarAvatar');
  if (currentUser.avatar) {
    av.style.cssText = 'padding:0;overflow:hidden';
    av.innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    av.textContent = initials(currentUser.name);
  }
  document.getElementById('sidebarName').textContent = currentUser.name;
  document.getElementById('sidebarRole').textContent = roleLabel;
  document.getElementById('userMenuName').textContent = currentUser.name;
  document.getElementById('userMenuRole').textContent = roleLabel;

  // Update greeting with fresh name if it changed
  document.getElementById('welcomeMsg').textContent = `${greetEmoji} ${greetWord}, ${currentUser.name.split(' ')[0]}!`;

  if (currentUser.role === 'admin') {
    document.getElementById('userMenuAdmin').style.display = 'block';
  }
  if (['admin', 'management', 'sellsupport'].includes(currentUser.role)) {
    document.getElementById('btnAddNews').style.display = 'inline-flex';
  }

  // Role-based nav filtering
  const role = currentUser.role;
  document.querySelectorAll('.sidebar-nav [data-roles]').forEach(el => {
    const allowed = el.dataset.roles.split(',');
    if (!allowed.includes(role)) el.style.display = 'none';
  });
  document.querySelectorAll('.sidebar-nav [data-nav-section]').forEach(label => {
    let sibling = label.nextElementSibling;
    let hasVisible = false;
    while (sibling && !sibling.classList.contains('nav-section-label')) {
      if (sibling.style.display !== 'none') { hasVisible = true; break; }
      sibling = sibling.nextElementSibling;
    }
    if (!hasVisible) label.style.display = 'none';
  });

  if (currentUser.does_onboarding) {
    document.querySelectorAll('.nav-item').forEach(n => {
      if (n.getAttribute('onclick')?.includes("'deal'")) n.style.display = 'none';
    });
  }

  const pathMatch = window.location.pathname.match(/^\/app\/([^/]+)/);
  const startPage = pathMatch ? pathMatch[1] : (localStorage.getItem('tbc_last_page') || 'dashboard');
  showPage(startPage, 'replace');

  // Fade out loader
  const loader = document.getElementById('appLoader');
  if (loader) {
    loader.style.opacity = '0';
    setTimeout(() => loader.remove(), 350);
  }
});

/* ─── Navigation ─── */
window.addEventListener('popstate', (e) => {
  const page = e.state?.page || 'dashboard';
  showPage(page, false);
});

function showPage(page, pushState = true) {
  closeSidebar();
  localStorage.setItem('tbc_last_page', page);
  if (pushState === true) {
    history.pushState({ page }, '', '/app/' + page);
  } else if (pushState === 'replace') {
    history.replaceState({ page }, '', '/app/' + page);
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick')?.includes(`'${page}'`)) n.classList.add('active');
  });

  const titles = {
    dashboard: ['Dashboard', 'Willkommen im TBC Mitarbeiter-Portal'],
    leads: ['Insta Leads', 'Screenshot hochladen · HubSpot prüfen · anlegen'],
    employees: ['Mitarbeiter', 'Alle Teammitglieder im Überblick'],
    onboarding: ['Onboarding', 'Einarbeitungs-Checkliste & Fortschritt'],
    statistik: ['Sales Statistik', 'Prospect-Übersicht & Auswertungen'],
    datenbank: ['Member', 'Alle Members im Überblick'],
    tasks: ['Aufgaben', 'Aufgaben & Projekte verwalten'],
    tools: ['Tools & Links', 'Interne Ressourcen und Tools'],
    wiki: ['Wissensdatenbank', 'Artikel, Guides & internes Wissen'],
    calllist: ['Callliste', 'Kontaktnummern aus HubSpot-Unternehmen'],
    deal: ['Onboarding starten', 'HubSpot Onboarding-Workflow starten'],
    feedback: ['Feedback', 'Bewertungen & Verbesserungsvorschläge'],
    admin: ['Admin-Bereich', 'Statistiken, Benutzerverwaltung und Feedback'],
  };

  const [title, subtitle] = titles[page] || ['–', ''];
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSubtitle').textContent = subtitle;

  const actions = document.getElementById('topbarActions');
  actions.innerHTML = '';

  if (page === 'employees' && ['admin', 'management'].includes(currentUser.role)) {
    addActionBtn(actions, '+ Mitarbeiter', () => openModal('modalEmployee'));
  }
  if (page === 'datenbank') {
    addActionBtn(actions, '+ Member anlegen', () => openNewKundeModal());
  }
  if (page === 'tasks') {
    addActionBtn(actions, '+ Aufgabe', () => openNewTaskModal());
    addActionBtn(actions, '📦 Sourcing-Anfrage', () => openSourcingModal());
  }

  const loaders = {
    dashboard: loadDashboard,
    leads: loadLeads,
    employees: loadEmployees,
    onboarding: loadOnboarding,
    statistik: loadStatistik,
    datenbank: loadDatenbank,
    tasks: loadTasks,
    tools: loadTools,
    wiki: loadWiki,
    calllist: loadCalllistPage,
    deal: loadDeal,
    admin: loadAdmin,
    feedback: loadFeedbackPage,
  };
  if (loaders[page]) loaders[page]();
}

function addActionBtn(container, label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary topbar-action-btn';
  btn.innerHTML = `<span class="btn-full">${label}</span><span class="btn-short">+</span>`;
  btn.onclick = onClick;
  container.appendChild(btn);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('active');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}

function toggleUserMenu() {
  const d = document.getElementById('userMenuDropdown');
  d.style.display = d.style.display === 'none' ? '' : 'none';
}
function closeUserMenu() {
  document.getElementById('userMenuDropdown').style.display = 'none';
}
document.addEventListener('click', e => {
  if (!document.getElementById('userMenuWrap')?.contains(e.target)) closeUserMenu();
  if (!e.target.closest('#lpane-insta')) {
    const sug = document.getElementById('leadInstaSuggestions');
    if (sug) sug.style.display = 'none';
  }
});

function logout() {
  localStorage.clear();
  window.location.href = '/';
}

/* ─── Dashboard ─── */
async function loadDashboard() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('dashDate').textContent = dateStr;

  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Role capabilities (5-role system: admin, management, sellsupport, customersuccess, newbusiness)
  const hasSales       = ['admin', 'newbusiness', 'management'].includes(currentUser.role);
  const hasIntakeCommit = currentUser.role === 'customersuccess';
  const hasCommit      = hasSales || hasIntakeCommit;
  const hasRecent      = ['admin', 'newbusiness', 'customersuccess', 'management'].includes(currentUser.role);
  const hasTasks       = ['admin', 'management', 'sellsupport', 'customersuccess', 'newbusiness'].includes(currentUser.role);

  const [news, tasks, kunden, commit] = await Promise.all([
    api.get('/news'),
    hasTasks  ? api.get('/tasks')  : Promise.resolve([]),
    hasRecent ? api.get('/kunden') : Promise.resolve([]),
    hasCommit ? api.get('/commitments?month=' + currentMonth).catch(() => null) : Promise.resolve(null),
  ]);
  allTasks = tasks;

  // ── Commitment Banner ──
  const bannerEl = document.getElementById('commitBanner');
  if (hasCommit && !commit) {
    const dayOfMonth = now.getDate();
    const monthName = now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const isDeadlinePassed = dayOfMonth > 5;
    bannerEl.style.display = '';
    bannerEl.innerHTML = `
      <div class="commit-banner commit-banner-warn">
        <span>${isDeadlinePassed ? '⚠️' : '🔔'} <strong>Kein Commitment für ${monthName}</strong>${isDeadlinePassed ? ' – Deadline (5.) überschritten' : ' – Deadline: 5. des Monats'}</span>
        <button class="btn btn-sm btn-primary" onclick="openCommitModal()">Jetzt eintragen →</button>
      </div>`;
  } else {
    bannerEl.style.display = 'none';
  }

  // ── KPI Cards ──
  const kpiEl = document.getElementById('dashKpi');
  const today = now.toISOString().slice(0, 10);
  const isMine = t => t.assigned_to === currentUser.id || (t.created_by === currentUser.id && !t.assigned_to);
  const overdueTasks = tasks.filter(t => isMine(t) && t.status !== 'done' && t.due_date && t.due_date < today).length;
  const myOpenTasks  = tasks.filter(t => isMine(t) && t.status !== 'done').length;

  if (hasSales) {
    const kundenThisMonth = kunden.filter(k => k.abschlussdatum && k.abschlussdatum.startsWith(currentMonth));
    const actualKunden = kundenThisMonth.length;
    const actualUmsatz = kundenThisMonth.reduce((s, k) => s + (Number(k.umsatz) || 0), 0);
    const targetKunden = commit?.targetKunden || 0;
    const targetUmsatz = commit?.targetUmsatz || 0;
    const barClass = p => p >= 100 ? 'ok' : p >= 50 ? '' : 'warn';
    const kundenPct = targetKunden > 0 ? Math.min(100, Math.round((actualKunden / targetKunden) * 100)) : 0;
    const umsatzPct = targetUmsatz > 0 ? Math.min(100, Math.round((actualUmsatz / targetUmsatz) * 100)) : 0;
    kpiEl.innerHTML = `
      <div class="dash-kpi">
        <div class="dash-kpi-label">Member</div>
        <div class="dash-kpi-value">${actualKunden}${targetKunden ? `<span class="dash-kpi-target"> / ${targetKunden}</span>` : ''}</div>
        ${targetKunden ? `<div class="dash-kpi-bar"><div class="dash-kpi-bar-fill ${barClass(kundenPct)}" style="width:${kundenPct}%"></div></div><div class="dash-kpi-sub">${kundenPct}%</div>` : '<div class="dash-kpi-sub dash-kpi-sub--link" onclick="openCommitModal()">Ziel →</div>'}
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-label">Umsatz</div>
        <div class="dash-kpi-value dash-kpi-value--euro">€${actualUmsatz.toLocaleString('de-DE')}</div>
        ${targetUmsatz ? `<div class="dash-kpi-bar"><div class="dash-kpi-bar-fill ${barClass(umsatzPct)}" style="width:${umsatzPct}%"></div></div><div class="dash-kpi-sub">${umsatzPct}% von €${targetUmsatz.toLocaleString('de-DE')}</div>` : '<div class="dash-kpi-sub dash-kpi-sub--link" onclick="openCommitModal()">Ziel →</div>'}
      </div>
      <div class="dash-kpi${overdueTasks > 0 ? ' dash-kpi--warn' : myOpenTasks === 0 ? ' dash-kpi--ok' : ''}">
        <div class="dash-kpi-label">Aufgaben</div>
        <div class="dash-kpi-value">${myOpenTasks}</div>
        <div class="dash-kpi-sub">${overdueTasks > 0 ? `<span style="color:var(--danger);font-weight:700">⚠ ${overdueTasks} überfällig</span>` : myOpenTasks === 0 ? '✓ alle erledigt' : 'offen'}</div>
      </div>`;
  } else if (hasIntakeCommit) {
    // Customer Success KPIs: € sum of revenue of kunden that entered design/production this month
    const fmtEur = n => '€' + Number(n).toLocaleString('de-DE');
    const sumPhase = phase => kunden
      .filter(k => k.assigned_cs_user_id === currentUser.id && countsForIntake(k, phase, currentMonth))
      .reduce((s, k) => s + (Number(k.umsatz) || 0), 0);
    const designEur     = sumPhase('design');
    const productionEur = sumPhase('production');
    const targetDI = commit?.targetDesignIntake     || 0;
    const targetPI = commit?.targetProductionIntake || 0;
    const moneyTile = (label, actual, target) => {
      const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
      const barClass = pct >= 100 ? 'ok' : pct >= 50 ? '' : 'warn';
      return `
      <div class="dash-kpi">
        <div class="dash-kpi-label">${label}</div>
        <div class="dash-kpi-value dash-kpi-value--euro">${fmtEur(actual)}</div>
        ${target
          ? `<div class="dash-kpi-bar"><div class="dash-kpi-bar-fill ${barClass}" style="width:${pct}%"></div></div><div class="dash-kpi-sub">${pct}% von ${fmtEur(target)}</div>`
          : '<div class="dash-kpi-sub dash-kpi-sub--link" onclick="openCommitModal()">Ziel →</div>'}
      </div>`;
    };
    kpiEl.innerHTML = moneyTile('Design Intake', designEur, targetDI) + moneyTile('Production Intake', productionEur, targetPI) + `
      <div class="dash-kpi${overdueTasks > 0 ? ' dash-kpi--warn' : myOpenTasks === 0 ? ' dash-kpi--ok' : ''}">
        <div class="dash-kpi-label">Aufgaben</div>
        <div class="dash-kpi-value">${myOpenTasks}</div>
        <div class="dash-kpi-sub">${overdueTasks > 0 ? `<span style="color:var(--danger);font-weight:700">⚠ ${overdueTasks} überfällig</span>` : myOpenTasks === 0 ? '✓ alle erledigt' : 'offen'}</div>
      </div>`;
  } else if (hasTasks) {
    kpiEl.innerHTML = `
      <div class="dash-kpi${overdueTasks > 0 ? ' dash-kpi--warn' : myOpenTasks === 0 ? ' dash-kpi--ok' : ''}">
        <div class="dash-kpi-label">Offene Aufgaben</div>
        <div class="dash-kpi-value">${myOpenTasks}</div>
        <div class="dash-kpi-sub">${overdueTasks > 0 ? `<span style="color:var(--danger);font-weight:700">⚠ ${overdueTasks} überfällig</span>` : myOpenTasks === 0 ? '✓ alle erledigt' : 'offen'}</div>
      </div>`;
  } else {
    kpiEl.style.display = 'none';
  }

  // CS-Design-Intakes erscheinen jetzt direkt als Aufgaben in der Tasks-Karte;
  // separates Widget ausgeblendet.
  const csIntakeCard = document.getElementById('dashCsIntakeCard');
  if (csIntakeCard) csIntakeCard.style.display = 'none';

  // ── Recently won customers ──
  document.getElementById('dashRecentCard').style.display = hasRecent ? '' : 'none';
  // Tasks is now the left column of the grid; collapse to 1fr when tasks hidden so News fills the row
  document.getElementById('dashGrid').style.gridTemplateColumns = hasTasks ? '' : '1fr';
  if (hasRecent) {
    const recentEl = document.getElementById('dashRecent');
    const recent = [...kunden].sort((a, b) => new Date(b.abschlussdatum) - new Date(a.abschlussdatum)).slice(0, 6);
    recentEl.innerHTML = recent.length
      ? recent.map(k => `
        <div class="dash-recent-row">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--tbc-blue);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${k.firma[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div class="dash-recent-name">${k.firma}</div>
            <div class="dash-recent-meta">${k.kanal} · ${k.mitarbeiter_name}</div>
          </div>
          <div class="dash-recent-meta">${formatDate(k.abschlussdatum)}</div>
        </div>`).join('')
      : '<div class="empty-state" style="padding:24px"><div class="empty-icon">🏆</div><p>Noch keine Member eingetragen</p></div>';
  }

  // ── News (always visible) ──
  const dashNews = document.getElementById('dashNews');
  dashNews.innerHTML = news.length
    ? news.slice(0, 4).map(n => {
        const preview = htmlToPreviewText(n.content);
        return `
      <div onclick="openNewsRead(${n.id})" style="padding:12px 18px;border-bottom:1px solid var(--border-light);cursor:pointer;transition:background .12s" onmouseenter="this.style.background='var(--bg)'" onmouseleave="this.style.background=''">
        ${n.pinned ? '<div style="font-size:10px;font-weight:700;color:var(--tbc-blue);letter-spacing:0.5px;margin-bottom:2px">📌 ANGEPINNT</div>' : ''}
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="font-weight:600;font-size:13px;margin-bottom:2px">${n.title}</div>
          ${preview.length > 90 ? '<div style="font-size:11px;color:var(--text-light);white-space:nowrap;margin-top:1px">Lesen →</div>' : ''}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.5">${preview.substring(0, 90)}${preview.length > 90 ? '…' : ''}</div>
        <div style="font-size:11px;color:var(--text-light);margin-top:4px">${n.author_name || ''} · ${formatRelative(n.created_at)}</div>
      </div>`;
      }).join('')
    : '<div class="empty-state" style="padding:24px"><div class="empty-icon">📭</div><p>Noch keine Ankündigungen</p></div>';

  // ── My open tasks ──
  document.getElementById('dashTasksCard').style.display = hasTasks ? '' : 'none';
  if (hasTasks) {
    const dashTasks = document.getElementById('dashTasks');
    // Mine = explicitly assigned to me OR created by me without an assignee
    const myTasks = tasks
      .filter(t => t.status !== 'done' && (t.assigned_to === currentUser.id || (t.created_by === currentUser.id && !t.assigned_to)))
      .sort((a, b) => {
        const aOver = a.due_date && a.due_date < today;
        const bOver = b.due_date && b.due_date < today;
        if (aOver && !bOver) return -1;
        if (!aOver && bOver) return 1;
        return (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1;
      })
      .slice(0, 6);
    dashTasks.innerHTML = myTasks.length
      ? myTasks.map(t => {
          const isOverdue = t.due_date && t.due_date < today;
          const isDueToday = t.due_date === today;
          const dueLine = isOverdue
            ? `<span style="color:var(--danger);font-weight:700">⚠ Überfällig seit ${formatDate(t.due_date)}</span>`
            : isDueToday
              ? `<span style="color:#D97706;font-weight:700">⏰ Heute fällig</span>`
              : `Fällig: ${formatDate(t.due_date)}`;
          // For CS users, Onboarding tasks open the dedicated member overview
          const isCsHandover = currentUser.role === 'customersuccess' && t.project === 'Onboarding' && t.kunde_id;
          const clickAction = isCsHandover
            ? `openCsMemberOverview(${t.kunde_id})`
            : `openTaskDetail(${t.id})`;
          return `
          <div onclick="${clickAction}" style="padding:11px 18px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:12px;cursor:pointer;transition:background .12s${isOverdue ? ';background:#FEF9F9' : ''}" onmouseenter="this.style.background='var(--bg)'" onmouseleave="this.style.background='${isOverdue ? '#FEF9F9' : ''}'">
            <div style="flex:1">
              <div style="font-weight:600;font-size:13px">${t.title}</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:1px">${t.project || '–'} · ${dueLine}</div>
            </div>
            ${badge(t.priority)}
            <span style="font-size:12px;color:var(--text-light);flex-shrink:0">→</span>
          </div>`;
        }).join('')
      : '<div class="empty-state" style="padding:24px"><div class="empty-icon">🎉</div><p>Alle Aufgaben erledigt!</p></div>';
  }
}

// Phase ordering helpers — used to decide whether a kunde currently counts as
// "reached" a phase. After a revert (e.g. Production → Design), the lower phase
// is current and the higher-phase intake should drop. We treat intake as
// "this month a phase entry was logged AND the current phase has not been
// reverted to something below that phase".
const _PHASE_RANK = { '': 0, 'übergeben': 0, pre_onboarding: 0, onboarding: 0, design: 1, production: 2, fertig: 3 };
function _phaseReached(k, target) {
  return (_PHASE_RANK[k.onboarding_phase || ''] || 0) >= (_PHASE_RANK[target] || 0);
}
function _enteredPhaseInMonth(k, phase, month) {
  return Array.isArray(k.phase_history) && k.phase_history.some(h => h.phase === phase && (h.at || '').startsWith(month));
}
function countsForIntake(k, phase, month) {
  return _phaseReached(k, phase) && _enteredPhaseInMonth(k, phase, month);
}

// Role-aware commitment field schema. CS tracks intakes in €; everyone else tracks members + revenue.
function commitFieldsForRole(role) {
  if (role === 'customersuccess') {
    return [
      { key: 'targetDesignIntake',     label: 'Design Intake-Ziel (€)',     short: 'Design Intake',     placeholder: 'z.B. 50000',  kind: 'euro' },
      { key: 'targetProductionIntake', label: 'Production Intake-Ziel (€)', short: 'Production Intake', placeholder: 'z.B. 100000', kind: 'euro' },
    ];
  }
  return [
    { key: 'targetKunden', label: 'Member-Ziel (Anzahl)', short: 'Member', placeholder: 'z.B. 10',    kind: 'count' },
    { key: 'targetUmsatz', label: 'Umsatz-Ziel (€)',      short: 'Umsatz', placeholder: 'z.B. 15000', kind: 'euro' },
  ];
}

function renderCommitFields(containerId, idPrefix, current) {
  const fields = commitFieldsForRole(currentUser.role);
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = fields.map(f => `
    <div class="form-group">
      <label class="form-label">${f.label}${f.kind === 'euro' ? '' : ''}</label>
      <input class="form-control" type="number" min="0" id="${idPrefix}${f.key}" placeholder="${f.placeholder}" value="${current?.[f.key] || ''}">
    </div>`).join('');
}

function readCommitFields(idPrefix) {
  const fields = commitFieldsForRole(currentUser.role);
  const out = {};
  fields.forEach(f => {
    out[f.key] = parseInt(document.getElementById(idPrefix + f.key).value) || 0;
  });
  return { fields, values: out };
}

async function openCommitModal() {
  const _n = new Date();
  const month = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, '0')}`;
  let current = null;
  try { current = await api.get('/commitments?month=' + month); } catch {}
  renderCommitFields('commitFields', 'commit', current);
  openModal('modalCommit');
}

async function saveCommit() {
  const { fields, values } = readCommitFields('commit');
  if (fields.every(f => !values[f.key])) return showToast('Bitte mindestens einen Wert eintragen', 'error');
  const _n = new Date(); const month = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, '0')}`;
  await api.post('/commitments', { month, ...values });
  closeModal('modalCommit');
  showToast('Commitment gespeichert!');
  // Re-render dashboard with fresh commitment data
  await loadDashboard();
}

function formatRelative(iso) {
  if (!iso) return '–';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'gestern';
  if (d < 7) return `vor ${d} Tagen`;
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

/* ─── News (Dashboard only) ─── */
const NEWS_ALLOWED_TAGS = new Set(['B','STRONG','I','EM','U','H2','H3','P','BR','UL','OL','LI','SPAN','HR','BLOCKQUOTE','FONT','DIV']);
function sanitizeNewsHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (node) => {
    [...node.children].forEach(child => {
      if (!NEWS_ALLOWED_TAGS.has(child.tagName)) {
        const text = document.createTextNode(child.textContent);
        child.replaceWith(text);
        return;
      }
      // Strip event-handler attrs and javascript: URLs
      [...child.attributes].forEach(attr => {
        const an = attr.name.toLowerCase();
        const av = String(attr.value).toLowerCase();
        if (an.startsWith('on') || av.includes('javascript:')) child.removeAttribute(attr.name);
      });
      walk(child);
    });
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

function htmlToPreviewText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

function newsCmd(cmd) {
  document.getElementById('newsEditor').focus();
  document.execCommand(cmd, false, null);
  newsEditorInput();
}
function newsBlock(tag) {
  document.getElementById('newsEditor').focus();
  document.execCommand('formatBlock', false, tag);
  newsEditorInput();
}
function newsFontSize(size) {
  document.getElementById('newsEditor').focus();
  document.execCommand('fontSize', false, String(size));
  newsEditorInput();
}
function newsInsert(text) {
  document.getElementById('newsEditor').focus();
  document.execCommand('insertText', false, text);
  newsEditorInput();
}
function newsEditorInput() {
  const ed = document.getElementById('newsEditor');
  if (!ed) return;
  ed.dataset.empty = ed.innerText.trim() === '';
}

async function openNewsRead(id) {
  const news = await api.get('/news');
  const n = news.find(x => x.id === id);
  if (!n) return;
  document.getElementById('newsReadTitle').textContent = n.title;
  document.getElementById('newsReadMeta').textContent = (n.author_name || '') + (n.author_name && n.created_at ? ' · ' : '') + formatRelative(n.created_at);
  // Render with sanitization. Backwards-compat: treat plain-text legacy entries as such.
  const isHtml = /<[a-z][\s\S]*>/i.test(n.content);
  document.getElementById('newsReadContent').innerHTML = isHtml ? sanitizeNewsHtml(n.content) : `<p style="white-space:pre-wrap">${n.content.replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c]))}</p>`;

  document.getElementById('newsReadPinned').style.display = n.pinned ? '' : 'none';

  // Delete button — visible to author + admin/management/sellsupport
  const canDelete = n.author_id === currentUser.id || ['admin','management','sellsupport'].includes(currentUser.role);
  const footer = document.getElementById('newsReadFooter');
  const delBtn = document.getElementById('newsReadDeleteBtn');
  footer.style.display = canDelete ? '' : 'none';
  if (canDelete) delBtn.onclick = () => deleteNews(n.id);

  openModal('modalNewsRead');
}

async function deleteNews(id) {
  if (!confirm('Ankündigung wirklich löschen?')) return;
  try {
    await api.delete('/news/' + id);
    closeModal('modalNewsRead');
    showToast('Ankündigung gelöscht');
    // Refresh dashboard if it's the active page
    if (document.getElementById('page-dashboard')?.classList.contains('active')) loadDashboard();
  } catch (err) {
    showToast(err.message || 'Löschen fehlgeschlagen', 'error');
  }
}

async function saveNews() {
  const title = document.getElementById('newsTitle').value.trim();
  const editor = document.getElementById('newsEditor');
  const content = sanitizeNewsHtml(editor.innerHTML.trim());
  if (!title || !editor.innerText.trim()) return showToast('Titel und Inhalt erforderlich', 'error');
  await api.post('/news', { title, content, pinned: document.getElementById('newsPinned').checked });
  closeModal('modalNews');
  // Reset editor for next use
  document.getElementById('newsTitle').value = '';
  editor.innerHTML = '';
  document.getElementById('newsPinned').checked = false;
  newsEditorInput();
  showToast('Ankündigung veröffentlicht!');
  loadDashboard();
}

/* ─── Employees ─── */
async function loadEmployees() {
  allEmployees = await api.get('/employees');
  renderEmployees(allEmployees);
  const depts = [...new Set(allEmployees.map(e => e.department).filter(Boolean))].sort();
  const filter = document.getElementById('empDeptFilter');
  filter.innerHTML = '<option value="">Alle Abteilungen</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
}

function renderEmployees(employees) {
  const tbody = document.getElementById('empTable');
  if (!employees.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-secondary)">Keine Mitarbeiter gefunden</td></tr>';
    return;
  }
  tbody.innerHTML = employees.map(e => `
    <tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        ${renderAvatar(e.name, e.avatar)}
        <div><div style="font-weight:600">${e.name}</div><div style="font-size:12px;color:var(--text-secondary)">${e.email}</div></div>
      </div></td>
      <td>${e.department || '–'}</td>
      <td>${e.position || '–'}</td>
      <td>${badge(e.role)}</td>
      <td>${e.phone || '–'}</td>
      <td>${currentUser.role === 'admin' ? `<button class="btn-icon" onclick="deleteEmployee(${e.id})">🗑️</button>` : ''}</td>
    </tr>
  `).join('');
}

function filterEmployees() {
  const q = document.getElementById('empSearch').value.toLowerCase();
  const dept = document.getElementById('empDeptFilter').value;
  renderEmployees(allEmployees.filter(e =>
    (!q || e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || (e.position || '').toLowerCase().includes(q)) &&
    (!dept || e.department === dept)
  ));
}

async function saveEmployee() {
  const editId = document.getElementById('empId').value;
  const data = {
    name: document.getElementById('empName').value.trim(),
    email: document.getElementById('empEmail').value.trim(),
    password: document.getElementById('empPassword').value || undefined,
    role: document.getElementById('empRole').value,
    department: document.getElementById('empDept').value.trim(),
    position: document.getElementById('empPosition').value.trim(),
    phone: document.getElementById('empPhone').value.trim(),
    does_onboarding: document.getElementById('empDoesOnboarding').checked,
  };
  if (!data.name || !data.email) return showToast('Name und E-Mail erforderlich', 'error');
  if (!editId && !data.password) return showToast('Passwort ist erforderlich', 'error');
  try {
    if (editId) {
      await api.put('/employees/' + editId, data);
      showToast('Nutzer aktualisiert!');
    } else {
      await api.post('/employees', data);
      showToast('Nutzer angelegt!');
    }
    closeModal('modalEmployee');
    ['empName','empEmail','empPassword','empDept','empPosition','empPhone'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('empId').value = '';
    if (document.getElementById('page-admin')?.classList.contains('active')) switchAdminTab('users');
    else loadEmployees();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteEmployee(id) {
  if (!confirmDelete('Mitarbeiter wirklich löschen?')) return;
  await api.delete('/employees/' + id);
  showToast('Mitarbeiter gelöscht');
  loadEmployees();
}

/* ─── Onboarding ─── */
async function loadOnboarding() {
  const container = document.getElementById('onboardingContent');
  const isAdminOrManager = ['admin', 'management'].includes(currentUser.role);

  if (isAdminOrManager) {
    const overview = await api.get('/onboarding/overview');
    container.innerHTML = `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header"><h2>Onboarding-Fortschritt aller Mitarbeiter</h2></div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Mitarbeiter</th><th>Abteilung</th><th>Fortschritt</th><th>%</th></tr></thead>
            <tbody>${overview.map(u => `
              <tr>
                <td><div style="display:flex;align-items:center;gap:10px">
                  ${renderAvatar(u.name, u.avatar)}
                  <div><div style="font-weight:600">${u.name}</div><div style="font-size:12px;color:var(--text-secondary)">${u.email}</div></div>
                </div></td>
                <td>${u.department || '–'}</td>
                <td style="width:220px">
                  <div class="progress-bar"><div class="progress-fill" style="width:${u.percent}%"></div></div>
                  <div style="font-size:11px;color:var(--text-secondary);margin-top:3px">${u.completed}/${u.total} Schritte</div>
                </td>
                <td><strong>${u.percent}%</strong></td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="card"><div class="card-header"><h2>Mein Onboarding</h2></div><div class="card-body" id="myOnboarding"></div></div>
    `;
  } else {
    container.innerHTML = `
      <div class="card">
        <div class="card-header"><div><h2>Mein Onboarding</h2><p style="font-size:13px;color:var(--text-secondary);margin-top:4px">Hake jeden Schritt ab, sobald du ihn abgeschlossen hast.</p></div></div>
        <div class="card-body" id="myOnboarding"></div>
      </div>
    `;
  }
  await renderOnboardingSteps('myOnboarding', currentUser.id);
}

async function renderOnboardingSteps(containerId, userId) {
  const steps = await api.get(`/onboarding/progress/${userId}`);
  const doneCount = steps.filter(s => s.completed).length;
  const pct = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:14px;background:var(--bg);border-radius:8px">
      <div style="flex:1"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div></div>
      <strong style="color:var(--tbc-blue)">${pct}%</strong>
      <span style="font-size:13px;color:var(--text-secondary)">${doneCount}/${steps.length} Schritte</span>
    </div>
    ${steps.map(s => `
      <div class="step-item" id="step-${s.id}">
        <div class="step-checkbox ${s.completed ? 'done' : ''}" onclick="toggleStep(${userId}, ${s.id}, ${s.completed})">
          ${s.completed ? '✓' : ''}
        </div>
        <div class="step-content" style="${s.completed ? 'opacity:0.55' : ''}">
          <h4>${s.order_index}. ${s.title}</h4>
          <p>${s.description || ''}</p>
          ${s.completed ? `<div style="font-size:11px;color:var(--success);margin-top:4px">✓ ${formatDateTime(s.completed_at)}</div>` : ''}
        </div>
      </div>
    `).join('')}
  `;
}

async function toggleStep(userId, stepId, currentlyDone) {
  await api.post(`/onboarding/progress/${userId}/${stepId}`, { completed: !currentlyDone });
  await renderOnboardingSteps('myOnboarding', userId);
}

/* ─── Sales Statistik ─── */
function statMonthInit() {
  const sel = document.getElementById('statMonth');
  if (!sel || sel.options.length > 1) return;
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const opt = new Option(label, val);
    if (i === 0) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function loadStatistik() {
  statMonthInit();
  const isAdmin = ['admin', 'management'].includes(currentUser.role);
  const allKunden = await api.get('/kunden');
  // Customer Success has its own statistik view (Design/Production Intake + Repeat Orders)
  if (currentUser.role === 'customersuccess') return loadStatistikCS(allKunden);
  // Non-admins see only their own customers
  const kunden = isAdmin ? allKunden : allKunden.filter(k => k.created_by === currentUser.id);
  const container = document.getElementById('statistikContent');

  const now2 = new Date();
  const selMonth = document.getElementById('statMonth')?.value || `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}`;
  const [selYear, selMon] = selMonth.split('-').map(Number);
  const prevDate = new Date(selYear, selMon - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const inMonth = (k, m) => k.abschlussdatum && k.abschlussdatum.startsWith(m);
  const thisMo  = kunden.filter(k => inMonth(k, selMonth));
  const lastMo  = kunden.filter(k => inMonth(k, prevMonth));

  const sum = (arr, field) => arr.reduce((a, k) => a + (Number(k[field]) || 0), 0);
  const diff = (cur, prev) => {
    if (!prev) return cur > 0 ? '+100%' : '—';
    const pct = Math.round(((cur - prev) / prev) * 100);
    return (pct >= 0 ? '+' : '') + pct + '%';
  };
  const diffColor = (cur, prev) => cur >= prev ? 'var(--success)' : 'var(--danger)';
  const fmt = n => '€' + Number(n).toLocaleString('de-DE');

  const thisKunden = thisMo.length, lastKunden = lastMo.length;
  const thisUmsatz = sum(thisMo, 'umsatz'), lastUmsatz = sum(lastMo, 'umsatz');
  const thisMarge = sum(thisMo, 'marge'), lastMarge = sum(lastMo, 'marge');

  // Design Intake an CS — € value of MY kunden that reached design this/prev month (respecting reverts)
  const designHandedOff = kunden.filter(k => countsForIntake(k, 'design', selMonth));
  const lastDesignHandedOff = kunden.filter(k => countsForIntake(k, 'design', prevMonth));
  const thisDesignEur = sum(designHandedOff, 'umsatz');
  const lastDesignEur = sum(lastDesignHandedOff, 'umsatz');

  // Kanal breakdown for selected month (all time if nothing this month, use all)
  const base = thisMo.length ? thisMo : kunden;
  const byKanal = {};
  base.forEach(k => { byKanal[k.kanal] = (byKanal[k.kanal] || 0) + 1; });
  const maxKanal = Math.max(...Object.values(byKanal), 1);

  // Trend last 6 months
  const trendMonths = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(selYear, selMon - 1 - i, 1);
    trendMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const trendVals = trendMonths.map(m => ({ m, v: kunden.filter(k => inMonth(k, m)).length }));
  const maxTrend = Math.max(...trendVals.map(t => t.v), 1);

  const kpiCard = (icon, label, val, cmp, color) => `
    <div class="dash-kpi">
      <div class="dash-kpi-label">${label}</div>
      <div class="dash-kpi-value">${val}</div>
      <div class="dash-kpi-sub" style="color:${color}">${cmp} vs. Vormonat</div>
    </div>`;

  // ── Donut chart data (all-time for the logged-in scope) ──
  const KANAL_COLORS = {
    'Instagram':    '#E1306C',
    'Kaltakquise':  '#0047AB',
    'Messe':        '#F59E0B',
    'Empfehlung':   '#22C55E',
    'LinkedIn':     '#0A66C2',
    'Website':      '#8B5CF6',
    'Sonstiges':    '#6B7280',
  };
  const donutData = Object.entries(
    kunden.reduce((acc, k) => { acc[k.kanal] = (acc[k.kanal] || 0) + 1; return acc; }, {})
  ).sort((a, b) => b[1] - a[1]);
  const donutTotal = donutData.reduce((s, [, v]) => s + v, 0);

  const donutChart = (() => {
    if (!donutTotal) return '<div class="empty-state" style="padding:40px"><p>Noch keine Daten</p></div>';
    let cumPct = 0;
    const segments = donutData.map(([kanal, count]) => {
      const pct = count / donutTotal;
      const color = KANAL_COLORS[kanal] || '#999';
      const start = cumPct * 360;
      cumPct += pct;
      const end = cumPct * 360;
      return `${color} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`;
    });
    const gradient = `conic-gradient(${segments.join(', ')})`;
    const legend = donutData.map(([kanal, count]) => {
      const pct = Math.round((count / donutTotal) * 100);
      const color = KANAL_COLORS[kanal] || '#999';
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border-light)">
        <div style="width:12px;height:12px;border-radius:3px;background:${color};flex-shrink:0"></div>
        <span style="flex:1;font-size:13px;font-weight:600">${kanal}</span>
        <span style="font-size:13px;color:var(--text-secondary)">${count} (${pct}%)</span>
      </div>`;
    }).join('');
    return `
      <div style="display:flex;align-items:center;gap:32px;flex-wrap:wrap">
        <div style="position:relative;flex-shrink:0">
          <div style="width:180px;height:180px;border-radius:50%;background:${gradient}"></div>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
            <div style="width:90px;height:90px;border-radius:50%;background:var(--surface)"></div>
          </div>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
            <div style="font-size:22px;font-weight:800;color:var(--text-primary)">${donutTotal}</div>
            <div style="font-size:11px;color:var(--text-light)">Member</div>
          </div>
        </div>
        <div style="flex:1;min-width:160px">${legend}</div>
      </div>`;
  })();

  const miniKpi = (label, val, cmp, color) =>
    `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;flex:1">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-light);margin-bottom:3px">${label}</div>
      <div style="font-size:20px;font-weight:800;color:var(--text-primary);line-height:1.1">${val}</div>
      <div style="font-size:11px;margin-top:2px;color:${color}">${cmp} vs. Vormonat</div>
    </div>`;

  const barRow = (label, count, max, color) => {
    const pct = max > 0 ? Math.round((count / max) * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <div style="width:90px;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
      <div style="flex:1;height:6px;background:var(--border);border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:99px"></div>
      </div>
      <div style="font-size:11px;color:var(--text-secondary);width:20px;text-align:right">${count}</div>
    </div>`;
  };

  container.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:14px">
      <div style="background:var(--surface);border:2px solid var(--tbc-blue);border-radius:var(--radius);padding:14px 18px;flex:2;min-width:200px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tbc-blue);margin-bottom:4px">⭐ Umsatz (Bonus-Metrik)</div>
        <div style="font-size:26px;font-weight:800;color:var(--text-primary);line-height:1.05">${fmt(thisUmsatz)}</div>
        <div style="font-size:12px;margin-top:3px;color:${diffColor(thisUmsatz, lastUmsatz)}">${diff(thisUmsatz, lastUmsatz)} vs. Vormonat</div>
      </div>
      ${miniKpi('Design Intake → CS', fmt(thisDesignEur), diff(thisDesignEur, lastDesignEur), diffColor(thisDesignEur, lastDesignEur))}
      ${miniKpi('Member', thisKunden, diff(thisKunden, lastKunden), diffColor(thisKunden, lastKunden))}
      ${miniKpi('Marge', fmt(thisMarge), diff(thisMarge, lastMarge), diffColor(thisMarge, lastMarge))}
    </div>

    <div class="stat-cards-grid ${isAdmin ? 'stat-cards-3' : 'stat-cards-2'}"  style="gap:14px;margin-bottom:14px">

      <div class="card" style="margin:0">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border-light);font-size:12px;font-weight:700">🏆 Vertriebskanäle</div>
        <div style="padding:12px 14px">
          ${!donutTotal
            ? '<div style="font-size:12px;color:var(--text-light);padding:8px 0">Noch keine Daten</div>'
            : (() => {
                let cum = 0;
                const segs = donutData.map(([k, v]) => {
                  const color = KANAL_COLORS[k] || '#999';
                  const s = cum * 360, e = (cum += v / donutTotal) * 360;
                  return `${color} ${s.toFixed(1)}deg ${e.toFixed(1)}deg`;
                });
                return `<div style="display:flex;align-items:center;gap:16px">
                  <div style="position:relative;flex-shrink:0;width:90px;height:90px">
                    <div style="width:90px;height:90px;border-radius:50%;background:conic-gradient(${segs.join(',')})"></div>
                    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
                      <div style="width:46px;height:46px;border-radius:50%;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center">
                        <div style="font-size:14px;font-weight:800">${donutTotal}</div>
                      </div>
                    </div>
                  </div>
                  <div style="flex:1">
                    ${donutData.map(([k, v]) => {
                      const pct = Math.round((v / donutTotal) * 100);
                      const color = KANAL_COLORS[k] || '#999';
                      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                        <div style="width:8px;height:8px;border-radius:2px;background:${color};flex-shrink:0"></div>
                        <span style="font-size:11px;flex:1">${k}</span>
                        <span style="font-size:11px;color:var(--text-secondary);font-weight:600">${pct}%</span>
                      </div>`;
                    }).join('')}
                  </div>
                </div>`;
              })()
          }
        </div>
      </div>

      <div class="card" style="margin:0">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border-light);font-size:12px;font-weight:700">📅 Trend (6 Monate)</div>
        <div style="padding:12px 14px;display:flex;align-items:flex-end;gap:6px;height:110px">
          ${trendVals.map(({ m, v }) => {
            const h = maxTrend > 0 ? Math.round((v / maxTrend) * 72) : 0;
            const label = new Date(m + '-02').toLocaleDateString('de-DE', { month: 'short' });
            const isSel = m === selMonth;
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
              <div style="font-size:10px;font-weight:600;color:var(--text-secondary)">${v || ''}</div>
              <div style="width:100%;background:${isSel ? 'var(--tbc-blue)' : 'var(--border)'};border-radius:3px 3px 0 0;height:${h}px;min-height:${v>0?3:0}px"></div>
              <div style="font-size:10px;color:${isSel ? 'var(--tbc-blue)' : 'var(--text-light)'};font-weight:${isSel?700:400}">${label}</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      ${isAdmin ? `<div class="card" style="margin:0">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border-light);font-size:12px;font-weight:700">👤 Team</div>
        <div style="padding:12px 14px">
          ${(() => {
            const byP = {};
            base.forEach(k => { byP[k.mitarbeiter_name] = (byP[k.mitarbeiter_name] || 0) + 1; });
            const maxP = Math.max(...Object.values(byP), 1);
            return Object.keys(byP).length === 0
              ? '<div style="font-size:12px;color:var(--text-light)">Noch keine Daten</div>'
              : Object.entries(byP).sort((a,b)=>b[1]-a[1]).map(([n,v]) => barRow(n, v, maxP, 'var(--tbc-accent)')).join('');
          })()}
        </div>
      </div>` : ''}
    </div>
  `;
}

/* ─── CS Statistik (Design / Production / Repeat Orders) ─── */
async function loadStatistikCS(allKunden) {
  const container = document.getElementById('statistikContent');
  const myKunden = allKunden.filter(k => k.assigned_cs_user_id === currentUser.id);

  const now2 = new Date();
  const selMonth = document.getElementById('statMonth')?.value || `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}`;
  const [selYear, selMon] = selMonth.split('-').map(Number);

  const designKunden     = myKunden.filter(k => countsForIntake(k, 'design', selMonth));
  const productionKunden = myKunden.filter(k => countsForIntake(k, 'production', selMonth));
  const designCount      = designKunden.length;
  const productionCount  = productionKunden.length;
  const designRevenue    = designKunden.reduce((s, k) => s + (Number(k.umsatz) || 0), 0);
  const productionRevenue = productionKunden.reduce((s, k) => s + (Number(k.umsatz) || 0), 0);

  let repeats = [];
  try { repeats = await api.get('/repeat-orders?month=' + selMonth); } catch {}
  const repeatCount = repeats.length;
  const repeatRevenue = repeats.reduce((s, r) => s + (Number(r.umsatz) || 0), 0);

  // 6-month trend of Production Intake
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(selYear, selMon - 1 - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    trend.push({ month: m, count: myKunden.filter(k => countsForIntake(k, 'production', m)).length });
  }
  const maxTrend = Math.max(1, ...trend.map(t => t.count));
  const monthNames = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

  // Recent phase changes across my kunden (last 10)
  const recent = [];
  myKunden.forEach(k => {
    (k.phase_history || []).forEach(h => recent.push({ ...h, firma: k.firma }));
  });
  recent.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const recentSlice = recent.slice(0, 10);

  const fmt = n => '€' + Number(n).toLocaleString('de-DE');
  const PHASE_LABEL = { design: 'Design', production: 'Production', fertig: 'Fertig', pre_onboarding: 'Pre-Onb.', onboarding: 'Onb.', 'übergeben': 'Übergeben' };

  const miniKpi = (label, val, sub) => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;flex:1">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-light);margin-bottom:3px">${label}</div>
      <div style="font-size:20px;font-weight:800;color:var(--text-primary);line-height:1.1">${val}</div>
      ${sub ? `<div style="font-size:11px;margin-top:2px;color:var(--text-secondary)">${sub}</div>` : ''}
    </div>`;

  container.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      ${miniKpi('Design Intake', fmt(designRevenue), `${designCount} Member · ${selMonth}`)}
      ${miniKpi('Production Intake', fmt(productionRevenue), `${productionCount} Member · ${selMonth}`)}
      ${miniKpi('Repeat Orders', fmt(repeatRevenue), `${repeatCount} Aufträge`)}
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="padding:12px 14px;border-bottom:1px solid var(--border-light);font-size:12px;font-weight:700">📈 Production Intake – 6 Monate</div>
      <div style="padding:14px 18px">
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:end;height:120px;margin-bottom:6px">
          ${trend.map(t => {
            const pct = Math.round((t.count / maxTrend) * 100);
            const isThis = t.month === selMonth;
            return `<div style="display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%" title="${t.month}: ${t.count}">
              <div style="font-size:11px;color:var(--text-light);font-weight:600;${pct < 30 ? 'opacity:0' : ''}">${t.count || ''}</div>
              <div style="width:100%;height:${Math.max(2, pct)}%;background:${isThis ? '#0EA5E9' : 'var(--text-light)'};border-radius:4px 4px 0 0;transition:height .4s"></div>
            </div>`;
          }).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;font-size:10px;color:var(--text-secondary);text-align:center">
          ${trend.map(t => `<span>${monthNames[parseInt(t.month.split('-')[1]) - 1]}</span>`).join('')}
        </div>
      </div>
    </div>

    <div class="card">
      <div style="padding:12px 14px;border-bottom:1px solid var(--border-light);font-size:12px;font-weight:700">🕐 Letzte Phasenwechsel</div>
      <div style="padding:0">
        ${recentSlice.length === 0
          ? '<div style="padding:18px;color:var(--text-secondary);font-size:13px">Noch keine Phasenwechsel.</div>'
          : recentSlice.map(r => `
            <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border-light);font-size:13px">
              <span style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.firma}</span>
              <span style="font-size:11px;font-weight:700;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:2px 8px">${PHASE_LABEL[r.phase] || r.phase}</span>
              <span style="font-size:11px;color:var(--text-light);min-width:90px;text-align:right">${formatDate(r.at)}</span>
            </div>`).join('')}
      </div>
    </div>
  `;
}

/* ─── Datenbank (gewonnene Kunden) ─── */
function uebergabeDeadlineBadge(createdAt) {
  const hoursElapsed = (Date.now() - new Date(createdAt)) / 3600000;
  const hoursLeft = 24 - hoursElapsed;
  if (hoursLeft > 0) {
    const h = Math.ceil(hoursLeft);
    const color = h <= 6 ? '#D97706' : 'var(--text-light)';
    return `<div style="font-size:10px;margin-top:3px;color:${color}">⏱ noch ${h}h</div>`;
  }
  const over = Math.round(hoursElapsed - 24);
  return `<div style="font-size:10px;margin-top:3px;color:var(--danger);font-weight:600">⚠ ${over}h überfällig</div>`;
}

async function loadDatenbank() {
  const search = (document.getElementById('dbSearch')?.value || '').toLowerCase();
  const kanal  = document.getElementById('dbKanal')?.value || '';

  const kunden = await api.get('/kunden');
  const filtered = kunden.filter(k => {
    if (kanal && k.kanal !== kanal) return false;
    if (search && !k.firma.toLowerCase().includes(search)) return false;
    return true;
  });

  const tbody = document.getElementById('datenbankTable');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-secondary)">Keine Einträge gefunden</td></tr>';
    return;
  }

  const fmt = n => n ? '€' + Number(n).toLocaleString('de-DE') : '–';

  const isCS = currentUser.role === 'customersuccess';
  const PHASE_LABEL = { design: 'Design', production: 'Production', fertig: 'Fertig', pre_onboarding: 'Pre-Onb.', onboarding: 'Onb.', 'übergeben': 'Übergeben' };

  tbody.innerHTML = filtered.map(k => {
    const isUebergeben = k.status === 'übergeben';
    const mineAsCS = isCS && k.assigned_cs_user_id === currentUser.id;
    const csLabel = k.assigned_cs_name ? k.assigned_cs_name : '–';
    const phaseLabel = k.onboarding_phase ? (PHASE_LABEL[k.onboarding_phase] || k.onboarding_phase) : null;

    const serviceChip = k.service_type === 'templates_only'
      ? '<span style="font-size:10px;font-weight:700;color:#0369A1;background:#E0F2FE;border:1px solid #BAE6FD;border-radius:6px;padding:2px 7px">TO · Templates</span>'
      : '<span style="font-size:10px;font-weight:700;color:#5B21B6;background:#F3E8FF;border:1px solid #DDD6FE;border-radius:6px;padding:2px 7px">FS · Full</span>';
    const slaChip = (k.handover_at && !k.whatsapp_contact_at && k.onboarding_phase !== 'fertig')
      ? (() => {
          const ageH = (Date.now() - new Date(k.handover_at).getTime()) / 3600000;
          if (ageH >= 24) return '<span style="font-size:10px;font-weight:700;color:#B91C1C;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:2px 7px">⚠ SLA</span>';
          return '<span style="font-size:10px;font-weight:700;color:#B45309;background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;padding:2px 7px">⏱ ' + Math.max(0, Math.round(24 - ageH)) + 'h</span>';
        })()
      : '';

    let statusBadge;
    if (isUebergeben) {
      statusBadge = `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">
        <span style="font-size:11px;font-weight:700;color:var(--success);background:#F0FDF4;border:1px solid #22C55E;border-radius:99px;padding:2px 8px">📤 Übergeben an ${csLabel}</span>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${phaseLabel ? `<span style="font-size:10px;font-weight:700;color:#6D28D9;background:#F3E8FF;border:1px solid #DDD6FE;border-radius:6px;padding:2px 7px">Phase: ${phaseLabel}</span>` : ''}
          ${serviceChip}
          ${slaChip}
        </div>
      </div>`;
    } else {
      statusBadge = `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">
        <span style="font-size:11px;font-weight:700;color:#92400E;background:#FFF8E1;border:1px solid #F59E0B;border-radius:99px;padding:2px 8px">🏆 Gewonnen</span>
        ${uebergabeDeadlineBadge(k.created_at)}
        <div style="display:flex;gap:4px;flex-wrap:wrap">${serviceChip}</div>
      </div>`;
    }
    if (isCS && k.created_by !== currentUser.id) {
      statusBadge = `<span style="font-size:10px;font-weight:700;color:var(--text-secondary);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:2px 7px;display:inline-block;margin-bottom:4px">von ${k.mitarbeiter_name} gewonnen</span><br>${statusBadge}`;
    }

    const csActions = mineAsCS ? `
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">
        <button class="btn-icon" style="padding:4px 8px;font-size:11px;background:#F3E8FF;color:#6D28D9;border-radius:6px" onclick="setKundePhase(${k.id},'design',this)" title="In Design verschieben">Design</button>
        <button class="btn-icon" style="padding:4px 8px;font-size:11px;background:#E0F2FE;color:#0369A1;border-radius:6px" onclick="setKundePhase(${k.id},'production',this)" title="In Production verschieben">Production</button>
        <button class="btn-icon" style="padding:4px 8px;font-size:11px;background:#DCFCE7;color:#15803D;border-radius:6px" onclick="setKundePhase(${k.id},'fertig',this)" title="Fertig">Fertig</button>
        <button class="btn-icon" style="padding:4px 8px;font-size:11px;background:var(--bg);color:var(--text-primary);border-radius:6px" onclick="openRepeatOrderModal(${k.id},'${k.firma.replace(/'/g,"\\'")}')" title="Repeat Order eintragen">↻ Repeat</button>
      </div>` : '';

    return `<tr>
      <td data-label="Firma"><div style="font-weight:600">${k.firma}</div>${k.telefon ? `<div style="font-size:12px;color:var(--text-secondary)">${k.telefon}</div>` : ''}</td>
      <td data-label="Kanal"><span class="db-kanal-badge">${k.kanal}</span></td>
      <td data-label="Abschluss" style="white-space:nowrap">${formatDate(k.abschlussdatum)}</td>
      <td data-label="Umsatz" style="font-weight:600">${fmt(k.umsatz)}</td>
      <td data-label="Marge" style="color:var(--success);font-weight:600">${fmt(k.marge)}</td>
      <td data-label="Mitarbeiter">${k.mitarbeiter_name}</td>
      <td data-label="Status">${statusBadge}</td>
      <td class="db-actions">
        ${csActions}
        ${!isUebergeben && !isCS ? `<button class="btn btn-sm btn-primary" onclick="startUebergabe(${k.id},'${k.firma.replace(/'/g,"\\'")}')">Übergeben →</button>` : ''}
        <button class="btn-icon" onclick="editKunde(${k.id})" title="Bearbeiten">✏️</button>
        <button class="btn-icon" onclick="deleteKunde(${k.id})" title="Löschen">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

// Shared loader for the customersuccess user dropdowns
let _csUsersCache = null;
async function loadCsUsersInto(selectEl, currentValue) {
  if (!_csUsersCache) {
    try {
      const users = await api.get('/employees');
      _csUsersCache = users.filter(u => u.role === 'customersuccess');
    } catch { _csUsersCache = []; }
  }
  const placeholder = selectEl.querySelector('option[value=""]');
  selectEl.innerHTML = '';
  if (placeholder) selectEl.appendChild(placeholder);
  _csUsersCache.forEach(u => {
    const o = document.createElement('option');
    o.value = u.id; o.textContent = u.name;
    selectEl.appendChild(o);
  });
  if (currentValue) selectEl.value = String(currentValue);
}

let _kundeEditOriginal = null;

function kSelectServiceType(value) {
  document.getElementById('kServiceType').value = value;
  document.querySelectorAll('#kServiceTypeGroup .kstype-card').forEach(el => {
    el.classList.toggle('active', el.dataset.value === value);
  });
  // Templates-Sender wird Pflicht bei templates_only
  const req = document.getElementById('kTemplatesSenderReq');
  if (req) req.textContent = value === 'templates_only' ? '(Pflicht)' : '(optional)';
}

async function openNewKundeModal() {
  document.getElementById('kundeModalTitle').textContent = 'Member anlegen';
  document.getElementById('kundeId').value = '';
  ['kFirma','kTelefon','kUmsatz','kMarge'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('kKanal').value = '';
  document.getElementById('kAbschluss').value = new Date().toISOString().slice(0, 10);
  document.getElementById('kHubspotId').value = '';
  document.getElementById('kTemplatesSender').value = '';
  kSelectServiceType('full_service');
  // Edit-only Sektion auch bei Anlegen verfügbar machen, damit man direkt Henry+Phase zuweisen kann
  document.getElementById('kEditOnboardingSection').style.display = '';
  await loadCsUsersInto(document.getElementById('kEditAssignCS'));
  document.getElementById('kEditAssignCS').value = '';
  document.getElementById('kEditPhase').value = '';
  _kundeEditOriginal = null;
  openModal('modalKunde');
}

async function editKunde(id) {
  const kunden = await api.get('/kunden');
  const k = kunden.find(x => x.id === id);
  if (!k) return;
  document.getElementById('kundeModalTitle').textContent = 'Member bearbeiten';
  document.getElementById('kundeId').value = k.id;
  document.getElementById('kFirma').value = k.firma;
  document.getElementById('kTelefon').value = k.telefon || '';
  document.getElementById('kKanal').value = k.kanal;
  document.getElementById('kAbschluss').value = k.abschlussdatum;
  document.getElementById('kUmsatz').value = k.umsatz;
  document.getElementById('kMarge').value = k.marge;
  document.getElementById('kHubspotId').value = k.hubspot_company_id || '';
  // Service-Typ + Templates-Sender vorbelegen
  kSelectServiceType(k.service_type || 'full_service');
  document.getElementById('kTemplatesSender').value = k.templates_sender || '';
  // CS-Übergabe Sektion
  document.getElementById('kEditOnboardingSection').style.display = '';
  await loadCsUsersInto(document.getElementById('kEditAssignCS'), k.assigned_cs_user_id);
  document.getElementById('kEditPhase').value = k.onboarding_phase || '';
  _kundeEditOriginal = {
    cs: k.assigned_cs_user_id || null,
    phase: k.onboarding_phase || '',
    serviceType: k.service_type || 'full_service',
    templatesSender: k.templates_sender || '',
  };
  openModal('modalKunde');
}

async function saveKunde() {
  const id = document.getElementById('kundeId').value;
  const data = {
    firma: document.getElementById('kFirma').value.trim(),
    telefon: document.getElementById('kTelefon').value.trim(),
    kanal: document.getElementById('kKanal').value,
    abschlussdatum: document.getElementById('kAbschluss').value,
    umsatz: document.getElementById('kUmsatz').value,
    marge: document.getElementById('kMarge').value,
    hubspot_company_id: document.getElementById('kHubspotId').value.trim() || null,
    service_type: document.getElementById('kServiceType').value || 'full_service',
    templates_sender: document.getElementById('kTemplatesSender').value || null,
  };
  if (!data.firma) return showToast('Firma ist erforderlich', 'error');
  if (!data.kanal) return showToast('Kanal ist erforderlich', 'error');
  if (!data.abschlussdatum) return showToast('Abschlussdatum ist erforderlich', 'error');
  if (data.service_type === 'templates_only' && !data.templates_sender) {
    return showToast('Templates-Sender ist Pflicht bei Templates-Only', 'error');
  }

  if (id) {
    await api.put('/kunden/' + id, data);
    const newCs    = parseInt(document.getElementById('kEditAssignCS').value) || null;
    const newPhase = document.getElementById('kEditPhase').value || '';
    const orig = _kundeEditOriginal || { cs: null, phase: '' };
    const csChanged    = (orig.cs ?? null) !== newCs;
    const phaseChanged = (orig.phase || '') !== newPhase;
    if (csChanged || phaseChanged) {
      const body = {};
      if (csChanged)    body.assigned_cs_user_id = newCs;
      if (phaseChanged && newPhase) body.onboarding_phase = newPhase;
      try { await api.patch('/kunden/' + id + '/status', body); } catch {}
    }
  } else {
    const created = await api.post('/kunden', data);
    // Direkt-Übergabe beim Anlegen wenn CS-Empfänger + Phase gewählt
    const initialCs    = parseInt(document.getElementById('kEditAssignCS').value) || null;
    const initialPhase = document.getElementById('kEditPhase').value || '';
    if (initialCs && initialPhase) {
      await api.patch('/kunden/' + created.id + '/status', {
        assigned_cs_user_id: initialCs,
        onboarding_phase: initialPhase,
      }).catch(() => {});
    } else {
      // Auto-Task für NB: Member innerhalb 24h übergeben
      const due = new Date(); due.setDate(due.getDate() + 1);
      api.post('/tasks', {
        title: `Übergabe an Customer Success: ${data.firma}`,
        description: `Member "${data.firma}" wurde angelegt — innerhalb 24h an Customer Success übergeben (Edit → CS-Empfänger + Phase Design).`,
        assigned_to: currentUser.id,
        priority: 'high',
        status: 'open',
        due_date: due.toISOString().slice(0, 10),
        project: 'Onboarding'
      }).catch(() => {});
    }
  }
  closeModal('modalKunde');
  showToast(id ? 'Member aktualisiert!' : 'Member angelegt!');
  loadDatenbank();
}

async function deleteKunde(id) {
  if (!confirm('Member wirklich löschen?')) return;
  await api.delete('/kunden/' + id);
  showToast('Gelöscht');
  loadDatenbank();
}

let obPendingKundeId = null;
let obPendingKundeFirma = null;

// Click handler for CS dashboard intake rows: open the dedicated CS member overview
function openCsIntakeDetail(kundeId) {
  openCsMemberOverview(kundeId);
}

/* ─── CS Member Overview (Henry's dedicated view per member) ─── */
const _csmPhases = [
  { key: 'design',     label: 'Design',     bg: '#F3E8FF', cl: '#6D28D9' },
  { key: 'production', label: 'Production', bg: '#E0F2FE', cl: '#0369A1' },
  { key: 'fertig',     label: 'Fertig',     bg: '#DCFCE7', cl: '#15803D' },
];
let _csmTaskId = null;
let _csmKundeId = null;

async function openCsMemberOverview(kundeId) {
  _csmKundeId = kundeId;
  const [kunden, repeats] = await Promise.all([
    api.get('/kunden').catch(() => []),
    api.get('/repeat-orders?kunde_id=' + kundeId).catch(() => []),
  ]);
  const k = kunden.find(x => x.id === kundeId);
  if (!k) return showToast('Member nicht gefunden', 'error');

  if (!Array.isArray(allTasks) || !allTasks.length) {
    try { allTasks = await api.get('/tasks'); } catch {}
  }
  const task = allTasks.find(t =>
    t.kunde_id === kundeId &&
    t.project === 'Onboarding' &&
    t.assigned_to === currentUser.id &&
    t.status !== 'done'
  );
  _csmTaskId = task?.id || null;

  // Header
  document.getElementById('csmTitle').textContent = k.firma;
  const phaseLabel = k.onboarding_phase ? (_csmPhases.find(p => p.key === k.onboarding_phase)?.label || k.onboarding_phase) : null;
  const serviceLabel = k.service_type === 'templates_only' ? 'Templates-Only' : 'Full Service';
  const serviceColor = k.service_type === 'templates_only'
    ? { bg: '#E0F2FE', cl: '#0369A1', bd: '#BAE6FD' }
    : { bg: '#F3E8FF', cl: '#5B21B6', bd: '#DDD6FE' };
  const senderHint = k.templates_sender === 'nb' ? ' · von NB' : k.templates_sender === 'cs' ? ' · von CS' : '';
  const phaseChip = phaseLabel
    ? `<span style="font-size:11px;font-weight:700;color:#6D28D9;background:#F3E8FF;border:1px solid #DDD6FE;border-radius:99px;padding:2px 8px">Phase: ${phaseLabel}</span>`
    : '';
  const serviceChip = `<span style="font-size:11px;font-weight:700;color:${serviceColor.cl};background:${serviceColor.bg};border:1px solid ${serviceColor.bd};border-radius:99px;padding:2px 8px">${serviceLabel}${senderHint}</span>`;
  document.getElementById('csmBadgeRow').innerHTML = phaseChip + serviceChip;

  // SLA banner just below the header
  const slaBanner = (() => {
    if (!k.handover_at) return '';
    if (k.whatsapp_contact_at) return `<div style="margin:0 0 14px;padding:9px 12px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;color:#15803D;font-size:13px;font-weight:600">✓ Erstkontakt am ${formatDate(k.whatsapp_contact_at)}</div>`;
    const ageH = (Date.now() - new Date(k.handover_at).getTime()) / 3600000;
    if (ageH >= 24) {
      const overH = Math.floor(ageH - 24);
      return `<div style="margin:0 0 14px;padding:9px 12px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;color:#B91C1C;font-size:13px;font-weight:700">⚠ 24h-SLA überschritten um ${overH}h — bitte WhatsApp-Kontakt aufnehmen!</div>`;
    }
    const remH = Math.floor(24 - ageH);
    const remM = Math.floor(((24 - ageH) - remH) * 60);
    return `<div style="margin:0 0 14px;padding:9px 12px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;color:#B45309;font-size:13px;font-weight:700">⏱ Erstkontakt offen — ${remH}h ${remM}min verbleibend</div>`;
  })();
  // Insert SLA banner before the Phase row
  const moveRow = document.getElementById('csmMoveRow');
  let banner = document.getElementById('csmSlaBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'csmSlaBanner';
    moveRow.parentNode.insertBefore(banner, moveRow.parentNode.firstChild);
  }
  banner.innerHTML = slaBanner;
  document.getElementById('csmMeta').innerHTML = [
    `<span>👤 von ${k.mitarbeiter_name || '–'}</span>`,
    k.kanal ? `<span>📥 ${k.kanal}</span>` : '',
    `<span style="font-weight:700;color:var(--text-primary)">€${Number(k.umsatz || 0).toLocaleString('de-DE')}</span>`,
    k.abschlussdatum ? `<span>📅 ${formatDate(k.abschlussdatum)}</span>` : '',
  ].filter(Boolean).join('');

  // Phase buttons
  document.getElementById('csmPhaseRow').innerHTML = _csmPhases.map(p => {
    const isCurrent = k.onboarding_phase === p.key;
    return `<button onclick="csmSetPhase('${p.key}', this)"
      style="padding:8px 16px;border-radius:10px;border:1.5px solid ${isCurrent ? p.cl : 'var(--border)'};background:${isCurrent ? p.bg : 'var(--bg)'};color:${isCurrent ? p.cl : 'var(--text-primary)'};font-size:13px;font-weight:${isCurrent ? 700 : 600};cursor:pointer;transition:all .15s">${p.label}</button>`;
  }).join('');

  // Move to production big button (only when currently in design)
  const moveRow = document.getElementById('csmMoveRow');
  if (k.onboarding_phase === 'design' && _csmTaskId) {
    moveRow.style.display = '';
    moveRow.innerHTML = `<button class="btn btn-primary" style="width:100%;padding:12px;font-size:14px;font-weight:700" onclick="csmMoveToProduction()">→ Member in Production verschieben</button>`;
  } else {
    moveRow.style.display = 'none';
    moveRow.innerHTML = '';
  }

  // Checklist (from the open task)
  const clCard = document.getElementById('csmChecklistCard');
  if (task && Array.isArray(task.checklist) && task.checklist.length) {
    clCard.style.display = '';
    document.getElementById('csmChecklist').innerHTML = task.checklist.map((item, i) => `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;${i ? 'border-top:1px solid var(--border-light);' : ''}cursor:pointer">
        <input type="checkbox" ${item.done ? 'checked' : ''} onchange="csmToggleChecklist(${i}, this.checked)" style="width:16px;height:16px;cursor:pointer">
        <span style="font-size:13px;${item.done ? 'text-decoration:line-through;color:var(--text-light)' : ''}">${item.label}</span>
      </label>`).join('');
  } else {
    clCard.style.display = 'none';
  }

  // Repeat orders
  const rl = document.getElementById('csmRepeatList');
  if (repeats.length) {
    rl.innerHTML = repeats.map(r => `
      <div style="display:flex;align-items:center;gap:12px;padding:9px 14px;border-bottom:1px solid var(--border-light);font-size:13px">
        <span style="flex:1">${formatDate(r.date)}${r.notes ? ` · <span style="color:var(--text-secondary);font-size:12px">${r.notes}</span>` : ''}</span>
        <span style="font-weight:700">€${Number(r.umsatz || 0).toLocaleString('de-DE')}</span>
      </div>`).join('');
  } else {
    rl.innerHTML = '<div style="padding:14px;color:var(--text-light);font-size:13px;text-align:center">Noch keine Repeat Orders.</div>';
  }

  // Button wiring
  document.getElementById('csmAddRoBtn').onclick = () => openRepeatOrderModal(k.id, k.firma);
  document.getElementById('csmEditBtn').onclick = () => { closeModal('modalCsMember'); editKunde(k.id); };

  openModal('modalCsMember');
}

async function csmSetPhase(phase, btn) {
  try {
    await api.patch('/kunden/' + _csmKundeId + '/status', { onboarding_phase: phase });
    showToast('Phase aktualisiert: ' + phase);
    openCsMemberOverview(_csmKundeId);
    // refresh dashboard data lazily in background
    if (document.getElementById('page-dashboard')?.classList.contains('active')) loadDashboard();
    if (document.getElementById('page-datenbank')?.classList.contains('active')) loadDatenbank();
  } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
}

async function csmToggleChecklist(index, done) {
  if (!_csmTaskId) return;
  try {
    const res = await api.patch('/tasks/' + _csmTaskId + '/checklist', { index, done });
    // update local cache
    const t = allTasks.find(x => x.id === _csmTaskId);
    if (t && res.checklist) t.checklist = res.checklist;
  } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
}

async function csmMoveToProduction() {
  if (!_csmKundeId || !_csmTaskId) return;
  if (!confirm('Member in die Production-Phase verschieben und diese Aufgabe als erledigt markieren?')) return;
  try {
    await api.patch('/kunden/' + _csmKundeId + '/status', { onboarding_phase: 'production' });
    const t = allTasks.find(x => x.id === _csmTaskId);
    if (t) await api.put('/tasks/' + _csmTaskId, { ...t, status: 'done' });
    closeModal('modalCsMember');
    showToast('Member in Production verschoben!');
    loadDashboard();
  } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
}

/* ─── Repeat Orders (Customer Success) ─── */
let _roCurrentKundeId = null;
function openRepeatOrderModal(kundeId, firma) {
  _roCurrentKundeId = kundeId;
  document.getElementById('roKundeFirma').textContent = firma || '';
  document.getElementById('roDate').value = new Date().toISOString().slice(0, 10);
  ['roUmsatz', 'roMarge', 'roNotes'].forEach(id => document.getElementById(id).value = '');
  openModal('modalRepeatOrder');
}

async function saveRepeatOrder() {
  if (!_roCurrentKundeId) return;
  const date = document.getElementById('roDate').value;
  const umsatz = parseInt(document.getElementById('roUmsatz').value) || 0;
  const marge = parseInt(document.getElementById('roMarge').value) || 0;
  const notes = document.getElementById('roNotes').value.trim();
  if (!date || !umsatz) return showToast('Datum und Umsatz erforderlich', 'error');
  try {
    await api.post('/repeat-orders', { kunde_id: _roCurrentKundeId, date, umsatz, marge, notes });
    closeModal('modalRepeatOrder');
    showToast('Repeat Order gespeichert!');
  } catch (err) {
    showToast(err.message || 'Speichern fehlgeschlagen', 'error');
  }
}

function startUebergabe(kundeId, firma) {
  obPendingKundeId = kundeId;
  obPendingKundeFirma = firma;
  showPage('deal');
  setTimeout(() => {
    obSwitchMode('kunde');
    const sel = document.getElementById('obKundeSelect');
    if (sel) {
      setTimeout(() => {
        for (const opt of sel.options) {
          if (opt.dataset.firma === firma) { sel.value = opt.value; obOnKundeSelect(); break; }
        }
      }, 400);
    }
  }, 200);
}

/* ─── Deal übergeben mode switch ─── */
let obMode = 'kunde';
async function loadDeal() {
  obResetAll();
  initObDeal();
  await obFillKundeSelect();
}

async function obFillKundeSelect() {
  const sel = document.getElementById('obKundeSelect');
  if (!sel) return;
  try {
    const kunden = await api.get('/kunden');
    sel.innerHTML = '<option value="">Member auswählen…</option>';
    kunden.forEach(k => {
      const opt = new Option(`${k.firma} (${formatDate(k.abschlussdatum)})`, k.id);
      opt.dataset.firma = k.firma;
      if (k.hubspot_company_id) opt.dataset.hsCompanyId = k.hubspot_company_id;
      sel.appendChild(opt);
    });
  } catch {}
}

function obSwitchMode(mode) {
  obMode = mode;
  document.getElementById('obTab-kunde').classList.toggle('active', mode === 'kunde');
  document.getElementById('obTab-id').classList.toggle('active', mode === 'id');
  document.getElementById('obPane-kunde').style.display = mode === 'kunde' ? '' : 'none';
  document.getElementById('obPane-id').style.display   = mode === 'id'    ? '' : 'none';
}

async function obOnKundeSelect() {
  const sel = document.getElementById('obKundeSelect');
  const kundeId = sel?.value;
  const opt = sel?.options[sel.selectedIndex];
  const firma = opt?.dataset?.firma;
  const hsCompanyId = opt?.dataset?.hsCompanyId;
  const statusEl = document.getElementById('obIdStatus');
  const dealsEl = document.getElementById('obKundeDeals');
  dealsEl.innerHTML = '';
  if (!kundeId || !firma) return;

  statusEl.textContent = '⏳ Suche Deals in HubSpot…';
  try {
    const r = hsCompanyId
      ? await obApiCall('getDealsByCompanyId', { companyId: hsCompanyId })
      : await obApiCall('searchDealsByCompany', { companyName: firma });
    if (!r.deals?.length) {
      statusEl.textContent = '⚠️ Keine Deals in HubSpot gefunden.';
      return;
    }
    statusEl.textContent = '';
    dealsEl.innerHTML = r.deals.map(d => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-top:6px;cursor:pointer;transition:border-color .15s" onclick="obSelectFromKunde('${d.id}')">
        <div style="flex:1">
          <div style="font-weight:600;font-size:13px">${d.name}</div>
          <div style="font-size:11px;color:var(--text-secondary)">${d.pipeline || ''} · ${d.stage || ''}</div>
        </div>
        ${d.amount != null ? `<span style="font-size:13px;font-weight:700;color:#16A34A">€${Number(d.amount).toLocaleString('de-DE')}</span>` : ''}
        <span style="font-size:12px;color:var(--tbc-blue);font-weight:600">Wählen →</span>
      </div>
    `).join('');
  } catch (e) {
    statusEl.textContent = '❌ ' + (e.message || 'Fehler');
  }
}

async function obSelectFromKunde(dealId) {
  document.getElementById('dealIdInput').value = dealId;
  obSwitchMode('id');
  await obLoadDeal();
}

/* ─── Profile ─── */
async function openProfileModal() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const [user, commit] = await Promise.all([
    api.get('/auth/me'),
    api.get('/commitments?month=' + currentMonth).catch(() => null),
  ]);
  document.getElementById('profName').value = user.name || '';
  document.getElementById('profEmail').value = user.email || '';
  document.getElementById('profPhone').value = user.phone || '';
  document.getElementById('profPassword').value = '';
  renderCommitFields('profCommitFields', 'profCommit', commit);
  // Instagram connection status
  const igConnected = !!user.instagram_session;
  document.getElementById('igConnectedBadge').style.display = igConnected ? 'flex' : 'none';
  document.getElementById('igConnectForm').style.display = igConnected ? 'none' : 'block';
  document.getElementById('igSessionInput').value = '';
  const prev = document.getElementById('profileAvatarPreview');
  if (user.avatar) {
    prev.style.background = 'none';
    prev.innerHTML = `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    prev.style.background = 'var(--tbc-blue)';
    prev.innerHTML = initials(user.name);
  }
  openModal('modalProfile');
}

let profilePicBase64 = null;
function previewProfilePic(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    profilePicBase64 = e.target.result;
    const prev = document.getElementById('profileAvatarPreview');
    prev.style.background = 'none';
    prev.innerHTML = `<img src="${profilePicBase64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  };
  reader.readAsDataURL(file);
}

async function saveProfile() {
  const data = {
    name: document.getElementById('profName').value.trim(),
    email: document.getElementById('profEmail').value.trim(),
    phone: document.getElementById('profPhone').value.trim(),
    password: document.getElementById('profPassword').value || undefined,
  };
  if (profilePicBase64) data.avatar = profilePicBase64;
  if (!data.name || !data.email) return showToast('Name und E-Mail erforderlich', 'error');

  // Save commitment if values provided
  const { fields: commitFs, values: commitVals } = readCommitFields('profCommit');
  if (commitFs.some(f => commitVals[f.key])) {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    api.post('/commitments', { month, ...commitVals }).catch(() => {});
  }

  const result = await api.put('/auth/profile', data);
  // Update stored token and currentUser
  localStorage.setItem('tbc_token', result.token);
  localStorage.setItem('tbc_user', JSON.stringify(result.user));
  currentUser = result.user;
  document.getElementById('sidebarName').textContent = result.user.name;
  const av = document.getElementById('sidebarAvatar');
  if (result.user.avatar) {
    av.innerHTML = `<img src="${result.user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    av.textContent = initials(result.user.name);
  }
  profilePicBase64 = null;
  closeModal('modalProfile');
  showToast('Profil gespeichert!');
}

async function saveInstagramSession() {
  const sessionid = document.getElementById('igSessionInput').value.trim();
  if (!sessionid) return showToast('Bitte Session-Cookie einfügen', 'error');
  await api.put('/auth/instagram-session', { sessionid });
  document.getElementById('igConnectedBadge').style.display = 'flex';
  document.getElementById('igConnectForm').style.display = 'none';
  document.getElementById('igSessionInput').value = '';
  showToast('Instagram verbunden! Die Suche funktioniert jetzt.');
}

async function disconnectInstagram() {
  await api.put('/auth/instagram-session', { sessionid: null });
  document.getElementById('igConnectedBadge').style.display = 'none';
  document.getElementById('igConnectForm').style.display = 'block';
  showToast('Instagram getrennt.');
}

/* ─── Wiki / Wissensdatenbank ─── */
const WIKI_CAT_ORDER = ['Produktwissen','Preise','Onboarding','Brandhub','Sales','Prozesse','HR','Allgemein'];
const WIKI_CAT_ICONS = {'Produktwissen':'📦','Preise':'💶','Onboarding':'🚀','Brandhub':'🎨','Sales':'🎯','Prozesse':'⚙️','HR':'👥','Allgemein':'📄'};
let _wikiAll = [];

async function loadWiki() {
  _wikiAll = await api.get('/wiki');
  wikiArticles = _wikiAll;
  wikiRenderCatView();
}

function wikiOnSearch() {
  const q = (document.getElementById('wikiSearch')?.value || '').trim();
  const clearBtn = document.getElementById('wikiSearchClear');
  const countEl = document.getElementById('wikiSearchCount');
  const catView = document.getElementById('wikiCatView');
  const searchView = document.getElementById('wikiSearchView');

  if (!q) {
    clearBtn.style.display = 'none';
    countEl.style.display = 'none';
    catView.style.display = '';
    searchView.style.display = 'none';
    return;
  }

  clearBtn.style.display = '';
  catView.style.display = 'none';
  searchView.style.display = '';

  const ql = q.toLowerCase();
  const hits = _wikiAll.filter(a =>
    a.title.toLowerCase().includes(ql) ||
    (a.category || '').toLowerCase().includes(ql) ||
    (a.content || '').replace(/<[^>]+>/g, ' ').toLowerCase().includes(ql)
  );

  countEl.style.display = '';
  countEl.textContent = hits.length ? `${hits.length} Treffer` : 'Keine Treffer';

  searchView.innerHTML = hits.length
    ? hits.map(a => wikiArticleCard(a)).join('')
    : `<div class="empty-state" style="padding:60px"><div class="empty-icon">🔍</div><p>Kein Artikel für „${q}" gefunden</p></div>`;
}

function wikiClearSearch() {
  document.getElementById('wikiSearch').value = '';
  wikiOnSearch();
}

function wikiRenderCatView() {
  const container = document.getElementById('wikiCatView');
  if (!_wikiAll.length) {
    container.innerHTML = `<div class="empty-state" style="padding:60px"><div class="empty-icon">📚</div><p>Noch keine Artikel — lege den ersten an!</p></div>`;
    return;
  }

  const grouped = {};
  _wikiAll.forEach(a => {
    const cat = a.category || 'Allgemein';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(a);
  });

  // Sort: predefined order first, then alphabetical for unknown cats
  const cats = Object.keys(grouped).sort((a, b) => {
    const ai = WIKI_CAT_ORDER.indexOf(a), bi = WIKI_CAT_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  container.innerHTML = cats.map((cat, idx) => {
    const items = grouped[cat];
    const icon = WIKI_CAT_ICONS[cat] || '📁';
    return `
      <div class="wiki-cat-section">
        <div class="wiki-cat-header" onclick="wikiToggleCat(${idx})">
          <span class="wiki-cat-icon">${icon}</span>
          <span class="wiki-cat-name">${cat}</span>
          <span class="wiki-cat-count">${items.length} Artikel</span>
          <span class="wiki-cat-chevron" id="wikiChev${idx}">›</span>
        </div>
        <div class="wiki-cat-body" id="wikiCatBody${idx}" style="display:none">
          ${items.map(a => wikiArticleRow(a)).join('')}
        </div>
      </div>`;
  }).join('');
}

function wikiToggleCat(idx) {
  const body = document.getElementById('wikiCatBody' + idx);
  const chev = document.getElementById('wikiChev' + idx);
  if (!body) return;
  const open = body.style.display === 'block';
  body.style.display = open ? 'none' : 'block';
  if (chev) chev.style.transform = open ? '' : 'rotate(90deg)';
}

function wikiArticleRow(a) {
  const preview = (a.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim().slice(0, 100);
  return `<div class="wiki-row" onclick="readWikiArticle(${a.id})">
    <div class="wiki-row-title">${a.title}</div>
    <div class="wiki-row-preview">${preview || '–'}</div>
    <div class="wiki-row-meta">${a.author_name} · ${formatRelative(a.updated_at || a.created_at)}</div>
  </div>`;
}

function wikiArticleCard(a) {
  const preview = (a.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim().slice(0, 120);
  return `<div class="wiki-search-card" onclick="readWikiArticle(${a.id})">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:11px;font-weight:700;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:2px 8px;color:var(--text-secondary)">${a.category || 'Allgemein'}</span>
    </div>
    <div class="wiki-row-title">${a.title}</div>
    <div class="wiki-row-preview">${preview || '–'}</div>
    <div class="wiki-row-meta">${a.author_name} · ${formatRelative(a.updated_at || a.created_at)}</div>
  </div>`;
}

let wikiArticles = [];
async function readWikiArticle(id) {
  if (!_wikiAll.length) _wikiAll = await api.get('/wiki');
  // eslint-disable-next-line eqeqeq
  const a = _wikiAll.find(x => x.id == id);
  if (!a) return;
  document.getElementById('wikiReadTitle').textContent = a.title;
  document.getElementById('wikiReadMeta').textContent = `${a.category || 'Allgemein'} · ${a.author_name} · ${formatRelative(a.updated_at || a.created_at)}`;
  // render HTML content (rich text) or fall back to plain text
  const el = document.getElementById('wikiReadContent');
  if (/<[a-z][\s\S]*>/i.test(a.content)) {
    el.innerHTML = a.content;
  } else {
    el.textContent = a.content;
  }
  const footer = document.getElementById('wikiReadFooter');
  footer.innerHTML = `<button class="btn btn-secondary" onclick="closeModal('modalWikiRead')">Schließen</button>
    <button class="btn btn-secondary" onclick="closeModal('modalWikiRead');editWikiArticle(${a.id})">✏️ Bearbeiten</button>
    <button class="btn btn-danger" onclick="deleteWikiArticle(${a.id})">🗑️ Löschen</button>`;
  openModal('modalWikiRead');
}

function openNewWikiModal() {
  wikiArticles = [];
  document.getElementById('wikiModalTitle').textContent = 'Artikel anlegen';
  document.getElementById('wikiId').value = '';
  document.getElementById('wikiTitle').value = '';
  document.getElementById('wikiCategory').value = 'Produktwissen';
  const ed = document.getElementById('wikiEditor');
  ed.innerHTML = '';
  wikiEditorInput();
  openModal('modalWiki');
  setTimeout(() => ed.focus(), 100);
}

async function editWikiArticle(id) {
  if (!_wikiAll.length) _wikiAll = await api.get('/wiki');
  // eslint-disable-next-line eqeqeq
  const a = _wikiAll.find(x => x.id == id);
  if (!a) return;
  document.getElementById('wikiModalTitle').textContent = 'Artikel bearbeiten';
  document.getElementById('wikiId').value = a.id;
  document.getElementById('wikiTitle').value = a.title;
  document.getElementById('wikiCategory').value = a.category || 'Allgemein';
  const ed = document.getElementById('wikiEditor');
  if (/<[a-z][\s\S]*>/i.test(a.content)) {
    ed.innerHTML = a.content;
  } else {
    ed.innerText = a.content;
  }
  wikiEditorInput();
  openModal('modalWiki');
}

async function saveWikiArticle() {
  const id = document.getElementById('wikiId').value;
  const ed = document.getElementById('wikiEditor');
  const content = ed.innerHTML.trim();
  const data = {
    title:    document.getElementById('wikiTitle').value.trim(),
    content,
    category: document.getElementById('wikiCategory').value.trim() || 'Allgemein',
  };
  if (!data.title)   return showToast('Titel ist erforderlich', 'error');
  if (!content || ed.innerText.trim() === '') return showToast('Inhalt ist erforderlich', 'error');
  if (id) await api.put('/wiki/' + id, data);
  else    await api.post('/wiki', data);
  _wikiAll = [];
  closeModal('modalWiki');
  showToast(id ? 'Artikel aktualisiert!' : 'Artikel angelegt!');
  loadWiki();
  loadTools();
}

/* ── Wiki Rich Text Editor ── */
function wikiCmd(cmd) {
  document.getElementById('wikiEditor').focus();
  document.execCommand(cmd, false, null);
  wikiEditorInput();
}

function wikiBlock(tag) {
  document.getElementById('wikiEditor').focus();
  document.execCommand('formatBlock', false, tag);
  wikiEditorInput();
}

function wikiInlineCode() {
  const sel = window.getSelection();
  if (sel && sel.toString()) {
    document.execCommand('insertHTML', false, `<code>${sel.toString()}</code>`);
  } else {
    document.execCommand('insertHTML', false, `<code>code</code>`);
  }
  wikiEditorInput();
}

function wikiCodeBlock() {
  const sel = window.getSelection();
  const txt = (sel && sel.toString()) ? sel.toString() : 'code hier';
  document.execCommand('insertHTML', false, `<pre>${txt}</pre><p><br></p>`);
  wikiEditorInput();
}

function wikiEditorInput() {
  const ed = document.getElementById('wikiEditor');
  if (!ed) return;
  const empty = ed.innerText.trim() === '';
  ed.dataset.empty = empty ? 'true' : 'false';
}

// Shrink an image File to fit within maxWidth, return data URL
async function wikiShrinkImage(file, maxWidth = 1200) {
  const dataUrl = await new Promise(res => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.readAsDataURL(file);
  });
  // SVG can't be canvas-rasterized losslessly; embed as-is
  if (file.type === 'image/svg+xml') return dataUrl;
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      res(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

async function wikiInsertImageFile(input) {
  const file = input.files[0];
  if (!file) return;
  const dataUrl = await wikiShrinkImage(file);
  document.getElementById('wikiEditor').focus();
  document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="${file.name}"><p><br></p>`);
  wikiEditorInput();
  input.value = '';
}

async function wikiHandlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      const dataUrl = await wikiShrinkImage(file);
      document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="Screenshot"><p><br></p>`);
      wikiEditorInput();
      return;
    }
  }
}

// Insert plain text (e.g. an arrow) at the editor caret
function wikiInsert(text) {
  document.getElementById('wikiEditor').focus();
  document.execCommand('insertText', false, text);
  wikiEditorInput();
}

// Track which image is currently selected (clicked) inside the editor
let _wikiSelectedImg = null;
document.addEventListener('click', e => {
  const editor = document.getElementById('wikiEditor');
  if (!editor) return;
  if (editor.contains(e.target) && e.target.tagName === 'IMG') {
    if (_wikiSelectedImg) _wikiSelectedImg.classList.remove('selected');
    _wikiSelectedImg = e.target;
    _wikiSelectedImg.classList.add('selected');
  } else if (_wikiSelectedImg) {
    _wikiSelectedImg.classList.remove('selected');
    _wikiSelectedImg = null;
  }
});

function wikiResizeImg(percent) {
  if (!_wikiSelectedImg) {
    alert('Bitte zuerst ein Bild im Artikel anklicken.');
    return;
  }
  _wikiSelectedImg.style.width = percent + '%';
  _wikiSelectedImg.style.maxWidth = '100%';
  wikiEditorInput();
}

async function deleteWikiArticle(id) {
  if (!confirm('Artikel wirklich löschen?')) return;
  await api.delete('/wiki/' + id);
  _wikiAll = [];
  closeModal('modalWikiRead');
  showToast('Gelöscht');
  loadTools();
}

/* ─── Tasks ─── */
/* ─── Admin ─── */
let _adminStats = null;

async function loadAdmin() {
  _adminStats = null;
  switchAdminTab('overview');
}

function switchAdminTab(tab) {
  ['overview','users','onboarding','feedback','settings'].forEach(t => {
    document.getElementById('adminTab-' + t).classList.toggle('active', t === tab);
    document.getElementById('adminPanel-' + t).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'overview')   loadAdminOverview();
  if (tab === 'users')      loadAdminUsers();
  if (tab === 'onboarding') loadOnboarding();
  if (tab === 'feedback')   loadAdminFeedback();
  if (tab === 'settings')   loadAdminSettings();
}

/* ─── Logo Upload (Admin Settings) ─── */
let _logoFileData = null;

async function loadAdminSettings() {
  document.getElementById('logoCurrentLabel').textContent = 'Hochgeladenes Logo oder Standard-Logo';
  document.getElementById('logoPreviewCurrent').src = '/api/brand/logo?' + Date.now();
  try {
    const { name } = await api.get('/brand/name');
    document.getElementById('appNameInput').value = name || '';
  } catch {}
}

async function saveAppName() {
  const name = document.getElementById('appNameInput').value.trim();
  const status = document.getElementById('appNameStatus');
  if (!name) return;
  try {
    await api.post('/brand/name', { name });
    status.innerHTML = '<span style="color:var(--success)">✓ Name gespeichert!</span>';
    applyAppName(name);
  } catch (e) {
    status.innerHTML = '<span style="color:var(--danger)">❌ ' + e.message + '</span>';
  }
}

function applyAppName(name) {
  document.title = name + ' – Mitarbeiter-Portal';
  const el = document.getElementById('appName');
  if (el) el.textContent = name;
}

/* ─── Push Notifications ─── */
let _swReg = null;

async function registerPushSW() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  _swReg = await navigator.serviceWorker.register('/sw.js');
  return _swReg;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function maybeResubscribePush() {
  if (!_swReg || Notification.permission !== 'granted') return;
  const existing = await _swReg.pushManager.getSubscription();
  if (existing) {
    await api.post('/push/subscribe', { subscription: existing }).catch(() => {});
    return;
  }
  await subscribePush();
}

async function subscribePush() {
  if (!_swReg) return;
  const { key, enabled } = await api.get('/push/vapid-public-key').catch(() => ({}));
  if (!enabled || !key) {
    showToast('Push-Benachrichtigungen sind serverseitig nicht konfiguriert.', 'error');
    return false;
  }
  try {
    const sub = await _swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await api.post('/push/subscribe', { subscription: sub });
    return true;
  } catch (err) {
    console.error('[push] subscribe failed:', err);
    return false;
  }
}

async function togglePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return showToast('Dein Browser unterstützt keine Push-Benachrichtigungen.', 'error');
  }
  if (!_swReg) await registerPushSW();
  if (!_swReg) return showToast('Service Worker konnte nicht registriert werden.', 'error');

  // Already subscribed → unsubscribe
  const existing = await _swReg.pushManager.getSubscription();
  if (existing) {
    try { await api.post('/push/unsubscribe', { endpoint: existing.endpoint }); } catch {}
    await existing.unsubscribe();
    showToast('Push-Benachrichtigungen deaktiviert.');
    return;
  }

  // Need permission?
  if (Notification.permission === 'denied') {
    return showToast('Benachrichtigungen sind in den Browser-Einstellungen blockiert.', 'error');
  }
  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return showToast('Berechtigung verweigert.', 'error');
  }

  if (await subscribePush()) showToast('Push-Benachrichtigungen aktiviert!');
}

function logoPreviewFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _logoFileData = { base64: e.target.result.split(',')[1], mime: file.type || 'image/png', name: file.name };
    document.getElementById('logoNewPreview').src = e.target.result;
    document.getElementById('logoNewPreviewWrap').style.display = 'flex';
    document.getElementById('logoNewName').textContent = file.name;
    document.getElementById('logoNewSize').textContent = (file.size / 1024).toFixed(0) + ' KB';
    document.getElementById('logoUploadBtn').disabled = false;
    document.getElementById('logoUploadStatus').textContent = '';
  };
  reader.readAsDataURL(file);
}

function logoHandleDrop(e) {
  const file = e.dataTransfer.files[0];
  if (file) logoPreviewFile(file);
}

function logoResetPick() {
  _logoFileData = null;
  document.getElementById('logoNewPreviewWrap').style.display = 'none';
  document.getElementById('logoUploadBtn').disabled = true;
  document.getElementById('logoFileInput').value = '';
}

async function logoUpload() {
  if (!_logoFileData) return;
  const btn = document.getElementById('logoUploadBtn');
  const status = document.getElementById('logoUploadStatus');
  btn.disabled = true;
  btn.textContent = 'Wird hochgeladen…';
  try {
    await api.post('/brand/logo', { imageBase64: _logoFileData.base64, imageMime: _logoFileData.mime });
    const newSrc = '/api/brand/logo?' + Date.now();
    document.getElementById('logoPreviewCurrent').src = newSrc;
    document.getElementById('sidebarLogo').src = newSrc;
    logoResetPick();
    status.innerHTML = '<span style="color:var(--success)">✓ Logo erfolgreich aktualisiert! App neu laden um Favicon zu aktualisieren.</span>';
  } catch (e) {
    status.innerHTML = '<span style="color:var(--danger)">❌ ' + e.message + '</span>';
    btn.disabled = false;
  }
  btn.innerHTML = 'Logo hochladen &amp; aktivieren';
}

async function loadAdminOverview() {
  const stats = _adminStats || await api.get('/admin/stats');
  _adminStats = stats;

  const fmt   = n => '€' + Number(n).toLocaleString('de-DE');
  const fmtN  = n => Number(n).toLocaleString('de-DE');
  const delta = (cur, prev) => {
    if (!prev) return cur > 0 ? `<span style="color:var(--success);font-weight:700">▲ neu</span>` : '<span style="color:var(--text-light)">–</span>';
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return `<span style="color:var(--text-light)">±0%</span>`;
    const up = pct > 0;
    return `<span style="color:${up ? 'var(--success)' : 'var(--danger)'};font-weight:700">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
  };

  // KPI row — with month-over-month deltas
  document.getElementById('adminKpi').innerHTML = `
    <div class="dash-kpi">
      <div class="dash-kpi-label">Umsatz Monat</div>
      <div class="dash-kpi-value admin-kpi-euro">${fmt(stats.thisMonth.umsatz)}</div>
      <div class="dash-kpi-sub">${delta(stats.thisMonth.umsatz, stats.prevMonth.umsatz)} vs Vormonat</div>
    </div>
    <div class="dash-kpi">
      <div class="dash-kpi-label">Marge Monat</div>
      <div class="dash-kpi-value admin-kpi-euro">${fmt(stats.thisMonth.marge)}</div>
      <div class="dash-kpi-sub">${delta(stats.thisMonth.marge, stats.prevMonth.marge)} vs Vormonat</div>
    </div>
    <div class="dash-kpi">
      <div class="dash-kpi-label">Member Monat</div>
      <div class="dash-kpi-value">${stats.kundenThisMonth}</div>
      <div class="dash-kpi-sub">Ø ${fmt(stats.avgDealValue)} / Member · ${delta(stats.thisMonth.count, stats.prevMonth.count)}</div>
    </div>
    <div class="dash-kpi">
      <div class="dash-kpi-label">Sourcing</div>
      <div class="dash-kpi-value">${stats.sourcingThisMonth}</div>
      <div class="dash-kpi-sub">Anfragen ds. Monat</div>
    </div>
    <div class="dash-kpi">
      <div class="dash-kpi-label">Umsatz gesamt</div>
      <div class="dash-kpi-value admin-kpi-euro">${fmt(stats.totalUmsatz)}</div>
      <div class="dash-kpi-sub">Marge: ${fmt(stats.totalMarge)}</div>
    </div>
  `;

  // Monthly revenue — bar chart over 12 months
  const monthNames = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const maxRev = Math.max(1, ...stats.monthlyRevenue.map(m => m.umsatz));
  const totalRev = stats.monthlyRevenue.reduce((s, m) => s + m.umsatz, 0);
  document.getElementById('adminMonthlyTotal').textContent = `Σ ${fmt(totalRev)}`;
  document.getElementById('adminMonthly').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:6px;align-items:end;height:160px;margin-bottom:8px">
      ${stats.monthlyRevenue.map(m => {
        const pct = Math.round((m.umsatz / maxRev) * 100);
        const isThis = m.month === new Date().toISOString().slice(0,7);
        return `<div style="display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;height:100%" title="${m.month}: ${fmt(m.umsatz)} (${m.count} Member)">
          <div style="font-size:10px;color:var(--text-light);font-weight:600;${pct < 30 ? 'opacity:0' : ''}">${m.umsatz > 0 ? '€'+Math.round(m.umsatz/1000)+'k' : ''}</div>
          <div style="width:100%;height:${Math.max(2, pct)}%;background:${isThis ? 'var(--tbc-blue)' : 'var(--text-light)'};border-radius:4px 4px 0 0;transition:height .4s"></div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:6px;font-size:10px;color:var(--text-secondary);text-align:center">
      ${stats.monthlyRevenue.map(m => `<span>${monthNames[parseInt(m.month.split('-')[1]) - 1]}</span>`).join('')}
    </div>`;

  // Pipeline
  const maxPipe = Math.max(1, ...stats.pipeline.map(p => p.count));
  document.getElementById('adminPipeline').innerHTML = stats.pipeline.map(p => `
    <div style="padding:9px 18px;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;font-size:13px">
        <span style="font-weight:600">${p.label}</span>
        <span style="color:var(--text-secondary);font-size:12px">${p.count} Member</span>
      </div>
      <div style="height:4px;background:var(--border);border-radius:4px;overflow:hidden">
        <div style="height:100%;background:#8B5CF6;border-radius:4px;width:${Math.round(p.count/maxPipe*100)}%;transition:width .4s"></div>
      </div>
    </div>`).join('') || '<div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:13px">Keine Daten</div>';

  // Channels
  const maxCh = Math.max(1, ...stats.channels.map(c => c.count));
  document.getElementById('adminChannels').innerHTML = stats.channels.map(c => `
    <div style="padding:9px 18px;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;font-size:13px;gap:8px">
        <span style="font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</span>
        <span style="color:var(--text-secondary);flex-shrink:0;font-size:12px">${c.count} · ${fmt(c.umsatz)}</span>
      </div>
      <div style="height:4px;background:var(--border);border-radius:4px;overflow:hidden">
        <div style="height:100%;background:var(--tbc-blue);border-radius:4px;width:${Math.round(c.count/maxCh*100)}%;transition:width .4s"></div>
      </div>
    </div>`).join('') || '<div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:13px">Keine Daten</div>';

  // Top performers
  document.getElementById('adminTopPerformers').innerHTML = stats.topPerformers.length
    ? stats.topPerformers.slice(0, 5).map((p, i) => `
      <div style="display:flex;align-items:center;gap:14px;padding:11px 18px;border-bottom:1px solid var(--border-light);font-size:13px">
        <span style="font-size:16px;width:24px;text-align:center">${['🥇','🥈','🥉'][i] || '·'}</span>
        <span style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span>
        <span style="color:var(--text-secondary);font-size:12px">${p.kunden} Kd.</span>
        <span style="font-weight:600;min-width:90px;text-align:right">${fmt(p.umsatz)}</span>
      </div>`).join('')
    : '<div style="padding:24px;text-align:center;color:var(--text-secondary);font-size:13px">Noch keine Member eingetragen</div>';
}

async function loadAdminUsers() {
  const users = await api.get('/employees');
  const roleLabel = { admin: 'Admin', manager: 'Human Resources', employee: 'Mitarbeiter', sellsupport: 'Sales Support', newbusiness: 'New Business', customersuccess: 'Customer Success', hr: 'Human Resources' };
  const roleColor = { admin: '#7C3AED', manager: '#BE185D', employee: 'var(--text-secondary)', sellsupport: '#0891B2', newbusiness: '#D97706', customersuccess: '#16A34A', hr: '#BE185D' };
  const tbody = document.getElementById('adminUsersTable');
  tbody.innerHTML = users.map(u => `
    <tr>
      <td data-label="Name">
        <div style="display:flex;align-items:center;gap:8px">
          ${renderAvatar(u.name, u.avatar, 'width:28px;height:28px;font-size:11px')}
          <span style="font-weight:600;font-size:13px">${u.name}</span>
        </div>
      </td>
      <td data-label="E-Mail" style="font-size:13px;color:var(--text-secondary)">${u.email}</td>
      <td data-label="Rolle"><span style="font-size:11px;font-weight:700;color:${roleColor[u.role]||'inherit'}">${roleLabel[u.role]||u.role}</span></td>
      <td data-label="Position" style="font-size:13px">${u.position || '–'}</td>
      <td data-label="Abteilung" style="font-size:13px;color:var(--text-secondary)">${u.department || '–'}</td>
      <td class="admin-actions" style="display:flex;gap:6px">
        <button class="btn-icon" onclick="openAdminEditUser(${u.id})">✏️</button>
        <button class="btn-icon" onclick="deleteEmployee(${u.id})">🗑️</button>
      </td>
    </tr>`).join('');
}

function openAdminNewUser() {
  document.getElementById('empId').value = '';
  document.getElementById('empModalTitle').textContent = 'Nutzer anlegen';
  document.getElementById('empPasswordLabel').textContent = 'Passwort *';
  ['empName','empEmail','empPassword','empDept','empPosition','empPhone'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('empRole').value = 'newbusiness';
  document.getElementById('empDoesOnboarding').checked = false;
  openModal('modalEmployee');
}

async function openAdminEditUser(id) {
  const users = await api.get('/employees');
  const u = users.find(x => x.id === id);
  if (!u) return;
  document.getElementById('empId').value = u.id;
  document.getElementById('empModalTitle').textContent = 'Nutzer bearbeiten';
  document.getElementById('empPasswordLabel').textContent = 'Passwort (optional)';
  document.getElementById('empName').value = u.name;
  document.getElementById('empEmail').value = u.email;
  document.getElementById('empPassword').value = '';
  document.getElementById('empRole').value = u.role || 'newbusiness';
  document.getElementById('empDept').value = u.department || '';
  document.getElementById('empPosition').value = u.position || '';
  document.getElementById('empPhone').value = u.phone || '';
  document.getElementById('empDoesOnboarding').checked = u.does_onboarding || false;
  openModal('modalEmployee');
}

async function loadAdminTasks() {
  const statusFilter = document.getElementById('adminTaskStatus')?.value || '';
  let tasks = await api.get('/admin/tasks');
  if (statusFilter) tasks = tasks.filter(t => t.status === statusFilter);

  const today = new Date().toISOString().slice(0, 10);
  const tbody = document.getElementById('adminTasksTable');
  if (!tasks.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-secondary)">Keine Aufgaben</td></tr>';
    return;
  }
  tbody.innerHTML = tasks.map(t => {
    const isOverdue = t.due_date && t.due_date < today && t.status !== 'done';
    return `<tr>
      <td data-label="Aufgabe">
        <div style="font-weight:600;font-size:13px">${t.title}</div>
        ${t.project ? `<div style="font-size:11px;color:var(--text-secondary)">${t.project}</div>` : ''}
      </td>
      <td data-label="Zuständig" style="font-size:13px">${t.assigned_name || '–'}</td>
      <td data-label="Status">${badge(t.status)}</td>
      <td data-label="Fällig" style="font-size:13px${isOverdue ? ';color:var(--danger);font-weight:700' : ''}">${isOverdue ? '⚠ ' : ''}${formatDate(t.due_date)}</td>
    </tr>`;
  }).join('');
}

async function loadAdminFeedback() {
  const feedback = await api.get('/feedback');
  const listEl = document.getElementById('adminFeedbackList');
  if (!feedback.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:40px"><div class="empty-icon">💬</div><p>Noch kein Feedback</p></div>';
    return;
  }
  listEl.innerHTML = feedback.map(f => `
    <div style="padding:12px 18px;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
        ${renderAvatar(f.user_name, f.user_avatar, 'width:24px;height:24px;font-size:10px')}
        <span style="font-size:13px;font-weight:600">${f.user_name}</span>
        <span style="font-size:15px;color:#F59E0B">${'★'.repeat(f.rating)}${'☆'.repeat(5-f.rating)}</span>
        <span style="font-size:11px;color:var(--text-light);margin-left:auto">${formatRelative(f.created_at)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">🏷 ${f.topic}</div>
      ${f.pros ? `<div style="font-size:12px;color:#16A34A">👍 ${f.pros}</div>` : ''}
      ${f.cons ? `<div style="font-size:12px;color:#D97706;margin-top:2px">💡 ${f.cons}</div>` : ''}
    </div>`).join('');
}

function exportUsersCSV() {
  const token = localStorage.getItem('tbc_token');
  const a = document.createElement('a');
  a.href = '/api/admin/export/users';
  // Pass JWT via query param so browser download works
  a.href += '?token=' + encodeURIComponent(token);
  a.click();
}

// ── HUBSPOT LEAD MODAL ──
function openHsLeadModal() {
  ['hlFirma','hlUrl','hlName','hlEmail','hlPhone','hlNotes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('hlStatus').textContent = '';
  openModal('modalHsLead');
}

async function submitHsLead() {
  const firma = document.getElementById('hlFirma').value.trim();
  const contactName = document.getElementById('hlName').value.trim();
  if (!firma || !contactName) return alert('Firmenname und Kontaktperson sind Pflichtfelder.');

  const statusEl = document.getElementById('hlStatus');
  statusEl.textContent = '⏳ Wird in HubSpot angelegt…';

  try {
    await api.post('/onboarding-hs', {
      action: 'createLead',
      firma,
      url: document.getElementById('hlUrl').value.trim(),
      contactName,
      email: document.getElementById('hlEmail').value.trim(),
      phone: document.getElementById('hlPhone').value.trim(),
      pipeline: document.getElementById('hlPipeline').value,
      notes: document.getElementById('hlNotes').value.trim(),
    });
    statusEl.textContent = '';
    closeModal('modalHsLead');
    alert(`✅ Lead "${firma}" wurde in HubSpot angelegt (Firma, Kontakt & Deal erstellt).`);
  } catch (e) {
    statusEl.textContent = '❌ Fehler: ' + (e.message || 'Unbekannter Fehler');
  }
}

// ── FEEDBACK PAGE ──
let fbRating = 0;

function loadFeedbackPage() {
  fbRating = 0;
  fbSetStars(0);
  document.getElementById('fbPros').value = '';
  document.getElementById('fbCons').value = '';

  document.querySelectorAll('#fbStars span').forEach(s => {
    s.onmouseover = () => fbSetStars(Number(s.dataset.v));
    s.onmouseleave = () => fbSetStars(fbRating);
    s.onclick = () => { fbRating = Number(s.dataset.v); fbSetStars(fbRating); };
  });
}

function fbSetStars(n) {
  document.querySelectorAll('#fbStars span').forEach(s => {
    s.textContent = Number(s.dataset.v) <= n ? '★' : '☆';
    s.style.color = Number(s.dataset.v) <= n ? '#F59E0B' : 'var(--text-light)';
  });
}

async function loadFeedbackTopic() {
  const isAdmin = ['admin', 'management'].includes(currentUser.role);
  const listCard = document.getElementById('fbListCard');
  if (listCard) listCard.style.display = isAdmin ? '' : 'none';
  if (!isAdmin) return;

  const topic = document.getElementById('fbTopic').value;
  document.getElementById('fbListTitle').textContent = `Feedback zu ${topic}`;
  const rows = await api.get(`/feedback?topic=${encodeURIComponent(topic)}`);
  const el = document.getElementById('fbList');
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">💬</div><p>Noch kein Feedback zu diesem Thema</p></div>';
    return;
  }
  el.innerHTML = rows.map(f => `
    <div style="padding:12px 18px;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
        ${renderAvatar(f.user_name, f.user_avatar, 'width:24px;height:24px;font-size:10px')}
        <span style="font-size:13px;font-weight:600">${f.user_name}</span>
        <span style="font-size:16px;color:#F59E0B">${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}</span>
        <span style="font-size:11px;color:var(--text-light);margin-left:auto">${formatRelative(f.created_at)}</span>
      </div>
      ${f.pros ? `<div style="font-size:12px;color:#16A34A;margin-top:4px">👍 ${f.pros}</div>` : ''}
      ${f.cons ? `<div style="font-size:12px;color:#D97706;margin-top:2px">💡 ${f.cons}</div>` : ''}
    </div>`).join('');
}

async function submitFeedback() {
  const topic = document.getElementById('fbTopic').value;
  const pros = document.getElementById('fbPros').value.trim();
  const cons = document.getElementById('fbCons').value.trim();
  if (!fbRating) return alert('Bitte eine Bewertung (Sterne) vergeben.');
  await api.post('/feedback', { topic, rating: fbRating, pros, cons });
  fbRating = 0;
  fbSetStars(0);
  document.getElementById('fbPros').value = '';
  document.getElementById('fbCons').value = '';
  loadFeedbackTopic();
}

async function loadTasks() {
  const status = document.getElementById('taskStatus')?.value || '';
  const priority = document.getElementById('taskPriority')?.value || '';
  let path = '/tasks?';
  if (status) path += `status=${status}&`;
  if (priority) path += `priority=${priority}&`;
  allTasks = await api.get(path);
  renderTasks(allTasks);
}

// Live countdown for the task detail view — adapts units (D/h/m/s)
function formatCountdown(dueDate, status) {
  if (!dueDate || status === 'done') return '';
  let due = new Date(dueDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) due.setHours(23, 59, 59, 999);
  const diffMs = due - new Date();

  let icon, color, bg, text;
  if (diffMs <= 0) {
    icon = '⏰'; color = '#DC2626'; bg = '#FEE2E2';
    const oh = Math.floor(-diffMs / 3600000);
    const od = Math.floor(-diffMs / 86400000);
    text = od >= 1 ? `${od}T überfällig` : oh >= 1 ? `${oh}h überfällig` : `${Math.floor(-diffMs / 60000)}m überfällig`;
  } else {
    const d = Math.floor(diffMs / 86400000);
    const h = Math.floor((diffMs % 86400000) / 3600000);
    const m = Math.floor((diffMs % 3600000) / 60000);
    const s = Math.floor((diffMs % 60000) / 1000);
    icon = '⏳';
    if (d > 0) { text = `${d}T ${h}h`; color = '#16A34A'; bg = '#F0FDF4'; }
    else if (h > 0) { text = `${h}h ${m}m ${String(s).padStart(2,'0')}s`; color = '#D97706'; bg = '#FEF3C7'; }
    else if (m > 0) { text = `${m}m ${String(s).padStart(2,'0')}s`; color = '#DC2626'; bg = '#FEE2E2'; }
    else { text = `${s}s`; color = '#DC2626'; bg = '#FEE2E2'; }
  }
  return `<span style="display:inline-flex;align-items:center;gap:6px;background:${bg};color:${color};font-size:14px;font-weight:700;padding:8px 14px;border-radius:10px;font-variant-numeric:tabular-nums">${icon} ${text}</span>`;
}

let _tdCountdownInterval = null;
function startTdCountdown(taskId, dueDate, status) {
  if (_tdCountdownInterval) clearInterval(_tdCountdownInterval);
  const row = document.getElementById('tdCountdownRow');
  const update = () => {
    const modal = document.getElementById('modalTaskDetail');
    if (!modal || modal.style.display === 'none' || tdCurrentTaskId !== taskId) {
      clearInterval(_tdCountdownInterval); _tdCountdownInterval = null; return;
    }
    row.innerHTML = formatCountdown(dueDate, status);
  };
  update();
  if (status !== 'done' && dueDate) _tdCountdownInterval = setInterval(update, 1000);
}

async function markTaskDone(taskId) {
  const t = allTasks.find(x => x.id === taskId);
  if (!t) return;
  await api.put('/tasks/' + taskId, { ...t, status: 'done' });
  closeModal('modalTaskDetail');
  showToast('Aufgabe als erledigt markiert!');
  loadTasks();
}

// Color coding by project (visible on the left edge of task cards + as chip tint)
const PROJECT_THEMES = {
  Sourcing:        { bar: '#0EA5E9', chipBg: '#E0F2FE', chipText: '#0369A1', icon: '📦' },
  Onboarding:      { bar: '#8B5CF6', chipBg: '#F3E8FF', chipText: '#6D28D9', icon: '🚀' },
  Sales:           { bar: '#22C55E', chipBg: '#DCFCE7', chipText: '#15803D', icon: '🎯' },
  Support:         { bar: '#F59E0B', chipBg: '#FEF3C7', chipText: '#B45309', icon: '🛟' },
  HR:              { bar: '#EC4899', chipBg: '#FCE7F3', chipText: '#BE185D', icon: '👥' },
  Marketing:       { bar: '#F97316', chipBg: '#FFEDD5', chipText: '#C2410C', icon: '📣' },
};
const DEFAULT_THEME = { bar: '#94A3B8', chipBg: 'var(--bg)', chipText: 'var(--text-secondary)', icon: '📁' };
function projectTheme(p) { return PROJECT_THEMES[p] || DEFAULT_THEME; }

function dueBadge(due_date, status) {
  if (!due_date || status === 'done') return '';
  const now = new Date();
  const due = new Date(due_date);
  const diffMs = due - now;
  const diffDays = Math.ceil(diffMs / 86400000);
  if (diffDays < 0) {
    const d = Math.abs(diffDays);
    return `<span style="display:inline-flex;align-items:center;gap:3px;background:#FEE2E2;color:#DC2626;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px">⏰ ${d}T überfällig</span>`;
  }
  if (diffDays === 0) return `<span style="display:inline-flex;align-items:center;gap:3px;background:#FEF3C7;color:#D97706;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px">⚡ Heute fällig</span>`;
  if (diffDays <= 2) return `<span style="display:inline-flex;align-items:center;gap:3px;background:#FEF3C7;color:#D97706;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px">⏳ ${diffDays}T</span>`;
  if (diffDays <= 7) return `<span style="display:inline-flex;align-items:center;gap:3px;background:#F0FDF4;color:#16A34A;font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px">📅 ${diffDays}T</span>`;
  return `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--bg);color:var(--text-light);font-size:11px;padding:2px 8px;border-radius:20px">📅 ${formatDate(due_date)}</span>`;
}

function renderTasks(tasks) {
  const q = document.getElementById('taskSearch')?.value?.toLowerCase() || '';
  const filtered = q ? tasks.filter(t => t.title.toLowerCase().includes(q) || (t.project||'').toLowerCase().includes(q)) : tasks;
  const container = document.getElementById('tasksContainer');
  if (!filtered.length) {
    container.innerHTML = '<div class="card"><div class="empty-state" style="padding:48px"><div class="empty-icon">✅</div><p>Keine Aufgaben gefunden</p></div></div>';
    return;
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const statusOrder = { open: 0, in_progress: 1, done: 2 };
  const sorted = [...filtered].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    const aOver = a.due_date && a.due_date < new Date().toISOString().slice(0,10) && a.status !== 'done';
    const bOver = b.due_date && b.due_date < new Date().toISOString().slice(0,10) && b.status !== 'done';
    if (aOver && !bOver) return -1;
    if (!aOver && bOver) return 1;
    return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
  });

  container.innerHTML = sorted.map(t => {
    const isOnboarding = t.project === 'Onboarding' && t.status !== 'done';
    const displayTitle = t.title.replace(/^Pre-Onboarding\s*\/\s*Onboarding starten:\s*/i, 'Onboarding starten: ');
    const isDone = t.status === 'done';
    const theme = projectTheme(t.project);
    const barColor = isDone ? 'var(--border)' : theme.bar;

    return `
    <div class="task-card-row" style="background:var(--surface);border-radius:14px;border:1px solid var(--border);border-left:6px solid ${barColor};padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:16px;box-shadow:0 1px 2px rgba(0,0,0,0.04);transition:box-shadow .15s,transform .1s;opacity:${isDone?'0.55':'1'};cursor:pointer"
      onclick="openTaskDetail(${t.id})"
      onmouseenter="this.style.boxShadow='0 6px 20px rgba(0,0,0,0.08)';this.style.transform='translateY(-1px)'"
      onmouseleave="this.style.boxShadow='0 1px 2px rgba(0,0,0,0.04)';this.style.transform=''">

      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap">
          ${t.project ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:${theme.chipBg};color:${theme.chipText};padding:3px 9px;border-radius:6px">${theme.icon} ${t.project}</span>` : ''}
          ${badge(t.status)}
          ${badge(t.priority)}
        </div>
        <div style="font-weight:700;font-size:16px;line-height:1.3;margin-bottom:4px;letter-spacing:-.2px;${isDone?'text-decoration:line-through;color:var(--text-light)':'color:var(--text-primary)'}">${displayTitle}</div>
        ${t.description ? `<div style="font-size:12.5px;color:var(--text-secondary);line-height:1.55">${t.description.substring(0,110)}${t.description.length>110?'…':''}</div>` : ''}
      </div>

      <div class="task-card-right" style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        ${dueBadge(t.due_date, t.status)}
        ${isOnboarding ? `<button class="btn btn-primary" style="font-size:12px;padding:7px 14px;white-space:nowrap" onclick="event.stopPropagation();startOnboardingFromTask(${t.id})">🚀 Onboarding starten</button>` : ''}
        <button class="btn-icon" onclick="event.stopPropagation();editTask(${t.id})" title="Bearbeiten">✏️</button>
        ${(['admin','management'].includes(currentUser.role) || t.created_by === currentUser.id || t.assigned_to === currentUser.id) ? `<button class="btn-icon" onclick="event.stopPropagation();deleteTask(${t.id})" title="Löschen">🗑️</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function filterTasks() { renderTasks(allTasks); }

let tdCurrentTaskId = null;
let tdRating = 0;

async function openTaskDetail(id) {
  tdCurrentTaskId = id;

  const t = await api.get('/tasks/' + id);

  document.getElementById('tdTitle').textContent = t.title.replace(/^Pre-Onboarding\s*\/\s*Onboarding starten:\s*/i, 'Onboarding starten: ');
  // Sourcing block — replace plaintext description with structured table when present
  const srcEl = document.getElementById('tdSourcing');
  if (t.sourcing) {
    srcEl.innerHTML = renderSourcingDetail(t.sourcing, t.id);
    srcEl.style.display = '';
    document.getElementById('tdDescription').textContent = '';
  } else {
    srcEl.style.display = 'none';
    srcEl.innerHTML = '';
    document.getElementById('tdDescription').textContent = t.description || '';
  }
  document.getElementById('tdBadgeRow').innerHTML = badge(t.status) + ' ' + badge(t.priority);
  document.getElementById('tdMeta').innerHTML = [
    t.project ? `<span>📁 ${t.project}</span>` : '',
    t.due_date ? `<span>📅 ${formatDate(t.due_date)}</span>` : '',
  ].filter(Boolean).join('');

  // Live countdown
  startTdCountdown(t.id, t.due_date, t.status);

  // "Als erledigt markieren" — visible to assignee or creator if not yet done
  const canMark = t.status !== 'done' && (t.assigned_to === currentUser.id || t.created_by === currentUser.id);
  const mdRow = document.getElementById('tdMarkDoneRow');
  if (canMark) {
    mdRow.style.display = '';
    mdRow.innerHTML = `<button class="btn btn-primary" style="width:100%;padding:12px;font-size:14px;font-weight:700" onclick="markTaskDone(${t.id})">✓ Als erledigt markieren</button>`;
  } else {
    mdRow.style.display = 'none';
    mdRow.innerHTML = '';
  }

  const isOnboardingTask = t.project === 'Onboarding';
  const firma = isOnboardingTask
    ? t.title.replace(/^(?:Pre-Onboarding\s*\/\s*)?Onboarding starten:\s*/i, '').trim() : null;

  // Checklist
  const checklistEl = document.getElementById('tdChecklist');
  const checklistItems = document.getElementById('tdChecklistItems');
  if (isOnboardingTask && Array.isArray(t.checklist) && t.checklist.length) {
    checklistEl.style.display = '';
    checklistItems.innerHTML = t.checklist.map((item, i) => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-light);cursor:pointer">
        <input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleChecklistItem(${t.id}, ${i}, this.checked)" style="width:16px;height:16px;cursor:pointer">
        <span style="${item.done ? 'text-decoration:line-through;color:var(--text-light)' : ''}">${item.label}</span>
      </label>`).join('');

    const phaseSection = document.getElementById('tdPhaseSection');
    if (currentUser.does_onboarding && t.kunde_id) {
      phaseSection.style.display = '';
      const phases = [
        { key: 'übergeben', label: 'Übergeben' },
        { key: 'pre_onboarding', label: 'Pre-Onboarding' },
        { key: 'onboarding', label: 'Onboarding' },
        { key: 'design', label: 'Design' },
        { key: 'fertig', label: 'Fertig ✓' },
      ];
      window._tdKundeId = t.kunde_id;
      document.getElementById('tdPhaseButtons').innerHTML = phases.map(p => `
        <button onclick="setKundePhase(${t.kunde_id}, '${p.key}', this)"
          style="padding:6px 14px;border-radius:20px;border:2px solid var(--border);background:var(--bg);font-size:12px;cursor:pointer;font-weight:600;transition:all .15s">${p.label}</button>`).join('');
    } else {
      phaseSection.style.display = 'none';
    }
  } else {
    checklistEl.style.display = 'none';
  }

  // Onboarding starten button (sales people only)
  const obBtn = document.getElementById('tdOnboardingBtn');
  const isCSOnboardingHandoff = isOnboardingTask && t.kunde_id && currentUser.role === 'customersuccess' && t.assigned_to === currentUser.id && t.status !== 'done';
  if (isCSOnboardingHandoff) {
    obBtn.style.display = '';
    obBtn.innerHTML = `<button class="btn btn-primary" style="width:100%;padding:12px;font-size:14px;font-weight:700" onclick="csMoveToProduction(${t.id}, ${t.kunde_id})">→ Member in Production verschieben</button>`;
  } else if (firma && t.status !== 'done' && !currentUser.does_onboarding) {
    obBtn.style.display = '';
    window._tdTaskId = t.id;
    obBtn.innerHTML = `<button class="btn btn-primary" style="padding:10px 20px;font-size:14px" onclick="closeModal('modalTaskDetail');startOnboardingFromTask(${t.id})">🚀 Onboarding starten</button>`;
  } else {
    obBtn.style.display = 'none';
  }

  openModal('modalTaskDetail');
}

async function csMoveToProduction(taskId, kundeId) {
  if (!confirm('Member in die Production-Phase verschieben und diese Aufgabe als erledigt markieren?')) return;
  try {
    await api.patch('/kunden/' + kundeId + '/status', { onboarding_phase: 'production' });
    const t = allTasks.find(x => x.id === taskId);
    if (t) await api.put('/tasks/' + taskId, { ...t, status: 'done' });
    closeModal('modalTaskDetail');
    showToast('Member in Production verschoben!');
    loadDashboard();
  } catch (err) {
    showToast(err.message || 'Fehlgeschlagen', 'error');
  }
}

async function toggleChecklistItem(taskId, index, done) {
  await api.patch(`/tasks/${taskId}/checklist`, { index, done });
}

async function setKundePhase(kundeId, phase, btn) {
  await api.patch('/kunden/' + kundeId + '/status', { onboarding_phase: phase });
  // Highlight active button if used inside the task-detail phase row
  const phaseRow = btn?.closest('#tdPhaseButtons');
  if (phaseRow) {
    phaseRow.querySelectorAll('button').forEach(b => {
      b.style.background = 'var(--bg)';
      b.style.borderColor = 'var(--border)';
      b.style.color = 'var(--text-primary)';
    });
    btn.style.background = 'var(--tbc-blue)';
    btn.style.borderColor = 'var(--tbc-blue)';
    btn.style.color = '#fff';
  }
  showToast('Phase aktualisiert: ' + (btn?.textContent || phase));
  // If on Datenbank page, refresh list so status badge updates
  if (document.getElementById('page-datenbank')?.classList.contains('active')) loadDatenbank();
}

async function startOnboardingFromTask(taskId) {
  try {
    const t = await api.get('/tasks/' + taskId);
    const firma = t.title.replace(/^(?:Pre-Onboarding\s*\/\s*)?Onboarding starten:\s*/i, '').trim();
    const kunden = await api.get('/kunden');
    const kunde = kunden.find(k => k.firma.toLowerCase() === firma.toLowerCase() && k.status !== 'übergeben');
    if (kunde) {
      startUebergabe(kunde.id, kunde.firma);
    } else {
      showPage('deal');
    }
  } catch {
    showPage('deal');
  }
}

async function openNewTaskModal() {
  document.getElementById('taskModalTitle').textContent = 'Aufgabe erstellen';
  document.getElementById('taskId').value = '';
  ['tTitle','tDesc','tProject'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('tStatus').value = 'open';
  document.getElementById('tPriority').value = 'medium';
  document.getElementById('tDue').value = '';
  await fillAssignedSelect('tAssigned');
  openModal('modalTask');
}

async function editTask(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t) return;
  document.getElementById('taskModalTitle').textContent = 'Aufgabe bearbeiten';
  document.getElementById('taskId').value = t.id;
  document.getElementById('tTitle').value = t.title;
  document.getElementById('tDesc').value = t.description || '';
  document.getElementById('tStatus').value = t.status;
  document.getElementById('tPriority').value = t.priority;
  document.getElementById('tProject').value = t.project || '';
  document.getElementById('tDue').value = t.due_date || '';
  await fillAssignedSelect('tAssigned', t.assigned_to);
  openModal('modalTask');
}

async function saveTask() {
  const id = document.getElementById('taskId').value;
  const data = {
    title: document.getElementById('tTitle').value.trim(),
    description: document.getElementById('tDesc').value.trim(),
    status: document.getElementById('tStatus').value,
    priority: document.getElementById('tPriority').value,
    project: document.getElementById('tProject').value.trim(),
    due_date: document.getElementById('tDue').value || null,
    assigned_to: document.getElementById('tAssigned').value || null,
  };
  if (!data.title) return showToast('Titel erforderlich', 'error');
  if (id) await api.put('/tasks/' + id, data);
  else await api.post('/tasks', data);
  closeModal('modalTask');
  showToast(id ? 'Aufgabe aktualisiert!' : 'Aufgabe erstellt!');
  loadTasks();
}

// ── Sourcing-Anfrage ──
const SOURCING_FIELDS = [
  ['customer',    'Customer'],
  ['supplier',    'Supplier'],
  ['productType', 'Product type'],
  ['model',       'Model'],
  ['size',        'Size of product'],
  ['printing',    'Printing'],
  ['material',    'Material'],
  ['varnishes',   'Varnishes'],
  ['quantity',    'Quantity for quote'],
  ['targetPrice', 'Target price'],
  ['examples',    'Examples'],
  ['note',        'Notiz'],
];

async function openSourcingModal() {
  ['srcCustomer','srcSupplier','srcProductType','srcSize','srcQuantity','srcPrinting','srcMaterial','srcVarnishes','srcTargetPrice','srcExamples','srcNote','srcDue'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('srcModel').value = '';

  // Populate assignee dropdown — preselect first sellsupport user if available
  const users = await api.get('/employees').catch(() => []);
  const sel = document.getElementById('srcAssigned');
  sel.innerHTML = '<option value="">– wählen –</option>';
  let firstSellsupport = null;
  users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `${u.name}${u.role === 'sellsupport' ? ' (Sales Support)' : ''}`;
    sel.appendChild(opt);
    if (u.role === 'sellsupport' && firstSellsupport === null) firstSellsupport = u.id;
  });
  if (firstSellsupport !== null) sel.value = firstSellsupport;

  openModal('modalSourcing');
}

async function saveSourcingTask() {
  const sourcing = {
    customer:    document.getElementById('srcCustomer').value.trim(),
    supplier:    document.getElementById('srcSupplier').value.trim(),
    productType: document.getElementById('srcProductType').value.trim(),
    model:       document.getElementById('srcModel').value,
    size:        document.getElementById('srcSize').value.trim(),
    printing:    document.getElementById('srcPrinting').value.trim(),
    material:    document.getElementById('srcMaterial').value.trim(),
    varnishes:   document.getElementById('srcVarnishes').value.trim(),
    quantity:    document.getElementById('srcQuantity').value.trim(),
    targetPrice: document.getElementById('srcTargetPrice').value.trim(),
    examples:    document.getElementById('srcExamples').value.trim(),
    note:        document.getElementById('srcNote').value.trim(),
  };
  const assigned = document.getElementById('srcAssigned').value;
  const due = document.getElementById('srcDue').value;

  if (!sourcing.customer)    return showToast('Customer erforderlich', 'error');
  if (!sourcing.productType) return showToast('Product type erforderlich', 'error');
  if (!sourcing.quantity)    return showToast('Quantity for quote erforderlich', 'error');
  if (!assigned)             return showToast('Bitte Empfänger wählen', 'error');

  const title = `Sourcing: ${sourcing.customer} — ${sourcing.productType}`;
  const description = SOURCING_FIELDS
    .map(([k, label]) => sourcing[k] ? `${label}: ${sourcing[k]}` : null)
    .filter(Boolean).join('\n');

  await api.post('/tasks', {
    title, description,
    priority: 'medium',
    project: 'Sourcing',
    assigned_to: assigned,
    due_date: due || null,
    sourcing,
  });
  closeModal('modalSourcing');
  showToast('Sourcing-Anfrage gesendet!');
  loadTasks();
}

function renderSourcingDetail(s, taskId) {
  if (!s || typeof s !== 'object') return '';
  const rows = SOURCING_FIELDS
    .filter(([k]) => s[k])
    .map(([k, label]) => `
      <tr>
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--text-secondary);background:var(--bg);width:42%;border-bottom:1px solid var(--border-light)">${label}</td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid var(--border-light)">${s[k]}</td>
      </tr>`).join('');
  return `
    <div style="padding:10px 14px;background:var(--bg);font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-secondary);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span>📦 Sourcing-Anfrage</span>
      <button class="btn btn-sm btn-secondary" style="font-size:11px;padding:4px 10px" onclick="copySourcingToClipboard(${taskId})">📋 Kopieren</button>
    </div>
    <table style="width:100%;border-collapse:collapse">${rows}</table>`;
}

function _escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function copySourcingToClipboard(taskId) {
  const t = allTasks.find(x => x.id === taskId);
  const s = t?.sourcing;
  if (!s) return showToast('Keine Sourcing-Daten gefunden', 'error');

  const filled = SOURCING_FIELDS.filter(([k]) => s[k]);
  // Plain-text — column-aligned for email clients without HTML
  const labelWidth = Math.max(...filled.map(([, label]) => label.length));
  const plain = filled.map(([k, label]) => `${label.padEnd(labelWidth, ' ')}  ${s[k]}`).join('\n');

  // HTML — formatted table that looks good in Outlook/Gmail/Apple Mail
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111">
<p style="margin:0 0 8px 0;font-weight:700">📦 Sourcing-Anfrage</p>
<table style="border-collapse:collapse;border:1px solid #ccc">
${filled.map(([k, label]) => `<tr>
  <td style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f3;font-weight:600;width:200px">${_escapeHtml(label)}</td>
  <td style="border:1px solid #ccc;padding:6px 10px">${_escapeHtml(s[k])}</td>
</tr>`).join('')}
</table></div>`;

  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html':  new Blob([html],  { type: 'text/html'  }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    showToast('In Zwischenablage kopiert!');
  } catch (err) {
    console.error('[copy] failed:', err);
    showToast('Kopieren fehlgeschlagen', 'error');
  }
}

async function deleteTask(id) {
  if (!confirmDelete('Aufgabe wirklich löschen?')) return;
  await api.delete('/tasks/' + id);
  showToast('Gelöscht');
  loadTasks();
}

/* ─── Tools ─── */
async function loadTools() {
  const tools = await api.get('/tools');
  const container = document.getElementById('toolsContent');
  const icons = { folder: '📁', users: '👥', user: '👤', link: '🔗' };

  const toolCard = (t) => `
    <a href="${t.url}" target="_blank" rel="noopener noreferrer" class="tool-card">
      <div class="tool-icon">${icons[t.icon] || '🔗'}</div>
      <div class="tool-name">${t.name}</div>
      <div class="tool-desc">${t.description || ''}</div>
    </a>`;

  const isAdminUser = ['admin', 'management'].includes(currentUser.role);

  const wikiHtml = `
    <div class="card" style="margin-bottom:20px;display:flex;align-items:center;gap:16px;padding:18px 20px">
      <span style="font-size:28px">📚</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:15px">Wissensdatenbank</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">Artikel, Guides & internes Wissen</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="showPage('wiki')">Öffnen</button>
    </div>`;

  // Mockup Drive (below wiki)
  const pinnedHtml = `
    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-light);margin-bottom:10px">Mockups</div>
      <div class="tools-grid">
        <a href="https://drive.google.com/drive/folders/1MD4iEBEbQFhXAibqbnwa7G4b9DphBwVW" target="_blank" rel="noopener noreferrer" class="tool-card">
          <div class="tool-icon">📂</div>
          <div class="tool-name">Mockup Drive</div>
          <div class="tool-desc">Alle Mockups & Design-Dateien</div>
        </a>
      </div>
    </div>`;

  // Tool links
  const categories = {};
  tools.forEach(t => {
    if (!categories[t.category]) categories[t.category] = [];
    categories[t.category].push(t);
  });
  let toolsHtml = Object.entries(categories).map(([cat, items]) => `
    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-light);margin-bottom:10px">${cat}</div>
      <div class="tools-grid">${items.map(toolCard).join('')}</div>
    </div>`).join('');

  const canSeeCalllist = ['admin', 'management', 'newbusiness'].includes(currentUser.role);
  const canSeeMember   = ['admin', 'newbusiness', 'customersuccess', 'management'].includes(currentUser.role);
  const canSeeOnboarding = ['admin', 'newbusiness', 'customersuccess'].includes(currentUser.role);

  const onboardingHtml = canSeeOnboarding ? `
    <div class="card" style="margin-bottom:12px;display:flex;align-items:center;gap:16px;padding:18px 20px">
      <span style="font-size:28px">🤝</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:15px">Onboarding starten</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">Pre-Onboarding-Prozess für einen Kunden anstoßen</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="showPage('deal')">Öffnen</button>
    </div>` : '';

  const calllistHtml = canSeeCalllist ? `
    <div class="card" style="margin-bottom:12px;display:flex;align-items:center;gap:16px;padding:18px 20px">
      <span style="font-size:28px">📞</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:15px">Callliste</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">Kontaktnummern aus HubSpot-Unternehmen</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="showPage('calllist')">Öffnen</button>
    </div>` : '';

  const memberHtml = canSeeMember ? `
    <div class="card" style="margin-bottom:20px;display:flex;align-items:center;gap:16px;padding:18px 20px">
      <span style="font-size:28px">🏆</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:15px">Member</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">Kundendatenbank & Abschlüsse</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="showPage('datenbank')">Öffnen</button>
    </div>` : '';

  container.innerHTML = wikiHtml + onboardingHtml + calllistHtml + memberHtml + pinnedHtml + toolsHtml;
}

function renderWikiInTools(articles) {
  const search = (document.getElementById('wikiSearchTools')?.value || '').toLowerCase();
  const filtered = search
    ? articles.filter(a => a.title.toLowerCase().includes(search) || a.content.toLowerCase().includes(search))
    : articles;
  const el = document.getElementById('wikiInToolsContent');
  if (!el) return;
  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state" style="padding:28px"><div class="empty-icon">📚</div><p>${search ? 'Keine Treffer' : 'Noch keine Artikel — lege den ersten an!'}</p></div>`;
    return;
  }
  el.innerHTML = `<div class="wiki-tools-grid">
    ${filtered.map(a => `
      <div class="wiki-tools-card" onclick="readWikiArticle(${a.id})">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px">${a.title}</div>
        <div style="font-size:12px;color:var(--text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.5">${a.content}</div>
        <div style="font-size:11px;color:var(--text-light);margin-top:8px">${a.category || 'Allgemein'} · ${formatRelative(a.updated_at || a.created_at)}</div>
      </div>`).join('')}
  </div>`;
  wikiArticles = articles;
}

async function loadWikiInTools() {
  const articles = await api.get('/wiki');
  renderWikiInTools(articles);
  // also refresh the standalone wiki page if it was loaded
  loadWiki();
}

/* ─── Callliste ─── */
function loadCalllistPage() {
  initCalllistGrid();
  loadCalllistWeek();
}

const CL_PERSONS = [
  { id: '32099639', name: 'Ramon Herper',  initials: 'RH', bg: '#d8f0e8', cl: '#0d5c38' },
  { id: '46604320', name: 'Tim Zimmer',    initials: 'TZ', bg: '#dde8f5', cl: '#4a7ab5' },
  { id: '45653587', name: 'Leon Scheffs',  initials: 'LS', bg: '#fde8e0', cl: '#c05c3a' },
  { id: '34040626', name: 'Justus Kemper', initials: 'JK', bg: '#ede8fd', cl: '#5a3ab5' },
  { id: '30089244', name: 'Henry Salazar', initials: 'HS', bg: '#fdf5d7', cl: '#8a6a13' },
];
let calllistOwnerId = null;

function initCalllistGrid() {
  const grid = document.getElementById('calllistPersonGrid');
  if (!grid) return;
  calllistOwnerId = null;
  grid.innerHTML = CL_PERSONS.map(p => `
    <button class="lead-person-btn" onclick="calllistPickPerson('${p.id}',this)">
      <div class="avatar" style="background:${p.bg};color:${p.cl};width:36px;height:36px;font-size:12px">${p.initials}</div>
      <span class="ob-pname">${p.name.split(' ')[0]}</span>
    </button>`).join('');
}

function calllistPickPerson(id, el) {
  if (calllistOwnerId === id) {
    calllistOwnerId = null;
    el.classList.remove('sel');
    return;
  }
  calllistOwnerId = id;
  document.querySelectorAll('#calllistPersonGrid .lead-person-btn').forEach(b => b.classList.remove('sel'));
  el.classList.add('sel');
}

function calllistFormatLastContact(dateStr) {
  if (!dateStr) return '<span style="color:var(--text-light);font-size:12px">Nie angerufen</span>';
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return '<span style="color:#16a34a;font-size:12px;font-weight:600">Heute</span>';
  if (diffDays === 1) return '<span style="font-size:12px;color:var(--text-secondary)">Gestern</span>';
  if (diffDays < 7) return `<span style="font-size:12px;color:var(--text-secondary)">Vor ${diffDays} Tagen</span>`;
  if (diffDays < 30) return `<span style="font-size:12px;color:var(--text-secondary)">Vor ${Math.floor(diffDays/7)} Woche${Math.floor(diffDays/7)>1?'n':''}</span>`;
  return `<span style="font-size:12px;color:var(--warning,#d97706);font-weight:600">Vor ${Math.floor(diffDays/30)} Monat${Math.floor(diffDays/30)>1?'en':''}</span>`;
}

let _calllistEntries = [];

async function loadCalllist() {
  const limit = parseInt(document.getElementById('calllistLimit')?.value) || 20;
  const nameFilter = (document.getElementById('calllistNameFilter')?.value || '').trim();
  const status = document.getElementById('calllistStatus');
  const results = document.getElementById('calllistResults');
  const btn = document.getElementById('calllistBtn');

  if (!calllistOwnerId) {
    status.innerHTML = `<div style="color:var(--danger);padding:8px 0">⚠️ Bitte zuerst einen Salesperson auswählen.</div>`;
    return;
  }

  btn.disabled = true;
  status.innerHTML = `<div style="color:var(--text-secondary);padding:12px 0">⏳ Lädt aus HubSpot${nameFilter ? ` mit Filter „${nameFilter}"` : ''}…</div>`;
  results.innerHTML = '';
  try {
    const data = await leadApiCall('calllist', { ownerId: calllistOwnerId, limit, nameFilter });
    if (!data.entries?.length) {
      status.innerHTML = `<div style="color:var(--text-secondary);padding:12px 0">Keine Einträge${nameFilter ? ` für „${nameFilter}"` : ''} mit Telefonnummer gefunden.</div>`;
      btn.disabled = false;
      return;
    }
    _calllistEntries = data.entries;
    status.innerHTML = `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">${data.entries.length} Einträge${data.total ? ` · ${data.total} Unternehmen gefunden` : ''}${nameFilter ? ` · Filter: „${nameFilter}"` : ''} · sortiert nach letztem Kontakt</div>`;
    results.innerHTML = `
      <div class="card" style="padding:14px 14px 0">
        <input type="text" id="calllistFilter" placeholder="🔍 Suche nach Unternehmen oder Kontakt (z.B. Smash, Kaffee)…"
               oninput="renderCalllistTable(this.value)"
               style="width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;background:var(--bg);outline:none;margin-bottom:12px">
      </div>
      <div id="calllistTableHost"></div>`;
    renderCalllistTable('');
  } catch (e) {
    status.innerHTML = `<div style="color:var(--danger);padding:12px 0">❌ ${e.message}</div>`;
    results.innerHTML = `<div class="card" style="padding:16px"><button class="btn btn-primary" onclick="loadCalllist()">🔄 Erneut versuchen</button></div>`;
  }
  btn.disabled = false;
}

function renderCalllistTable(filterStr) {
  const host = document.getElementById('calllistTableHost');
  if (!host) return;
  const q = (filterStr || '').trim().toLowerCase();
  const rows = q
    ? _calllistEntries.filter(e =>
        (e.companyName || '').toLowerCase().includes(q) ||
        (e.contactName || '').toLowerCase().includes(q))
    : _calllistEntries;

  if (!rows.length) {
    host.innerHTML = `<div class="card" style="padding:24px;text-align:center;color:var(--text-secondary);font-size:13px">Keine Treffer für „${filterStr}"</div>`;
    return;
  }

  host.innerHTML = `<div class="card"><div class="calllist-table-wrap">
    <table class="data-table calllist-table">
      <thead><tr><th>Unternehmen</th><th>Kontakt</th><th>Telefon</th><th>Zuletzt angerufen</th><th></th></tr></thead>
      <tbody>${rows.map(e => {
        const entryJson = JSON.stringify({ companyId: e.companyId, companyName: e.companyName, contactName: e.contactName, phone: e.phone, hsUrl: e.hsUrl }).replace(/'/g, '&#39;');
        return `<tr>
          <td data-label="Unternehmen"><span style="font-weight:600">${e.companyName || '–'}</span></td>
          <td data-label="Kontakt" style="font-size:13px;color:var(--text-secondary)">${e.contactName || '–'}</td>
          <td data-label="Telefon"><a href="tel:${e.phone}" style="color:var(--primary);font-weight:600;font-size:14px">${e.phone}</a></td>
          <td data-label="Zuletzt angerufen">${calllistFormatLastContact(e.lastContacted)}</td>
          <td data-label="Aktionen">
            ${e.hsUrl ? `<a href="${e.hsUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" style="font-size:11px;padding:4px 10px">HubSpot ↗</a>` : ''}
            <button class="btn btn-sm btn-secondary" style="font-size:11px;padding:4px 10px" onclick='addToCalllistWeek(${entryJson})'>⭐ Wochenliste</button>
          </td>
        </tr>`;}).join('')}</tbody>
    </table></div></div>`;
}

async function loadCalllistWeek() {
  const body = document.getElementById('calllistWeekBody');
  const clearBtn = document.getElementById('calllistWeekClearBtn');
  if (!body) return;
  try {
    const data = await leadApiCall('calllist_week_get', {});
    const entries = data.entries || [];
    if (!entries.length) {
      body.innerHTML = `<div style="padding:16px;font-size:13px;color:var(--text-secondary)">Noch keine Einträge in der Wochenliste. Klicke auf ⭐ um Unternehmen hinzuzufügen.</div>`;
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }
    if (clearBtn) clearBtn.style.display = '';
    body.innerHTML = `<div class="calllist-table-wrap"><table class="data-table calllist-table">
      <thead><tr><th>Unternehmen</th><th>Kontakt</th><th>Telefon</th><th>Hinzugefügt</th><th></th></tr></thead>
      <tbody>${entries.map(e => {
        const addedDays = e.addedAt ? Math.floor((Date.now() - new Date(e.addedAt)) / 86400000) : null;
        const addedLabel = addedDays === 0 ? 'Heute' : addedDays === 1 ? 'Gestern' : addedDays != null ? `Vor ${addedDays} Tagen` : '–';
        return `<tr>
          <td data-label="Unternehmen"><span style="font-weight:600">${e.companyName || '–'}</span></td>
          <td data-label="Kontakt" style="font-size:13px;color:var(--text-secondary)">${e.contactName || '–'}</td>
          <td data-label="Telefon"><a href="tel:${e.phone}" style="color:var(--primary);font-weight:600;font-size:14px">${e.phone || '–'}</a></td>
          <td data-label="Hinzugefügt" style="font-size:12px;color:var(--text-secondary)">${addedLabel}</td>
          <td data-label="Aktionen">
            ${e.hsUrl ? `<a href="${e.hsUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" style="font-size:11px;padding:4px 10px">HubSpot ↗</a>` : ''}
            <button class="btn btn-sm btn-secondary" style="font-size:11px;padding:4px 10px;color:var(--danger)" onclick="removeFromCalllistWeek('${e.companyId}')">✕ Entfernen</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  } catch(e) {
    body.innerHTML = `<div style="padding:16px;font-size:13px;color:var(--danger)">Fehler: ${e.message}</div>`;
  }
}

async function addToCalllistWeek(entry) {
  try {
    await leadApiCall('calllist_week_save', { entry });
    loadCalllistWeek();
  } catch(e) {
    alert('Fehler: ' + e.message);
  }
}

async function removeFromCalllistWeek(companyId) {
  try {
    await leadApiCall('calllist_week_remove', { companyId });
    loadCalllistWeek();
  } catch(e) {
    alert('Fehler: ' + e.message);
  }
}

async function clearCalllistWeek() {
  if (!confirm('Wochenliste wirklich leeren?')) return;
  try {
    await leadApiCall('calllist_week_clear', {});
    loadCalllistWeek();
  } catch(e) {
    alert('Fehler: ' + e.message);
  }
}

/* ─── Deal übergeben (Onboarding Tool) ─── */
const OB_STAGE_IDS = {
  '1073833178': { preOnboarding: '1487268036', onboarding: '4793537736' },
  '250370754':  { preOnboarding: '705458930',  onboarding: '4958905581' },
};
const OB_ONBOARDING_PERSON = { id: '30089244', name: 'Henry Salazar' };
const OB_SENDERS = [
  { id: '32099639', name: 'Ramon Herper',  initials: 'RH', bg: '#d8f0e8', cl: '#0d5c38' },
  { id: '46604320', name: 'Tim Zimmer',    initials: 'TZ', bg: '#dde8f5', cl: '#4a7ab5' },
  { id: '45653587', name: 'Leon Scheffs',  initials: 'LS', bg: '#fde8e0', cl: '#c05c3a' },
];

let obDeal = null;
let obSender = null;

function initObDeal() {
  initObSenderGrid();
  initObAssignCS();
}

async function initObAssignCS() {
  const sel = document.getElementById('obAssignCS');
  if (!sel) return;
  if (sel.dataset.loaded === '1') return;
  try {
    const users = await api.get('/employees');
    const csUsers = users.filter(u => u.role === 'customersuccess');
    sel.innerHTML = '<option value="">– wählen –</option>' + csUsers.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    if (csUsers.length === 1) sel.value = String(csUsers[0].id);
    sel.dataset.loaded = '1';
    sel.onchange = () => {
      const btn = document.getElementById('obSubmitBtn');
      if (btn) btn.disabled = !(obDeal && obSender && sel.value);
    };
  } catch {}
}

function initObSenderGrid() {
  const grid = document.getElementById('obSenderGrid');
  if (!grid || grid.dataset.initialized) return;
  grid.dataset.initialized = '1';
  grid.innerHTML = OB_SENDERS.map(s => `
    <button class="ob-person-btn" data-id="${s.id}" data-name="${s.name}" onclick="obSelectSender(this)">
      <div class="avatar" style="background:${s.bg};color:${s.cl};width:38px;height:38px;font-size:12px">${s.initials}</div>
      <span class="ob-pname">${s.name.split(' ')[0]}</span>
    </button>
  `).join('');
}

async function obLoadDeal() {
  const raw = document.getElementById('dealIdInput').value.trim();
  const statusEl = document.getElementById('obIdStatus');
  const btn = document.getElementById('obLoadBtn');
  const match = raw.match(/(\d{6,})/);
  const id = match ? match[1] : null;
  if (!id) { statusEl.textContent = '❌ Keine gültige ID gefunden'; return; }

  statusEl.innerHTML = `Lade Deal ${id}… <span style="display:inline-block;width:10px;height:10px;border:2px solid #ddd;border-top-color:var(--tbc-blue);border-radius:50%;animation:spin360 .8s linear infinite;vertical-align:middle"></span>`;
  btn.disabled = true;
  try {
    const data = await obApiCall('getDealById', { dealId: id });
    if (!data.id) throw new Error('Deal nicht gefunden');
    statusEl.textContent = '';
    btn.disabled = false;
    obSelectDeal(data);
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--danger)">❌ ${e.message}</span>`;
    btn.disabled = false;
  }
}

function obSelectDeal(d) {
  obDeal = d;
  document.getElementById('dealInputView').style.display = 'none';
  document.getElementById('dealSelectedView').style.display = 'block';
  document.getElementById('obDealName').textContent = d.name;
  document.getElementById('obDealSub').textContent = `${d.company || '—'} · ${d.pipeline}`;
  ['obSenderCard','obOwnerCard','obBriefingCard'].forEach(id => document.getElementById(id).style.display = 'block');
  obCheckSubmit();
}

function obClearDeal() {
  obDeal = null; obSender = null;
  document.getElementById('dealInputView').style.display = 'block';
  document.getElementById('dealSelectedView').style.display = 'none';
  document.getElementById('dealIdInput').value = '';
  document.getElementById('obIdStatus').textContent = '';
  ['obSenderCard','obOwnerCard','obBriefingCard'].forEach(id => document.getElementById(id).style.display = 'none');
  document.querySelectorAll('.ob-person-btn').forEach(b => b.classList.remove('sel'));
  obCheckSubmit();
}

function obSelectSender(el) {
  document.querySelectorAll('.ob-person-btn').forEach(b => b.classList.remove('sel'));
  el.classList.add('sel');
  obSender = { id: el.dataset.id, name: el.dataset.name };
  obCheckSubmit();
}

function obCheckSubmit() {
  const csSel = document.getElementById('obAssignCS');
  const csOk = csSel ? !!csSel.value : true;
  document.getElementById('obSubmitBtn').disabled = !(obDeal && obSender && csOk);
}

function obBuildNote() {
  const get = id => document.getElementById(id).value.trim() || '—';
  return [
    '📋 ONBOARDING BRIEFING', '',
    'Trigger / Dringlichkeit', '* ' + get('ob_trigger'), '',
    'Warum kaufen Sie jetzt?', '* ' + get('ob_why'), '',
    'Erwartungen & Risiken', '* ' + get('ob_expectations'), '',
    'Besondere Wünsche', '* ' + get('ob_special'), '',
    'Wachstumspotenzial', '* ' + get('ob_growth'), '',
    'Kommunizierte Lieferzeit', '* ' + get('ob_delivery'), '',
    '---',
    'Onboarding-Verantwortliche/r: @' + OB_ONBOARDING_PERSON.name.replace(/\s+/g,''),
    'NB Credits: ' + obSender.name,
  ].join('\n');
}

async function obRun() {
  const btn = document.getElementById('obSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Läuft…';
  const logCard = document.getElementById('obLogCard');
  const logInner = document.getElementById('obLogInner');
  logCard.style.display = 'block';
  logInner.innerHTML = '';
  document.getElementById('obSuccessCard').style.display = 'none';

  const stages = OB_STAGE_IDS[obDeal.pipelineId] || OB_STAGE_IDS['1073833178'];
  const note = obBuildNote();

  const steps = [
    { key: 'pre',   label: 'Deal → Pre-Onboarding' },
    { key: 'note',  label: 'Briefing-Notiz am Deal erstellen' },
    { key: 'nb',    label: `NB Credits → ${obSender.name}` },
    { key: 'owner', label: `Owner → ${OB_ONBOARDING_PERSON.name}` },
    { key: 'done',  label: 'Deal → Onboarding' },
  ];

  for (const s of steps) {
    const row = obAddLog(s.label, 'pending');
    try {
      if (s.key === 'pre')   await obApiCall('updateDealStage', { dealId: obDeal.id, stage: stages.preOnboarding });
      if (s.key === 'note')  await obApiCall('createNote', { dealId: obDeal.id, companyId: obDeal.companyId, body: note, ownerId: obSender.id });
      if (s.key === 'nb')    await obApiCall('setNbCredits', { companyId: obDeal.companyId, ownerId: obSender.id });
      if (s.key === 'owner') await obApiCall('updateOwner', { dealId: obDeal.id, companyId: obDeal.companyId, ownerId: OB_ONBOARDING_PERSON.id });
      if (s.key === 'done')  await obApiCall('updateDealStage', { dealId: obDeal.id, stage: stages.onboarding });
      obSetLog(row, 'ok', s.label);
    } catch (e) {
      obSetLog(row, 'err', s.label + ' — ' + (e.message || 'Fehler'));
      btn.disabled = false;
      btn.textContent = 'Erneut versuchen';
      return;
    }
  }

  document.getElementById('obSuccessCard').style.display = 'block';
  document.getElementById('obSuccessText').innerHTML =
    `<strong>${obDeal.name}</strong> übergeben · NB Credits: <strong>${obSender.name}</strong>`;
  btn.textContent = 'Weiteren Deal starten';
  btn.onclick = () => obResetAll();
  btn.disabled = false;

  // Mark kunde as übergeben — backend auto-creates the CS handover task + push notify
  if (obPendingKundeId) {
    const pendingId = obPendingKundeId;
    obPendingKundeId = null;
    obPendingKundeFirma = null;
    const assignedCsId = parseInt(document.getElementById('obAssignCS')?.value) || null;
    // Phase 'design' triggers auto status='übergeben', push-notify, and Onboarding-task on the backend
    api.patch('/kunden/' + pendingId + '/status', {
      onboarding_phase: 'design',
      assigned_cs_user_id: assignedCsId,
    }).catch(() => {});
  }
}

function obAddLog(label, type) {
  const el = document.createElement('div');
  el.className = `ob-log-row ${type}`;
  el.innerHTML = `<span class="ob-log-icon"></span><span>${label}</span>`;
  document.getElementById('obLogInner').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  return el;
}
function obSetLog(el, type, label) {
  el.className = `ob-log-row ${type} show`;
  el.querySelector('span:last-child').textContent = label;
}

function obResetAll() {
  obPendingKundeId = null;
  obPendingKundeFirma = null;
  obClearDeal();
  ['ob_trigger','ob_why','ob_expectations','ob_special','ob_growth','ob_delivery'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('obLogCard').style.display = 'none';
  document.getElementById('obLogInner').innerHTML = '';
  document.getElementById('obSuccessCard').style.display = 'none';
  const btn = document.getElementById('obSubmitBtn');
  btn.textContent = 'Onboarding starten';
  btn.onclick = obRun;
  btn.disabled = true;
}

async function obApiCall(action, payload) {
  const res = await fetch('/api/onboarding-hs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('tbc_token')}` },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
}

/* ─── Insta Lead Tool ─── */
function loadLeads() {
  initLeadPersonGrid();
  initLeadUpload();
}

function initLeadPersonGrid() {
  const grid = document.getElementById('leadPersonGrid');
  if (!grid || grid.dataset.initialized) return;
  grid.dataset.initialized = '1';
  grid.innerHTML = LEAD_SALESPEOPLE.map((p, i) => {
    const col = LEAD_AV_COLORS[i % LEAD_AV_COLORS.length];
    const ini = (p.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase());
    return `<div class="lead-person-btn" onclick="leadPickPerson('${p.name}',${p.id},this)">
      <div class="lead-person-avatar" style="background:${col.bg};color:${col.cl}">${ini}</div>
      <div class="lead-person-name">${p.name.split(' ')[0]}</div>
    </div>`;
  }).join('');
}

function initLeadUpload() {
  const fileEl = document.getElementById('leadFile');
  const uploadEl = document.getElementById('leadUpload');
  if (!fileEl || fileEl.dataset.initialized) return;
  fileEl.dataset.initialized = '1';

  uploadEl.addEventListener('dragover', e => { e.preventDefault(); uploadEl.style.borderColor='var(--tbc-blue)'; });
  uploadEl.addEventListener('dragleave', () => { uploadEl.style.borderColor=''; });
  uploadEl.addEventListener('drop', e => { e.preventDefault(); uploadEl.style.borderColor=''; if(e.dataTransfer.files[0]) leadProcessFile(e.dataTransfer.files[0]); });
  fileEl.addEventListener('change', () => { if(fileEl.files[0]) leadProcessFile(fileEl.files[0]); });
}

function leadCompressToBase64(img) {
  // iOS Safari ignores the quality param in toDataURL, so we MUST control size via dimensions.
  // Loop over progressively smaller canvas sizes until base64 fits under 180KB.
  const MAX_B64 = 180000;
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;
  const dims = [700, 550, 420, 320, 240, 180];
  for (const maxDim of dims) {
    let w = origW, h = origH;
    if (w > maxDim || h > maxDim) {
      if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
      else { w = Math.round(w * maxDim / h); h = maxDim; }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    for (let q = 0.8; q >= 0.3; q -= 0.15) {
      const b64 = c.toDataURL('image/jpeg', q).split(',')[1];
      if (b64 && b64.length <= MAX_B64) return b64;
    }
  }
  // Absolute fallback: 160px
  const cf = document.createElement('canvas');
  cf.width = 160; cf.height = Math.round(160 * origH / Math.max(origW, 1));
  cf.getContext('2d').drawImage(img, 0, 0, cf.width, cf.height);
  return cf.toDataURL('image/jpeg', 0.4).split(',')[1];
}

function leadProcessFile(file) {
  document.getElementById('leadConverting').style.display = 'block';
  document.getElementById('leadUpload').style.display = 'none';
  const previewUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    try {
      const base64 = leadCompressToBase64(img);
      if (base64 && base64.length > 100) { leadSetImg(base64, 'image/jpeg', previewUrl); return; }
    } catch {}
    // Fallback: FileReader → compress again
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const img2 = new Image();
        img2.onload = () => {
          try { leadSetImg(leadCompressToBase64(img2), 'image/jpeg', previewUrl); }
          catch { leadSetImg(e.target.result.split(',')[1], file.type || 'image/jpeg', previewUrl); }
        };
        img2.onerror = () => leadSetImg(e.target.result.split(',')[1], file.type || 'image/jpeg', previewUrl);
        img2.src = e.target.result;
      } catch { leadSetImg(e.target.result.split(',')[1], file.type || 'image/jpeg', previewUrl); }
    };
    reader.readAsDataURL(file);
  };
  img.onerror = () => {
    const reader = new FileReader();
    reader.onload = e => { leadSetImg(e.target.result.split(',')[1], file.type || 'image/jpeg', previewUrl); };
    reader.readAsDataURL(file);
  };
  img.src = previewUrl;
}

function leadSetImg(base64, mime, previewUrl) {
  leadImgData = { base64, mime };
  document.getElementById('leadPreviewImg').src = previewUrl;
  document.getElementById('leadPreview').style.display = 'block';
  document.getElementById('leadConverting').style.display = 'none';
  document.getElementById('leadUpload').style.display = 'none';
  leadCheckReady();
}

function leadClearImg() {
  leadImgData = null;
  document.getElementById('leadPreview').style.display = 'none';
  document.getElementById('leadUpload').style.display = 'block';
  document.getElementById('leadFile').value = '';
  leadCheckReady();
}

function leadPickPerson(name, id, el) {
  leadPerson = name; leadOwnerId = id;
  document.querySelectorAll('.lead-person-btn').forEach(b => b.classList.remove('sel'));
  el.classList.add('sel');
  const ol = document.getElementById('leadOwnerLabel');
  if (ol) ol.textContent = name;
  leadCheckReady();
  leadUpdateReassignBtn();
}

function leadSwitchTab(t) {
  leadMode = t;
  document.getElementById('ltab-scan').classList.toggle('active', t==='scan');
  document.getElementById('ltab-insta').classList.toggle('active', t==='insta');
  document.getElementById('lpane-scan').style.display = t==='scan' ? 'block' : 'none';
  document.getElementById('lpane-insta').style.display = t==='insta' ? 'block' : 'none';
  leadCheckReady();
}

let _instaSearchTimer = null;

function leadOnInstaInput() {
  const val = document.getElementById('leadInstaInput').value.trim();
  leadInstaConfirmed = false;
  document.getElementById('leadInstaPreview').style.display = 'none';
  document.getElementById('leadInstaSuggestions').style.display = 'none';
  leadCheckReady();

  clearTimeout(_instaSearchTimer);
  if (val.length < 2) {
    document.getElementById('leadInstaStatus').textContent = '';
    return;
  }
  document.getElementById('leadInstaStatus').textContent = '⏳ Suche…';
  _instaSearchTimer = setTimeout(() => leadSearchInsta(val), 400);
}

function leadInstaKeydown(e) {
  const box = document.getElementById('leadInstaSuggestions');
  const items = box.querySelectorAll('.insta-suggest-item');
  const active = box.querySelector('.insta-suggest-item.hover');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = active ? (active.nextElementSibling || items[0]) : items[0];
    if (active) active.classList.remove('hover');
    if (next) next.classList.add('hover');
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = active ? (active.previousElementSibling || items[items.length - 1]) : items[items.length - 1];
    if (active) active.classList.remove('hover');
    if (prev) prev.classList.add('hover');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (active) { active.click(); return; }
    const val = document.getElementById('leadInstaInput').value.trim().replace(/^@/, '');
    if (val) leadFetchProfile(val);
  } else if (e.key === 'Escape') {
    box.style.display = 'none';
  }
}

async function leadSearchInsta(query) {
  try {
    const data = await leadApiCall('instaSearch', { query });
    document.getElementById('leadInstaStatus').textContent = '';
    leadRenderSuggestions(data.users || []);
  } catch {
    document.getElementById('leadInstaStatus').textContent = '';
  }
}

function leadRenderSuggestions(users) {
  const box = document.getElementById('leadInstaSuggestions');
  if (!users.length) { box.style.display = 'none'; return; }

  box.innerHTML = users.map((u, i) => `
    <div class="insta-suggest-item" onclick="leadSelectSuggestion('${u.username.replace(/'/g,"\\'")}')">
      <div class="insta-suggest-avatar">
        ${u.avatar ? `<img src="${u.avatar}" onerror="this.style.display='none'" style="width:36px;height:36px;border-radius:50%;object-fit:cover">` : '<span style="font-size:20px">👤</span>'}
      </div>
      <div style="min-width:0">
        <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:4px">
          ${u.name}${u.verified ? ' <span style="color:#3B82F6;font-size:11px">✓</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--text-secondary)">@${u.username}${u.followers ? ' · ' + u.followers + ' Follower' : ''}</div>
      </div>
    </div>`).join('');
  box.style.display = 'block';
}

async function leadSelectSuggestion(username) {
  document.getElementById('leadInstaSuggestions').style.display = 'none';
  document.getElementById('leadInstaInput').value = '@' + username;
  await leadFetchProfile(username);
}

async function leadFetchProfile(username) {
  username = (username || document.getElementById('leadInstaInput').value.trim()).replace(/^@/, '');
  if (!username) return;
  leadInstaUsername = username;
  leadInstaConfirmed = false;
  document.getElementById('leadInstaStatus').textContent = '⏳ Profil wird geladen…';
  document.getElementById('leadInstaPreview').style.display = 'none';

  try {
    const data = await leadApiCall('instaProfile', { username });
    document.getElementById('leadInstaStatus').textContent = '';
    leadRenderInstaCard(data, username);
  } catch (e) {
    document.getElementById('leadInstaStatus').textContent = '⚠️ Profil nicht gefunden – Username prüfen';
  }
}

function leadRenderInstaCard(data, username) {
  const card = document.getElementById('leadInstaCard');
  const followers = data.followers ? `${data.followers} Follower` : '';
  const stats = followers ? `<div class="lead-insta-stats">${followers}${data.posts ? ' · ' + data.posts + ' Beiträge' : ''}</div>` : '';
  const bio = data.bio ? `<div class="lead-insta-stats">${data.bio.substring(0,60)}${data.bio.length>60?'…':''}</div>` : '';
  const avatar = data.avatar
    ? `<div class="lead-insta-avatar"><img src="${data.avatar}" onerror="this.parentElement.innerHTML='📸'" style="width:48px;height:48px;border-radius:50%;object-fit:cover"></div>`
    : `<div class="lead-insta-avatar">📸</div>`;

  card.innerHTML = avatar + `<div>
    <div class="lead-insta-name">${data.name || username}</div>
    <div class="lead-insta-user">@${username}</div>
    ${stats}${bio}
    <div class="lead-insta-confirm">✓ Ausgewählt</div>
  </div>`;
  card.className = 'lead-insta-card';
  card.onclick = () => {
    leadInstaConfirmed = true;
    card.classList.add('confirmed');
    leadDetectedInstagram = username;
    leadDetectedWebsite = data.website || null;
    leadCheckReady();
  };
  document.getElementById('leadInstaPreview').style.display = 'block';
}

function leadCheckReady() {
  const btn = document.getElementById('leadGoBtn');
  if (!btn) return;
  if (leadMode === 'scan') {
    btn.disabled = !(leadImgData && leadPerson);
  } else {
    btn.disabled = !(leadInstaConfirmed && leadPerson);
  }
}

function leadSetStatus(msg, type) {
  const el = document.getElementById('leadStatus');
  el.style.display = 'block';
  el.className = `lead-status lead-status-${type}`;
  el.innerHTML = msg;
}
function leadHideStatus() { const el = document.getElementById('leadStatus'); if(el) el.style.display='none'; }

function leadShowCard(id) {
  ['leadExistsCard','leadNewCard','leadDoneCard'].forEach(c => { const el = document.getElementById(c); if(el) el.style.display='none'; });
  if (id) { const el = document.getElementById(id); if(el) el.style.display='block'; }
}

async function leadApiCall(action, payload) {
  const bodyStr = JSON.stringify({ action, payload });
  // Guard: if base64 is still somehow huge, fail early with a readable message
  if (bodyStr.length > 800000) {
    throw new Error('Bild konnte nicht klein genug komprimiert werden – bitte Screenshot zuschneiden und erneut versuchen');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('tbc_token')}` },
      body: bodyStr,
      signal: ctrl.signal
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'AbortError') {
      throw new Error('HubSpot antwortet nicht (>30s) – bitte erneut versuchen');
    }
    throw new Error('Netzwerkfehler – bitte Verbindung prüfen und erneut versuchen');
  } finally {
    clearTimeout(timer);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    // Server returned non-JSON (e.g. nginx 413 page) – body was too large
    throw new Error('Bild zu groß für den Server – bitte kleineren Screenshot verwenden (413)');
  }
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
}

const DOTS = '<span class="lead-dots"><span></span><span></span><span></span></span>';

async function leadRun() {
  leadShowCard(null);
  document.getElementById('leadGoBtn').disabled = true;

  if (leadMode === 'insta') {
    leadSetStatus(`${DOTS} Suche "@${leadInstaUsername}" in HubSpot…`, 'loading');
    leadDoHubSpotSearch(leadInstaUsername);
    return;
  }

  leadSetStatus(`${DOTS} Bild wird analysiert…`, 'loading');
  try {
    const r = await leadApiCall('analyze', { imageBase64: leadImgData.base64, imageMime: leadImgData.mime });
    const name = (r.name || '').trim();
    const BLOCKED = ['apetitomenu','lieferando','speisekarte','linktr.ee','rausgegangen','yelp','tripadvisor','google','facebook','instagram','thefork','opentable'];
    leadDetectedWebsite = r.website && !BLOCKED.some(d => r.website.includes(d)) ? r.website : null;
    leadDetectedInstagram = r.instagram || null;

    if (!name || name.toUpperCase() === 'UNBEKANNT') {
      leadSetStatus('⚠️ Kein Unternehmensname erkannt. Anderen Screenshot versuchen.', 'warning');
      document.getElementById('leadGoBtn').disabled = false;
      return;
    }
    leadSetStatus(`${DOTS} "${name}" erkannt – HubSpot wird geprüft…`, 'loading');
    leadDoHubSpotSearch(name);
  } catch (e) {
    leadSetStatus('❌ ' + e.message, 'error');
    document.getElementById('leadGoBtn').disabled = false;
  }
}

function ownerLabel(ownerId) {
  if (!ownerId) return '<span style="color:var(--text-light)">kein Owner</span>';
  const p = CL_PERSONS.find(x => x.id === String(ownerId));
  if (p) return `<span style="display:inline-flex;align-items:center;gap:5px"><span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:${p.bg};color:${p.cl};font-size:9px;font-weight:800">${p.initials}</span>${p.name}</span>`;
  return `<span style="color:var(--text-secondary)">Owner #${ownerId}</span>`;
}

async function leadDoHubSpotSearch(name) {
  try {
    const hs = await leadApiCall('search', { query: name, website: leadDetectedWebsite, instagram: leadDetectedInstagram });
    leadHideStatus();

    if (hs.total > 0) {
      document.getElementById('leadExistsContent').innerHTML = hs.results.map(c => {
        const hsUrl = 'https://app.hubspot.com/contacts/143445032/record/0-2/' + c.id;
        const city = c.properties.city || '';
        const domain = c.properties.domain || '';
        const meta = [city, domain].filter(Boolean).join(' · ');
        const ownerHtml = ownerLabel(c.properties.hubspot_owner_id);
        return `<div class="lead-match-item" id="lmatch-${c.id}" onclick="leadSelectMatch('${c.id}','${(c.properties.name||'').replace(/'/g,"\\'")}',this)">
          <div class="mi-name">${c.properties.name || '—'}</div>
          <div class="mi-meta">${meta}</div>
          <div class="mi-owner" style="font-size:12px;margin-top:4px;display:flex;align-items:center;gap:6px"><span style="color:var(--text-light);font-weight:600">Owner:</span> ${ownerHtml}</div>
          <a class="mi-link" href="${hsUrl}" target="_blank" onclick="event.stopPropagation()">HubSpot öffnen →</a>
        </div>`;
      }).join('');
      leadExistingCompanyId = hs.results[0].id;
      leadExistingCompanyName = hs.results[0].properties.name;
      document.getElementById('lmatch-' + hs.results[0].id)?.classList.add('sel');
      document.getElementById('leadReassignStatus').innerHTML = '';
      leadUpdateReassignBtn();
      leadShowCard('leadExistsCard');
    } else {
      const displayName = leadDetectedInstagram || name;
      document.getElementById('leadNameInput').value = displayName;
      const wsRow = document.getElementById('leadWebsiteRow');
      const wsInput = document.getElementById('leadWebsiteInput');
      if (leadDetectedWebsite) { wsInput.value = leadDetectedWebsite; wsRow.style.display = 'block'; }
      else { wsInput.value = ''; wsRow.style.display = 'none'; }
      leadShowCard('leadNewCard');
    }
  } catch (e) {
    leadSetStatus('❌ ' + e.message, 'error');
    document.getElementById('leadGoBtn').disabled = false;
  }
}

function leadSelectMatch(companyId, companyName, el) {
  document.querySelectorAll('.lead-match-item').forEach(b => b.classList.remove('sel'));
  el.classList.add('sel');
  leadExistingCompanyId = companyId;
  leadExistingCompanyName = companyName;
  leadUpdateReassignBtn();
}

function leadUpdateReassignBtn() {
  const btn = document.getElementById('leadReassignBtn');
  if (!btn) return;
  if (leadExistingCompanyId && leadPerson) {
    btn.style.display = 'flex';
    btn.textContent = 'Owner auf ' + leadPerson + ' umschreiben';
  } else {
    btn.style.display = 'none';
  }
}

async function leadDoReassign() {
  const btn = document.getElementById('leadReassignBtn');
  const rs = document.getElementById('leadReassignStatus');
  btn.disabled = true;
  rs.innerHTML = `<div class="lead-status lead-status-loading">${DOTS} Wird umgeschrieben auf ${leadPerson}…</div>`;
  try {
    const r = await leadApiCall('updateOwner', { companyId: leadExistingCompanyId, ownerId: leadOwnerId });
    const dealsMsg = r.dealsUpdated > 0 ? ` + ${r.dealsUpdated} Deal(s) umgeschrieben.` : '';
    rs.innerHTML = `<div class="lead-status lead-status-success">✅ Owner auf <strong>${leadPerson}</strong> geändert.${dealsMsg} <a href="https://app.hubspot.com/contacts/143445032/record/0-2/${leadExistingCompanyId}" target="_blank" style="color:var(--success)">HubSpot öffnen →</a></div>`;
    btn.style.display = 'none';
  } catch (e) {
    rs.innerHTML = `<div class="lead-status lead-status-error">❌ ${e.message}</div>`;
    btn.disabled = false;
  }
}

function leadForceCreate() {
  const displayName = leadDetectedInstagram || leadExistingCompanyName || '';
  document.getElementById('leadNameInput').value = displayName;
  const wsRow = document.getElementById('leadWebsiteRow');
  const wsInput = document.getElementById('leadWebsiteInput');
  if (leadDetectedWebsite) { wsInput.value = leadDetectedWebsite; wsRow.style.display = 'block'; }
  else { wsInput.value = ''; wsRow.style.display = 'none'; }
  leadShowCard('leadNewCard');
}

async function leadCreate() {
  const name = document.getElementById('leadNameInput').value.trim();
  if (!name) return;
  const createBtn = document.getElementById('leadCreateBtn');
  createBtn.disabled = true;
  leadSetStatus(`${DOTS} Wird angelegt…`, 'loading');
  const website = document.getElementById('leadWebsiteInput').value.trim() || null;

  try {
    const company = await leadApiCall('createCompany', { name, ownerId: leadOwnerId, website, instagram: leadDetectedInstagram, description: 'Lead via Instagram. Salesperson: ' + leadPerson });
    const deal = await leadApiCall('createDeal', { companyName: name, companyId: company.id, ownerId: leadOwnerId });
    leadHideStatus();
    leadShowCard('leadDoneCard');
    createBtn.disabled = false;
    document.getElementById('leadDoneContent').innerHTML =
      `✅ <strong>${name}</strong> angelegt. <a href="https://app.hubspot.com/contacts/143445032/record/0-3/${deal.id}" target="_blank" style="color:var(--success)">Deal öffnen →</a>`;
  } catch (e) {
    leadSetStatus('❌ ' + e.message, 'error');
    createBtn.disabled = false;
  }
}

function leadReset() {
  leadClearImg();
  leadPerson = null; leadOwnerId = null; leadDetectedWebsite = null; leadDetectedInstagram = null;
  leadExistingCompanyId = null; leadExistingCompanyName = null;
  leadInstaUsername = ''; leadInstaConfirmed = false;
  document.querySelectorAll('.lead-person-btn').forEach(b => b.classList.remove('sel'));
  const ol = document.getElementById('leadOwnerLabel');
  if (ol) ol.textContent = '—';
  const ii = document.getElementById('leadInstaInput');
  if (ii) ii.value = '';
  const sug = document.getElementById('leadInstaSuggestions');
  if (sug) sug.style.display = 'none';
  const ip = document.getElementById('leadInstaPreview');
  if (ip) ip.style.display = 'none';
  const is = document.getElementById('leadInstaStatus');
  if (is) is.textContent = '';
  const rb = document.getElementById('leadReassignBtn');
  if (rb) { rb.style.display = 'none'; rb.disabled = false; }
  const rs = document.getElementById('leadReassignStatus');
  if (rs) rs.innerHTML = '';
  leadHideStatus();
  leadShowCard(null);
  leadCheckReady();
}

/* ─── Helpers ─── */
async function fillAssignedSelect(selectId, selectedId = null) {
  if (!allEmployees.length) allEmployees = await api.get('/employees');
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">– niemanden –</option>' +
    allEmployees.map(e => `<option value="${e.id}" ${e.id === selectedId ? 'selected' : ''}>${e.name}</option>`).join('');
}
