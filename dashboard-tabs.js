/**
 * Tabbed Interface for Dashboard
 * Employees | Usage | Billing | Settings
 */

let currentTab = 'employees';

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchTab(tab);
        });
    });
    
    // TASK-429: Restore tab from URL hash (skip if hash contains auth data — consumed by dashboard-dynamic.js)
    const hash = window.location.hash.slice(1);
    const validTabs = ['employees', 'usage', 'billing', 'settings'];
    if (hash.includes('session=')) {
        // Auth redirect — activate default tab without touching URL hash
        currentTab = 'employees';
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === 'employees');
        });
        document.querySelectorAll('.tab-panel').forEach(p => {
            p.classList.toggle('active', p.id === 'tab-employees');
        });
    } else {
        switchTab(validTabs.includes(hash) ? hash : 'employees');
    }
}

function switchTab(tabName) {
    currentTab = tabName;
    // TASK-429: Persist tab in URL hash
    if (window.location.hash.slice(1) !== tabName) {
        history.replaceState(null, '', '#' + tabName);
    }
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Hide all tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // Show selected tab content
    const selectedContent = document.getElementById(`${tabName}-tab`);
    if (selectedContent) {
        selectedContent.style.display = 'block';
    }
    
    // Load tab-specific data
    loadTabData(tabName);
}

function loadTabData(tabName) {
    switch(tabName) {
        case 'employees':
            // Already loaded by main dashboard
            break;
        case 'usage':
            loadUsageTab();
            break;
        case 'billing':
            loadBillingTab();
            break;
        case 'settings':
            loadSettingsTab();
            break;
    }
}

// Usage Tab
async function loadUsageTab() {
    if (!currentEmail) return;
    
    try {
        // Fetch both usage API and analytics overview
        const [usageRes, analyticsRes] = await Promise.all([
            fetch(`/api/dashboard/usage?email=${encodeURIComponent(currentEmail)}&days=30`),
            fetch(`/api/analytics/overview?userId=${encodeURIComponent(currentEmail)}&period=30d`).catch(() => null)
        ]);
        
        const usageData = await usageRes.json();
        
        // Update top-level stats from real usage data
        if (usageData.ok && usageData.dailyUsage) {
            const el = id => document.getElementById(id);
            const totalIn = usageData.dailyUsage.reduce((s, d) => s + (d.inputTokens || 0), 0);
            const totalOut = usageData.dailyUsage.reduce((s, d) => s + (d.outputTokens || 0), 0);
            const totalMsgs = usageData.dailyUsage.reduce((s, d) => s + (d.messageCount || 0), 0);
            const totalTokens = totalIn + totalOut;
            if (el('usageTotalTokens')) el('usageTotalTokens').textContent = totalTokens >= 1000 ? Math.round(totalTokens / 1000) + 'K' : totalTokens;
            if (el('usageTotalMessages')) el('usageTotalMessages').textContent = totalMsgs.toLocaleString();
            if (el('usageAvgTokens')) el('usageAvgTokens').textContent = Math.round(totalTokens / 30 / 1000) + 'K';
        }
        
        renderUsageDetails(usageData);
    } catch (err) {
        console.error('Failed to load usage data:', err);
    }
}

