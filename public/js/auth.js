'use strict';

// Login / register page logic.
(function () {
  // Already signed in? Go straight to the app.
  if (localStorage.getItem('token')) {
    window.location.href = 'index.html';
    return;
  }

  let mode = 'login'; // or 'register'

  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const form = document.getElementById('authForm');
  const emailEl = document.getElementById('email');
  const passwordEl = document.getElementById('password');
  const submitBtn = document.getElementById('submitBtn');
  const subtitle = document.getElementById('formSubtitle');
  const errorEl = document.getElementById('authError');

  function setMode(next) {
    mode = next;
    const isLogin = mode === 'login';
    tabLogin.classList.toggle('active', isLogin);
    tabRegister.classList.toggle('active', !isLogin);
    submitBtn.textContent = isLogin ? 'Sign in' : 'Create account';
    subtitle.textContent = isLogin
      ? 'Sign in to manage your expenses'
      : 'Create an account to get started';
    passwordEl.setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
    hideError();
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
  function hideError() {
    errorEl.hidden = true;
  }

  tabLogin.addEventListener('click', () => setMode('login'));
  tabRegister.addEventListener('click', () => setMode('register'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const email = emailEl.value.trim();
    const password = passwordEl.value;
    if (!email || !password) return showError('Please enter your email and password.');
    if (mode === 'register' && password.length < 6) {
      return showError('Password must be at least 6 characters.');
    }

    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'login' ? 'Signing in…' : 'Creating account…';

    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong');

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = 'index.html';
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      setMode(mode); // restores button label
    }
  });

  setMode('login');
})();
