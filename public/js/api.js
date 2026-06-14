'use strict';

// Tiny fetch wrapper that attaches the JWT and handles auth failures globally.
const API = {
  token() {
    return localStorage.getItem('token');
  },
  setSession(token, user) {
    localStorage.setItem('token', token);
    if (user) localStorage.setItem('user', JSON.stringify(user));
  },
  user() {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  },
  clear() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  async request(method, url, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const t = this.token();
    if (t) headers['Authorization'] = 'Bearer ' + t;

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      this.clear();
      window.location.href = 'login.html';
      throw new Error('Session expired');
    }
    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  del(url) { return this.request('DELETE', url); },
};
