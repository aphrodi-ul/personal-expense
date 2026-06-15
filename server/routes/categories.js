'use strict';

const express = require('express');
const db = require('../db');
const { ensureCategories } = db;

const router = express.Router();

// GET /api/categories — the user's categories (seeds defaults on first access)
router.get('/', (req, res) => {
  ensureCategories(req.userId);
  const rows = db
    .prepare('SELECT id, name FROM categories WHERE user_id = ? ORDER BY name COLLATE NOCASE')
    .all(req.userId);
  res.json(rows);
});

// POST /api/categories — add a custom category { name }
router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  if (name.length > 50) return res.status(400).json({ error: 'Category name is too long' });

  const exists = db
    .prepare('SELECT id FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE')
    .get(req.userId, name);
  if (exists) return res.status(409).json({ error: 'That category already exists' });

  const info = db
    .prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)')
    .run(req.userId, name);
  res.status(201).json({ id: Number(info.lastInsertRowid), name });
});

// DELETE /api/categories/:id — remove a category (existing expenses keep their label)
router.delete('/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM categories WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Category not found' });
  res.status(204).end();
});

module.exports = router;
