'use strict';

/**
 * WhatsApp → Bitrix24 Lead Dashboard
 *
 * Pages:
 *   login   → Hardcoded temporary credentials (admin@system.com / Admin@123456)
 *   dashboard → KPIs + recent WhatsApp leads
 *   leads     → Full searchable table of all WhatsApp leads
 *   setup     → Bitrix24 webhook + WhatsApp webhook + Auto-Sync
 */

class App {
  constructor() {
    this.token = localStorage.getItem('wa_b24_token') || null;
    this.pollTimer = null;
    this.state = {
      user: null,
      tenant: null,
      currentPage: 'dashboard',
      leads: [],
    };
    this._init();
  }

  // ──────────────────────────────────────────────────────────────────
  // Bootstrap
  // ──────────────────────────────────────────────────────────────────

  async _init() {
    this._bindGlobal();

    if (this.token) {
      const ok = await this._fetchProfile();
      if (ok) {
        this._showApp();
        this._navigateTo('dashboard');
      } else {
        this._showLogin();
      }
    } else {
      this._showLogin();
    }

    // Auto-refresh dashboard every 15 s while logged in
    this.pollTimer = setInterval(() => {
      if (this.token && this.state.currentPage === 'dashboard') {
        this._loadDashboard(true);
      }
    }, 15000);
  }

  _bindGlobal() {
    // Login
    document.getElementById('form-login').addEventListener('submit', e => this._handleLogin(e));

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => this._logout());

