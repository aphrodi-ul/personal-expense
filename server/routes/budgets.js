'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

function currentMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// GET /api/budgets — budgets with this-month spending for each category
router.get('/', (req, res) => {
  const month = currentMonth();
  const budgets = db
    .prepare('SELECT id, category, monthly_limit FROM budgets WHERE user_id = ? ORDER BY category COLLATE NOCASE')
    .all(req.userId);

  const spentRows = db
    .prepare(
      `SELECT category, SUM(amount) AS spent FROM expenses
       WHERE user_id = ? AND type = 'expense' AND substr(date,1,7) = ?
       GROUP BY category`
    )
    .all(req.userId, month);
  const spentMap = Object.fromEntries(spentRows.map((r) => [r.category, r.spent]));

  res.json(
    budgets.map((b) => ({
      ...b,
      spent: spentMap[b.category] || 0,
      month,
    }))
  );
});

// PUT /api/budgets — create or update a category budget { category, monthly_limit }
router.put('/', (req, res) => {
  const category = String(req.body?.category || '').trim();
  const limit = Number(req.body?.monthly_limit);
  if (!category) return res.status(400).json({ error: 'Category is required' });
  if (!Number.isFinite(limit) || limit <= 0) {
    return res.status(400).json({ error: 'Monthly limit must be a positive number' });
  }
  db.prepare(
    `INSERT INTO budgets (user_id, category, monthly_limit) VALUES (?, ?, ?)
     ON CONFLICT(user_id, category) DO UPDATE SET monthly_limit = excluded.monthly_limit`
  ).run(req.userId, category, Math.round(limit * 100) / 100);

  const row = db
    .prepare('SELECT id, category, monthly_limit FROM budgets WHERE user_id = ? AND category = ?')
    .get(req.userId, category);
  res.json(row);
});

// DELETE /api/budgets/:id
router.delete('/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Budget not found' });
  res.status(204).end();
});

module.exports = router;
