'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH } = require('./config');

const dbFile = DB_PATH || path.join(__dirname, '..', 'data.db');
// Ensure the target directory exists (e.g. a mounted volume path like /var/data).
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new DatabaseSync(dbFile);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ---- Base tables ----
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    amount      REAL NOT NULL,
    category    TEXT NOT NULL,
    description TEXT,
    date        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id, date DESC);

  CREATE TABLE IF NOT EXISTS categories (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name    TEXT NOT NULL,
    UNIQUE(user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    category      TEXT NOT NULL,
    monthly_limit REAL NOT NULL,
    UNIQUE(user_id, category),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recurring (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    type          TEXT NOT NULL DEFAULT 'expense',
    amount        REAL NOT NULL,
    category      TEXT NOT NULL,
    description   TEXT,
    day_of_month  INTEGER NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    last_run      TEXT,                      -- 'YYYY-MM' of the last materialized month
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ---- Lightweight migrations for existing databases ----
function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
function addColumn(table, name, ddl) {
  if (!columns(table).includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
// expenses gained income/expense type and an optional receipt (base64 data URL)
addColumn('expenses', 'type', "type TEXT NOT NULL DEFAULT 'expense'");
addColumn('expenses', 'receipt', 'receipt TEXT');

// ---- Default categories ----
const DEFAULT_CATEGORIES = [
  'Food', 'Transport', 'Housing', 'Utilities',
  'Entertainment', 'Health', 'Shopping', 'Salary', 'Other',
];

// Seed default categories for a user if they have none yet (idempotent).
function ensureCategories(userId) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM categories WHERE user_id = ?').get(userId);
  if (row.c === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO categories (user_id, name) VALUES (?, ?)');
    for (const name of DEFAULT_CATEGORIES) insert.run(userId, name);
  }
}

module.exports = db;
module.exports.ensureCategories = ensureCategories;
module.exports.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;