async function renderUsageDetails(data) {
    const container = document.getElementById('usage-details');
    if (!container) return;
    
    const dailyUsage = data.dailyUsage || [];
    
    // TASK-417: Empty state for usage tab
    if (dailyUsage.length === 0 || dailyUsage.every(d => !d.inputTokens && !d.outputTokens && !d.messageCount)) {
        container.innerHTML = `
            <div style="text-align:center; padding:60px 20px; color:#888">
                <div style="font-size:48px; margin-bottom:12px">📊</div>
                <h3 style="margin:0 0 8px; color:var(--white)">No usage data yet</h3>
                <p style="margin:0; font-size:14px">Usage statistics will appear here once your bot starts processing requests.</p>
            </div>
        `;
        return;
    }

    // Calculate totals
    const totalTokens = dailyUsage.reduce((sum, day) => sum + (day.inputTokens || 0) + (day.outputTokens || 0), 0);
    const totalMessages = dailyUsage.reduce((sum, day) => sum + (day.messageCount || 0), 0);
    
    // Estimate cost from tokens (Sonnet pricing: $3/M input, $15/M output)
    const totalIn = dailyUsage.reduce((s, d) => s + (d.inputTokens || 0), 0);
    const totalOut = dailyUsage.reduce((s, d) => s + (d.outputTokens || 0), 0);
    const totalCost = (totalIn / 1_000_000) * 3 + (totalOut / 1_000_000) * 15;
    const budgetLimit = 20; // Starter plan default
    
    const costBreakdown = data.costBreakdown || {};
    const budgetUtilization = budgetLimit > 0 ? (totalCost / budgetLimit) * 100 : 0;
    const budgetColor = budgetUtilization >= 90 ? 'var(--red)' : 
                       budgetUtilization >= 80 ? 'var(--yellow)' : 
                       'var(--green)';
    
    container.innerHTML = `
        <div class="usage-summary">
            <div class="usage-stat-card">
                <div class="label">Total Cost (Month)</div>
                <div class="value" style="color:${budgetColor};">$${totalCost.toFixed(2)}</div>
                <div class="sub" style="font-size:11px;color:var(--gray);margin-top:4px;">
                    ${budgetUtilization.toFixed(1)}% of $${budgetLimit.toFixed(2)} budget
                </div>
            </div>
            <div class="usage-stat-card">
                <div class="label">Total Tokens (30d)</div>
                <div class="value">${Math.round(totalTokens / 1000)}K</div>
            </div>
            <div class="usage-stat-card">
                <div class="label">Total Messages (30d)</div>
                <div class="value">${totalMessages}</div>
            </div>
            <div class="usage-stat-card">
                <div class="label">Avg Cost/Day</div>
                <div class="value">$${(totalCost / 30).toFixed(2)}</div>
            </div>
        </div>
        
        ${Object.keys(costBreakdown).length > 0 ? `
        <div class="cost-breakdown" style="margin-top:32px;padding:24px;background:rgba(255,107,53,0.05);border-radius:12px;">
            <h3 style="margin:0 0 16px 0;color:var(--white);">💰 Cost Breakdown by Provider</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;">
                ${Object.entries(costBreakdown).map(([provider, cost]) => {
                    const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;
                    return `
                    <div style="padding:16px;background:rgba(255,255,255,0.05);border-radius:8px;">
                        <div style="font-size:12px;color:var(--gray);text-transform:uppercase;">${provider}</div>
                        <div style="font-size:24px;font-weight:600;color:var(--primary);margin:8px 0;">$${cost.toFixed(2)}</div>
                        <div style="font-size:11px;color:var(--gray);">${pct.toFixed(1)}% of total</div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
        ` : ''}
        
        
        <div class="usage-chart-container">
            <h3>Daily Usage (Last 30 Days)</h3>
            <svg id="detailedUsageChart" width="100%" height="300" style="margin-top:24px;"></svg>
        </div>
        
        <div class="usage-breakdown">
            <h3>Daily Breakdown</h3>
            <div class="usage-table-wrapper" style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
            <table class="usage-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Input Tokens</th>
                        <th>Output Tokens</th>
                        <th>Total Tokens</th>
                        <th>Messages</th>
                    </tr>
                </thead>
                <tbody>
                    ${dailyUsage.slice().reverse().map(day => `
                        <tr>
                            <td>${day.date}</td>
                            <td>${(day.inputTokens || 0).toLocaleString()}</td>
                            <td>${(day.outputTokens || 0).toLocaleString()}</td>
                            <td>${((day.inputTokens || 0) + (day.outputTokens || 0)).toLocaleString()}</td>
                            <td>${day.messageCount || 0}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            </div>
        </div>
    `;
    
    // Render detailed chart
    renderDetailedUsageChart(dailyUsage);
}

async function renderDetailedUsageChart(days) {
    // Lazy load Chart.js, fallback to SVG
    const chartContainer = document.getElementById('detailedUsageChart');
    if (!chartContainer || days.length === 0) return;
    
    if (typeof Chart === 'undefined' && typeof loadChartLib === 'function') {
        try { await loadChartLib(); } catch(e) { /* fallback to SVG */ }
    }
    
    if (typeof Chart !== 'undefined') {
        // Replace SVG with canvas for Chart.js
        const parent = chartContainer.parentElement;
        if (chartContainer.tagName === 'SVG') {
            const canvas = document.createElement('canvas');
            canvas.id = 'detailedUsageChart';
            canvas.style.maxHeight = '300px';
            parent.replaceChild(canvas, chartContainer);
        }
        
        const ctx = document.getElementById('detailedUsageChart');
        if (!ctx) return;
        
        // Destroy existing chart if any
        if (window._usageChart) window._usageChart.destroy();
        
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
        const textColor = isDark ? '#aaa' : '#666';
        
        window._usageChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: days.map(d => d.date.slice(5)),
                datasets: [
                    {
                        label: 'Input Tokens',
                        data: days.map(d => (d.inputTokens || 0) / 1000),
                        backgroundColor: 'rgba(124, 58, 237, 0.7)',
                        borderRadius: 4
                    },
                    {
                        label: 'Output Tokens',
                        data: days.map(d => (d.outputTokens || 0) / 1000),
                        backgroundColor: 'rgba(16, 185, 129, 0.7)',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: textColor }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}K tokens`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { color: gridColor },
                        ticks: { color: textColor }
                    },
                    y: {
                        stacked: true,
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            callback: v => v + 'K'
                        }
                    }
                }
            }
        });
    } else {
        // SVG fallback
        const svg = chartContainer;
        if (svg.tagName !== 'SVG') return;
        
        const W = svg.clientWidth || 900;
        const H = 300;
        const PAD_L = 60, PAD_R = 20, PAD_T = 20, PAD_B = 60;
        const chartW = W - PAD_L - PAD_R;
        const chartH = H - PAD_T - PAD_B;
        
        const maxTokens = Math.max(...days.map(d => (d.inputTokens || 0) + (d.outputTokens || 0)), 1000);
        const barW = Math.min(20, (chartW / days.length) * 0.6);
        const gap = chartW / days.length;
        
        let html = '';
        for (let i = 0; i <= 5; i++) {
            const y = PAD_T + chartH - (chartH * i / 5);
            const val = Math.round(maxTokens * i / 5 / 1000);
            html += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#333" stroke-width="1"/>`;
            html += `<text x="${PAD_L - 8}" y="${y + 4}" text-anchor="end" fill="#888" font-size="11">${val}K</text>`;
        }
        
        days.forEach((d, i) => {
            const tokens = (d.inputTokens || 0) + (d.outputTokens || 0);
            const x = PAD_L + gap * i + (gap - barW) / 2;
            const h = (tokens / maxTokens) * chartH;
            const y = PAD_T + chartH - h;
            html += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="#ff6b35" opacity="0.85"/>`;
            if (i % 5 === 0) {
                const label = d.date.slice(5);
                html += `<text x="${x + barW/2}" y="${H - 10}" text-anchor="middle" fill="#888" font-size="10">${label}</text>`;
            }
        });
        
        svg.innerHTML = html;
    }
}

// Billing Tab
async function loadBillingTab() {
    if (!currentEmail) return;
    
    try {
        const [billingRes, marginRes] = await Promise.all([
            fetch(`/api/dashboard/billing?email=${encodeURIComponent(currentEmail)}`),
            fetch(`/api/dashboard/margin?email=${encodeURIComponent(currentEmail)}`)
        ]);
        
        const billingData = await billingRes.json();
        const marginData = await marginRes.json();
        
        renderBillingDetails(billingData, marginData);
    } catch (err) {
        console.error('Failed to load billing data:', err);
    }
}

function renderBillingDetails(billing, margin) {
    const container = document.getElementById('billing-details');
    if (!container) return;
    
    const tokensUsed = billing.usage?.tokensUsed || 0;
    const tokensLimit = billing.usage?.tokensLimit || 500000;
    const pctUsed = tokensLimit > 0 ? ((tokensUsed / tokensLimit) * 100).toFixed(1) : 0;
    const pctColor = pctUsed >= 90 ? 'var(--red)' : pctUsed >= 70 ? 'var(--yellow)' : 'var(--green)';
    
    container.innerHTML = `
        <div class="billing-summary">
            <div class="billing-stat-card">
                <div class="label">Current Plan</div>
                <div class="value">${billing.plan?.toUpperCase() || 'STARTER'}</div>
                <div class="sub">$${billing.planPrice || 29}/month</div>
            </div>
            <div class="billing-stat-card">
                <div class="label">Token Usage</div>
                <div class="value" style="color:${pctColor};">${pctUsed}%</div>
                <div class="sub">${tokensUsed.toLocaleString()} / ${tokensLimit.toLocaleString()}</div>
            </div>
            <div class="billing-stat-card">
                <div class="label">AI Employees</div>
                <div class="value">${margin.bots?.count || 1}</div>
                <div class="sub">${margin.bots?.uptimeHours || 0}h uptime this month</div>
            </div>
            <div class="billing-stat-card">
                <div class="label">Next Invoice</div>
                <div class="value">$${billing.planPrice || 29}</div>
                <div class="sub">${billing.nextBillingDate ? new Date(billing.nextBillingDate).toLocaleDateString() : 'TBD'}</div>
            </div>
        </div>
        
        <div class="billing-actions">
            <button class="btn btn-primary" onclick="upgradePlan()">Upgrade Plan</button>
            <button class="btn btn-secondary" onclick="manageBilling()">Manage Billing</button>
            <button class="btn btn-secondary" onclick="downloadInvoice()">Download Invoice</button>
        </div>
        
        <div class="cost-breakdown">
            <h3>Plan Details</h3>
            <p style="color:#aaa;margin-bottom:16px;">What's included in your ${billing.plan?.charAt(0).toUpperCase() + billing.plan?.slice(1) || 'Starter'} plan</p>
            <div style="display:grid;gap:12px;">
                <div style="background:rgba(255,255,255,0.03);padding:16px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
                    <span>Token Allowance</span>
                    <strong>${tokensLimit.toLocaleString()} / month</strong>
                </div>
                <div style="background:rgba(255,255,255,0.03);padding:16px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
                    <span>Status</span>
                    <strong style="color:var(--green);">● ${billing.status?.charAt(0).toUpperCase() + billing.status?.slice(1) || 'Active'}</strong>
                </div>
                <div style="background:rgba(255,255,255,0.03);padding:16px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
                    <span>Billing Cycle</span>
                    <strong>Monthly</strong>
                </div>
            </div>
        </div>
    `;
}

function downloadInvoice() {
    showToast('Invoice download coming soon!', 'info');
}

// Settings Tab
async function loadSettingsTab() {
    const container = document.getElementById('settings-details');
    if (!container) return;
    
    // Fetch current API keys and team members
    let apiKeys = [];
    let teamMembers = [];
    
    try {
        const [keysRes, teamRes] = await Promise.all([
            fetch(`/api/settings/api-keys?email=${encodeURIComponent(currentEmail)}`),
            fetch(`/api/settings/team?email=${encodeURIComponent(currentEmail)}`)
        ]);
        
        const keysData = await keysRes.json();
        const teamData = await teamRes.json();
        
        if (keysData.ok) apiKeys = keysData.keys || [];
        if (teamData.ok) teamMembers = teamData.members || [];
    } catch (err) {
        console.error('Failed to load settings data:', err);
    }
    
    container.innerHTML = `
        <div class="settings-section">
            <h3>Account Settings</h3>
            <div class="settings-form">
                <label>Email</label>
                <input type="email" value="${currentEmail}" disabled style="opacity:0.5;background:var(--bg-card);border:1px solid var(--light-gray);border-radius:8px;padding:12px;color:var(--white);width:100%;margin-bottom:16px;">
                
                <label>Notification Preferences</label>
                <div class="checkbox-group" id="notification-prefs">
                    <label><input type="checkbox" id="pref-usageSpikeAlerts" onchange="savePreferences()"> Email alerts for usage spikes</label>
                    <label><input type="checkbox" id="pref-weeklyReports" onchange="savePreferences()"> Weekly usage reports</label>
                    <label><input type="checkbox" id="pref-marketingEmails" onchange="savePreferences()"> Marketing emails</label>
                </div>
            </div>
        </div>
        
        <div class="settings-section">
            <h3>Team Members (${teamMembers.length})</h3>
            <p style="color:#aaa;margin-bottom:16px;">Invite team members to manage your AI employees.</p>
            
            <div style="margin-bottom:16px;">
                ${teamMembers.map(member => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg-card);border:1px solid var(--light-gray);border-radius:8px;margin-bottom:8px;">
                        <div>
                            <div style="font-weight:600;">${member.email}</div>
                            <div style="font-size:12px;color:var(--gray);text-transform:uppercase;">${member.role}</div>
                        </div>
                        ${member.memberId !== 'owner' ? `
                            <button class="btn btn-danger" style="padding:6px 12px;font-size:12px;" onclick="removeTeamMember('${member.memberId}')">Remove</button>
                        ` : '<span style="color:var(--green);font-size:12px;">●  You</span>'}
                    </div>
                `).join('')}
            </div>
            
            <button class="btn btn-primary" onclick="showInviteTeamModal()">+ Invite Team Member</button>
        </div>
        
        <!-- API Keys section hidden for MVP. Backend ready: api-local/settings/api-keys.js
             Unhide when targeting developer/agency users (Phase 2). -->

        <div class="settings-section">
            <h3>🔐 Connected Services</h3>
            <p style="color:#aaa;margin-bottom:16px;">Add your API keys for services your AI employee can use. Keys are encrypted and never shown again.</p>
            <div id="clientSecrets"><p style="color:var(--gray);">Loading...</p></div>
            <div id="newSecretRow" style="display:none;margin-top:8px;">
                <div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-card);border:2px solid var(--primary);border-radius:8px;">
                    <input type="text" id="newSecretName" placeholder="KEY_NAME" style="background:var(--bg);border:1px solid var(--light-gray);border-radius:4px;padding:8px 10px;color:var(--white);font-family:monospace;font-size:12px;min-width:180px;text-transform:uppercase;">
                    <input type="password" id="newSecretValue" placeholder="Paste your secret value…" style="flex:1;background:var(--bg);border:1px solid var(--light-gray);border-radius:4px;padding:8px 10px;color:var(--white);font-family:monospace;font-size:12px;">
                    <button class="btn btn-primary" style="padding:6px 14px;font-size:12px;white-space:nowrap;" onclick="saveNewSecret()">Save</button>
                    <button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="cancelNewSecret()">✕</button>
                </div>
            </div>
            <div style="margin-top:12px;display:flex;align-items:center;gap:16px;">
                <button class="btn btn-primary" onclick="showNewSecretRow()">+ Add Secret</button>
                <span style="font-size:12px;color:var(--gray);">Common: <span style="color:#aaa;">ELEVENLABS_API_KEY, METRICOOL_API_KEY, METRICOOL_BRAND_ID</span></span>
            </div>
        </div>
        
        <div class="settings-section">
            <h3>Danger Zone</h3>
            <button class="btn btn-danger" onclick="confirmDeleteAccount()">Delete Account</button>
        </div>
    `;

    // Load client secrets and preferences after render
    loadClientSecrets();
    loadPreferences();
}

async function loadPreferences() {
    try {
        const res = await fetch('/api/settings/preferences');
        const data = await res.json();
        if (data.ok && data.preferences) {
            const p = data.preferences;
            const spike = document.getElementById('pref-usageSpikeAlerts');
            const weekly = document.getElementById('pref-weeklyReports');
            const marketing = document.getElementById('pref-marketingEmails');
            if (spike) spike.checked = p.usageSpikeAlerts;
            if (weekly) weekly.checked = p.weeklyReports;
            if (marketing) marketing.checked = p.marketingEmails;
        }
    } catch (err) {
        console.error('Failed to load preferences:', err);
    }
}

async function savePreferences() {
    const prefs = {
        usageSpikeAlerts: document.getElementById('pref-usageSpikeAlerts')?.checked ?? true,
        weeklyReports: document.getElementById('pref-weeklyReports')?.checked ?? true,
        marketingEmails: document.getElementById('pref-marketingEmails')?.checked ?? false
    };
    try {
        const res = await fetch('/api/settings/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(prefs)
        });
        const data = await res.json();
        if (data.ok) {
            showToast('Preferences saved', 'success');
        }
    } catch (err) {
        console.error('Failed to save preferences:', err);
        showToast('Failed to save preferences', 'error');
    }
}

// Team management functions
async function showInviteTeamModal() {
    const result = await showPromptDialog('Invite Team Member', 'Enter email address:');
    if (!result) return;
    
    const role = await showSelectDialog('Select role:', ['admin', 'member', 'viewer']);
    if (!role) return;
    
    try {
        const res = await fetch('/api/settings/team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: currentEmail,
                inviteEmail: result,
                role: role
            })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast(`Invitation sent to ${result}`, 'success');
            loadSettingsTab();
        } else {
            showToast(`Failed to invite: ${data.error}`, 'error');
        }
    } catch (err) {
        showToast('Failed to send invitation', 'error');
    }
}

async function removeTeamMember(memberId) {
    const confirmed = await showConfirmDialog('Remove this team member?', 'Remove Team Member', 'Remove', 'Cancel');
    if (!confirmed) return;
    
    try {
        const res = await fetch('/api/settings/team', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentEmail, memberId })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast('Team member removed', 'success');
            loadSettingsTab();
        } else {
            showToast(`Failed to remove: ${data.error}`, 'error');
        }
    } catch (err) {
        showToast('Failed to remove team member', 'error');
    }
}

// API key management functions
async function showGenerateApiKeyModal() {
    const name = await showPromptDialog('Generate API Key', 'Enter key name (e.g., "Production Server"):');
    if (!name) return;
    
    try {
        // Try new dedicated endpoint first, fall back to settings endpoint
        let res = await fetch('/api/keys/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                scopes: ['bots:read', 'bots:create', 'usage:read']
            })
        });
        
        let data = await res.json();
        
        if (data.secretKey) {
            // New endpoint format - show both public and secret keys
            showApiKeyModal(data.secretKey, name);
            loadSettingsTab();
        } else if (data.ok) {
            // Legacy format
            showApiKeyModal(data.apiKey, name);
            loadSettingsTab();
        } else {
            showToast(`Failed to generate key: ${data.error}`, 'error');
        }
    } catch (err) {
        showToast('Failed to generate API key', 'error');
    }
}

