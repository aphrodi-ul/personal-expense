'use strict';
// One-off helper: seed demo data and capture screenshots of the running app.
// Usage: BASE=http://localhost:3148 CHROME="C:/.../chrome.exe" node scripts/screenshots.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE = process.env.BASE || 'http://localhost:3148';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(__dirname, '..', 'screenshots');

const DEMO = [
  { amount: 1450, category: 'Housing', date: '2026-06-01', description: 'Monthly rent' },
  { amount: 86.4, category: 'Utilities', date: '2026-06-03', description: 'Electricity bill' },
  { amount: 52.18, category: 'Food', date: '2026-06-05', description: 'Groceries' },
  { amount: 12.5, category: 'Food', date: '2026-06-06', description: 'Lunch with team' },
  { amount: 40, category: 'Transport', date: '2026-06-07', description: 'Fuel' },
  { amount: 24.99, category: 'Entertainment', date: '2026-06-09', description: 'Movie night' },
  { amount: 18, category: 'Health', date: '2026-06-11', description: 'Pharmacy' },
  { amount: 75.3, category: 'Shopping', date: '2026-06-12', description: 'New shoes' },
];

async function seed() {
  const email = 'demo@example.com';
  const password = 'secret123';
  // register (ignore 409 if it already exists) then login
  let res = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 409) {
    res = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  }
  const { token, user } = await res.json();
  for (const e of DEMO) {
    await fetch(BASE + '/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(e),
    });
  }
  return { token, user };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { token, user } = await seed();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars'],
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
  });

  try {
    const page = await browser.newPage();

    // 1) Login / register page
    await page.goto(BASE + '/login.html', { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.join(OUT, '01-login.png') });

    // Inject session so the dashboard loads as a logged-in user
    await page.evaluateOnNewDocument((t, u) => {
      localStorage.setItem('token', t);
      localStorage.setItem('user', JSON.stringify(u));
    }, token, user);

    // 2) Dashboard (desktop) — wait for chart + table to render
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => window.Chart && document.querySelectorAll('#expenseRows tr').length > 0,
      { timeout: 15000 }
    );
    await new Promise((r) => setTimeout(r, 700)); // let chart animation settle
    await page.screenshot({ path: path.join(OUT, '02-dashboard.png'), fullPage: true });

    // 3) Category filter applied
    await page.select('#filterCategory', 'Food');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('#expenseRows .badge')).every((b) => b.textContent === 'Food'),
      { timeout: 5000 }
    );
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(OUT, '03-filter-food.png'), fullPage: true });

    // 4) Mobile view of the dashboard
    const mobile = await browser.newPage();
    await mobile.evaluateOnNewDocument((t, u) => {
      localStorage.setItem('token', t);
      localStorage.setItem('user', JSON.stringify(u));
    }, token, user);
    await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    await mobile.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await mobile.waitForFunction(
      () => window.Chart && document.querySelectorAll('#expenseRows tr').length > 0,
      { timeout: 15000 }
    );
    await new Promise((r) => setTimeout(r, 700));
    await mobile.screenshot({ path: path.join(OUT, '04-mobile.png'), fullPage: true });

    console.log('Saved screenshots to', OUT);
    for (const f of fs.readdirSync(OUT)) console.log(' -', f);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
