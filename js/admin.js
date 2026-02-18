let allClients = [];
let impersonating = null;

// Auth helper — adds Bearer token from localStorage
function authHeaders(extra = {}) {
    const token = localStorage.getItem('clawops_session_token');
    return token ? { 'Authorization': `Bearer ${token}`, ...extra } : { ...extra };
}
function authFetch(url, opts = {}) {
    opts.headers = authHeaders(opts.headers || {});
    return fetch(url, opts);
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
        const data = await res.json();
        console.log('[admin] clients data:', data.ok, 'count:', data.clients?.length);
        if (!data.ok) throw new Error(data.error);

        allClients = data.clients;
        const s = data.summary;

        document.getElementById('statClients').textContent = s.totalClients;
        document.getElementById('statActiveClients').textContent = s.activeClients;
        document.getElementById('statActiveBots').textContent = s.activeBots;
        document.getElementById('statTotalBots').textContent = `of ${s.totalBots} total`;
        document.getElementById('statTerminated').textContent = s.terminatedBots;

        renderClients(allClients);
    } catch (err) {
        document.getElementById('clientList').innerHTML = `<p style="color:var(--red);text-align:center;padding:40px;">Error: ${err.message}</p>`;
    }
}

function renderClients(clients) {
    const el = document.getElementById('clientList');
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
                    <span>${c.firstSeen ? new Date(c.firstSeen).toLocaleDateString() : '—'}</span>
                </div>
                <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="event.stopPropagation();impersonate('${c.email}')">👁 View as</button>
            </div>
            <div class="client-bots" id="bots-${btoa(c.email)}">
                ${c.bots.map(b => `
                    <div class="bot-row">
                        <span class="pill ${b.status}">${b.status}</span>
                        <span class="bot-name">${b.name || b.tenantId}</span>
                        <span style="color:var(--gray);font-size:11px;">${b.tenantId}</span>
                        <span style="color:var(--gray);font-size:11px;">${b.health}</span>
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
                `).join('')}
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
        if (header) header.setAttribute('aria-expanded', el.classList.contains('open'));
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

// ─── Bot actions ───

async function viewLogs(tenantId) {
    document.getElementById('logTitle').textContent = `Logs — ${tenantId}`;
    document.getElementById('logBody').textContent = 'Loading...';
    document.getElementById('logModal').classList.add('open');

    try {
        const res = await authFetch(`/api/admin/bots/${tenantId}?action=logs&lines=100`);
        const data = await res.json();
        document.getElementById('logBody').textContent = data.ok ? data.logs.join('\n') : `Error: ${data.error}`;
    } catch (err) {
        document.getElementById('logBody').textContent = `Failed: ${err.message}`;
    }
}

async function viewConfig(tenantId) {
    document.getElementById('logTitle').textContent = `Config — ${tenantId}`;
    document.getElementById('logBody').textContent = 'Loading...';
    document.getElementById('logModal').classList.add('open');

    try {
        const res = await authFetch(`/api/admin/bots/${tenantId}?action=config`);
        const data = await res.json();
        document.getElementById('logBody').textContent = data.ok ? JSON.stringify(data.config, null, 2) : `Error: ${data.error}`;
    } catch (err) {
        document.getElementById('logBody').textContent = `Failed: ${err.message}`;
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
        }
    } catch {}
}

async function stopImpersonate() {
    try {
        await authFetch('/api/admin/stop-impersonate', { method: 'POST' });
        impersonating = null;
        document.getElementById('impersonateBanner').classList.remove('active');
    } catch {}
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
    document.getElementById('logTitle').textContent = `Backups — ${tenantId}`;
    document.getElementById('logBody').textContent = 'Loading...';
    document.getElementById('logModal').classList.add('open');

    try {
        const res = await authFetch(`/api/admin/bots/${tenantId}/backups`);
        const data = await res.json();
        if (!data.ok || !data.backups.length) {
            document.getElementById('logBody').textContent = 'No backups found.';
            return;
        }
        document.getElementById('logBody').innerHTML = data.backups.map(b => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #333;">
                <div>
                    <strong>${b.backupId}</strong><br>
                    <span style="font-size:11px;">${b.createdAt} · ${b.sizeKB} KB · ${b.reason} · by ${b.triggeredBy}</span>
                </div>
                <button onclick="restoreBot('${tenantId}','${b.backupId}',this)" style="background:#ff6b35;color:white;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">Restore</button>
            </div>
        `).join('');
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
loadClients();
loadSecrets('platform', 'platformSecrets');
