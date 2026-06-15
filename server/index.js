'use strict';

const path = require('path');
const express = require('express');

const { PORT } = require('./config');
const auth = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const expenseRoutes = require('./routes/expenses');
const budgetRoutes = require('./routes/budgets');
const categoryRoutes = require('./routes/categories');
const recurringRoutes = require('./routes/recurring');

require('./db'); // initialize schema on boot

const app = express();

// Larger limit so receipt images (base64 data URLs) fit in the JSON body.
app.use(express.json({ limit: '6mb' }));

// --- API routes ---
app.use('/api/auth', authRoutes);
app.use('/api/expenses', auth, expenseRoutes); // all expense endpoints require auth
app.use('/api/budgets', auth, budgetRoutes);
app.use('/api/categories', auth, categoryRoutes);
app.use('/api/recurring', auth, recurringRoutes);

// Unknown API route -> JSON 404 (must come before static so it isn't swallowed)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// --- Static frontend ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Centralized error handler ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large (receipt image may be too big)' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Expense Tracker running at http://localhost:${PORT}`);
});
