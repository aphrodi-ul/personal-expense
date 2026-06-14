'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

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

  const description = String(body.description || '').trim().slice(0, 500);

  return {
    errors,
    value: { amount: Math.round(amount * 100) / 100, category, description, date },
  };
}

// GET /api/expenses?category=Food  — list (optionally filtered by category)
router.get('/', (req, res) => {
  const { category } = req.query;
  const rows =
    category && category !== 'All'
      ? db
          .prepare(
            'SELECT * FROM expenses WHERE user_id = ? AND category = ? ORDER BY date DESC, id DESC'
          )
          .all(req.userId, String(category))
      : db
          .prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC, id DESC')
          .all(req.userId);
  res.json(rows);
});

// GET /api/expenses/summary  — totals overall and per category
router.get('/summary', (req, res) => {
  const totals = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE user_id = ?')
    .get(req.userId);
  const byCategory = db
    .prepare(
      'SELECT category, SUM(amount) AS total FROM expenses WHERE user_id = ? GROUP BY category ORDER BY total DESC'
    )
    .all(req.userId);
  res.json({ total: totals.total, count: totals.count, byCategory });
});

// GET /api/expenses/export  — download all expenses as CSV
router.get('/export', (req, res) => {
  const rows = db
    .prepare(
      'SELECT date, category, amount, description FROM expenses WHERE user_id = ? ORDER BY date DESC, id DESC'
    )
    .all(req.userId);

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = 'Date,Category,Amount,Description';
  const body = rows.map((r) => [r.date, r.category, r.amount, r.description].map(esc).join(','));
  const csv = [header, ...body].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
  res.send(csv);
});

// POST /api/expenses  — create
router.post('/', (req, res) => {
  const { errors, value } = validateExpense(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const info = db
    .prepare(
      'INSERT INTO expenses (user_id, amount, category, description, date) VALUES (?, ?, ?, ?, ?)'
    )
    .run(req.userId, value.amount, value.category, value.description, value.date);

  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
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
    'UPDATE expenses SET amount = ?, category = ?, description = ?, date = ? WHERE id = ? AND user_id = ?'
  ).run(value.amount, value.category, value.description, value.date, id, req.userId);

  res.json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id));
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
