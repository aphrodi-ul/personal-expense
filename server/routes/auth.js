'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { ensureCategories } = db;
const { JWT_SECRET } = require('../config');
const requireAuth = require('../middleware/auth');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function makeToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(email, hash);
  const user = { id: Number(info.lastInsertRowid), email };
  ensureCategories(user.id); // give new users the default category set

  res.status(201).json({ token: makeToken(user), user });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  ensureCategories(user.id); // backfill defaults for accounts created before categories existed

  res.json({ token: makeToken(user), user: { id: user.id, email: user.email } });
});

// --- Authenticated account management ---

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user || !bcrypt.compareSync(current, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), req.userId);
  res.json({ ok: true });
});

// DELETE /api/auth/account  — delete the user and all their data
router.delete('/account', requireAuth, (req, res) => {
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Password is incorrect' });
  }
  // ON DELETE CASCADE clears expenses/categories/budgets/recurring.
  db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
  res.status(204).end();
});

module.exports = router;
