let allClients = [];
let impersonating = null;
let activeClientEmail = null;
const PLAN_OPTIONS = ['starter', 'pro', 'team', 'agency', 'enterprise'];
const STATUS_OPTIONS = ['active', 'paused', 'terminated', 'provisioning', 'error'];
const HEALTH_OPTIONS = ['healthy', 'unhealthy', 'pending', 'unknown'];
const updatesAdapter = window.OpenClawUpdatesAdapter || null;
const ADMIN_THEME_KEY = 'clawops_admin_theme';
let tenantVersionMap = new Map();
let updateRuns = [];
let selectedUpdateRunId = null;
let runDetailPollTimer = null;
let confirmResolver = null;
let updateRunsRefreshTimer = null;
let currentRunDetails = null;
let activeAdminSection = 'tenants';
let updatesMode = 'easy';
let easyDryRunState = null;
let easyDryRunPollTimer = null;
let versionCatalogState = null;
let waitlistEntries = [];
let hasLoadedWaitlist = false;

// Auth helper — adds Bearer token from localStorage
function authHeaders(extra = {}) {
    const token = localStorage.getItem('clawops_session_token');
    return token ? { 'Authorization': `Bearer ${token}`, ...extra } : { ...extra };
}
function authFetch(url, opts = {}) {
    opts.headers = authHeaders(opts.headers || {});
    return fetch(url, opts);
}

function formatCompactNumber(n) {
    const value = Number(n || 0);
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return String(value);
}

function formatUsd(value) {
    const n = Number(value || 0);
    if (n > 0 && n < 0.01) return '<$0.01';
    return `$${n.toFixed(2)}`;
}

function escapeHtml(input) {
    return String(input ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function safeId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getStoredAdminTheme() {
    const stored = localStorage.getItem(ADMIN_THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return null;
}

function preferredAdminTheme() {
    const stored = getStoredAdminTheme();
    if (stored) return stored;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
}

function updateThemeToggleLabel(theme) {
    const btn = document.getElementById('adminThemeToggle');
    if (!btn) return;
    if (theme === 'dark') {
        btn.textContent = '☀ Light';
        btn.title = 'Switch to light mode';
    } else {
        btn.textContent = '🌙 Dark';
        btn.title = 'Switch to dark mode';
    }
}

function applyAdminTheme(theme, announce = false) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem(ADMIN_THEME_KEY, nextTheme);
    updateThemeToggleLabel(nextTheme);
    if (announce) showToast(`Switched to ${nextTheme} mode`, 'success', 1400);
}

function toggleAdminTheme() {
    const current = document.documentElement.getAttribute('data-theme') || preferredAdminTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    applyAdminTheme(next, true);
}

function initAdminTheme() {
    applyAdminTheme(preferredAdminTheme(), false);
    const btn = document.getElementById('adminThemeToggle');
    if (btn) btn.addEventListener('click', toggleAdminTheme);
}

function formatDateTime(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString();
}

function formatOpenClawVersion(value) {
    const v = String(value || '').trim();
    if (!v || v === 'unknown') return '—';
    return v;
}

function normalizeUpdateStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    if (!value) return 'unknown';
    if (value.includes('success')) return 'success';
    if (value.includes('fail') || value.includes('error')) return 'failed';
    if (value.includes('run') || value.includes('progress') || value.includes('queue')) return 'running';
    if (value.includes('pending')) return 'pending';
    return value;
}

function updateStatusLabel(status) {
    const normalized = normalizeUpdateStatus(status);
    if (normalized === 'success') return 'Success';
    if (normalized === 'failed') return 'Failed';
    if (normalized === 'running') return 'Running';
    if (normalized === 'pending') return 'Pending';
    if (normalized === 'unknown') return 'Unknown';
    return normalized;
}

function statusChipClass(status) {
    const normalized = normalizeUpdateStatus(status);
    if (normalized === 'success') return 'success';
    if (normalized === 'failed') return 'failed';
    if (normalized === 'running') return 'running';
    if (normalized === 'pending') return 'pending';
    return 'neutral';
}

function renderStatusChip(status) {
    const css = statusChipClass(status);
    const label = updateStatusLabel(status);
    return `<span class="status-chip ${css}">${escapeHtml(label)}</span>`;
}

function applyTenantMetadataToClients(clients) {
    const mapped = (clients || []).map((client) => {
        const bots = (client.bots || []).map((bot) => {
            const tenantMeta = tenantVersionMap.get(bot.tenantId);
            if (!tenantMeta) return bot;
            return {
                ...bot,
                openClawVersion: tenantMeta.openClawVersion || bot.openClawVersion || null,
                lastUpdateStatus: tenantMeta.lastUpdateStatus || bot.lastUpdateStatus || null,
                lastUpdateTime: tenantMeta.lastUpdateTime || bot.lastUpdateTime || null,
            };
        });
        return { ...client, bots };
    });
    return mapped;
}

function applyTenantMetadataToClient(client) {
    if (!client) return client;
    const wrapped = applyTenantMetadataToClients([client]);
    return wrapped[0] || client;
}

function currentTenantRows() {
    const rows = [];
    for (const client of allClients || []) {
        for (const bot of client.bots || []) {
            rows.push({
                tenantId: bot.tenantId,
                name: bot.name || bot.tenantId,
                email: client.email,
                status: bot.status || 'active',
            });
        }
    }
    rows.sort((a, b) => a.tenantId.localeCompare(b.tenantId));
    return rows;
}

async function refreshTenantVersionMap({ applyToClients = true, rerender = false, silent = true } = {}) {
    if (!updatesAdapter || typeof updatesAdapter.getTenantVersions !== 'function') return;
    try {
        const payload = await updatesAdapter.getTenantVersions();
        const rows = Array.isArray(payload?.tenants) ? payload.tenants : [];
        tenantVersionMap = new Map(rows.map((row) => [row.tenantId, row]));
        if (applyToClients && allClients.length) {
            allClients = applyTenantMetadataToClients(allClients);
        }
        renderRolloutTenantSelection();
        if (!versionCatalogState || !(versionCatalogState.recentVersions || []).length) {
            versionCatalogState = buildFallbackVersionCatalog();
        }
        renderVersionCatalog();
        if (rerender) filterClients();
    } catch (err) {
        if (!silent) showToast(`Failed to load tenant versions: ${err.message}`, 'error');
    }
}

function openModal(title, mode = 'text') {
    document.getElementById('logTitle').textContent = title;
    const body = document.getElementById('logBody');
    body.classList.toggle('rich', mode === 'rich');
    body.textContent = 'Loading...';
    document.getElementById('logModal').classList.add('open');
}

function switchAdminSection(sectionName) {
    activeAdminSection = sectionName || 'tenants';
    const tenantsVisible = activeAdminSection === 'tenants';
    const waitlistVisible = activeAdminSection === 'waitlist';
    const updatesVisible = activeAdminSection === 'updates';
    const secretsVisible = activeAdminSection === 'secrets';

    const searchBar = document.getElementById('adminTenantsSearchBar');
    const resultsInfo = document.getElementById('resultsInfo');
    const clientList = document.getElementById('clientList');
    const waitlistBlock = document.getElementById('adminWaitlistBlock');
    const updatesBlock = document.getElementById('openclawUpdatesRoot');
    const secretsBlock = document.getElementById('adminSecretsBlock');

    if (searchBar) searchBar.style.display = tenantsVisible ? 'flex' : 'none';
    if (resultsInfo) resultsInfo.style.display = tenantsVisible ? 'block' : 'none';
    if (clientList) clientList.style.display = tenantsVisible ? 'block' : 'none';
    if (waitlistBlock) waitlistBlock.classList.toggle('admin-section-hidden', !waitlistVisible);
    if (updatesBlock) updatesBlock.classList.toggle('admin-section-hidden', !updatesVisible);
    if (secretsBlock) secretsBlock.classList.toggle('admin-section-hidden', !secretsVisible);

    document.querySelectorAll('#adminNav .nav-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.section === activeAdminSection);
    });

    if (waitlistVisible && !hasLoadedWaitlist) {
        loadWaitlist().catch(() => {});
    }
}

function initAdminSectionNav() {
    document.querySelectorAll('#adminNav .nav-btn').forEach((btn) => {
        btn.addEventListener('click', () => switchAdminSection(btn.dataset.section));
    });
    switchAdminSection('tenants');
}

async function loadClients() {
    try {
        console.log('[admin] loadClients called, token in localStorage:', localStorage.getItem('clawops_session_token') ? 'YES' : 'NO');
        const res = await authFetch('/api/admin/clients');
        console.log('[admin] /api/admin/clients response status:', res.status);
        if (res.status === 403) {
            document.getElementById('clientList').innerHTML = '<p style="color:var(--red);text-align:center;padding:40px;">Admin access required.</p>';
            return;
        }
        if (res.status === 401) {
            document.getElementById('clientList').innerHTML = '<p style="color:var(--red);text-align:center;padding:40px;">Not authenticated. <a href="/?login=true" style="color:var(--primary);">Log in</a></p>';
            return;
        }
        const data = await res.json().catch(() => ({}));
        console.log('[admin] clients data:', data.ok, 'count:', data.clients?.length);
        if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);

        allClients = data.clients || [];
        const s = data.summary || {
            totalClients: allClients.length,
            activeClients: allClients.filter(c => (c.activeBots || 0) > 0).length,
            activeBots: allClients.reduce((sum, c) => sum + (c.activeBots || 0), 0),
            totalBots: allClients.reduce((sum, c) => sum + (c.totalBots || 0), 0),
            terminatedBots: Math.max(0, allClients.reduce((sum, c) => sum + (c.totalBots || 0), 0) - allClients.reduce((sum, c) => sum + (c.activeBots || 0), 0)),
        };

        document.getElementById('statClients').textContent = s.totalClients;
        document.getElementById('statActiveClients').textContent = s.activeClients;
        document.getElementById('statActiveBots').textContent = s.activeBots;
        document.getElementById('statTotalBots').textContent = `of ${s.totalBots} total`;
        document.getElementById('statTerminated').textContent = s.terminatedBots;
        const tokensEl = document.getElementById('statMonthTokens');
        const msgsEl = document.getElementById('statMonthMessages');
        const costEl = document.getElementById('statMonthCost');
        if (tokensEl) tokensEl.textContent = formatCompactNumber(s.monthlyTokens || 0);
        if (msgsEl) msgsEl.textContent = formatCompactNumber(s.monthlyMessages || 0);
        if (costEl) costEl.textContent = formatUsd(s.monthlyCost || 0);

        renderClients(allClients);
        refreshTenantVersionMap({ applyToClients: true, rerender: true, silent: true }).catch(() => {});
    } catch (err) {
        document.getElementById('clientList').innerHTML = `<p style="color:var(--red);text-align:center;padding:40px;">Error: ${err.message}</p>`;
        ['statClients', 'statActiveClients', 'statActiveBots', 'statTerminated', 'statMonthTokens', 'statMonthMessages', 'statMonthCost'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '!';
        });
        const totalEl = document.getElementById('statTotalBots');
        if (totalEl) totalEl.textContent = 'stats unavailable';
        const summaryEl = document.getElementById('resultsInfo');
        if (summaryEl) summaryEl.textContent = `Failed to load clients: ${err.message}`;
    }
}

