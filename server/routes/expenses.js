'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

const TYPES = ['expense', 'income'];
const MAX_RECEIPT_CHARS = 3_000_000; // ~2MB image as a base64 data URL

// Validate & normalize an incoming expense payload.
function validateExpense(body = {}) {
  const errors = [];

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push('Amount must be a positive number');
  }

  const category = String(body.category || '').trim();
  if (!category) errors.push('Category is required');
  if (category.length > 50) errors.push('Category is too long');

  const date = String(body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push('Date must be in YYYY-MM-DD format');
  }

  let type = String(body.type || 'expense').trim().toLowerCase();
  if (!TYPES.includes(type)) type = 'expense';

  const description = String(body.description || '').trim().slice(0, 500);

  let receipt = body.receipt;
  if (receipt != null && receipt !== '') {
    receipt = String(receipt);
    if (!/^data:image\/[a-zA-Z+.-]+;base64,/.test(receipt)) {
      errors.push('Receipt must be an image');
    } else if (receipt.length > MAX_RECEIPT_CHARS) {
      errors.push('Receipt image is too large (max ~2MB)');
    }
  } else {
    receipt = null;
  }

  return {
    errors,
    value: { amount: Math.round(amount * 100) / 100, category, description, date, type, receipt },
  };
}

// Build a WHERE clause from query filters, always scoped to the user.
function buildWhere(req) {
  const where = ['user_id = ?'];
  const params = [req.userId];
  const { category, type, from, to, q } = req.query;
  if (category && category !== 'All') { where.push('category = ?'); params.push(String(category)); }
  if (type && TYPES.includes(type)) { where.push('type = ?'); params.push(type); }
  if (from) { where.push('date >= ?'); params.push(String(from)); }
  if (to) { where.push('date <= ?'); params.push(String(to)); }
  if (q) {
    where.push('(description LIKE ? OR category LIKE ?)');
    const like = '%' + String(q) + '%';
    params.push(like, like);
  }
  return { clause: where.join(' AND '), params };
}

const LIST_COLS =
  'id, amount, category, description, date, type, created_at, (receipt IS NOT NULL) AS has_receipt';

// GET /api/expenses  — list with optional filters: category, type, from, to, q
router.get('/', (req, res) => {
  const { clause, params } = buildWhere(req);
  const rows = db
    .prepare(`SELECT ${LIST_COLS} FROM expenses WHERE ${clause} ORDER BY date DESC, id DESC`)
    .all(...params);
  res.json(rows);
});

