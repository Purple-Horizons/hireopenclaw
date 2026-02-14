// Dynamic dashboard functionality for hireopenclaw
// Fetches real data from API and renders UI

let currentEmail = null;
let currentBots = [];

// Modal/Alert Functions (use modal.js toast system)
function showAlert(message, type = 'info') {
    showToast(message, type);
}

function showConfirm(message, title = 'Confirm') {
    return showConfirmDialog(message, title);
}

function showDeleteModal(botId, botName) {
    showDeleteBotModal(botId, botName);
}

// Get email from URL parameter or localStorage
function getUserEmail() {
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email') || localStorage.getItem('clawops_email');
    return email;
}

// Load and render dashboard
async function loadDashboard(email) {
    if (!email) {
        showLoginPrompt();
        return;
    }
    
    currentEmail = email;
    localStorage.setItem('clawops_email', email);
    
    try {
        const res = await fetch(`/api/dashboard/bots?email=${encodeURIComponent(email)}`);
        const data = await res.json();
        
        if (data.bots) {
            currentBots = data.bots;
            
            // Update header user info
            document.querySelector('.user-info .email').textContent = email;
            document.querySelector('.user-info .plan-badge').textContent = data.plan.toUpperCase();
            
            // Update stats
            updateStats(data);
            
            // Render bots grid
            renderBots(data.bots, data.maxBots);
            
            // Load usage chart
            loadUsageChart(email);
            
            // Show dashboard, hide login
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('dashboardScreen').style.display = 'block';
        }
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        showToast('Failed to load dashboard. Check console for errors.', 'error');
    }
}

// Update stats cards
function updateStats(data) {
    const activeBots = data.bots.filter(b => b.status === 'active').length;
    
    // Active bots stat (REAL DATA)
    document.querySelector('.stat-card:nth-child(1) .label').textContent = 'Active Employees';
    document.querySelector('.stat-card:nth-child(1) .value').textContent = activeBots;
    document.querySelector('.stat-card:nth-child(1) .sub').textContent = `of ${data.maxBots} available`;
    
    // Token usage stat (MOCK DATA for now)
    const tokenK = Math.round(data.totalTokensUsed / 1000);
    const limitM = (data.totalTokensLimit / 1000000).toFixed(1);
    const tokenPct = data.totalTokensLimit > 0 
        ? Math.round((data.totalTokensUsed / data.totalTokensLimit) * 100) 
        : 0;
    
    document.querySelector('.stat-card:nth-child(2) .label').textContent = 'Tokens Used';
    document.querySelector('.stat-card:nth-child(2) .value').textContent = `${tokenK}K`;
    document.querySelector('.stat-card:nth-child(2) .sub').textContent = `of ${limitM}M this month`;
    
    // Usage bar
    const bar = document.querySelector('.usage-bar');
    bar.style.width = `${tokenPct}%`;
    bar.className = `usage-bar ${tokenPct > 90 ? 'red' : tokenPct > 70 ? 'yellow' : 'green'}`;
    
    // Hide mock stats (messages, uptime)
    const statCards = document.querySelectorAll('.stat-card');
    if (statCards[2]) statCards[2].style.opacity = '0.5';
    if (statCards[3]) statCards[3].style.opacity = '0.5';
}

// Render bots grid
function renderBots(bots, maxBots) {
    const grid = document.querySelector('.bots-grid');
    grid.innerHTML = ''; // Clear existing
    
    // Render each bot
    bots.forEach(bot => {
        const card = createBotCard(bot);
        grid.appendChild(card);
    });
    
    // Add "Add Bot" card if slots available
    if (bots.length < maxBots) {
        const addCard = createAddBotCard(maxBots - bots.length);
        grid.appendChild(addCard);
    }
}

