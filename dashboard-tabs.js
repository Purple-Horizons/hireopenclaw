/**
 * Tabbed Interface for Dashboard
 * Employees | Usage | Billing | Settings
 */

let currentTab = 'employees';

function initTabs() {
    // Add click handlers to all tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchTab(tab);
        });
    });
    
    // Load initial tab
    switchTab('employees');
}

function switchTab(tabName) {
    currentTab = tabName;
    
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
        
        // Update top-level stats if analytics available
        if (analyticsRes) {
            try {
                const analytics = await analyticsRes.json();
                const el = id => document.getElementById(id);
                if (analytics.summary) {
                    const s = analytics.summary;
                    if (el('usageTotalTokens')) el('usageTotalTokens').textContent = Math.round((s.tokensIn + s.tokensOut) / 1000) + 'K';
                    if (el('usageTotalMessages')) el('usageTotalMessages').textContent = s.messages.toLocaleString();
                    if (el('usageAvgTokens')) el('usageAvgTokens').textContent = Math.round((s.tokensIn + s.tokensOut) / 30 / 1000) + 'K';
                    if (el('usageTotalCost')) el('usageTotalCost').textContent = '$' + s.cost.toFixed(2);
                }
            } catch (e) {
                console.warn('Analytics not available:', e);
            }
        }
        
        renderUsageDetails(usageData);
    } catch (err) {
        console.error('Failed to load usage data:', err);
    }
}

function renderUsageDetails(data) {
    const container = document.getElementById('usage-details');
    if (!container) return;
    
    const dailyUsage = data.dailyUsage || [];
    
    // Calculate totals
    const totalTokens = dailyUsage.reduce((sum, day) => sum + (day.inputTokens || 0) + (day.outputTokens || 0), 0);
    const totalMessages = dailyUsage.reduce((sum, day) => sum + (day.messageCount || 0), 0);
    
    container.innerHTML = `
        <div class="usage-summary">
            <div class="usage-stat-card">
                <div class="label">Total Tokens (30d)</div>
                <div class="value">${Math.round(totalTokens / 1000)}K</div>
            </div>
            <div class="usage-stat-card">
                <div class="label">Total Messages (30d)</div>
                <div class="value">${totalMessages}</div>
            </div>
            <div class="usage-stat-card">
                <div class="label">Avg Tokens/Day</div>
                <div class="value">${Math.round(totalTokens / 30 / 1000)}K</div>
            </div>
            <div class="usage-stat-card">
                <div class="label">Avg Messages/Day</div>
                <div class="value">${Math.round(totalMessages / 30)}</div>
            </div>
        </div>
        
        <div class="usage-chart-container">
            <h3>Daily Usage (Last 30 Days)</h3>
            <svg id="detailedUsageChart" width="100%" height="300" style="margin-top:24px;"></svg>
        </div>
        
        <div class="usage-breakdown">
            <h3>Daily Breakdown</h3>
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
    `;
    
    // Render detailed chart
    renderDetailedUsageChart(dailyUsage);
}