    // Sidebar navigation
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.addEventListener('click', () => this._navigateTo(el.dataset.page));
    });

    // Dashboard "View All" button
    document.getElementById('btn-view-all')?.addEventListener('click', () => this._navigateTo('leads'));

    // Dashboard refresh
    document.getElementById('btn-refresh-dashboard')?.addEventListener('click', () => this._loadDashboard(false));

    // Dashboard Sync Now
    document.getElementById('btn-sync-dash')?.addEventListener('click', () => this._runSync('sync-status-banner', 'sync-status-text'));

    // Leads page sync
    document.getElementById('btn-sync-leads')?.addEventListener('click', () => this._runSync('sync-status-banner', 'sync-status-text'));

    // Leads search
    document.getElementById('search-leads')?.addEventListener('input', e => this._filterLeads(e.target.value));

    // Setup: save
    document.getElementById('btn-save-setup')?.addEventListener('click', () => this._handleSaveSetup());

    // Setup: test
    document.getElementById('btn-test-conn')?.addEventListener('click', () => this._handleTestConn());

    // Setup: sync
    document.getElementById('btn-sync-setup')?.addEventListener('click', () => this._runSync('setup-status', null));
  }

  // ──────────────────────────────────────────────────────────────────
  // Auth
  // ──────────────────────────────────────────────────────────────────

  async _handleLogin(e) {
    e.preventDefault();
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    const btn      = document.getElementById('btn-login');

    errEl.classList.add('hidden');
    btn.classList.add('btn-loading');
    btn.disabled = true;

    try {
      const res = await this._api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      this.token = res.data.token;
      localStorage.setItem('wa_b24_token', this.token);
      this.state.user   = res.data.user;
      this.state.tenant = res.data.tenant;

      this._renderUserMeta();
      this._showApp();
      this._navigateTo('dashboard');
    } catch (err) {
      errEl.textContent = err.message || 'Invalid email or password.';
      errEl.classList.remove('hidden');
    } finally {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  }

  async _fetchProfile() {
    try {
      const res = await this._api('/api/auth/me');
      this.state.user   = res.data.user;
      this.state.tenant = res.data.tenant;
      this._renderUserMeta();
      return true;
    } catch {
      return false;
    }
  }

  _renderUserMeta() {
    const u = this.state.user;
    if (!u) return;
    const name = u.name || u.email || 'Admin';
    const el   = document.getElementById('user-display-name');
    const av   = document.getElementById('user-avatar');
    if (el) el.textContent = name;
    if (av) av.textContent = name[0].toUpperCase();
  }

  _logout() {
    this.token = null;
    localStorage.removeItem('wa_b24_token');
    this.state.user = null;
    this.state.tenant = null;
    this.state.leads = [];
    this._showLogin();
  }

  // ──────────────────────────────────────────────────────────────────
  // View transitions
  // ──────────────────────────────────────────────────────────────────

  _showLogin() {
    document.getElementById('view-login').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  }

  _showApp() {
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
  }

  _navigateTo(pageId) {
    this.state.currentPage = pageId;

    // Sidebar active state
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === pageId);
    });

    // Page sections
    document.querySelectorAll('.page-section').forEach(sec => sec.classList.add('hidden'));
    const target = document.getElementById(`page-${pageId}`);
    if (target) target.classList.remove('hidden');

    // Load data
    switch (pageId) {
      case 'dashboard': this._loadDashboard(false); break;
      case 'leads':     this._loadLeads(false);     break;
      case 'setup':     this._loadSetup();           break;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Dashboard
  // ──────────────────────────────────────────────────────────────────

  async _loadDashboard(silent = false) {
    try {
      const res  = await this._api('/api/dashboard/stats', {}, silent);
      const kpis = res.data.kpis || {};
      const conn = res.data.connectionStatus || {};

      this._setText('kpi-wa-leads',       kpis.leadsCreatedViaWhatsApp  ?? kpis.totalCustomers ?? 0);
      this._setText('kpi-today-leads',    kpis.todaysWhatsAppLeads      ?? kpis.todaysLeads    ?? 0);
      this._setText('kpi-synced',         kpis.totalLeads               ?? 0);
      this._setText('kpi-active-chats',   kpis.activeConversations      ?? 0);
      this._setText('kpi-auto-replies',   kpis.automatedMessages        ?? 0);
      this._setText('kpi-campaign-leads', kpis.campaignMessages         ?? 0);

      // Connection pills
      const b24ok = conn.bitrix24?.ok;
      const waok  = conn.whatsbox?.ok;
      this._setStatusPill('status-b24', b24ok, 'Bitrix24 Connected', 'Bitrix24 Disconnected');
      this._setStatusPill('status-wa',  waok,  'WhatsApp Ready',     'WhatsApp Unconfigured');

      // Recent leads (WhatsApp-created, synced to Bitrix)
      const leadsRes = await this._api('/api/contacts?createdVia=WHATSAPP&limit=10', {}, silent);
      this._renderRecentLeads(leadsRes.data.items || []);
    } catch (err) {
      if (!silent) console.error('Dashboard load failed:', err.message);
    }
  }

  _renderRecentLeads(items) {
    const tbody = document.getElementById('table-recent');
    if (!tbody) return;

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">
        <div class="empty-icon">📲</div>
        No WhatsApp leads yet.<br>
        <span style="color:var(--text-dim);font-size:12px;">Send a WhatsApp message — a Bitrix24 lead will appear here automatically.</span>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(l => this._leadRow(l, 6)).join('');
  }

  // ──────────────────────────────────────────────────────────────────
  // All Leads page
  // ──────────────────────────────────────────────────────────────────

  async _loadLeads(silent = false) {
    try {
      const res = await this._api('/api/contacts?createdVia=WHATSAPP&limit=500', {}, silent);
      this.state.leads = res.data.items || [];
      this._renderLeadsTable(this.state.leads);
    } catch (err) {
      if (!silent) console.error('Leads load failed:', err.message);
    }
  }

  _renderLeadsTable(leads) {
    const tbody  = document.getElementById('table-leads');
    const countEl = document.getElementById('leads-count');
    if (!tbody) return;

    if (countEl) countEl.textContent = `${leads.length} lead${leads.length !== 1 ? 's' : ''}`;

    if (!leads.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">
        <div class="empty-icon">🎯</div>
        No WhatsApp leads found.<br>
        <span style="color:var(--text-dim);font-size:12px;">Leads created from WhatsApp messages, campaigns &amp; auto-replies will appear here.</span>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = leads.map(l => this._leadRow(l, 7)).join('');
  }

  _leadRow(l, cols) {
    const name   = l.name || `${l.firstName || ''} ${l.lastName || ''}`.trim() || 'WhatsApp User';
    const source = l.createdVia === 'WHATSAPP' ? `<span class="badge badge-green">📲 WhatsApp</span>` : `<span class="badge badge-muted">${l.createdVia || '—'}</span>`;
    const sync   = l.syncStatus === 'SYNCED'
      ? `<span class="badge badge-green">✓ Synced</span>`
      : l.syncStatus === 'FAILED'
        ? `<span class="badge badge-red">✗ Failed</span>`
        : `<span class="badge badge-orange">⏳ Pending</span>`;

    const b24 = l.bitrix24ContactId
      ? `<span class="badge badge-blue">#${l.bitrix24ContactId}</span>`
      : `<span style="color:var(--text-dim)">—</span>`;

    const created = new Date(l.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    if (cols === 6) {
      // Recent leads table (dashboard) — no email column
      return `<tr>
        <td style="font-weight:600;">${this._esc(name)}</td>
        <td><code style="font-size:12px;color:var(--blue);">${l.whatsappPhone}</code></td>
        <td>${b24}</td>
        <td>${source}</td>
        <td>${sync}</td>
        <td style="color:var(--text-muted);font-size:12px;">${created}</td>
      </tr>`;
    }

    // Full leads table
    return `<tr>
      <td style="font-weight:600;">${this._esc(name)}</td>
      <td><code style="font-size:12px;color:var(--blue);">${l.whatsappPhone}</code></td>
      <td style="color:var(--text-muted);">${l.email ? this._esc(l.email) : '—'}</td>
      <td>${b24}</td>
      <td>${source}</td>
      <td>${sync}</td>
      <td style="color:var(--text-muted);font-size:12px;">${created}</td>
    </tr>`;
  }

  _filterLeads(query) {
    if (!query.trim()) {
      this._renderLeadsTable(this.state.leads);
      return;
    }
    const q  = query.toLowerCase();
    const filtered = this.state.leads.filter(l =>
      [l.name, l.firstName, l.lastName, l.whatsappPhone, l.email, String(l.bitrix24ContactId || '')]
        .some(v => v && String(v).toLowerCase().includes(q))
    );
    this._renderLeadsTable(filtered);
  }

  // ──────────────────────────────────────────────────────────────────
  // Setup page
  // ──────────────────────────────────────────────────────────────────

  async _loadSetup() {
    try {
      const res = await this._api('/api/tenant/setup-status');
      const d   = res.data || {};

      const b24El = document.getElementById('input-b24-url');
      const waEl  = document.getElementById('input-wa-webhook');
      const chEl  = document.getElementById('input-wa-channel');

      if (d.bitrix24WebhookUrl && b24El) {
        b24El.value = d.bitrix24WebhookUrl.length > 8 ? '●●●●●●●●' : '';
        b24El.dataset.masked = '1';
      }
      if (d.whatsappWebhookUrl && waEl) {
        waEl.value = '●●●●●●●●';
        waEl.dataset.masked = '1';
      }
      if (d.whatsboxChannelId && chEl) {
        chEl.value = d.whatsboxChannelId;
      }
    } catch (err) {
      console.error('Setup load failed:', err.message);
    }
  }

  async _handleSaveSetup() {
    const b24El = document.getElementById('input-b24-url');
    const waEl  = document.getElementById('input-wa-webhook');
    const chEl  = document.getElementById('input-wa-channel');
    const btn   = document.getElementById('btn-save-setup');

    const payload = {};
    if (chEl?.value)                                            payload.whatsboxChannelId   = chEl.value;
    if (waEl?.value && waEl.dataset.masked !== '1')            payload.whatsappWebhookUrl  = waEl.value;
    if (b24El?.value && b24El.dataset.masked !== '1')          payload.bitrix24WebhookUrl  = b24El.value;

    if (!Object.keys(payload).length) {
      this._showSetupMsg('No changes to save. Enter at least one URL.', 'warning');
      return;
    }

    btn.classList.add('btn-loading'); btn.disabled = true;
    this._showSetupMsg('Saving and testing connection...', 'info');

    try {
      const res = await this._api('/api/tenant/setup', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const b24ok = res.data?.connectionStatus?.bitrix24?.ok;
      const waok  = res.data?.connectionStatus?.whatsbox?.ok;

      this._showSetupMsg(
        `✅ Webhooks saved!  Bitrix24: ${b24ok ? '✅ Connected' : '⚠️ Unreachable'} · WhatsApp: ${waok ? '✅ Ready' : '⚠️ Unconfigured'}`,
        b24ok ? 'success' : 'warning'
      );

      // Clear masked flags so updated values are not re-masked
      if (b24El) { b24El.dataset.masked = '1'; }
      if (waEl)  { waEl.dataset.masked  = '1'; }

      await this._fetchProfile();
      this._loadDashboard(true);
    } catch (err) {
      this._showSetupMsg(`❌ ${err.message}`, 'error');
    } finally {
      btn.classList.remove('btn-loading'); btn.disabled = false;
    }
  }

  async _handleTestConn() {
    const btn = document.getElementById('btn-test-conn');
    btn.classList.add('btn-loading'); btn.disabled = true;
    this._showSetupMsg('Testing connections...', 'info');

    try {
      const res = await this._api('/api/tenant/test-connection', { method: 'POST' });
      const b24 = res.data.bitrix24 || {};
      const wa  = res.data.whatsbox  || {};
      this._showSetupMsg(
        `Bitrix24: ${b24.ok ? '✅ Connected' : `❌ ${b24.error || 'Failed'}`}
         &nbsp;|&nbsp; WhatsApp: ${wa.ok ? '✅ Ready' : `⚠️ ${wa.error || wa.note || 'Unconfigured'}`}`,
        (b24.ok && wa.ok) ? 'success' : 'warning'
      );
    } catch (err) {
      this._showSetupMsg(`❌ ${err.message}`, 'error');
    } finally {
      btn.classList.remove('btn-loading'); btn.disabled = false;
    }
  }

  _showSetupMsg(text, type = 'info') {
    const el = document.getElementById('setup-status');
    if (!el) return;
    el.className = `status-box ${type}`;
    el.innerHTML = text;
    el.classList.remove('hidden');
  }

  // ──────────────────────────────────────────────────────────────────
  // Auto-Sync
  // ──────────────────────────────────────────────────────────────────

  async _runSync(statusElId, textElId) {
    const statusEl = document.getElementById(statusElId);
    const textEl   = textElId ? document.getElementById(textElId) : null;

    const setText = (msg, type = 'info') => {
      if (statusEl) {
        statusEl.className = `status-box ${type}`;
        if (textEl) textEl.textContent = msg;
        else statusEl.innerHTML = msg;
        statusEl.classList.remove('hidden');
      }
    };

    // Disable all sync buttons during sync
    ['btn-sync-dash', 'btn-sync-leads', 'btn-sync-setup'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = true; el.classList.add('btn-loading'); }
    });

    setText('⚡ Syncing contacts from Bitrix24 — this may take a moment...', 'info');

    // Show animated bar
    const barWrap = document.getElementById('sync-bar-wrap');
    const bar     = document.getElementById('sync-bar');
    if (barWrap) barWrap.style.display = 'block';
    if (bar) bar.style.width = '15%';

    try {
      if (bar) bar.style.width = '60%';
      const res = await this._api('/api/tenant/sync', { method: 'POST' });
      if (bar) bar.style.width = '100%';

      if (res.data.ok) {
        const { created, updated, skipped, synced } = res.data;
        setText(
          `✅ Sync complete — ${synced} contacts processed: ${created} new · ${updated} updated · ${skipped} skipped`,
          'success'
        );
        // Refresh leads immediately after sync
        this._loadDashboard(true);
        if (this.state.currentPage === 'leads') this._loadLeads(false);
      } else {
        setText(`❌ Sync failed: ${res.data.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      setText(`❌ ${err.message}`, 'error');
    } finally {
      ['btn-sync-dash', 'btn-sync-leads', 'btn-sync-setup'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = false; el.classList.remove('btn-loading'); }
      });
      setTimeout(() => {
        if (barWrap) barWrap.style.display = 'none';
        if (bar) bar.style.width = '0%';
      }, 2000);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // API helper
  // ──────────────────────────────────────────────────────────────────

  async _api(url, options = {}, silent = false) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res  = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      this._logout();
      throw new Error('Session expired — please sign in again.');
    }
    if (!res.ok) {
      throw new Error(data.message || `Request failed (${res.status})`);
    }
    return data;
  }

  // ──────────────────────────────────────────────────────────────────
  // DOM helpers
  // ──────────────────────────────────────────────────────────────────

  _setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  _setStatusPill(id, isOnline, onText, offText) {
    const el = document.getElementById(id);
    if (!el) return;
    if (isOnline) {
      el.className = 'status-pill status-online';
      el.innerHTML = `<span class="status-dot"></span> ${onText}`;
    } else {
      el.className = 'status-pill status-offline';
      el.innerHTML = `<span class="status-dot"></span> ${offText}`;
    }
  }

  _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