// GET /api/expenses/summary  — totals, income/net, per-category, avg/day, biggest
router.get('/summary', (req, res) => {
  const { clause, params } = buildWhere(req);

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type='expense' THEN amount END), 0) AS expense,
         COALESCE(SUM(CASE WHEN type='income'  THEN amount END), 0) AS income,
         COUNT(*) AS count,
         MIN(date) AS minDate, MAX(date) AS maxDate
       FROM expenses WHERE ${clause}`
    )
    .get(...params);

  const byCategory = db
    .prepare(
      `SELECT category, SUM(amount) AS total FROM expenses
       WHERE ${clause} AND type='expense'
       GROUP BY category ORDER BY total DESC`
    )
    .all(...params);

  const biggest = db
    .prepare(
      `SELECT amount, category, date, description FROM expenses
       WHERE ${clause} AND type='expense'
       ORDER BY amount DESC LIMIT 1`
    )
    .get(...params);

  // Average spend per day across the span actually covered by the data.
  let days = 1;
  if (totals.minDate && totals.maxDate) {
    const ms = Date.parse(totals.maxDate) - Date.parse(totals.minDate);
    days = Math.max(1, Math.round(ms / 86_400_000) + 1);
  }

  res.json({
    expense: totals.expense,
    income: totals.income,
    net: Math.round((totals.income - totals.expense) * 100) / 100,
    count: totals.count,
    total: totals.expense, // backwards-compatible alias
    byCategory,
    avgPerDay: Math.round((totals.expense / days) * 100) / 100,
    biggest: biggest || null,
  });
});

// GET /api/expenses/trend?months=6  — per-month income & expense sums
router.get('/trend', (req, res) => {
  let months = parseInt(req.query.months, 10);
  if (!Number.isFinite(months)) months = 6;
  months = Math.min(24, Math.max(1, months));

  // Build the list of YYYY-MM buckets ending with the current month.
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    buckets.push(ym);
  }
  const first = buckets[0];

  const rows = db
    .prepare(
      `SELECT substr(date,1,7) AS ym,
              COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense,
              COALESCE(SUM(CASE WHEN type='income'  THEN amount END),0) AS income
       FROM expenses
       WHERE user_id = ? AND substr(date,1,7) >= ?
       GROUP BY ym`
    )
    .all(req.userId, first);

  const map = Object.fromEntries(rows.map((r) => [r.ym, r]));
  const series = buckets.map((ym) => ({
    month: ym,
    expense: map[ym] ? map[ym].expense : 0,
    income: map[ym] ? map[ym].income : 0,
  }));
  res.json(series);
});

// GET /api/expenses/export  — CSV of the filtered set
router.get('/export', (req, res) => {
  const { clause, params } = buildWhere(req);
  const rows = db
    .prepare(
      `SELECT date, type, category, amount, description FROM expenses
       WHERE ${clause} ORDER BY date DESC, id DESC`
    )
    .all(...params);

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = 'Date,Type,Category,Amount,Description';
  const body = rows.map((r) => [r.date, r.type, r.category, r.amount, r.description].map(esc).join(','));
  const csv = [header, ...body].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
  res.send(csv);
});

// Minimal CSV line parser (handles quotes and escaped quotes).
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// POST /api/expenses/import  — bulk add from CSV text { csv }
router.post('/import', (req, res) => {
  const csv = String(req.body?.csv || '').trim();
  if (!csv) return res.status(400).json({ error: 'No CSV content provided' });

  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return res.status(400).json({ error: 'CSV has no data rows' });

  // Map header names to column indexes (case-insensitive).
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const di = idx('date'), ci = idx('category'), ai = idx('amount');
  const ti = idx('type'), si = idx('description');
  if (di < 0 || ci < 0 || ai < 0) {
    return res.status(400).json({ error: 'CSV must have Date, Category and Amount columns' });
  }

  const insert = db.prepare(
    'INSERT INTO expenses (user_id, amount, category, description, date, type) VALUES (?, ?, ?, ?, ?, ?)'
  );
  let imported = 0;
  const skipped = [];

  db.exec('BEGIN');
  try {
    for (let r = 1; r < lines.length; r++) {
      const cells = parseCsvLine(lines[r]);
      const { errors, value } = validateExpense({
        date: cells[di], category: cells[ci], amount: cells[ai],
        type: ti >= 0 ? cells[ti] : 'expense',
        description: si >= 0 ? cells[si] : '',
      });
      if (errors.length) { skipped.push({ row: r + 1, reason: errors.join('; ') }); continue; }
      insert.run(req.userId, value.amount, value.category, value.description, value.date, value.type);
      imported++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  res.json({ imported, skipped: skipped.length, details: skipped.slice(0, 20) });
});

// GET /api/expenses/:id  — full row (including receipt data URL)
router.get('/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.userId);
  if (!row) return res.status(404).json({ error: 'Expense not found' });
  res.json(row);
});

// POST /api/expenses  — create
router.post('/', (req, res) => {
  const { errors, value } = validateExpense(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const info = db
    .prepare(
      'INSERT INTO expenses (user_id, amount, category, description, date, type, receipt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(req.userId, value.amount, value.category, value.description, value.date, value.type, value.receipt);

  const row = db.prepare(`SELECT ${LIST_COLS} FROM expenses WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json(row);
});

// PUT /api/expenses/:id  — update
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db
    .prepare('SELECT id FROM expenses WHERE id = ? AND user_id = ?')
    .get(id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });

  const { errors, value } = validateExpense(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  db.prepare(
    'UPDATE expenses SET amount=?, category=?, description=?, date=?, type=?, receipt=? WHERE id=? AND user_id=?'
  ).run(value.amount, value.category, value.description, value.date, value.type, value.receipt, id, req.userId);

  res.json(db.prepare(`SELECT ${LIST_COLS} FROM expenses WHERE id = ?`).get(id));
});

// DELETE /api/expenses/:id
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = db
    .prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?')
    .run(id, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Expense not found' });
  res.status(204).end();
});

module.exports = router;
