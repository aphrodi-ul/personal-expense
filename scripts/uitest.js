'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3170';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(__dirname, '..', 'screenshots');

const DEMO = [
  { amount: 1450, category: 'Housing', date: '2026-06-01', description: 'Monthly rent', type: 'expense' },
  { amount: 3200, category: 'Salary', date: '2026-06-01', description: 'Paycheck', type: 'income' },
  { amount: 86.4, category: 'Utilities', date: '2026-06-03', description: 'Electricity', type: 'expense' },
  { amount: 152.18, category: 'Food', date: '2026-06-05', description: 'Groceries', type: 'expense' },
  { amount: 42.5, category: 'Food', date: '2026-06-09', description: 'Dinner out', type: 'expense' },
  { amount: 40, category: 'Transport', date: '2026-06-07', description: 'Fuel', type: 'expense' },
  { amount: 60, category: 'Entertainment', date: '2026-06-10', description: 'Concert', type: 'expense' },
  { amount: 220, category: 'Food', date: '2026-05-12', description: 'Last month groceries', type: 'expense' },
  { amount: 3200, category: 'Salary', date: '2026-05-01', description: 'Paycheck', type: 'income' },
];

async function api(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { token, user } = await api('POST', '/api/auth/register', null, { email: 'demo2@example.com', password: 'secret123' });
  for (const e of DEMO) await api('POST', '/api/expenses', token, e);
  await api('PUT', '/api/budgets', token, { category: 'Food', monthly_limit: 200 });
  await api('PUT', '/api/budgets', token, { category: 'Entertainment', monthly_limit: 100 });
  await api('POST', '/api/recurring', token, { type: 'expense', amount: 1450, category: 'Housing', description: 'Rent', day_of_month: 1 });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'], defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 2 } });
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()); });

  await page.evaluateOnNewDocument((t, u) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('theme', 'light'); }, token, user);
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('#expenseRows tr').length > 0, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 900));

  // Assertions on dashboard
  const expenseStat = await page.$eval('#statExpense', (e) => e.textContent);
  const incomeStat = await page.$eval('#statIncome', (e) => e.textContent);
  const rowCount = await page.$$eval('#expenseRows tr', (r) => r.length);
  const hasCatChart = await page.evaluate(() => !!document.querySelector('#categoryChart') && getComputedStyle(document.querySelector('#categoryChart')).display !== 'none');
  const hasTrend = await page.evaluate(() => document.querySelector('#trendChart').height > 0);
  const alertShown = await page.$eval('#budgetAlerts', (e) => e.textContent.trim().length > 0);
  console.log('statExpense=', expenseStat, '| statIncome=', incomeStat, '| rows=', rowCount, '| catChart=', hasCatChart, '| trend=', hasTrend, '| budgetAlert=', alertShown);
  await page.screenshot({ path: path.join(OUT, '02-dashboard.png'), fullPage: true });

  // Budgets view
  await page.click('.navtab[data-view="budgets"]');
  await page.waitForSelector('#view-budgets:not([hidden]) .budget-row', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(OUT, '05-budgets.png'), fullPage: true });
  const budgetRows = await page.$$eval('#budgetList .budget-row', (r) => r.length);
  console.log('budget rows=', budgetRows);

  // Recurring view
  await page.click('.navtab[data-view="recurring"]');
  await page.waitForSelector('#view-recurring:not([hidden]) .rec-row', { timeout: 5000 });
  const recRows = await page.$$eval('#recurringList .rec-row', (r) => r.length);
  console.log('recurring rows=', recRows);

  // Categories view + add a category through the UI
  await page.click('.navtab[data-view="categories"]');
  await page.waitForSelector('#view-categories:not([hidden]) .chip', { timeout: 5000 });
  await page.type('#categoryName', 'Subscriptions');
  await page.click('#categoryForm button[type="submit"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#categoryList .chip')].some((c) => c.textContent.includes('Subscriptions')), { timeout: 5000 });
  console.log('category added via UI: ok');

  // Dark mode + back to dashboard
  await page.click('.navtab[data-view="dashboard"]');
  await page.click('#themeToggle');
  await new Promise((r) => setTimeout(r, 900));
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log('theme after toggle=', theme);
  await page.screenshot({ path: path.join(OUT, '06-dark.png'), fullPage: true });

  // Mobile
  await page.click('#themeToggle'); // back to light
  const mobile = await browser.newPage();
  await mobile.evaluateOnNewDocument((t, u) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('theme', 'light'); }, token, user);
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  await mobile.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
  await mobile.waitForFunction(() => document.querySelectorAll('#expenseRows tr').length > 0, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  await mobile.screenshot({ path: path.join(OUT, '04-mobile.png'), fullPage: true });

  console.log('PAGE ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
  await browser.close();
  process.exit(errors.length ? 2 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
