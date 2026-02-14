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
        const res = await fetch(`/api/dashboard/usage?email=${encodeURIComponent(currentEmail)}&days=30`);
        const data = await res.json();
        
        renderUsageDetails(data);
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
    const svg = document.getElementById('detailedUsageChart');
    if (!svg || days.length === 0) return;
    
    const W = svg.clientWidth || 900;
    const H = 300;
    const PAD_L = 60, PAD_R = 20, PAD_T = 20, PAD_B = 60;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    
    const maxTokens = Math.max(...days.map(d => (d.inputTokens || 0) + (d.outputTokens || 0)), 1000);
    const barW = Math.min(20, (chartW / days.length) * 0.6);
    const gap = chartW / days.length;
    
    let html = '';
    
    // Y-axis
    for (let i = 0; i <= 5; i++) {
        const y = PAD_T + chartH - (chartH * i / 5);
        const val = Math.round(maxTokens * i / 5 / 1000);
        html += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#333" stroke-width="1"/>`;
        html += `<text x="${PAD_L - 8}" y="${y + 4}" text-anchor="end" fill="#888" font-size="11">${val}K</text>`;
    }
    
    // Bars
    days.forEach((d, i) => {
        const tokens = (d.inputTokens || 0) + (d.outputTokens || 0);
        const x = PAD_L + gap * i + (gap - barW) / 2;
        const h = (tokens / maxTokens) * chartH;
        const y = PAD_T + chartH - h;
        
        html += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="#ff6b35" opacity="0.85"/>`;
        
        // X-axis labels (every 5 days)
        if (i % 5 === 0) {
            const label = d.date.slice(5);
            html += `<text x="${x + barW/2}" y="${H - 10}" text-anchor="middle" fill="#888" font-size="10">${label}</text>`;
        }
    });
    
    svg.innerHTML = html;
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
function loadSettingsTab() {
    const container = document.getElementById('settings-details');
    if (!container) return;
    
    container.innerHTML = `
        <div class="settings-section">
            <h3>Account Settings</h3>
            <div class="settings-form">
                <label>Email</label>
                <input type="email" value="${currentEmail}" disabled style="opacity:0.5;">
                
                <label>Notification Preferences</label>
                <div class="checkbox-group">
                    <label><input type="checkbox" checked> Email alerts for usage spikes</label>
                    <label><input type="checkbox" checked> Weekly usage reports</label>
                    <label><input type="checkbox"> Marketing emails</label>
                </div>
            </div>
        </div>
        
        <div class="settings-section">
            <h3>Team Members</h3>
            <p style="color:#aaa;">Invite team members to manage your AI employees.</p>
            <button class="btn btn-primary" onclick="showToast('Team management coming soon!', 'info')">Invite Team Member</button>
        </div>
        
        <div class="settings-section">
            <h3>API Access</h3>
            <p style="color:#aaa;">Connect external tools to your AI employees.</p>
            <button class="btn btn-secondary" onclick="showToast('API keys coming soon!', 'info')">Generate API Key</button>
        </div>
        
        <div class="settings-section">
            <h3>Danger Zone</h3>
            <button class="btn btn-danger" onclick="confirmDeleteAccount()">Delete Account</button>
        </div>
    `;
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