function showApiKeyModal(apiKey, name) {
    const modal = document.getElementById('genericModal');
    if (!modal) return;
    
    document.getElementById('genericModalTitle').textContent = '🔑 API Key Generated';
    document.getElementById('genericModalMessage').innerHTML = `
        <div style="margin-bottom:16px;">
            <strong>${name}</strong>
        </div>
        <div style="background:var(--bg);padding:16px;border-radius:8px;margin-bottom:16px;">
            <code style="word-break:break-all;font-size:12px;">${apiKey}</code>
        </div>
        <p style="color:var(--yellow);font-size:14px;margin-bottom:8px;">⚠️ Save this key now!</p>
        <p style="color:var(--gray);font-size:13px;">This is the only time you'll see this key. Store it somewhere safe.</p>
    `;
    
    document.getElementById('genericModalActions').innerHTML = `
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${apiKey}');showToast('Copied to clipboard!','success')">📋 Copy</button>
        <button class="btn btn-primary" onclick="closeModal()">Done</button>
    `;
    
    openModal('genericModal');
}

async function revokeApiKey(keyId) {
    const confirmed = await showConfirmDialog('Revoke this API key? Apps using it will stop working.', 'Revoke API Key', 'Revoke', 'Cancel');
    if (!confirmed) return;
    
    try {
        const res = await fetch('/api/settings/api-keys', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentEmail, keyId })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast('API key revoked', 'success');
            loadSettingsTab();
        } else {
            showToast(`Failed to revoke: ${data.error}`, 'error');
        }
    } catch (err) {
        showToast('Failed to revoke API key', 'error');
    }
}