// Create bot card element
function createBotCard(bot) {
    const card = document.createElement('div');
    card.className = 'bot-card';
    
    const statusClass = bot.status === 'active' ? 'active' : 
                       bot.status === 'paused' ? 'paused' : 'error';
    
    const healthColor = bot.health === 'healthy' ? 'var(--green)' :
                       bot.health === 'unhealthy' ? 'var(--red)' : 'var(--yellow)';
    
    const lastActiveText = formatLastActive(bot.lastActive);
    const tokenDisplay = bot.gatewayToken 
        ? `${bot.gatewayToken.substring(0, 8)}...` 
        : 'Not set';
    
    card.innerHTML = `
        <div class="bot-header">
            <div style="flex:1;">
                <div class="bot-name">
                    ${escapeHtml(bot.name)}
                    <button onclick="renameBot('${bot.id}', '${escapeHtml(bot.name)}'); event.stopPropagation();" 
                            style="background:none;border:none;color:var(--gray);cursor:pointer;font-size:14px;margin-left:8px;padding:4px;" 
                            title="Rename bot">✏️</button>
                </div>
                <div class="bot-role">${escapeHtml(bot.role)}</div>
            </div>
            <span class="status-dot ${statusClass}" title="${bot.status}"></span>
        </div>
        

        <div class="bot-stats">
            <div class="bot-stat">
                <div class="label">Tokens used</div>
                <div class="value">${Math.round(bot.tokensUsed / 1000)}K</div>
            </div>
            <div class="bot-stat">
                <div class="label">Last active</div>
                <div class="value">${lastActiveText}</div>
            </div>
            <div class="bot-stat">
                <div class="label">Health</div>
                <div class="value" style="color:${healthColor};">${bot.health}</div>
            </div>
        </div>
        
        ${bot.gatewayToken ? `
        <div style="margin-top:16px;padding:12px;background:rgba(255,107,53,0.1);border-radius:8px;">
            <div style="font-size:11px;color:var(--gray);margin-bottom:6px;">🔑 Gateway Token (first-time pairing)</div>
            <div style="display:flex;align-items:center;gap:8px;">
                <code style="flex:1;font-size:11px;color:var(--white);word-break:break-all;">${tokenDisplay}</code>
                <button class="btn btn-primary" style="padding:4px 12px;font-size:11px;white-space:nowrap;" onclick="copyToken('${bot.gatewayToken}', '${escapeHtml(bot.name)}'); return false;">📋 Copy</button>
            </div>
        </div>
        ` : ''}
        
        <div class="bot-actions">
            <button class="btn btn-primary" onclick="openBot('${bot.id}', '${bot.endpoint}', '${bot.gatewayToken || ''}')">💬 Open Chat</button>
            ${bot.status === 'active' 
                ? `<button class="btn btn-secondary" onclick="botAction('${bot.id}', 'pause')">⏸ Pause</button>`
                : `<button class="btn btn-primary" onclick="botAction('${bot.id}', 'resume')">▶ Resume</button>`
            }
            <button class="btn btn-danger" onclick="showDeleteModal('${bot.id}', '${escapeHtml(bot.name)}')">🗑 Delete</button>
        </div>
    `;
    
    return card;
}

// Create "Add Bot" card
function createAddBotCard(slotsAvailable) {
    const card = document.createElement('div');
    card.className = 'add-bot-card';
    card.onclick = showAddBot;
    
    card.innerHTML = `
        <div class="icon">+</div>
        <div class="text">Add another AI employee</div>
        <div class="text" style="font-size:12px;margin-top:4px;">
            ${slotsAvailable} slot${slotsAvailable !== 1 ? 's' : ''} available
        </div>
    `;
    
    return card;
}