function renderClients(clients) {
    const el = document.getElementById('clientList');
    const summaryEl = document.getElementById('resultsInfo');
    if (summaryEl) {
        const total = allClients.length;
        summaryEl.textContent = `Showing ${clients.length} of ${total} client${total === 1 ? '' : 's'}`;
    }
    if (clients.length === 0) {
        el.innerHTML = '<p style="color:var(--gray);text-align:center;padding:40px;">No clients found.</p>';
        return;
    }

    el.innerHTML = clients.map(c => `
        <div class="client-card" id="client-${btoa(c.email)}">
            <div class="client-header" tabindex="0" role="button" aria-expanded="false" onclick="toggleBots('${btoa(c.email)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleBots('${btoa(c.email)}');}">
                <div class="client-email">${c.email}</div>
                <div class="client-meta">
                    <span class="active">${c.activeBots} active</span>
                    <span>${c.totalBots} total</span>
                    <span>${formatCompactNumber(c.usageMonth?.tokens || 0)} tokens/mo</span>
                    <span>${formatCompactNumber(c.usageMonth?.messages || 0)} msgs/mo</span>
                    <span>${formatUsd(c.usageMonth?.cost || 0)}/mo</span>
                    <span>First: ${c.firstSeen ? new Date(c.firstSeen).toLocaleDateString() : '—'}</span>
                    <span>Last: ${c.lastActive ? new Date(c.lastActive).toLocaleDateString() : '—'}</span>
                </div>
                <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="event.stopPropagation();viewClientDetails(decodeURIComponent('${encodeURIComponent(c.email)}'))">🧩 Manage</button>
                <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="event.stopPropagation();impersonate(decodeURIComponent('${encodeURIComponent(c.email)}'))">👁 View as</button>
                <span class="expand-icon">▶</span>
            </div>
            <div class="client-bots" id="bots-${btoa(c.email)}">
                ${c.bots.length ? c.bots.map(b => `
                    <div class="bot-row">
                        <span class="pill ${b.status}">${b.status}</span>
                        <span class="bot-name">${b.name || b.tenantId}</span>
                        <span style="color:var(--gray);font-size:11px;">${b.tenantId}</span>
                        <span style="color:var(--gray);font-size:11px;">${b.health}</span>
                        <span style="color:var(--gray);font-size:11px;">v${escapeHtml(formatOpenClawVersion(b.openClawVersion))}</span>
                        <span>${renderStatusChip(b.lastUpdateStatus || 'unknown')}</span>
                        <span style="color:var(--gray);font-size:11px;">${escapeHtml(formatDateTime(b.lastUpdateTime))}</span>
                        <span style="color:var(--gray);font-size:11px;">${formatCompactNumber(b.usageMonth?.tokens || 0)} tok</span>
                        <span style="color:var(--gray);font-size:11px;">${formatCompactNumber(b.usageMonth?.messages || 0)} msg</span>
                        <span style="color:var(--gray);font-size:11px;">${formatUsd(b.usageMonth?.cost || 0)}</span>
                        <div class="bot-actions">
                            ${b.status === 'active' ? `
                                <button onclick="viewLogs('${b.tenantId}')">📋 Logs</button>
                                <button onclick="restartBot('${b.tenantId}',this)">🔄 Restart</button>
                                <button onclick="viewConfig('${b.tenantId}')">⚙️ Config</button>
                                <button onclick="openChat('${b.tenantId}', '${(b.name || b.tenantId).replace(/'/g, "\\'")}')">💬 Chat</button>
                                <button onclick="backupBot('${b.tenantId}')">💾 Backup</button>
                                <button onclick="showBackups('${b.tenantId}')">📦 Restore</button>
                            ` : ''}
                        </div>
                    </div>
                `).join('') : '<div style="padding:12px 0;color:var(--gray);font-size:12px;">No bot records available.</div>'}
            </div>
        </div>
    `).join('');
}

function toggleBots(id) {
    const el = document.getElementById('bots-' + id);
    if (el) {
        el.classList.toggle('open');
        // TASK-408: Update aria-expanded
        const header = el.previousElementSibling;
        if (header) {
            const isOpen = el.classList.contains('open');
            header.setAttribute('aria-expanded', isOpen);
            header.classList.toggle('open', isOpen);
        }
    }
}

function filterClients() {
    const q = document.getElementById('searchInput').value.toLowerCase();
    const status = document.getElementById('filterStatus').value;
    
    let filtered = allClients;
    if (q) filtered = filtered.filter(c => c.email.toLowerCase().includes(q));
    if (status === 'active') filtered = filtered.filter(c => c.activeBots > 0);
    if (status === 'none') filtered = filtered.filter(c => c.activeBots === 0);
    
    renderClients(filtered);
}

function normalizeWaitlistStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'activated') return 'activated';
    if (value === 'rejected') return 'rejected';
    return 'pending';
}

function renderWaitlistStatusBadge(status) {
    const normalized = normalizeWaitlistStatus(status);
    if (normalized === 'activated') {
        return '<span class="status-chip activated">Activated</span>';
    }
    if (normalized === 'rejected') {
        return '<span class="status-chip rejected">Rejected</span>';
    }
    return '<span class="status-chip pending-review">Pending</span>';
}

function formatWaitlistDate(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString();
}

function inlinePlanPicker(containerEl, initialPlan = 'starter') {
    return new Promise((resolve) => {
        if (!containerEl) {
            resolve(null);
            return;
        }

        const originalHtml = containerEl.innerHTML;
        const initial = PLAN_OPTIONS.includes(initialPlan) ? initialPlan : 'starter';
        const optionsHtml = PLAN_OPTIONS.map((plan) => (
            `<option value="${plan}" ${plan === initial ? 'selected' : ''}>${plan.toUpperCase()}</option>`
        )).join('');

        containerEl.innerHTML = `
            <span class="inline-plan-picker">
                <span class="label">Plan</span>
                <select>${optionsHtml}</select>
                <button class="activate" type="button">Activate</button>
                <button class="cancel" type="button">Cancel</button>
            </span>
        `;

        const selectEl = containerEl.querySelector('select');
        const activateBtn = containerEl.querySelector('.activate');
        const cancelBtn = containerEl.querySelector('.cancel');
        const finish = (selectedPlan) => {
            containerEl.innerHTML = originalHtml;
            resolve(selectedPlan);
        };

        activateBtn?.addEventListener('click', () => {
            finish(selectEl?.value || initial);
        });
        cancelBtn?.addEventListener('click', () => finish(null));
    });
}

function renderWaitlist(entries) {
    const waitlistEl = document.getElementById('waitlistList');
    const resultsEl = document.getElementById('waitlistResultsInfo');
    if (!waitlistEl) return;

    if (resultsEl) {
        resultsEl.textContent = `${entries.length} waitlist entr${entries.length === 1 ? 'y' : 'ies'}`;
    }

    if (!entries.length) {
        waitlistEl.innerHTML = '<p style="color:var(--gray);font-size:13px;">No waitlist entries found.</p>';
        return;
    }

    waitlistEl.innerHTML = entries.map((entry) => {
        const normalizedStatus = normalizeWaitlistStatus(entry.status);
        const rowId = safeId(entry.email);
        const canReview = normalizedStatus === 'pending';
        const encodedEmail = encodeURIComponent(entry.email || '');
        const name = entry.name || [entry.firstName, entry.lastName].filter(Boolean).join(' ').trim() || '—';
        const phone = entry.phone || '—';
        const createdAt = formatWaitlistDate(entry.createdAt);
        return `
            <div class="waitlist-row">
                <div class="waitlist-main">
                    <div class="waitlist-name">${escapeHtml(name)}</div>
                    <div class="waitlist-email">${escapeHtml(entry.email || '—')}</div>
                </div>
                <div class="waitlist-col">${escapeHtml(phone)}</div>
                <div class="waitlist-col">${escapeHtml(createdAt)}<br>${renderWaitlistStatusBadge(normalizedStatus)}</div>
                <div class="waitlist-actions" id="waitlist-actions-${rowId}">
                    ${canReview ? `
                        <button class="btn btn-primary" style="padding:6px 10px;font-size:11px;" onclick="startWaitlistActivation('${encodedEmail}', '${rowId}')">Activate</button>
                        <button class="btn btn-danger" style="padding:6px 10px;font-size:11px;" onclick="rejectWaitlistEntry('${encodedEmail}', '${rowId}')">Reject</button>
                    ` : '<span style="color:var(--gray);font-size:12px;">No actions</span>'}
                </div>
            </div>
        `;
    }).join('');
}