// Helper functions for prompts/selects
function showPromptDialog(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('genericModal');
        if (!modal) {
            resolve(null);
            return;
        }
        
        document.getElementById('genericModalTitle').textContent = title;
        document.getElementById('genericModalMessage').innerHTML = `
            <p style="margin-bottom:12px;">${message}</p>
            <input type="text" id="promptInput" style="width:100%;padding:12px;background:var(--bg);border:1px solid var(--light-gray);border-radius:8px;color:var(--white);">
        `;
        
        document.getElementById('genericModalActions').innerHTML = `
            <button class="btn btn-secondary" onclick="genericModalResolve(null)">Cancel</button>
            <button class="btn btn-primary" onclick="genericModalResolve(document.getElementById('promptInput').value)">OK</button>
        `;
        
        window.genericModalResolveFunc = resolve;
        openModal('genericModal');
        
        setTimeout(() => document.getElementById('promptInput')?.focus(), 100);
    });
}

function showSelectDialog(title, options) {
    return new Promise((resolve) => {
        const modal = document.getElementById('genericModal');
        if (!modal) {
            resolve(null);
            return;
        }
        
        document.getElementById('genericModalTitle').textContent = title;
        document.getElementById('genericModalMessage').innerHTML = `
            <select id="selectInput" style="width:100%;padding:12px;background:var(--bg);border:1px solid var(--light-gray);border-radius:8px;color:var(--white);">
                ${options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
            </select>
        `;
        
        document.getElementById('genericModalActions').innerHTML = `
            <button class="btn btn-secondary" onclick="genericModalResolve(null)">Cancel</button>
            <button class="btn btn-primary" onclick="genericModalResolve(document.getElementById('selectInput').value)">OK</button>
        `;
        
        window.genericModalResolveFunc = resolve;
        openModal('genericModal');
    });
}

