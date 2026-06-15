'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();
const TYPES = ['expense', 'income'];

function validate(body = {}) {
  const errors = [];
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push('Amount must be a positive number');
  const category = String(body.category || '').trim();
  if (!category) errors.push('Category is required');
  let day = parseInt(body.day_of_month, 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) errors.push('Day of month must be between 1 and 31');
  let type = String(body.type || 'expense').toLowerCase();
  if (!TYPES.includes(type)) type = 'expense';
  const description = String(body.description || '').trim().slice(0, 500);
  return { errors, value: { amount: Math.round(amount * 100) / 100, category, day, type, description } };
}

// GET /api/recurring
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM recurring WHERE user_id = ? ORDER BY day_of_month, id')
    .all(req.userId);
  res.json(rows);
});

// POST /api/recurring
router.post('/', (req, res) => {
  const { errors, value } = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const info = db
    .prepare(
      'INSERT INTO recurring (user_id, type, amount, category, description, day_of_month) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(req.userId, value.type, value.amount, value.category, value.description, value.day);
  res.status(201).json(db.prepare('SELECT * FROM recurring WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/recurring/:id  — update fields and/or active flag
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM recurring WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Recurring item not found' });
  const { errors, value } = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const active = req.body.active === undefined ? existing.active : req.body.active ? 1 : 0;
  db.prepare(
    'UPDATE recurring SET type=?, amount=?, category=?, description=?, day_of_month=?, active=? WHERE id=? AND user_id=?'
  ).run(value.type, value.amount, value.category, value.description, value.day, active, id, req.userId);
  res.json(db.prepare('SELECT * FROM recurring WHERE id = ?').get(id));
});

// DELETE /api/recurring/:id
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM recurring WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Recurring item not found' });
  res.status(204).end();
});

// POST /api/recurring/run — materialize due items for the current month (idempotent)
router.post('/run', (req, res) => {
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today = now.getDate();

  const items = db
    .prepare('SELECT * FROM recurring WHERE user_id = ? AND active = 1')
    .all(req.userId);

  const insert = db.prepare(
    'INSERT INTO expenses (user_id, amount, category, description, date, type) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const markRun = db.prepare('UPDATE recurring SET last_run = ? WHERE id = ?');

  let created = 0;
  for (const item of items) {
    if (item.last_run === ym) continue;            // already generated this month
    const day = Math.min(item.day_of_month, daysInMonth);
    if (day > today) continue;                      // not due yet this month
    const date = `${ym}-${String(day).padStart(2, '0')}`;
    const desc = item.description || `${item.category} (recurring)`;
    insert.run(req.userId, item.amount, item.category, desc, date, item.type);
    markRun.run(ym, item.id);
    created++;
  }
  res.json({ created });
});

module.exports = router;
