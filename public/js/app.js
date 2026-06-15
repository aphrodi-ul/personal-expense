'use strict';

(function () {
  if (!API.token()) { window.location.href = 'login.html'; return; }

  const el = (id) => document.getElementById(id);
  const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const localDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

  // ---- State ----
  let categories = [];
  let expenses = [];
  let editingId = null;
  let formType = 'expense';
  let sort = { key: 'date', dir: 'desc' };
  let catChart = null, trendChart = null;
  let searchTimer = null;

  // ============== THEME ==============
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    el('themeToggle').textContent = t === 'dark' ? '☀️' : '🌙';
  }
  applyTheme(localStorage.getItem('theme') || 'light');
  el('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
    // Re-render charts so their colors match the theme.
    refreshDashboard();
  });

  // ============== NAVIGATION ==============
  el('tabsnav').addEventListener('click', (e) => {
    const btn = e.target.closest('.navtab');
    if (!btn) return;
    document.querySelectorAll('.navtab').forEach((t) => t.classList.toggle('active', t === btn));
    const view = btn.dataset.view;
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + view; });
    if (view === 'budgets') loadBudgetsView();
    if (view === 'recurring') loadRecurring();
    if (view === 'categories') renderCategoryChips();
  });

  // ============== CATEGORIES ==============
  async function loadCategories() {
    categories = await API.get('/api/categories');
    populateCategorySelects();
  }
  function fillSelect(select, opts, { keep = true, allOption = null } = {}) {
    const prev = select.value;
    select.innerHTML = '';
    if (allOption) select.add(new Option(allOption, 'All'));
    for (const name of opts) select.add(new Option(name, name));
    if (keep && [...select.options].some((o) => o.value === prev)) select.value = prev;
  }
  function populateCategorySelects() {
    const names = categories.map((c) => c.name);
    fillSelect(el('category'), names);
    fillSelect(el('filterCategory'), names, { allOption: 'All categories' });
    fillSelect(el('budgetCategory'), names);
    fillSelect(el('recCategory'), names);
  }

  function renderCategoryChips() {
    const box = el('categoryList');
    box.innerHTML = '';
    for (const c of categories) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `<span>${escapeHtml(c.name)}</span><button data-del-cat="${c.id}" title="Delete">×</button>`;
      box.appendChild(chip);
    }
  }
  el('categoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('categoryName').value.trim();
    const err = el('categoryError'); err.hidden = true;
    try {
      await API.post('/api/categories', { name });
      el('categoryName').value = '';
      await loadCategories();
      renderCategoryChips();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  el('categoryList').addEventListener('click', async (e) => {
    const id = e.target.getAttribute('data-del-cat');
    if (!id) return;
    if (!confirm('Delete this category? Existing transactions keep their label.')) return;
    await API.del('/api/categories/' + id);
    await loadCategories();
    renderCategoryChips();
  });

  // ============== FILTERS ==============
  function filterParams() {
    const p = new URLSearchParams();
    const cat = el('filterCategory').value;
    const type = el('filterType').value;
    const q = el('searchBox').value.trim();
    if (cat && cat !== 'All') p.set('category', cat);
    if (type && type !== 'All') p.set('type', type);
    if (q) p.set('q', q);

    const range = el('filterRange').value;
    const now = new Date();
    if (range === 'month') {
      p.set('from', localDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      p.set('to', localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    } else if (range === '30') {
      const from = new Date(now); from.setDate(from.getDate() - 29);
      p.set('from', localDate(from)); p.set('to', localDate(now));
    } else if (range === 'year') {
      p.set('from', now.getFullYear() + '-01-01');
      p.set('to', now.getFullYear() + '-12-31');
    } else if (range === 'custom') {
      if (el('fromDate').value) p.set('from', el('fromDate').value);
      if (el('toDate').value) p.set('to', el('toDate').value);
    }
    return p;
  }

  el('filterRange').addEventListener('change', () => {
    const custom = el('filterRange').value === 'custom';
    el('fromDate').hidden = !custom;
    el('toDate').hidden = !custom;
    if (!custom) refreshDashboard();
  });
  el('fromDate').addEventListener('change', refreshDashboard);
  el('toDate').addEventListener('change', refreshDashboard);
  el('filterType').addEventListener('change', refreshDashboard);
  el('filterCategory').addEventListener('change', refreshDashboard);
  el('searchBox').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshDashboard, 250);
  });

  // ============== TABLE ==============
  function sortExpenses() {
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    expenses.sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === 'amount') { av = Number(av); bv = Number(bv); }
      else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return (a.id - b.id) * mul;
    });
  }
  function renderTable() {
    sortExpenses();
    const rows = el('expenseRows');
    rows.innerHTML = '';
    el('tableEmpty').hidden = expenses.length > 0;

    for (const e of expenses) {
      const tr = document.createElement('tr');
      const isIncome = e.type === 'income';
      const amount = (isIncome ? '+' : '') + money(e.amount);
      const receipt = e.has_receipt
        ? `<a class="receipt-link" data-receipt="${e.id}" title="View receipt">🧾</a> `
        : '';
      tr.innerHTML = `
        <td>${escapeHtml(e.date)}</td>
        <td><span class="${isIncome ? 'tag-income' : 'tag-expense'}">${isIncome ? 'Income' : 'Expense'}</span></td>
        <td><span class="badge">${escapeHtml(e.category)}</span></td>
        <td>${receipt}${escapeHtml(e.description) || '<span class="muted">—</span>'}</td>
        <td class="num ${isIncome ? 'amt-income' : ''}">${amount}</td>
        <td class="actions-col"><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${e.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del="${e.id}">Delete</button>
        </div></td>`;
      rows.appendChild(tr);
    }

    const net = expenses.reduce((s, e) => s + (e.type === 'income' ? 1 : -1) * Number(e.amount), 0);
    el('filteredTotal').textContent = (net < 0 ? '-' : '') + money(Math.abs(net));

    document.querySelectorAll('th.sortable').forEach((th) => {
      const active = th.dataset.sort === sort.key;
      th.classList.toggle('sorted', active);
      th.classList.toggle('asc', active && sort.dir === 'asc');
    });
  }

  document.querySelector('#expenseTable thead').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.sort;
    if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    else { sort.key = key; sort.dir = key === 'amount' || key === 'date' ? 'desc' : 'asc'; }
    renderTable();
  });

  el('expenseRows').addEventListener('click', async (e) => {
    const editId = e.target.getAttribute('data-edit');
    const delId = e.target.getAttribute('data-del');
    const receiptId = e.target.getAttribute('data-receipt');
    if (editId) {
      const full = await API.get('/api/expenses/' + editId);
      startEdit(full);
    } else if (delId) {
      if (!confirm('Delete this transaction?')) return;
      try { await API.del('/api/expenses/' + delId); if (String(editingId) === delId) resetForm(); await refreshDashboard(); }
      catch (ex) { alert(ex.message); }
    } else if (receiptId) {
      const full = await API.get('/api/expenses/' + receiptId);
      if (full.receipt) { el('lightboxImg').src = full.receipt; el('lightbox').hidden = false; }
    }
  });
  el('lightbox').addEventListener('click', () => { el('lightbox').hidden = true; el('lightboxImg').src = ''; });

  // ============== FORM (add/edit) ==============
  el('typeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn'); if (!btn) return;
    formType = btn.dataset.type;
    document.querySelectorAll('#typeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
  });

  el('receipt').addEventListener('change', () => {
    const file = el('receipt').files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showFormError('Receipt image must be under 2MB.'); el('receipt').value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => { el('receiptData').value = reader.result; showReceiptPreview(reader.result); };
    reader.readAsDataURL(file);
  });
  el('receiptClear').addEventListener('click', () => {
    el('receiptData').value = ''; el('receipt').value = ''; el('receiptPreview').hidden = true; el('receiptThumb').src = '';
  });
  function showReceiptPreview(src) { el('receiptThumb').src = src; el('receiptPreview').hidden = false; }

  function setType(t) {
    formType = t;
    document.querySelectorAll('#typeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === t));
  }
  function showFormError(msg) { const x = el('formError'); x.textContent = msg; x.hidden = false; }
  function resetForm() {
    editingId = null;
    el('expenseForm').reset();
    el('expenseId').value = '';
    el('receiptData').value = '';
    el('receiptPreview').hidden = true; el('receiptThumb').src = '';
    el('date').value = localDate(new Date());
    setType('expense');
    el('formTitle').textContent = 'Add transaction';
    el('saveBtn').textContent = 'Add transaction';
    el('cancelEditBtn').hidden = true;
    el('formError').hidden = true;
  }
  function startEdit(x) {
    editingId = x.id;
    el('expenseId').value = x.id;
    el('amount').value = x.amount;
    if (![...el('category').options].some((o) => o.value === x.category)) el('category').add(new Option(x.category, x.category));
    el('category').value = x.category;
    el('date').value = x.date;
    el('description').value = x.description || '';
    setType(x.type || 'expense');
    el('receiptData').value = x.receipt || '';
    if (x.receipt) showReceiptPreview(x.receipt); else { el('receiptPreview').hidden = true; }
    el('formTitle').textContent = 'Edit transaction';
    el('saveBtn').textContent = 'Save changes';
    el('cancelEditBtn').hidden = false;
    el('formError').hidden = true;
    document.querySelectorAll('.navtab')[0].click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  el('cancelEditBtn').addEventListener('click', resetForm);

  el('expenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('formError').hidden = true;
    const payload = {
      amount: el('amount').value,
      category: el('category').value,
      date: el('date').value,
      description: el('description').value,
      type: formType,
      receipt: el('receiptData').value || null,
    };
    if (!(Number(payload.amount) > 0)) return showFormError('Enter an amount greater than 0.');
    if (!payload.category) return showFormError('Please choose a category.');
    if (!payload.date) return showFormError('Please choose a date.');

    el('saveBtn').disabled = true;
    try {
      if (editingId) await API.put('/api/expenses/' + editingId, payload);
      else await API.post('/api/expenses', payload);
      resetForm();
      await refreshDashboard();
    } catch (ex) { showFormError(ex.message); }
    finally { el('saveBtn').disabled = false; }
  });

  // ============== CHARTS ==============
  const COLORS = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b'];
  function tickColor() { return getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#64748b'; }

  function renderCategoryChart(byCategory) {
    const canvas = el('categoryChart');
    if (!byCategory || byCategory.length === 0) {
      el('chartEmpty').hidden = false; canvas.style.display = 'none';
      if (catChart) { catChart.destroy(); catChart = null; }
      return;
    }
    el('chartEmpty').hidden = true; canvas.style.display = 'block';
    if (catChart) catChart.destroy();
    catChart = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: byCategory.map((c) => c.category), datasets: [{ data: byCategory.map((c) => Number(c.total)), backgroundColor: COLORS, borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: tickColor(), boxWidth: 12, padding: 12 } },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } } } },
    });
  }

  async function renderTrend() {
    const months = el('trendMonths').value;
    const data = await API.get('/api/expenses/trend?months=' + months);
    const labels = data.map((d) => {
      const [y, m] = d.month.split('-');
      return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    });
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(el('trendChart'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Expenses', data: data.map((d) => d.expense), backgroundColor: '#ef4444' },
        { label: 'Income', data: data.map((d) => d.income), backgroundColor: '#10b981' },
      ] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: tickColor() } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } } },
        scales: { x: { ticks: { color: tickColor() }, grid: { display: false } },
          y: { ticks: { color: tickColor(), callback: (v) => '$' + v }, grid: { color: 'rgba(148,163,184,.15)' } } } },
    });
  }

  // ============== SUMMARY + BUDGET ALERTS ==============
  function renderSummary(s) {
    el('statExpense').textContent = money(s.expense);
    el('statIncome').textContent = money(s.income);
    const net = el('statNet'); net.textContent = (s.net < 0 ? '-' : '') + money(Math.abs(s.net));
    net.className = 'stat-value ' + (s.net >= 0 ? 'pos' : 'neg');
    el('statAvg').textContent = money(s.avgPerDay);
    el('statBiggest').textContent = s.biggest ? `${money(s.biggest.amount)}` : '—';
    el('statBiggest').title = s.biggest ? `${s.biggest.category} · ${s.biggest.date}` : '';
    renderCategoryChart(s.byCategory);
  }

  async function renderBudgetAlerts() {
    const budgets = await API.get('/api/budgets');
    const box = el('budgetAlerts'); box.innerHTML = '';
    const flagged = budgets.filter((b) => b.spent >= b.monthly_limit * 0.9);
    if (!flagged.length) return;
    const over = flagged.filter((b) => b.spent > b.monthly_limit);
    const near = flagged.filter((b) => b.spent <= b.monthly_limit);
    const parts = [];
    if (over.length) parts.push(`Over budget: ${over.map((b) => `${b.category} (${money(b.spent)}/${money(b.monthly_limit)})`).join(', ')}`);
    if (near.length) parts.push(`Near limit: ${near.map((b) => b.category).join(', ')}`);
    const div = document.createElement('div');
    div.className = 'alert alert-warn';
    div.textContent = '⚠️ ' + parts.join(' · ');
    box.appendChild(div);
  }

  // ============== DASHBOARD REFRESH ==============
  async function refreshDashboard() {
    const qs = '?' + filterParams().toString();
    try {
      const [list, summary] = await Promise.all([API.get('/api/expenses' + qs), API.get('/api/expenses/summary' + qs)]);
      expenses = list;
      renderTable();
      renderSummary(summary);
      await Promise.all([renderTrend(), renderBudgetAlerts()]);
    } catch (ex) { console.error(ex); }
  }
  el('trendMonths').addEventListener('change', renderTrend);

  // ============== EXPORT / IMPORT / PRINT ==============
  async function downloadCsv(qs, filename) {
    const res = await fetch('/api/expenses/export' + qs, { headers: { Authorization: 'Bearer ' + API.token() } });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  el('exportBtn').addEventListener('click', () => downloadCsv('?' + filterParams().toString(), 'expenses.csv').catch((e) => alert(e.message)));
  el('exportAllBtn').addEventListener('click', () => downloadCsv('', 'expenses-all.csv').catch((e) => alert(e.message)));

  el('importBtn').addEventListener('click', () => el('importFile').click());
  el('importFile').addEventListener('change', async () => {
    const file = el('importFile').files[0];
    if (!file) return;
    const csv = await file.text();
    try {
      const r = await API.post('/api/expenses/import', { csv });
      alert(`Imported ${r.imported} transaction(s).` + (r.skipped ? ` Skipped ${r.skipped} invalid row(s).` : ''));
      await loadCategories();
      await refreshDashboard();
    } catch (ex) { alert(ex.message); }
    finally { el('importFile').value = ''; }
  });
  el('printBtn').addEventListener('click', () => window.print());

  // ============== BUDGETS VIEW ==============
  async function loadBudgetsView() {
    const budgets = await API.get('/api/budgets');
    const list = el('budgetList'); list.innerHTML = '';
    el('budgetEmpty').hidden = budgets.length > 0;
    for (const b of budgets) {
      const pct = Math.min(100, (b.spent / b.monthly_limit) * 100);
      const cls = b.spent > b.monthly_limit ? 'over' : b.spent >= b.monthly_limit * 0.9 ? 'warn' : '';
      const row = document.createElement('div');
      row.className = 'budget-row';
      row.innerHTML = `
        <div class="budget-top">
          <span class="budget-name">${escapeHtml(b.category)}</span>
          <span class="budget-figures">${money(b.spent)} / ${money(b.monthly_limit)} (${Math.round((b.spent / b.monthly_limit) * 100)}%)</span>
        </div>
        <div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
        <div class="budget-actions"><button class="btn btn-ghost btn-sm" data-del-budget="${b.id}">Remove</button></div>`;
      list.appendChild(row);
    }
  }
  el('budgetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el('budgetError'); err.hidden = true;
    try {
      await API.put('/api/budgets', { category: el('budgetCategory').value, monthly_limit: el('budgetLimit').value });
      el('budgetLimit').value = '';
      await loadBudgetsView();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  el('budgetList').addEventListener('click', async (e) => {
    const id = e.target.getAttribute('data-del-budget');
    if (!id) return;
    await API.del('/api/budgets/' + id);
    await loadBudgetsView();
  });

  // ============== RECURRING VIEW ==============
  async function loadRecurring() {
    const items = await API.get('/api/recurring');
    const list = el('recurringList'); list.innerHTML = '';
    el('recurringEmpty').hidden = items.length > 0;
    for (const r of items) {
      const row = document.createElement('div');
      row.className = 'rec-row' + (r.active ? '' : ' rec-off');
      const sign = r.type === 'income' ? '+' : '';
      row.innerHTML = `
        <div class="rec-info">
          <span><strong>${sign}${money(r.amount)}</strong> · ${escapeHtml(r.category)}</span>
          <span class="rec-meta">${r.type} · day ${r.day_of_month}${r.description ? ' · ' + escapeHtml(r.description) : ''}${r.last_run ? ' · last: ' + r.last_run : ''}</span>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-toggle="${r.id}" data-active="${r.active}">${r.active ? 'Pause' : 'Resume'}</button>
          <button class="btn btn-danger btn-sm" data-del-rec="${r.id}">Delete</button>
        </div>`;
      list.appendChild(row);
    }
  }
  el('recurringForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el('recError'); err.hidden = true;
    try {
      await API.post('/api/recurring', {
        type: el('recType').value, amount: el('recAmount').value, category: el('recCategory').value,
        description: el('recDesc').value, day_of_month: el('recDay').value,
      });
      el('recAmount').value = ''; el('recDesc').value = '';
      await loadRecurring();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  el('recurringList').addEventListener('click', async (e) => {
    const delId = e.target.getAttribute('data-del-rec');
    const togId = e.target.getAttribute('data-toggle');
    if (delId) { if (confirm('Delete this recurring item?')) { await API.del('/api/recurring/' + delId); await loadRecurring(); } }
    else if (togId) {
      const items = await API.get('/api/recurring');
      const item = items.find((x) => String(x.id) === togId);
      await API.put('/api/recurring/' + togId, { ...item, active: !item.active });
      await loadRecurring();
    }
  });
  el('runRecurringBtn').addEventListener('click', async () => {
    const r = await API.post('/api/recurring/run');
    alert(r.created ? `Generated ${r.created} transaction(s).` : 'Nothing due right now.');
    await loadRecurring();
    await refreshDashboard();
  });

  // ============== SETTINGS ==============
  el('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = el('passwordMsg'); msg.hidden = true;
    try {
      await API.post('/api/auth/change-password', { currentPassword: el('currentPassword').value, newPassword: el('newPassword').value });
      el('passwordForm').reset();
      msg.textContent = 'Password updated.'; msg.className = 'msg'; msg.hidden = false;
    } catch (ex) { msg.textContent = ex.message; msg.className = 'error'; msg.hidden = false; }
  });
  el('deleteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el('deleteError'); err.hidden = true;
    if (!confirm('This permanently deletes your account and ALL data. Continue?')) return;
    try {
      await API.request('DELETE', '/api/auth/account', { password: el('deletePassword').value });
      API.clear();
      window.location.href = 'login.html';
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });

  // ============== LOGOUT ==============
  el('logoutBtn').addEventListener('click', () => { API.clear(); window.location.href = 'login.html'; });

  // ============== BOOT ==============
  (async () => {
    const user = API.user();
    if (user) el('userEmail').textContent = user.email;
    resetForm();
    try {
      await loadCategories();
      await API.post('/api/recurring/run').catch(() => {}); // materialize any due recurring items
    } catch (ex) { console.error(ex); }
    await refreshDashboard();
  })();
})();