function genericModalResolve(value) {
    if (window.genericModalResolveFunc) {
        window.genericModalResolveFunc(value);
        window.genericModalResolveFunc = null;
    }
    closeModal();
}

function confirmDeleteAccount() {
    showConfirmDialog(
        'Are you sure you want to delete your account? This action cannot be undone. All your AI employees and data will be permanently deleted.',
        'Delete Account',
        'Delete Forever',
        'Cancel'
    ).then(confirmed => {
        if (confirmed) {
            showToast('Account deletion is disabled in beta. Contact support to delete your account.', 'warning', 5000);
        }
    });
}

// ─── Client Secrets ───

async function loadClientSecrets() {
    const el = document.getElementById('clientSecrets');
    if (!el) return;
    try {
        const res = await fetch('/api/settings/secrets');
        const data = await res.json();
        if (!data.ok || !data.secrets?.length) {
            el.innerHTML = '<p style="color:var(--gray);font-size:13px;">No secrets configured yet.</p>';
            return;
        }
        el.innerHTML = data.secrets.map(s => `
            <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-card);border:1px solid var(--light-gray);border-radius:8px;margin-bottom:8px;font-size:13px;">
                <code style="background:var(--bg);padding:4px 8px;border-radius:4px;font-size:12px;min-width:180px;">${s.key}</code>
                <span style="color:var(--gray);font-family:monospace;font-size:12px;">${s.preview}</span>
                <span style="flex:1;color:var(--gray);font-size:12px;">${s.label !== s.key ? s.label : ''}</span>
                <button class="btn btn-danger" style="padding:4px 10px;font-size:11px;" onclick="deleteClientSecret('${s.key}')">Remove</button>
            </div>
        `).join('');
    } catch (err) {
        el.innerHTML = `<p style="color:var(--red);font-size:13px;">Error loading secrets</p>`;
    }
}

