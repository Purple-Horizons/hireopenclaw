let allClients = [];
let impersonating = null;
let activeClientEmail = null;
const PLAN_OPTIONS = ['starter', 'pro', 'team', 'agency', 'enterprise'];
const STATUS_OPTIONS = ['active', 'paused', 'terminated', 'provisioning', 'error'];
const HEALTH_OPTIONS = ['healthy', 'unhealthy', 'pending', 'unknown'];

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

function openModal(title, mode = 'text') {
    document.getElementById('logTitle').textContent = title;
    const body = document.getElementById('logBody');
    body.classList.toggle('rich', mode === 'rich');
    body.textContent = 'Loading...';
    document.getElementById('logModal').classList.add('open');
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

        allClients = data.clients;
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

        const c = data.client;
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
                            <th>Tokens</th>
                            <th>Msgs</th>
                            <th>Cost</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tenantRows || '<tr><td colspan="8" style="color:#888;">No tenant instances found.</td></tr>'}
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