function renderDetailedUsageChart(days) {
    // Use Chart.js if available, fallback to SVG
    const chartContainer = document.getElementById('detailedUsageChart');
    if (!chartContainer || days.length === 0) return;
    
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
    
    const marginStatus = margin.margin?.status || 'unknown';
    const marginColor = marginStatus === 'healthy' ? 'var(--green)' : 
                        marginStatus === 'warning' ? 'var(--yellow)' : 'var(--red)';
    
    container.innerHTML = `
        <div class="billing-summary">
            <div class="billing-stat-card">
                <div class="label">Current Plan</div>
                <div class="value">${billing.plan?.toUpperCase() || 'STARTER'}</div>
                <div class="sub">$${billing.planPrice || 29}/month</div>
            </div>
            <div class="billing-stat-card">
                <div class="label">Revenue</div>
                <div class="value">$${margin.revenue || 0}</div>
                <div class="sub">This month</div>
            </div>
            <div class="billing-stat-card">
                <div class="label">Costs</div>
                <div class="value">$${margin.costs?.total || 0}</div>
                <div class="sub">Tokens: $${margin.costs?.tokens || 0} | Compute: $${margin.costs?.compute || 0}</div>
            </div>
            <div class="billing-stat-card" style="border-left: 3px solid ${marginColor};">
                <div class="label">Margin</div>
                <div class="value" style="color:${marginColor};">$${margin.margin?.amount || 0}</div>
                <div class="sub">${margin.margin?.percent || 0}% (${marginStatus})</div>
            </div>
        </div>
        
        <div class="billing-actions">
            <button class="btn btn-primary" onclick="upgradePlan()">Upgrade Plan</button>
            <button class="btn btn-secondary" onclick="manageBilling()">Manage Billing</button>
            <button class="btn btn-secondary" onclick="downloadInvoice()">Download Invoice</button>
        </div>
        
        <div class="cost-breakdown">
            <h3>Cost Breakdown</h3>
            <p style="color:#aaa;margin-bottom:16px;">Understanding your AI employee costs</p>
            <div style="display:grid;gap:16px;">
                <div style="background:rgba(255,255,255,0.03);padding:16px;border-radius:8px;">
                    <strong>Token Costs: $${margin.costs?.tokens || 0}</strong><br>
                    <span style="color:#888;font-size:14px;">
                        ${margin.usage?.inputTokens || 0} input + ${margin.usage?.outputTokens || 0} output tokens<br>
                        Model: ${margin.bots?.avgModel || 'gpt-4o'}
                    </span>
                </div>
                <div style="background:rgba(255,255,255,0.03);padding:16px;border-radius:8px;">
                    <strong>Compute Costs: $${margin.costs?.compute || 0}</strong><br>
                    <span style="color:#888;font-size:14px;">
                        ${margin.bots?.uptimeHours || 0} hours across ${margin.bots?.count || 0} bot(s)<br>
                        Fargate: $0.04/hour per bot
                    </span>
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
                <div class="checkbox-group">
                    <label><input type="checkbox" checked> Email alerts for usage spikes</label>
                    <label><input type="checkbox" checked> Weekly usage reports</label>
                    <label><input type="checkbox"> Marketing emails</label>
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
        
        <div class="settings-section">
            <h3>API Keys (${apiKeys.length})</h3>
            <p style="color:#aaa;margin-bottom:16px;">Connect external tools to your AI employees.</p>
            
            ${apiKeys.length > 0 ? `
                <div style="margin-bottom:16px;">
                    ${apiKeys.map(key => `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg-card);border:1px solid var(--light-gray);border-radius:8px;margin-bottom:8px;">
                            <div style="flex:1;">
                                <div style="font-weight:600;">${key.name}</div>
                                <div style="font-size:12px;color:var(--gray);font-family:monospace;margin-top:6px;display:flex;align-items:center;gap:8px;">
                                    <code style="background:var(--bg);padding:4px 8px;border-radius:4px;">${key.publicKey || key.preview}</code>
                                    <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="navigator.clipboard.writeText('${key.publicKey || key.preview}');showToast('Copied!','success')">📋 Copy</button>
                                </div>
                                <div style="font-size:11px;color:var(--gray);margin-top:6px;">
                                    Created: ${new Date(key.createdAt).toLocaleDateString()}
                                    ${key.lastUsedAt ? ` • Last used: ${new Date(key.lastUsedAt).toLocaleDateString()}` : ' • Never used'}
                                </div>
                            </div>
                            <button class="btn btn-danger" style="padding:6px 12px;font-size:12px;" onclick="revokeApiKey('${key.keyId}')">Revoke</button>
                        </div>
                    `).join('')}
                </div>
            ` : '<p style="color:var(--gray);font-size:14px;margin-bottom:16px;">No API keys yet.</p>'}
            
            <button class="btn btn-primary" onclick="showGenerateApiKeyModal()">+ Generate API Key</button>
        </div>
        
        <div class="settings-section">
            <h3>Danger Zone</h3>
            <button class="btn btn-danger" onclick="confirmDeleteAccount()">Delete Account</button>
        </div>
    `;
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

// Initialize on load
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        // Check if tabs exist before initializing
        if (document.querySelector('.tab-btn')) {
            initTabs();
        }
    });
}