function showNewSecretRow() {
    document.getElementById('newSecretRow').style.display = 'block';
    document.getElementById('newSecretName').value = '';
    document.getElementById('newSecretValue').value = '';
    setTimeout(() => document.getElementById('newSecretName').focus(), 50);
}

function cancelNewSecret() {
    document.getElementById('newSecretRow').style.display = 'none';
}

async function saveNewSecret() {
    const nameEl = document.getElementById('newSecretName');
    const valueEl = document.getElementById('newSecretValue');
    const key = (nameEl.value || '').trim().toUpperCase();
    const value = (valueEl.value || '').trim();

    if (!key) { nameEl.focus(); showToast('Enter a key name', 'error'); return; }
    if (!value) { valueEl.focus(); showToast('Enter the secret value', 'error'); return; }

    try {
        const res = await fetch('/api/settings/secrets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value, label: key })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('Secret saved!', 'success');
            cancelNewSecret();
            loadClientSecrets();
        } else {
            showToast('Error: ' + data.error, 'error');
        }
    } catch {
        showToast('Failed to save secret', 'error');
    }
}

async function deleteClientSecret(key) {
    const confirmed = await showConfirmDialog(`Remove ${key}? Services using it will stop working.`, 'Remove Secret', 'Remove', 'Cancel');
    if (!confirmed) return;

    try {
        const res = await fetch('/api/settings/secrets', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('Secret removed', 'success');
            loadClientSecrets();
        }
    } catch {}
}

// Initialize on load
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        // Check if tabs exist before initializing
        if (document.querySelector('.tab-btn')) {
            initTabs();
        }
    });
}
