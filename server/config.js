'use strict';

// Minimal config with safe defaults so the app runs out of the box.
// Override via environment variables (see .env.example).
module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  DB_PATH: process.env.DB_PATH || null, // null => server/../data.db (see db.js)
};