// Format last active time
function formatLastActive(timestamp) {
    if (!timestamp) return 'Never';
    
    // Handle both Unix timestamps (number) and ISO strings
    const lastActiveMs = typeof timestamp === 'number' 
        ? timestamp 
        : new Date(timestamp).getTime();
    
    const diff = Date.now() - lastActiveMs;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

// Bot actions
async function botAction(tenantId, action) {
    // Confirm pause action
    if (action === 'pause') {
        const confirmed = await showConfirm(
            'Pause this AI employee? They will stop responding until resumed.',
            'Confirm Pause'
        );
        if (!confirmed) return;
    }
    
    try {
        const res = await fetch('/api/dashboard/bot-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, action })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast(`Bot ${action}d successfully`, 'success');
            setTimeout(() => {
                closeModal();
                loadDashboard(currentEmail);
            }, 1500);
        } else {
            showToast(`Failed to ${action} bot: ${data.error}`, 'error');
        }
    } catch (err) {
        console.error('Bot action failed:', err);
        showToast('Action failed. Try again.', 'error');
    }
}

// Open bot chat interface
function openBot(botId, endpoint, token) {
    if (!endpoint) {
        showToast('Bot endpoint not available yet. Try again in a moment.', 'warning');
        return;
    }
    
    // If we have a token, use launch page for auto-auth
    if (token && token.length >= 20) {
        // Generate expiry timestamp (5 minutes from now)
        const expiryMs = Date.now() + (5 * 60 * 1000);
        
        // Construct launch URL (query params, not hash)
        // Launch page will inject token into localStorage then redirect
        const launchUrl = `/launch?endpoint=${encodeURIComponent(endpoint)}&token=${encodeURIComponent(token)}&exp=${expiryMs}`;
        
        // Open in new tab
        window.open(launchUrl, '_blank');
        
        // Show info toast
        showTemporaryMessage('🚀 Launching bot with auto-authentication...', 'info', 3000);
    } else {
        // No token available, just open endpoint
        window.open(endpoint, '_blank');
        showTemporaryMessage('ℹ️ Opened bot - you may need to pair manually', 'info', 3000);
    }
}

// Show temporary message (non-blocking toast)
function showTemporaryMessage(text, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'var(--green)' : 
                    type === 'error' ? 'var(--red)' : 
                    type === 'warning' ? 'var(--yellow)' : 
                    'var(--blue)';
    
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: ${bgColor};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        animation: slideUp 0.3s ease-out;
    `;
    toast.textContent = text;
    
    // Add animation if not exists
    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes slideUp {
                from { transform: translateY(100px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            @keyframes slideDown {
                from { transform: translateY(0); opacity: 1; }
                to { transform: translateY(100px); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Auto-remove
    setTimeout(() => {
        toast.style.animation = 'slideDown 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Copy token to clipboard
function copyToken(token, botName) {
    navigator.clipboard.writeText(token).then(() => {
        // Show success feedback (non-blocking)
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.style.background = 'var(--green)';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2000);
    }).catch(() => {
        // Fallback: show toast with manual copy instruction
        showToast('Failed to copy. Please select and copy the token manually.', 'warning');
    });
}

// Configure bot - disabled for now (will be a proper modal later)
function configureBot(botId) {
    showToast('Configuration panel coming soon!', 'info');
}

// Show Add Bot form (uses modal from modal.js)
function showAddBot() {
    showAddBotModal();
}

// Rename bot
async function renameBot(botId, currentName) {
    const newName = prompt(`Rename bot:`, currentName);
    
    if (!newName || newName.trim() === '' || newName.trim() === currentName) {
        return; // Cancelled or no change
    }
    
    try {
        const res = await fetch('/api/dashboard/rename-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenantId: botId,
                newName: newName.trim()
            })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast(`Bot renamed to "${newName}"`, 'success');
            setTimeout(() => loadDashboard(currentEmail), 1000);
        } else {
            showToast(`Failed to rename: ${data.error}`, 'error');
        }
    } catch (err) {
        console.error('Rename failed:', err);
        showToast('Failed to rename bot', 'error');
    }
}

// Load usage chart
async function loadUsageChart(email) {
    try {
        const res = await fetch(`/api/dashboard/usage?email=${encodeURIComponent(email)}&days=7`);
        const data = await res.json();
        renderUsageChart(data.dailyUsage || []);
    } catch (err) {
        console.error('Failed to load usage chart:', err);
        // Render empty chart
        renderUsageChart([]);
    }
}

// Render usage chart (same as before)
function renderUsageChart(days) {
    const svg = document.getElementById('usageChart');
    if (!svg || days.length === 0) return;
    
    const W = 700, H = 220, PAD_L = 60, PAD_R = 20, PAD_T = 20, PAD_B = 40;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    
    const maxTokens = Math.max(...days.map(d => (d.inputTokens || 0) + (d.outputTokens || 0)), 1000);
    const barW = Math.min(60, (chartW / days.length) * 0.7);
    const gap = chartW / days.length;
    
    let html = '';
    
    // Y-axis labels
    for (let i = 0; i <= 4; i++) {
        const y = PAD_T + chartH - (chartH * i / 4);
        const val = Math.round(maxTokens * i / 4 / 1000);
        html += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#333" stroke-width="1"/>`;
        html += `<text x="${PAD_L - 8}" y="${y + 4}" text-anchor="end" fill="#888" font-size="11" font-family="Inter,sans-serif">${val}K</text>`;
    }
    
    // Bars
    days.forEach((d, i) => {
        const tokens = (d.inputTokens || 0) + (d.outputTokens || 0);
        const x = PAD_L + gap * i + (gap - barW) / 2;
        const h = (tokens / maxTokens) * chartH;
        const y = PAD_T + chartH - h;
        const label = d.date.slice(5); // MM-DD
        
        html += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="#ff6b35" opacity="0.85"/>`;
        html += `<text x="${x + barW/2}" y="${y - 6}" text-anchor="middle" fill="#ccc" font-size="10" font-family="Inter,sans-serif">${Math.round(tokens/1000)}K</text>`;
        html += `<text x="${x + barW/2}" y="${H - 8}" text-anchor="middle" fill="#888" font-size="11" font-family="Inter,sans-serif">${label}</text>`;
    });
    
    svg.innerHTML = html;
}

// Login prompt
function showLoginPrompt() {
    document.getElementById('dashboardScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
}

// Handle login
function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    if (email && email.includes('@')) {
        loadDashboard(email);
    } else {
        showToast('Please enter a valid email address', 'error');
    }
}

// Handle logout
function handleLogout() {
    currentEmail = null;
    localStorage.removeItem('clawops_email');
    document.getElementById('dashboardScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
}

// Manage billing
async function manageBilling() {
    showToast('Billing portal coming soon! Contact support@hireopenclaw.com for billing inquiries.', 'info', 5000);
}

// Upgrade plan
function upgradePlan() {
    window.location.href = '/#pricing';
}

// Utility: Escape HTML
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Initialize dashboard on page load
document.addEventListener('DOMContentLoaded', () => {
    const email = getUserEmail();
    
    if (email) {
        loadDashboard(email);
        
        // Set up auto-refresh every 30 seconds
        setInterval(() => loadDashboard(email), 30000);
    } else {
        showLoginPrompt();
    }
    
    // Login form handler
    const loginBtn = document.getElementById('loginBtn');
    const loginEmail = document.getElementById('loginEmail');
    
    if (loginBtn) loginBtn.addEventListener('click', handleLogin);
    if (loginEmail) loginEmail.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
});
