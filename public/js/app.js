'use strict';

// Main application logic (requires a valid session).
(function () {
  if (!API.token()) {
    window.location.href = 'login.html';
    return;
  }

  // ---- State ----
  let expenses = [];          // current (filtered) list shown in the table
  let editingId = null;
  let chart = null;

  // ---- Elements ----
  const el = (id) => document.getElementById(id);
  const form = el('expenseForm');
  const formTitle = el('formTitle');
  const saveBtn = el('saveBtn');
  const cancelEditBtn = el('cancelEditBtn');
  const formError = el('formError');
  const rowsEl = el('expenseRows');
  const tableEmpty = el('tableEmpty');
  const filterCategory = el('filterCategory');
  const filteredTotalEl = el('filteredTotal');

  // ---- Helpers ----
  const money = (n) =>
    '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function showFormError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }
  function hideFormError() {
    formError.hidden = true;
  }

  // ---- Rendering ----
  function renderTable() {
    rowsEl.innerHTML = '';
    if (expenses.length === 0) {
      tableEmpty.hidden = false;
    } else {
      tableEmpty.hidden = true;
      for (const e of expenses) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(e.date)}</td>
          <td><span class="badge">${escapeHtml(e.category)}</span></td>
          <td>${escapeHtml(e.description) || '<span class="muted">—</span>'}</td>
          <td class="num">${money(e.amount)}</td>
          <td class="actions-col">
            <div class="row-actions">
              <button class="btn btn-ghost btn-sm" data-edit="${e.id}">Edit</button>
              <button class="btn btn-danger btn-sm" data-del="${e.id}">Delete</button>
            </div>
          </td>`;
        rowsEl.appendChild(tr);
      }
    }
    const filteredTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
    filteredTotalEl.textContent = money(filteredTotal);
  }

  function renderSummary(summary) {
    el('statTotal').textContent = money(summary.total);
    el('statCount').textContent = summary.count;
    el('statTop').textContent = summary.byCategory[0] ? summary.byCategory[0].category : '—';
    renderChart(summary.byCategory);
  }

  const CHART_COLORS = [
    '#4f46e5', '#06b6d4', '#10b981', '#f59e0b',
    '#ef4444', '#8b5cf6', '#ec4899', '#64748b',
  ];

  function renderChart(byCategory) {
    const chartEmpty = el('chartEmpty');
    const canvas = el('categoryChart');

    if (!byCategory || byCategory.length === 0) {
      chartEmpty.hidden = false;
      canvas.style.display = 'none';
      if (chart) { chart.destroy(); chart = null; }
      return;
    }
    chartEmpty.hidden = true;
    canvas.style.display = 'block';

    const labels = byCategory.map((c) => c.category);
    const data = byCategory.map((c) => Number(c.total));

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = data;
      chart.update();
      return;
    }
    chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: CHART_COLORS, borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${money(ctx.parsed)}`,
            },
          },
        },
      },
    });
  }

  // ---- Data loading ----
  async function loadExpenses() {
    const category = filterCategory.value;
    const q = category && category !== 'All' ? `?category=${encodeURIComponent(category)}` : '';
    expenses = await API.get('/api/expenses' + q);
    renderTable();
  }

  async function loadSummary() {
    const summary = await API.get('/api/expenses/summary');
    renderSummary(summary);
  }

  async function refresh() {
    try {
      await Promise.all([loadExpenses(), loadSummary()]);
    } catch (err) {
      console.error(err);
    }
  }

  // ---- Form: add / edit ----
  function resetForm() {
    editingId = null;
    form.reset();
    el('expenseId').value = '';
    el('date').value = new Date().toISOString().slice(0, 10); // default today
    formTitle.textContent = 'Add expense';
    saveBtn.textContent = 'Add expense';
    cancelEditBtn.hidden = true;
    hideFormError();
  }

  function startEdit(expense) {
    editingId = expense.id;
    el('expenseId').value = expense.id;
    el('amount').value = expense.amount;
    el('category').value = expense.category;
    el('date').value = expense.date;
    el('description').value = expense.description || '';
    formTitle.textContent = 'Edit expense';
    saveBtn.textContent = 'Save changes';
    cancelEditBtn.hidden = false;
    hideFormError();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideFormError();

    const payload = {
      amount: el('amount').value,
      category: el('category').value,
      date: el('date').value,
      description: el('description').value,
    };

    // Client-side validation (server validates too).
    if (!(Number(payload.amount) > 0)) return showFormError('Enter an amount greater than 0.');
    if (!payload.category) return showFormError('Please choose a category.');
    if (!payload.date) return showFormError('Please choose a date.');

    saveBtn.disabled = true;
    try {
      if (editingId) {
        await API.put('/api/expenses/' + editingId, payload);
      } else {
        await API.post('/api/expenses', payload);
      }
      resetForm();
      await refresh();
    } catch (err) {
      showFormError(err.message);
    } finally {
      saveBtn.disabled = false;
    }
  });

  cancelEditBtn.addEventListener('click', resetForm);

  // Event delegation for edit/delete buttons.
  rowsEl.addEventListener('click', async (e) => {
    const editId = e.target.getAttribute('data-edit');
    const delId = e.target.getAttribute('data-del');
    if (editId) {
      const expense = expenses.find((x) => String(x.id) === editId);
      if (expense) startEdit(expense);
    } else if (delId) {
      if (!confirm('Delete this expense?')) return;
      try {
        await API.del('/api/expenses/' + delId);
        if (String(editingId) === delId) resetForm();
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  // ---- Filter ----
  filterCategory.addEventListener('change', loadExpenses);

  // ---- CSV export (authenticated download) ----
  el('exportBtn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/expenses/export', {
        headers: { Authorization: 'Bearer ' + API.token() },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'expenses.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    }
  });

  // ---- Logout ----
  el('logoutBtn').addEventListener('click', () => {
    API.clear();
    window.location.href = 'login.html';
  });

  // ---- Boot ----
  const user = API.user();
  if (user) el('userEmail').textContent = user.email;
  resetForm();
  refresh();
})();