async function loadWaitlist() {
    const waitlistEl = document.getElementById('waitlistList');
    const resultsEl = document.getElementById('waitlistResultsInfo');
    try {
        if (waitlistEl && !hasLoadedWaitlist) {
            waitlistEl.innerHTML = '<p style="color:var(--gray);font-size:13px;">Loading waitlist...</p>';
        }

        const res = await authFetch('/api/admin/waitlist');
        if (res.status === 403) {
            if (waitlistEl) waitlistEl.innerHTML = '<p style="color:var(--red);font-size:13px;">Admin access required.</p>';
            return;
        }
        if (res.status === 401) {
            if (waitlistEl) waitlistEl.innerHTML = '<p style="color:var(--red);font-size:13px;">Not authenticated. <a href="/?login=true" style="color:var(--primary);">Log in</a></p>';
            return;
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
        waitlistEntries = Array.isArray(data.waitlist) ? data.waitlist : [];
        hasLoadedWaitlist = true;
        renderWaitlist(waitlistEntries);
    } catch (err) {
        if (waitlistEl) waitlistEl.innerHTML = `<p style="color:var(--red);font-size:13px;">Failed to load waitlist: ${escapeHtml(err.message)}</p>`;
        if (resultsEl) resultsEl.textContent = 'Waitlist unavailable';
    }
}

async function startWaitlistActivation(encodedEmail, rowId) {
    const email = decodeURIComponent(encodedEmail);
    const actionEl = document.getElementById(`waitlist-actions-${rowId}`);
    const selectedPlan = await inlinePlanPicker(actionEl, 'starter');
    if (!selectedPlan) return;

    try {
        const res = await authFetch('/api/admin/waitlist/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, plan: selectedPlan }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to activate waitlist entry');
        showToast(`Activated ${email} on ${selectedPlan.toUpperCase()}`, 'success');
        await loadWaitlist();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function rejectWaitlistEntry(encodedEmail, rowId) {
    const email = decodeURIComponent(encodedEmail);
    const actionEl = document.getElementById(`waitlist-actions-${rowId}`);
    if (!actionEl) {
        showToast('Action panel unavailable', 'error');
        return;
    }
    const confirmed = await inlineConfirm(actionEl, `Reject ${email}?`);
    if (!confirmed) return;

    try {
        const res = await authFetch('/api/admin/waitlist/reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to reject waitlist entry');
        showToast(`Rejected ${email}`, 'success');
        await loadWaitlist();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ─── Bot actions ───

async function viewLogs(tenantId) {
    openModal(`Logs — ${tenantId}`, 'text');

    try {
        const res = await authFetch(`/api/admin/bots/${tenantId}?action=logs&lines=100`);
        const data = await res.json();
        document.getElementById('logBody').textContent = data.ok ? data.logs.join('\n') : `Error: ${data.error}`;
    } catch (err) {
        document.getElementById('logBody').textContent = `Failed: ${err.message}`;
    }
}

async function viewConfig(tenantId) {
    openModal(`Config — ${tenantId}`, 'text');

    try {
        const res = await authFetch(`/api/admin/bots/${tenantId}?action=config`);
        const data = await res.json();
        if (!data.ok) {
            const detail = data.detail ? `\nDetail: ${data.detail}` : '';
            document.getElementById('logBody').textContent = `Error: ${data.error || 'Unable to load config'}${detail}`;
            return;
        }
        const header = data.path ? `Path: ${data.path}\n\n` : '';
        if (data.config && typeof data.config === 'object') {
            document.getElementById('logBody').textContent = `${header}${JSON.stringify(data.config, null, 2)}`;
        } else if (typeof data.raw === 'string') {
            document.getElementById('logBody').textContent = `${header}${data.raw}`;
        } else {
            document.getElementById('logBody').textContent = `${header}Config file is empty or unreadable.`;
        }
    } catch (err) {
        document.getElementById('logBody').textContent = `Failed: ${err.message}`;
    }
}

async function viewClientDetails(email) {
    activeClientEmail = email;
    openModal(`Client Manager — ${email}`, 'rich');

    try {
        const res = await authFetch(`/api/admin/clients/${encodeURIComponent(email)}`);
        const data = await res.json();
        if (!res.ok || !data.ok || !data.client) {
            document.getElementById('logBody').textContent = `Error: ${data.error || 'Failed to load client detail'}`;
            return;
        }

        const c = applyTenantMetadataToClient(data.client);
        const profile = c.profile || {};
        const team = data.team || {};
        const teamExists = Boolean(team.teamId);
        const encodedEmail = encodeURIComponent(email);
        const planValue = (team.plan || 'starter').toLowerCase();
        const planOptions = PLAN_OPTIONS.map(p => `<option value="${p}" ${p === planValue ? 'selected' : ''}>${p.toUpperCase()}</option>`).join('');
        const tenantRows = (c.bots || []).map((bot) => {
            const rowId = safeId(bot.tenantId);
            const encodedTenant = encodeURIComponent(bot.tenantId);
            const statusOptions = STATUS_OPTIONS.map(s => `<option value="${s}" ${bot.status === s ? 'selected' : ''}>${s}</option>`).join('');
            const healthValue = bot.health || 'unknown';
            const healthOptions = HEALTH_OPTIONS.map(s => `<option value="${s}" ${healthValue === s ? 'selected' : ''}>${s}</option>`).join('');
            return `
                <tr>
                    <td>
                        <div style="font-weight:600;">${escapeHtml(bot.tenantId)}</div>
                        <div class="detail-meta">${escapeHtml(bot.endpoint || 'no endpoint')}</div>
                    </td>
                    <td><input class="crud-input" id="tenant-name-${rowId}" value="${escapeHtml(bot.name || bot.tenantId)}"></td>
                    <td><select class="crud-select" id="tenant-status-${rowId}">${statusOptions}</select></td>
                    <td><select class="crud-select" id="tenant-health-${rowId}">${healthOptions}</select></td>
                    <td>v${escapeHtml(formatOpenClawVersion(bot.openClawVersion))}</td>
                    <td>${renderStatusChip(bot.lastUpdateStatus || 'unknown')}</td>
                    <td>${escapeHtml(formatDateTime(bot.lastUpdateTime))}</td>
                    <td>${formatCompactNumber(bot.usageMonth?.tokens || 0)} tok</td>
                    <td>${formatCompactNumber(bot.usageMonth?.messages || 0)} msg</td>
                    <td>${formatUsd(bot.usageMonth?.cost || 0)}</td>
                    <td>
                        <div class="row-actions">
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="saveTenantChanges('${encodedEmail}','${encodedTenant}','${rowId}')">Save</button>
                            <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="archiveTenant('${encodedEmail}','${encodedTenant}',this)">Archive</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        const detailHtml = `
            <div class="detail-grid">
                <div class="detail-card">
                    <div class="detail-title">Customer Profile (Person)</div>
                    <div class="detail-meta"><strong>Email:</strong> ${escapeHtml(c.email)}</div>
                    <div class="crud-field">
                        <label class="crud-label" for="client-profile-name">Full Name</label>
                        <input id="client-profile-name" class="crud-input" value="${escapeHtml(profile.name || '')}" maxlength="120" placeholder="Client name">
                    </div>
                    <div class="crud-field">
                        <label class="crud-label" for="client-profile-phone">Phone</label>
                        <input id="client-profile-phone" class="crud-input" value="${escapeHtml(profile.phone || '')}" maxlength="32" placeholder="+1 555 123 4567">
                    </div>
                    <div class="crud-field">
                        <label class="crud-label" for="client-profile-company">Company</label>
                        <input id="client-profile-company" class="crud-input" value="${escapeHtml(profile.company || '')}" maxlength="120" placeholder="Optional">
                    </div>
                    <div class="detail-meta"><strong>Total bots:</strong> ${c.totalBots}</div>
                    <div class="detail-meta"><strong>Active bots:</strong> ${c.activeBots}</div>
                    <div class="detail-meta"><strong>First seen:</strong> ${c.firstSeen ? new Date(c.firstSeen).toLocaleString() : '—'}</div>
                    <div class="detail-meta"><strong>Last active:</strong> ${c.lastActive ? new Date(c.lastActive).toLocaleString() : '—'}</div>
                    <div class="detail-meta"><strong>Usage this month:</strong> ${formatCompactNumber(c.usageMonth?.tokens || 0)} tokens, ${formatCompactNumber(c.usageMonth?.messages || 0)} messages, ${formatUsd(c.usageMonth?.cost || 0)}</div>
                    <div class="detail-actions">
                        <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;" onclick="saveCustomerProfile('${encodedEmail}')">Save Profile</button>
                        <button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="impersonate(decodeURIComponent('${encodedEmail}'))">Impersonate</button>
                    </div>
                </div>
                <div class="detail-card">
                    <div class="detail-title">Team Workspace (Optional)</div>
                    <div class="detail-meta">${teamExists ? 'Customer has a team workspace.' : 'No team yet. Saving team settings will create one automatically.'}</div>
                    <div class="crud-field">
                        <label class="crud-label" for="client-team-name">Team Name</label>
                        <input id="client-team-name" class="crud-input" value="${escapeHtml(team.name || '')}" maxlength="120" placeholder="${escapeHtml(email.split('@')[0])}">
                    </div>
                    <div class="crud-field">
                        <label class="crud-label" for="client-team-plan">Plan</label>
                        <select id="client-team-plan" class="crud-select">${planOptions}</select>
                    </div>
                    <div class="crud-field">
                        <label class="crud-label" for="client-team-seats">Seats</label>
                        <input id="client-team-seats" class="crud-input" type="number" min="1" max="1000" value="${Number.isFinite(team.seats) ? team.seats : 1}">
                    </div>
                    <div class="crud-field">
                        <label class="crud-label" for="client-admin-notes">Admin Notes</label>
                        <textarea id="client-admin-notes" class="crud-textarea" maxlength="2000">${escapeHtml(team.adminNotes || '')}</textarea>
                    </div>
                    <div class="detail-meta"><strong>Team ID:</strong> ${escapeHtml(team.teamId || '—')}</div>
                    <div class="detail-meta"><strong>Last login:</strong> ${team.lastLoginAt ? new Date(team.lastLoginAt).toLocaleString() : 'Not available'}</div>
                    <div class="detail-meta"><strong>Updated:</strong> ${team.updatedAt ? new Date(team.updatedAt).toLocaleString() : '—'} ${team.updatedBy ? `by ${escapeHtml(team.updatedBy)}` : ''}</div>
                    <div class="detail-actions">
                        <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;" onclick="saveClientTeamSettings('${encodedEmail}')">Save Team Settings</button>
                    </div>
                </div>
            </div>
            <div class="detail-card" style="margin-bottom:12px;">
                <div class="detail-title">Team Members & Roles</div>
                <div class="detail-grid" style="grid-template-columns:2fr 1fr auto;margin-bottom:10px;">
                    <div class="crud-field">
                        <label class="crud-label" for="team-invite-email">Invite Email</label>
                        <input id="team-invite-email" class="crud-input" placeholder="member@company.com">
                    </div>
                    <div class="crud-field">
                        <label class="crud-label" for="team-invite-role">Role</label>
                        <select id="team-invite-role" class="crud-select">
                            <option value="member">MEMBER</option>
                            <option value="admin">ADMIN</option>
                            <option value="viewer">VIEWER</option>
                        </select>
                    </div>
                    <div class="detail-actions" style="align-items:flex-end;">
                        <button class="btn btn-secondary" style="padding:8px 12px;font-size:12px;" onclick="inviteClientTeamMember('${encodedEmail}')">Send Invite</button>
                    </div>
                </div>
                <div id="team-members-panel" class="detail-meta">Loading team members…</div>
            </div>
            <div class="detail-card">
                <div class="detail-title">Tenant Instances</div>
                <table class="crud-table">
                    <thead>
                        <tr>
                            <th>Tenant</th>
                            <th>Name</th>
                            <th>Status</th>
                            <th>Health</th>
                            <th>OpenClaw Version</th>
                            <th>Last Update Status</th>
                            <th>Last Update Time</th>
                            <th>Tokens</th>
                            <th>Msgs</th>
                            <th>Cost</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tenantRows || '<tr><td colspan="11" style="color:#888;">No tenant instances found.</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
        document.getElementById('logBody').innerHTML = detailHtml;
        await loadClientTeamMembers(email);
    } catch (err) {
        document.getElementById('logBody').textContent = `Failed: ${err.message}`;
    }
}

async function saveCustomerProfile(encodedEmail) {
    const email = decodeURIComponent(encodedEmail);
    const name = document.getElementById('client-profile-name')?.value?.trim() || '';
    const phone = document.getElementById('client-profile-phone')?.value?.trim() || '';
    const company = document.getElementById('client-profile-company')?.value?.trim() || '';

    try {
        const res = await authFetch(`/api/admin/clients/${encodeURIComponent(email)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile: { name, phone, company } })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to update customer profile');
        }
        showToast('Customer profile updated', 'success');
        await loadClients();
        await viewClientDetails(email);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function saveClientTeamSettings(encodedEmail) {
    const email = decodeURIComponent(encodedEmail);
    const teamName = document.getElementById('client-team-name')?.value?.trim();
    const teamPlan = document.getElementById('client-team-plan')?.value;
    const teamSeats = Number(document.getElementById('client-team-seats')?.value || 1);
    const adminNotes = document.getElementById('client-admin-notes')?.value || '';

    try {
        const res = await authFetch(`/api/admin/clients/${encodeURIComponent(email)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                team: { name: teamName, plan: teamPlan, seats: teamSeats },
                adminNotes
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to update client');
        }
        showToast('Team settings updated', 'success');
        await loadClients();
        await viewClientDetails(email);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function loadClientTeamMembers(email) {
    const panel = document.getElementById('team-members-panel');
    if (!panel) return;

    try {
        const res = await authFetch(`/api/admin/clients/${encodeURIComponent(email)}/team-members`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to load team members');
        }

        const members = data.members || [];
        if (!members.length) {
            panel.innerHTML = '<div style="color:#888;">No members found.</div>';
            return;
        }

        const rows = members.map((m) => {
            const encodedMemberId = encodeURIComponent(m.memberId);
            const rowId = safeId(m.memberId);
            const isOwner = m.memberId === 'owner';
            const roleOptions = ['admin', 'member', 'viewer'].map((role) => {
                const selected = (m.role || '').toLowerCase() === role ? 'selected' : '';
                return `<option value="${role}" ${selected}>${role.toUpperCase()}</option>`;
            }).join('');

            return `
                <tr>
                    <td>${escapeHtml(m.email || '—')}</td>
                    <td>${escapeHtml(m.status || 'active')}</td>
                    <td>${isOwner ? 'OWNER' : `<select id="member-role-${rowId}" class="crud-select" style="max-width:140px;">${roleOptions}</select>`}</td>
                    <td>${m.invitedAt ? new Date(m.invitedAt).toLocaleString() : (m.joinedAt ? new Date(m.joinedAt).toLocaleString() : '—')}</td>
                    <td>
                        ${isOwner ? '—' : `
                            <div class="row-actions">
                                <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="updateClientTeamMemberRole('${encodeURIComponent(email)}','${encodedMemberId}','member-role-${rowId}')">Save Role</button>
                                <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="removeClientTeamMember('${encodeURIComponent(email)}','${encodedMemberId}',this)">Remove</button>
                            </div>
                        `}
                    </td>
                </tr>
            `;
        }).join('');

        panel.innerHTML = `
            <table class="crud-table">
                <thead>
                    <tr>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Role</th>
                        <th>Joined/Invited</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    } catch (err) {
        panel.innerHTML = `<div style="color:#ff5252;">${escapeHtml(err.message)}</div>`;
    }
}

async function inviteClientTeamMember(encodedEmail) {
    const email = decodeURIComponent(encodedEmail);
    const inviteEmail = document.getElementById('team-invite-email')?.value?.trim() || '';
    const role = document.getElementById('team-invite-role')?.value || 'member';
    if (!inviteEmail) {
        showToast('Invite email is required', 'error');
        return;
    }

    try {
        const res = await authFetch(`/api/admin/clients/${encodeURIComponent(email)}/team-members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inviteEmail, role })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to invite member');
        }
        showToast(`Invite sent to ${inviteEmail}`, 'success');
        document.getElementById('team-invite-email').value = '';
        await loadClientTeamMembers(email);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function updateClientTeamMemberRole(encodedEmail, encodedMemberId, roleInputId) {
    const email = decodeURIComponent(encodedEmail);
    const memberId = decodeURIComponent(encodedMemberId);
    const role = document.getElementById(roleInputId)?.value;
    if (!role) return;

    try {
        const res = await authFetch(`/api/admin/clients/${encodeURIComponent(email)}/team-members/${encodeURIComponent(memberId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to update role');
        }
        showToast('Role updated', 'success');
        await loadClientTeamMembers(email);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function removeClientTeamMember(encodedEmail, encodedMemberId, btnEl) {
    const email = decodeURIComponent(encodedEmail);
    const memberId = decodeURIComponent(encodedMemberId);
    const confirmed = await inlineConfirm(btnEl.parentElement, `Remove ${memberId}?`);
    if (!confirmed) return;

    try {
        const res = await authFetch(`/api/admin/clients/${encodeURIComponent(email)}/team-members/${encodeURIComponent(memberId)}`, {
            method: 'DELETE'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to remove member');
        }
        showToast('Member removed', 'success');
        await loadClientTeamMembers(email);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function saveTenantChanges(encodedEmail, encodedTenantId, rowId) {
    const email = decodeURIComponent(encodedEmail);
    const tenantId = decodeURIComponent(encodedTenantId);
    const name = document.getElementById(`tenant-name-${rowId}`)?.value?.trim();
    const status = document.getElementById(`tenant-status-${rowId}`)?.value;
    const healthStatus = document.getElementById(`tenant-health-${rowId}`)?.value;

    try {
        const res = await authFetch(`/api/admin/clients/${encodeURIComponent(email)}/tenants/${encodeURIComponent(tenantId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, status, healthStatus })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to update tenant');
        }
        showToast(`Updated ${tenantId}`, 'success');
        await loadClients();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function archiveTenant(encodedEmail, encodedTenantId, btnEl) {
    const email = decodeURIComponent(encodedEmail);
    const tenantId = decodeURIComponent(encodedTenantId);
    const confirmed = await inlineConfirm(btnEl.parentElement, `Archive ${tenantId}?`);
    if (!confirmed) return;

    try {
        const res = await authFetch(`/api/admin/clients/${encodeURIComponent(email)}/tenants/${encodeURIComponent(tenantId)}`, {
            method: 'DELETE'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to archive tenant');
        }
        showToast(`Archived ${tenantId}`, 'success');
        await loadClients();
        if (activeClientEmail === email) await viewClientDetails(email);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function restartBot(tenantId, btnEl) {
    const confirmed = await inlineConfirm(btnEl.parentElement, `Restart ${tenantId}?`);
    if (!confirmed) return;
    try {
        const res = await authFetch(`/api/admin/bots/${tenantId}?action=restart`, { method: 'POST' });
        const data = await res.json();
        showToast(data.ok ? `✅ ${data.message}` : `❌ ${data.error}`, data.ok ? 'success' : 'error');
    } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
    }
}

function openChat(tenantId, name) {
    window.open(`/chat?botId=${encodeURIComponent(tenantId)}&name=${encodeURIComponent(name)}`, '_blank');
}

function closeLogModal() {
    document.getElementById('logModal').classList.remove('open');
    activeClientEmail = null;
}

// ─── Impersonate ───

async function impersonate(email) {
    try {
        const res = await authFetch('/api/admin/impersonate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.ok) {
            impersonating = email;
            document.getElementById('impersonateBanner').classList.add('active');
            document.getElementById('impersonateEmail').textContent = email;
            showToast(`Now viewing as ${email}`, 'success');
        } else {
            showToast(data.error || 'Failed to impersonate user', 'error');
        }
    } catch (err) {
        showToast(`Failed to impersonate: ${err.message}`, 'error');
    }
}

async function stopImpersonate() {
    try {
        const res = await authFetch('/api/admin/stop-impersonate', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Could not stop impersonation');
        }
        impersonating = null;
        document.getElementById('impersonateBanner').classList.remove('active');
        showToast('Stopped impersonation', 'success');
    } catch (err) {
        showToast(`Failed to stop impersonation: ${err.message}`, 'error');
    }
}

// ─── Backup & Restore ───

async function backupBot(tenantId) {
    try {
        const res = await authFetch(`/api/admin/bots/${tenantId}/backup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'admin-manual' }) });
        const data = await res.json();
        showToast(data.ok ? `✅ Backup created: ${data.backupId} (${(data.sizeBytes/1024).toFixed(1)} KB)` : `❌ ${data.error}`, data.ok ? 'success' : 'error');
    } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

async function showBackups(tenantId) {
    openModal(`Backups — ${tenantId}`, 'rich');

    try {
        const res = await authFetch(`/api/admin/bots/${tenantId}/backups`);
        const data = await res.json();
        if (!data.ok || !data.backups.length) {
            document.getElementById('logBody').textContent = 'No backups found.';
            return;
        }
        const rows = data.backups.map((b, idx) => `
            <div style="border:1px solid #2b2b2b;border-radius:10px;padding:12px;margin-bottom:10px;background:rgba(255,255,255,0.02);">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
                    <div>
                        <div style="font-weight:700;font-size:13px;">${b.backupId}</div>
                        <div style="font-size:11px;color:#9a9a9a;margin-top:4px;">
                            ${new Date(b.createdAt).toLocaleString()} • ${b.sizeKB} KB • ${b.reason} • by ${b.triggeredBy}
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        ${idx === 0 ? '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(0,200,83,0.16);color:#00c853;">LATEST</span>' : ''}
                        <button onclick="restoreBot('${tenantId}','${b.backupId}',this)" style="background:#ff6b35;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Restore</button>
                        <button onclick="deleteBackup('${tenantId}','${b.backupId}',this)" style="background:rgba(255,82,82,0.15);color:#ff5252;border:1px solid rgba(255,82,82,0.3);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Delete</button>
                    </div>
                </div>
            </div>
        `).join('');
        document.getElementById('logBody').innerHTML = `
            <div style="font-size:12px;color:#999;margin-bottom:10px;">Backups are stored per tenant instance. Delete permanently removes the snapshot from storage.</div>
            ${rows}
        `;
    } catch (err) {
        document.getElementById('logBody').textContent = 'Error: ' + err.message;
    }
}

async function restoreBot(tenantId, backupId, btnEl) {
    if (btnEl) {
        const confirmed = await inlineConfirm(btnEl.parentElement, `⚠️ Overwrite current state?`);
        if (!confirmed) return;
    }
    try {
        const res = await authFetch(`/api/admin/bots/${tenantId}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backupId }) });
        const data = await res.json();
        showToast(data.ok ? `✅ Restored from ${backupId}` : `❌ ${data.error}`, data.ok ? 'success' : 'error');
    } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

async function deleteBackup(tenantId, backupId, btnEl) {
    if (btnEl) {
        const confirmed = await inlineConfirm(btnEl.parentElement, `Delete ${backupId}?`);
        if (!confirmed) return;
    }
    try {
        const res = await authFetch(`/api/admin/bots/${tenantId}/backups/${backupId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Delete failed');
        }
        showToast(`✅ Deleted backup ${backupId}`, 'success');
        showBackups(tenantId);
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    }
}

// ─── Secrets ───

async function loadSecrets(scope, containerId) {
    const el = document.getElementById(containerId);
    try {
        const res = await authFetch(`/api/admin/secrets?scope=${encodeURIComponent(scope)}`);
        const data = await res.json();
        if (!data.ok || !data.secrets.length) {
            el.innerHTML = '<p style="color:var(--gray);font-size:13px;">No secrets configured.</p>';
            return;
        }
        el.innerHTML = data.secrets.map(s => `
            <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:13px;">
                <code style="background:var(--bg);padding:4px 8px;border-radius:4px;font-size:12px;min-width:180px;">${s.key}</code>
                <span style="color:var(--gray);font-family:monospace;font-size:12px;">${s.preview}</span>
                <span style="color:var(--gray);font-size:11px;flex:1;">${s.label !== s.key ? s.label : ''}</span>
                <span style="color:var(--gray);font-size:11px;">${s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : ''}</span>
                <button onclick="deleteSecret('${scope}','${s.key}','${containerId}',this)" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;">✕</button>
            </div>
        `).join('');
    } catch (err) {
        el.innerHTML = `<p style="color:var(--red);font-size:13px;">Error: ${err.message}</p>`;
    }
}

function showAddSecret(scope) {
    const containerId = scope === 'platform' ? 'platformSecrets' : `secrets-${btoa(scope)}`;
    const container = document.getElementById(containerId);
    // Don't add if already showing inline form
    if (container.querySelector('.inline-secret-form')) return;

    const row = document.createElement('div');
    row.className = 'inline-secret-form';
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);';
    row.innerHTML = `
        <input type="text" placeholder="KEY_NAME" style="background:var(--bg);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:6px 10px;color:var(--fg);font-family:monospace;font-size:12px;width:180px;text-transform:uppercase;" id="newSecretKey-${scope}">
        <input type="password" placeholder="Value" style="background:var(--bg);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:6px 10px;color:var(--fg);font-family:monospace;font-size:12px;flex:1;" id="newSecretVal-${scope}">
        <button onclick="saveInlineSecret('${scope}')" style="background:var(--green,#4caf50);border:none;color:#fff;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">Save</button>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--gray);cursor:pointer;font-size:12px;">Cancel</button>
    `;
    container.insertBefore(row, container.firstChild);
    row.querySelector('input').focus();
}

async function saveInlineSecret(scope) {
    const key = document.getElementById(`newSecretKey-${scope}`).value.trim().toUpperCase();
    const value = document.getElementById(`newSecretVal-${scope}`).value;
    if (!key || !value) return;

    try {
        const res = await authFetch('/api/admin/secrets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope, key, value, label: key })
        });
        const data = await res.json();
        if (data.ok) {
            loadSecrets(scope, scope === 'platform' ? 'platformSecrets' : `secrets-${btoa(scope)}`);
        } else {
            showToast('Error: ' + data.error, 'error');
        }
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    }
}

async function deleteSecret(scope, key, containerId, btnEl) {
    const confirmed = await inlineConfirm(btnEl.parentElement, `Delete ${key}?`);
    if (!confirmed) return;
    try {
        await authFetch('/api/admin/secrets', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope, key })
        });
        loadSecrets(scope, containerId);
    } catch {}
}

// ─── OpenClaw Updates ───

function stopEasyDryRunPolling() {
    if (easyDryRunPollTimer) {
        clearInterval(easyDryRunPollTimer);
        easyDryRunPollTimer = null;
    }
}

function parseComparableVersion(input) {
    const raw = String(input || '').trim();
    const match = raw.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
    if (!match) return null;
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function sortVersionsDesc(values) {
    const unique = Array.from(new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean)));
    unique.sort((a, b) => {
        const va = parseComparableVersion(a);
        const vb = parseComparableVersion(b);
        if (va && vb) {
            if (va.major !== vb.major) return vb.major - va.major;
            if (va.minor !== vb.minor) return vb.minor - va.minor;
            if (va.patch !== vb.patch) return vb.patch - va.patch;
            return b.localeCompare(a);
        }
        if (va) return -1;
        if (vb) return 1;
        return b.localeCompare(a);
    });
    return unique;
}

function setRolloutTargetVersionValue(version) {
    const normalized = String(version || '').trim();
    if (!normalized) return;
    const easyInput = document.getElementById('easyRolloutTargetVersion');
    const advancedInput = document.getElementById('rolloutTargetVersion');
    if (easyInput) easyInput.value = normalized;
    if (advancedInput) advancedInput.value = normalized;
}

function renderVersionCatalog() {
    const hintEl = document.getElementById('versionCatalogHint');
    const listEl = document.getElementById('versionCatalogList');
    const datalistEl = document.getElementById('openclawVersionOptions');
    const catalog = versionCatalogState || {};
    const versions = Array.isArray(catalog.recentVersions) ? catalog.recentVersions : [];
    const recommended = catalog.recommendedVersion || versions[0] || null;

    if (datalistEl) {
        datalistEl.innerHTML = versions.map((v) => `<option value=\"${escapeHtml(v)}\"></option>`).join('');
    }

    if (listEl) {
        if (!versions.length) {
            listEl.innerHTML = '<span style=\"font-size:12px;color:var(--gray);\">No recent version history available yet.</span>';
        } else {
            listEl.innerHTML = versions.map((version) => `
                <button type="button" class="version-chip" onclick="setRolloutTargetVersionValue(decodeURIComponent('${encodeURIComponent(version)}'))">
                    ${escapeHtml(version)}
                </button>
            `).join('');
        }
    }

    if (hintEl) {
        if (!recommended) {
            hintEl.textContent = 'No reliable latest version found yet. Enter version manually.';
        } else {
            const githubLatest = catalog?.sources?.github?.latest;
            const sourceText = githubLatest ? `GitHub latest ${githubLatest}` : `recommended ${recommended}`;
            hintEl.textContent = `Latest known: ${recommended} (${sourceText}). Showing last ${Math.min(5, versions.length)} versions.`;
        }
    }

    if (recommended) {
        const easyInput = document.getElementById('easyRolloutTargetVersion');
        const advancedInput = document.getElementById('rolloutTargetVersion');
        if (easyInput && !easyInput.value.trim()) easyInput.value = recommended;
        if (advancedInput && !advancedInput.value.trim()) advancedInput.value = recommended;
    }
}

function buildFallbackVersionCatalog() {
    const observedTenantVersions = sortVersionsDesc(
        Array.from(tenantVersionMap.values())
            .map((tenant) => tenant?.openClawVersion)
            .filter((value) => value && value !== 'unknown')
    );
    return {
        recommendedVersion: observedTenantVersions[0] || null,
        recentVersions: observedTenantVersions.slice(0, 5),
        sources: {
            github: { latest: null, recentVersions: [] },
            tenants: { latest: observedTenantVersions[0] || null, recentVersions: observedTenantVersions.slice(0, 5) },
        },
    };
}

async function loadVersionCatalog() {
    const hintEl = document.getElementById('versionCatalogHint');
    if (hintEl) hintEl.textContent = 'Checking latest OpenClaw versions…';
    try {
        if (updatesAdapter && typeof updatesAdapter.getVersionCatalog === 'function') {
            const payload = await updatesAdapter.getVersionCatalog();
            versionCatalogState = {
                recommendedVersion: payload?.recommendedVersion || null,
                recentVersions: sortVersionsDesc(payload?.recentVersions || []).slice(0, 5),
                sources: payload?.sources || {},
            };
        } else {
            versionCatalogState = buildFallbackVersionCatalog();
        }
    } catch {
        versionCatalogState = buildFallbackVersionCatalog();
    }
    renderVersionCatalog();
}

function setUpdatesMode(mode) {
    updatesMode = mode === 'advanced' ? 'advanced' : 'easy';
    const easyBtn = document.getElementById('updatesModeEasyBtn');
    const advancedBtn = document.getElementById('updatesModeAdvancedBtn');
    const easyPanel = document.getElementById('updatesEasyPanel');
    const advancedRollout = document.getElementById('rolloutAdvancedSection');
    const advancedRollback = document.getElementById('rollbackAdvancedSection');
    const grid = document.getElementById('updatesGrid');

    easyBtn?.classList.toggle('active', updatesMode === 'easy');
    advancedBtn?.classList.toggle('active', updatesMode === 'advanced');
    if (easyPanel) easyPanel.style.display = updatesMode === 'easy' ? 'block' : 'none';
    if (advancedRollout) advancedRollout.classList.toggle('admin-section-hidden', updatesMode !== 'advanced');
    if (advancedRollback) advancedRollback.classList.toggle('admin-section-hidden', updatesMode !== 'advanced');
    if (grid) grid.classList.toggle('single-column', updatesMode !== 'advanced');
}

function renderEasyChecklist() {
    const checklist = document.getElementById('easyRolloutChecklist');
    const promoteBtn = document.getElementById('easyPromoteBtn');
    if (!checklist || !promoteBtn) return;

    if (!easyDryRunState) {
        checklist.innerHTML = `
            <div>Step 1: Run dry-run with safe defaults.</div>
            <div>Step 2: Live rollout is enabled only after a clean dry-run.</div>
        `;
        promoteBtn.disabled = true;
        return;
    }

    if (!easyDryRunState.completed) {
        checklist.innerHTML = `
            <div class="warn">Dry-run ${escapeHtml(easyDryRunState.runId)} is in progress.</div>
            <div>Live rollout stays disabled until dry-run finishes.</div>
        `;
        promoteBtn.disabled = true;
        return;
    }

    if (easyDryRunState.failedCount > 0) {
        checklist.innerHTML = `
            <div class="bad">Dry-run ${escapeHtml(easyDryRunState.runId)} found ${easyDryRunState.failedCount} failure(s).</div>
            <div>Open the run details to inspect errors before going live.</div>
        `;
        promoteBtn.disabled = true;
        return;
    }

    checklist.innerHTML = `
        <div class="ok">Dry-run ${escapeHtml(easyDryRunState.runId)} completed with no failures.</div>
        <div class="ok">Live rollout is unlocked.</div>
    `;
    promoteBtn.disabled = false;
}

function collectEasyRolloutPayload() {
    const targetVersion = document.getElementById('easyRolloutTargetVersion')?.value?.trim() || '';
    const imageUri = document.getElementById('easyRolloutImageUri')?.value?.trim() || '';
    if (!targetVersion && !imageUri) {
        throw new Error('Enter a target version or image URI to continue.');
    }

    return {
        targetVersion: targetVersion || undefined,
        imageUri: imageUri || undefined,
        scope: 'all_active',
        tenantIds: [],
        includePaused: Boolean(document.getElementById('easyRolloutIncludePaused')?.checked),
        dryRun: true,
        skipBackup: false,
    };
}

async function startEasyDryRunPolling(runId) {
    stopEasyDryRunPolling();
    easyDryRunPollTimer = setInterval(async () => {
        if (!easyDryRunState || easyDryRunState.runId !== runId || easyDryRunState.completed) {
            stopEasyDryRunPolling();
            return;
        }
        try {
            const payload = await updatesAdapter.getUpdateRun(runId, false);
            const run = payload?.run;
            if (!run) return;
            easyDryRunState.failedCount = Number(run.failedCount || 0);
            easyDryRunState.status = run.status || easyDryRunState.status;
            if (isTerminalRunStatus(run.status)) {
                easyDryRunState.completed = true;
                stopEasyDryRunPolling();
                setUpdatesState('easyRolloutState', `Dry-run ${runId} completed. Failed: ${easyDryRunState.failedCount}.`, easyDryRunState.failedCount > 0);
            }
            renderEasyChecklist();
        } catch {
            // keep polling quiet
        }
    }, 3500);
}

function setUpdatesState(id, text, isError = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--red)' : 'var(--gray)';
}

function setButtonLoading(button, loading, loadingLabel) {
    if (!button) return;
    if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
    button.disabled = Boolean(loading);
    button.textContent = loading ? loadingLabel : button.dataset.defaultLabel;
}

function parseTenantListInput(text) {
    return String(text || '')
        .split(/[\n, ]+/g)
        .map((item) => item.trim())
        .filter(Boolean);
}

function selectedRolloutScope() {
    return document.querySelector('input[name="rolloutScope"]:checked')?.value || 'all_active';
}

function toggleRolloutScopeSelection() {
    const wrap = document.getElementById('rolloutSelectedTenantsWrap');
    if (!wrap) return;
    wrap.style.display = selectedRolloutScope() === 'selected' ? 'block' : 'none';
}

function renderRolloutTenantSelection() {
    const container = document.getElementById('rolloutTenantSelection');
    if (!container) return;
    const selectedNow = new Set(
        Array.from(container.querySelectorAll('.rollout-tenant-check:checked')).map((el) => el.value)
    );
    const tenants = currentTenantRows();
    if (!tenants.length) {
        container.innerHTML = '<div style="color:#888;font-size:12px;">Load tenants first to target selected rollout scope.</div>';
        return;
    }

    container.innerHTML = tenants.map((tenant) => {
        const meta = tenantVersionMap.get(tenant.tenantId) || {};
        const checked = selectedNow.has(tenant.tenantId) ? 'checked' : '';
        return `
            <label class="scope-item">
                <input class="rollout-tenant-check" type="checkbox" value="${escapeHtml(tenant.tenantId)}" ${checked}>
                <span>
                    <strong>${escapeHtml(tenant.tenantId)}</strong>
                    <div class="meta">${escapeHtml(tenant.email || 'unknown')} • ${escapeHtml(tenant.status || 'active')} • v${escapeHtml(formatOpenClawVersion(meta.openClawVersion || null))}</div>
                </span>
            </label>
        `;
    }).join('');
}

function collectRolloutPayload(forceDryRun = false) {
    const targetVersion = document.getElementById('rolloutTargetVersion')?.value?.trim() || '';
    const imageUri = document.getElementById('rolloutImageUri')?.value?.trim() || '';
    if (!targetVersion && !imageUri) {
        throw new Error('Provide either target version or image URI.');
    }

    const scope = selectedRolloutScope();
    const selectedTenantIds = Array.from(document.querySelectorAll('.rollout-tenant-check:checked')).map((el) => el.value);
    if (scope === 'selected' && !selectedTenantIds.length) {
        throw new Error('Select at least one tenant for selected scope.');
    }

    return {
        targetVersion: targetVersion || undefined,
        imageUri: imageUri || undefined,
        scope,
        tenantIds: scope === 'selected' ? selectedTenantIds : [],
        includePaused: Boolean(document.getElementById('rolloutIncludePaused')?.checked),
        dryRun: forceDryRun ? true : Boolean(document.getElementById('rolloutDryRun')?.checked),
        skipBackup: Boolean(document.getElementById('rolloutSkipBackup')?.checked),
    };
}

function collectRollbackPayloadFromForm() {
    const runId = document.getElementById('rollbackRunId')?.value?.trim();
    if (!runId) throw new Error('Run ID is required.');
    const tenantIds = parseTenantListInput(document.getElementById('rollbackTenantFilter')?.value || '');
    return {
        runId,
        tenantIds,
        restoreBackup: Boolean(document.getElementById('rollbackRestoreBackup')?.checked),
        dryRun: Boolean(document.getElementById('rollbackDryRun')?.checked),
    };
}

function normalizeRunPayload(run) {
    return {
        runId: run.runId,
        operation: run.operation || 'rollout',
        status: run.status || 'running',
        startedAt: run.startedAt || new Date().toISOString(),
        finishedAt: run.finishedAt || null,
        successCount: Number(run.successCount || 0),
        failedCount: Number(run.failedCount || 0),
        tenantCount: Number(run.tenantCount || 0),
    };
}

function isTerminalRunStatus(status) {
    return ['completed', 'completed_with_errors', 'failed'].includes(String(status || '').toLowerCase());
}

function renderUpdateRunsTable() {
    const body = document.getElementById('updateRunsTableBody');
    if (!body) return;

    if (!updateRuns.length) {
        body.innerHTML = '<tr><td colspan="8" style="color:#888;">No update runs found.</td></tr>';
        return;
    }

    body.innerHTML = updateRuns.map((run) => `
        <tr>
            <td><code>${escapeHtml(run.runId)}</code></td>
            <td>${escapeHtml(String(run.operation || 'rollout').toUpperCase())}</td>
            <td>${escapeHtml(formatDateTime(run.startedAt))}</td>
            <td>${escapeHtml(formatDateTime(run.finishedAt))}</td>
            <td>${run.successCount || 0}</td>
            <td>${run.failedCount || 0}</td>
            <td>${renderStatusChip(run.status || 'unknown')}</td>
            <td><button class="updates-row-btn" onclick="openUpdateRunFromTable('${encodeURIComponent(run.runId)}')">View</button></td>
        </tr>
    `).join('');
}

async function loadUpdateRuns({ silent = false } = {}) {
    if (!updatesAdapter || typeof updatesAdapter.getUpdateRuns !== 'function') return;
    try {
        const failedOnly = Boolean(document.getElementById('runsFailedOnly')?.checked);
        const runId = document.getElementById('runsRunIdSearch')?.value?.trim() || '';
        if (!silent) setUpdatesState('updateRunsState', 'Loading runs…');
        const payload = await updatesAdapter.getUpdateRuns({ failedOnly, runId });
        updateRuns = Array.isArray(payload?.runs) ? payload.runs : [];
        if (easyDryRunState?.runId) {
            const dryRunSummary = updateRuns.find((run) => run.runId === easyDryRunState.runId);
            if (dryRunSummary) {
                easyDryRunState.failedCount = Number(dryRunSummary.failedCount || easyDryRunState.failedCount || 0);
                easyDryRunState.status = dryRunSummary.status || easyDryRunState.status;
                if (isTerminalRunStatus(dryRunSummary.status)) {
                    easyDryRunState.completed = true;
                    stopEasyDryRunPolling();
                }
            }
            renderEasyChecklist();
        }
        renderUpdateRunsTable();
        setUpdatesState('updateRunsState', `${updateRuns.length} run${updateRuns.length === 1 ? '' : 's'} loaded.`);
    } catch (err) {
        renderUpdateRunsTable();
        setUpdatesState('updateRunsState', `Failed to load runs: ${err.message}`, true);
    }
}

function stopRunDetailPolling() {
    if (runDetailPollTimer) {
        clearInterval(runDetailPollTimer);
        runDetailPollTimer = null;
    }
}

function startRunDetailPolling(runId) {
    stopRunDetailPolling();
    runDetailPollTimer = setInterval(async () => {
        if (!selectedUpdateRunId || selectedUpdateRunId !== runId) {
            stopRunDetailPolling();
            return;
        }
        await loadAndRenderUpdateRun(runId, { silent: true });
        await loadUpdateRuns({ silent: true });
        if (isTerminalRunStatus(currentRunDetails?.status)) {
            stopRunDetailPolling();
            await refreshTenantVersionMap({ applyToClients: true, rerender: true, silent: true });
        }
    }, 4000);
}

function closeUpdateRunDrawer(event) {
    if (event && event.currentTarget && event.target !== event.currentTarget) return;
    document.getElementById('updateRunDrawerBackdrop')?.classList.remove('open');
    stopRunDetailPolling();
}

async function openUpdateRunFromTable(encodedRunId) {
    const runId = decodeURIComponent(encodedRunId);
    selectedUpdateRunId = runId;
    document.getElementById('updateRunDrawerBackdrop')?.classList.add('open');
    await loadAndRenderUpdateRun(runId);
    startRunDetailPolling(runId);
}

async function loadAndRenderUpdateRun(runId, { silent = false } = {}) {
    if (!updatesAdapter || typeof updatesAdapter.getUpdateRun !== 'function') return;
    const stateEl = document.getElementById('updateRunDrawerState');
    const titleEl = document.getElementById('updateRunDrawerTitle');
    const rowsEl = document.getElementById('updateRunTenantRows');
    const calloutEl = document.getElementById('updateRunDrawerCallout');
    try {
        if (!silent && stateEl) stateEl.textContent = 'Loading run details…';
        const failedOnly = Boolean(document.getElementById('drawerFailedOnly')?.checked);
        const payload = await updatesAdapter.getUpdateRun(runId, failedOnly);
        const run = payload?.run;
        if (!run) throw new Error('Run details unavailable.');
        currentRunDetails = run;
        setRollbackInputs(run.runId, []);
        titleEl.textContent = `Run ${run.runId} • ${String(run.operation || '').toUpperCase()}`;

        const tenants = Array.isArray(run.tenants) ? run.tenants : [];
        const ordered = tenants.slice().sort((a, b) => {
            const priority = { failed: 0, pending: 1, success: 2 };
            const delta = (priority[normalizeUpdateStatus(a.status)] ?? 99) - (priority[normalizeUpdateStatus(b.status)] ?? 99);
            if (delta !== 0) return delta;
            return String(a.tenantId || '').localeCompare(String(b.tenantId || ''));
        });

        if (!ordered.length) {
            rowsEl.innerHTML = '<tr><td colspan="5" style="color:#888;">No tenant rows for this run.</td></tr>';
        } else {
            rowsEl.innerHTML = ordered.map((row) => `
                <tr>
                    <td><code>${escapeHtml(row.tenantId)}</code></td>
                    <td>${renderStatusChip(row.status || 'unknown')}</td>
                    <td>${escapeHtml(row.previousVersion || 'unknown')} → ${escapeHtml(row.newVersion || 'unknown')}</td>
                    <td>${escapeHtml(row.error || row.message || '—')}</td>
                    <td>
                        <button class="updates-row-btn" onclick="rollbackSingleTenant('${encodeURIComponent(run.runId)}','${encodeURIComponent(row.tenantId)}')">Rollback tenant</button>
                    </td>
                </tr>
            `).join('');
        }

        const hasFailures = Number(run.failedCount || 0) > 0 || ordered.some((row) => normalizeUpdateStatus(row.status) === 'failed');
        if (hasFailures) {
            calloutEl.classList.add('show');
            calloutEl.innerHTML = `Rollback Recommended: this run has failures (${run.failedCount || 0}).`;
        } else {
            calloutEl.classList.remove('show');
            calloutEl.textContent = '';
        }

        if (stateEl) {
            stateEl.textContent = `Status: ${updateStatusLabel(run.status)} • Success ${run.successCount || 0} • Failed ${run.failedCount || 0} • Started ${formatDateTime(run.startedAt)}`;
        }
    } catch (err) {
        if (rowsEl) rowsEl.innerHTML = '<tr><td colspan="5" style="color:var(--red);">Failed to load run details.</td></tr>';
        if (stateEl) stateEl.textContent = `Failed to load run details: ${err.message}`;
    }
}

async function copySelectedRunId() {
    if (!currentRunDetails?.runId) return;
    try {
        await navigator.clipboard.writeText(currentRunDetails.runId);
        showToast('Run ID copied', 'success');
    } catch (err) {
        showToast(`Copy failed: ${err.message}`, 'error');
    }
}

function setRollbackInputs(runId, tenantIds = []) {
    const runInput = document.getElementById('rollbackRunId');
    const filterInput = document.getElementById('rollbackTenantFilter');
    if (runInput) runInput.value = runId || '';
    if (filterInput) filterInput.value = (tenantIds || []).join(', ');
}

async function showConfirmModal({ title, message, confirmText = 'Confirm' }) {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        const backdrop = document.getElementById('adminConfirmBackdrop');
        const titleEl = document.getElementById('adminConfirmTitle');
        const messageEl = document.getElementById('adminConfirmMessage');
        const acceptBtn = document.getElementById('adminConfirmAcceptBtn');
        if (titleEl) titleEl.textContent = title || 'Confirm Action';
        if (messageEl) messageEl.textContent = message || 'Are you sure?';
        if (acceptBtn) acceptBtn.textContent = confirmText;
        backdrop?.classList.add('open');
    });
}

function resolveAdminConfirm(accepted, event) {
    if (event && event.currentTarget && event.target !== event.currentTarget) return;
    const backdrop = document.getElementById('adminConfirmBackdrop');
    backdrop?.classList.remove('open');
    const resolver = confirmResolver;
    confirmResolver = null;
    if (resolver) resolver(Boolean(accepted));
}

async function startRollbackFlow(payload, stateTargetId) {
    if (!updatesAdapter || typeof updatesAdapter.startRollback !== 'function') {
        throw new Error('OpenClaw updates adapter unavailable.');
    }

    if (!payload.dryRun) {
        const confirmed = await showConfirmModal({
            title: 'Confirm Live Rollback',
            message: `This will execute a live rollback for run ${payload.runId}.`,
            confirmText: 'Start Live Rollback',
        });
        if (!confirmed) return null;
    }

    setUpdatesState(stateTargetId, payload.dryRun ? 'Starting rollback dry-run…' : 'Starting live rollback…');
    const result = await updatesAdapter.startRollback(payload);
    const run = normalizeRunPayload(result?.run || result || {});
    updateRuns = [run, ...updateRuns.filter((item) => item.runId !== run.runId)];
    renderUpdateRunsTable();
    selectedUpdateRunId = run.runId;
    setRollbackInputs(payload.runId, payload.tenantIds || []);
    showToast(payload.dryRun ? 'Rollback dry-run started' : 'Rollback started', 'success');
    await openUpdateRunFromTable(encodeURIComponent(run.runId));
    await loadUpdateRuns({ silent: true });
    return run;
}

async function triggerRollbackFromForm() {
    const button = document.getElementById('rollbackRunBtn');
    try {
        const payload = collectRollbackPayloadFromForm();
        setButtonLoading(button, true, 'Starting…');
        const run = await startRollbackFlow(payload, 'rollbackState');
        if (run) setUpdatesState('rollbackState', `Rollback run started: ${run.runId}`);
    } catch (err) {
        setUpdatesState('rollbackState', err.message, true);
        showToast(err.message, 'error');
    } finally {
        setButtonLoading(button, false);
    }
}

async function rollbackSelectedRunFromDrawer() {
    if (!currentRunDetails?.runId) return;
    const payload = {
        runId: currentRunDetails.runId,
        tenantIds: [],
        restoreBackup: Boolean(document.getElementById('drawerRollbackRestoreBackup')?.checked),
        dryRun: Boolean(document.getElementById('drawerRollbackDryRun')?.checked),
    };
    try {
        await startRollbackFlow(payload, 'updateRunDrawerState');
    } catch (err) {
        setUpdatesState('updateRunDrawerState', err.message, true);
        showToast(err.message, 'error');
    }
}

async function rollbackSingleTenant(encodedRunId, encodedTenantId) {
    const runId = decodeURIComponent(encodedRunId);
    const tenantId = decodeURIComponent(encodedTenantId);
    const payload = {
        runId,
        tenantIds: [tenantId],
        restoreBackup: Boolean(document.getElementById('drawerRollbackRestoreBackup')?.checked),
        dryRun: Boolean(document.getElementById('drawerRollbackDryRun')?.checked),
    };
    try {
        await startRollbackFlow(payload, 'updateRunDrawerState');
    } catch (err) {
        setUpdatesState('updateRunDrawerState', err.message, true);
        showToast(err.message, 'error');
    }
}

async function startRolloutFlow(payload, stateTargetId) {
    if (!updatesAdapter || typeof updatesAdapter.startRollout !== 'function') {
        throw new Error('OpenClaw updates adapter unavailable.');
    }
    if (!payload?.targetVersion && !payload?.imageUri) {
        throw new Error('Provide either target version or image URI.');
    }

    if (!payload.dryRun) {
        const confirmed = await showConfirmModal({
            title: 'Confirm Live Rollout',
            message: 'This will start a live rollout across the selected tenants.',
            confirmText: 'Start Live Rollout',
        });
        if (!confirmed) return null;
    }

    setUpdatesState(stateTargetId, payload.dryRun ? 'Starting rollout dry-run…' : 'Starting live rollout…');
    const result = await updatesAdapter.startRollout(payload);
    const run = normalizeRunPayload(result?.run || result || {});
    updateRuns = [run, ...updateRuns.filter((item) => item.runId !== run.runId)];
    renderUpdateRunsTable();
    selectedUpdateRunId = run.runId;
    setRollbackInputs(run.runId, []);
    showToast(payload.dryRun ? 'Rollout dry-run started' : 'Rollout started', 'success');
    await openUpdateRunFromTable(encodeURIComponent(run.runId));
    await loadUpdateRuns({ silent: true });
    setUpdatesState(stateTargetId, `Run started: ${run.runId}`);
    return run;
}

async function triggerRollout(forceDryRun = false) {
    const startBtn = document.getElementById('rolloutStartBtn');
    const dryBtn = document.getElementById('rolloutDryRunBtn');
    try {
        const payload = collectRolloutPayload(forceDryRun);

        setButtonLoading(startBtn, true, 'Starting…');
        setButtonLoading(dryBtn, true, 'Running…');
        await startRolloutFlow(payload, 'rolloutActionState');
    } catch (err) {
        setUpdatesState('rolloutActionState', err.message, true);
        showToast(err.message, 'error');
    } finally {
        setButtonLoading(startBtn, false);
        setButtonLoading(dryBtn, false);
    }
}

async function triggerEasyDryRun() {
    const btn = document.getElementById('easyDryRunBtn');
    const promoteBtn = document.getElementById('easyPromoteBtn');
    try {
        setButtonLoading(btn, true, 'Running…');
        setButtonLoading(promoteBtn, true, 'Waiting…');
        const payload = collectEasyRolloutPayload();
        const run = await startRolloutFlow(payload, 'easyRolloutState');
        if (!run) return;

        easyDryRunState = {
            runId: run.runId,
            payload,
            failedCount: Number(run.failedCount || 0),
            status: run.status || 'running',
            completed: isTerminalRunStatus(run.status),
        };
        renderEasyChecklist();
        if (!easyDryRunState.completed) {
            setUpdatesState('easyRolloutState', `Dry-run ${run.runId} started. Waiting for results…`);
            await startEasyDryRunPolling(run.runId);
        } else {
            renderEasyChecklist();
        }
    } catch (err) {
        setUpdatesState('easyRolloutState', err.message, true);
        showToast(err.message, 'error');
    } finally {
        setButtonLoading(btn, false);
        setButtonLoading(promoteBtn, false);
        renderEasyChecklist();
    }
}

async function triggerEasyPromoteLive() {
    const promoteBtn = document.getElementById('easyPromoteBtn');
    try {
        if (!easyDryRunState?.payload || !easyDryRunState?.runId) {
            throw new Error('Run a dry-run first.');
        }
        if (!easyDryRunState.completed) {
            throw new Error('Dry-run is still running. Wait for completion.');
        }
        if (easyDryRunState.failedCount > 0) {
            throw new Error('Dry-run has failures. Resolve them before live rollout.');
        }

        setButtonLoading(promoteBtn, true, 'Starting…');
        const livePayload = { ...easyDryRunState.payload, dryRun: false };
        const liveRun = await startRolloutFlow(livePayload, 'easyRolloutState');
        if (liveRun) {
            setUpdatesState('easyRolloutState', `Live rollout started: ${liveRun.runId}`);
        }
    } catch (err) {
        setUpdatesState('easyRolloutState', err.message, true);
        showToast(err.message, 'error');
    } finally {
        setButtonLoading(promoteBtn, false);
        renderEasyChecklist();
    }
}

function bindUpdatesUiEvents() {
    document.getElementById('updatesModeEasyBtn')?.addEventListener('click', () => setUpdatesMode('easy'));
    document.getElementById('updatesModeAdvancedBtn')?.addEventListener('click', () => setUpdatesMode('advanced'));
    document.getElementById('easyOpenAdvancedBtn')?.addEventListener('click', () => setUpdatesMode('advanced'));
    document.getElementById('easyDryRunBtn')?.addEventListener('click', triggerEasyDryRun);
    document.getElementById('easyPromoteBtn')?.addEventListener('click', triggerEasyPromoteLive);
    document.querySelectorAll('input[name="rolloutScope"]').forEach((el) => {
        el.addEventListener('change', toggleRolloutScopeSelection);
    });
    document.getElementById('rolloutDryRunBtn')?.addEventListener('click', () => triggerRollout(true));
    document.getElementById('rolloutStartBtn')?.addEventListener('click', () => triggerRollout(false));
    document.getElementById('rollbackRunBtn')?.addEventListener('click', triggerRollbackFromForm);
    document.getElementById('updatesRefreshBtn')?.addEventListener('click', async () => {
        await refreshTenantVersionMap({ applyToClients: true, rerender: true, silent: false });
        await loadVersionCatalog();
        await loadUpdateRuns();
    });
    document.getElementById('runsFailedOnly')?.addEventListener('change', () => loadUpdateRuns({ silent: true }));
    document.getElementById('runsRunIdSearch')?.addEventListener('input', () => loadUpdateRuns({ silent: true }));
    document.getElementById('drawerFailedOnly')?.addEventListener('change', () => {
        if (selectedUpdateRunId) loadAndRenderUpdateRun(selectedUpdateRunId, { silent: true });
    });
    document.getElementById('copyRunIdBtn')?.addEventListener('click', copySelectedRunId);
    document.getElementById('rollbackRunBtnDrawer')?.addEventListener('click', rollbackSelectedRunFromDrawer);
}

async function initOpenClawUpdates() {
    if (!document.getElementById('openclawUpdatesRoot')) return;
    if (!updatesAdapter) {
        setUpdatesState('rolloutActionState', 'OpenClaw updates adapter unavailable.', true);
        return;
    }

    bindUpdatesUiEvents();
    setUpdatesMode('easy');
    renderEasyChecklist();
    renderRolloutTenantSelection();
    await loadVersionCatalog();
    toggleRolloutScopeSelection();
    await loadUpdateRuns({ silent: true });

    if (updateRunsRefreshTimer) clearInterval(updateRunsRefreshTimer);
    updateRunsRefreshTimer = setInterval(() => {
        loadUpdateRuns({ silent: true });
    }, 10000);
}

// ─── Toast & Inline Confirm (no JS dialogs!) ───

function showToast(msg, type = 'success', duration = 3000) {
    let container = document.querySelector('.toast-container');
    if (!container) { container = document.createElement('div'); container.className = 'toast-container'; document.body.appendChild(container); }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => { t.style.animation = 'fadeOut 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, duration);
}

function inlineConfirm(el, msg) {
    return new Promise(resolve => {
        const orig = el.innerHTML;
        el.innerHTML = `<span class="inline-confirm"><span class="warn">${msg}</span><button class="yes" onclick="this.closest('.inline-confirm').dataset.result='yes'">Yes</button><button class="no" onclick="this.closest('.inline-confirm').dataset.result='no'">Cancel</button></span>`;
        const ic = el.querySelector('.inline-confirm');
        const observer = new MutationObserver(() => {
            if (ic.dataset.result) {
                observer.disconnect();
                el.innerHTML = orig;
                resolve(ic.dataset.result === 'yes');
            }
        });
        observer.observe(ic, { attributes: true });
    });
}

// Init
initAdminTheme();
initAdminSectionNav();
loadClients();
loadSecrets('platform', 'platformSecrets');
initOpenClawUpdates();
