// Dynamic dashboard functionality for hireopenclaw
// Fetches real data from API and renders UI

let currentEmail = null;
let currentBots = [];

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
        alert('Failed to load dashboard. Check console for errors.');
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
            <div>
                <div class="bot-name">${escapeHtml(bot.name)}</div>
                <div class="bot-role">${escapeHtml(bot.role)}</div>
            </div>
            <span class="status-dot ${statusClass}" title="${bot.status}"></span>
        </div>
        <div class="bot-stats">
            <div class="bot-stat">
                <div class="label">Messages today</div>
                <div class="value">${bot.messagesToday || 0}</div>
            </div>
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
        <div class="bot-stats" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--light-gray);">
            <div class="bot-stat" style="grid-column:1/-1;">
                <div class="label">Gateway Token ${bot.gatewayToken ? '(for first-time pairing)' : ''}</div>
                <div class="value" style="font-size:12px;font-family:monospace;display:flex;align-items:center;gap:8px;">
                    <span style="flex:1;">${tokenDisplay}</span>
                    ${bot.gatewayToken ? `<button class="btn btn-primary" style="padding:4px 12px;font-size:11px;" onclick="copyToken('${bot.gatewayToken}', '${escapeHtml(bot.name)}'); return false;">📋 Copy Token</button>` : ''}
                </div>
            </div>
        </div>
        <div class="bot-actions">
            <button class="btn btn-primary" onclick="openBot('${bot.id}', '${bot.endpoint}', '${bot.gatewayToken || ''}')">💬 Open Chat</button>
            <button class="btn btn-secondary" onclick="configureBot('${bot.id}')">Configure</button>
            ${bot.status === 'active' 
                ? `<button class="btn btn-secondary" onclick="botAction('${bot.id}', 'pause')">Pause</button>`
                : `<button class="btn btn-primary" onclick="botAction('${bot.id}', 'resume')">Resume</button>`
            }
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
function formatLastActive(isoString) {
    if (!isoString) return 'Never';
    
    const diff = Date.now() - new Date(isoString).getTime();
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
    if (action === 'pause' && !confirm('Pause this AI employee? They will stop responding until resumed.')) {
        return;
    }
    
    try {
        const res = await fetch('/api/dashboard/bot-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, action })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            alert(`Bot ${action}d successfully.`);
            await loadDashboard(currentEmail);
        } else {
            alert(`Failed to ${action} bot: ${data.error}`);
        }
    } catch (err) {
        console.error('Bot action failed:', err);
        alert('Action failed. Try again.');
    }
}

// State for modal
let pendingBotUrl = null;
let pendingBotToken = null;

// Open bot chat interface
function openBot(botId, endpoint, token) {
    if (endpoint) {
        if (token) {
            // Show modal with pairing instructions
            pendingBotUrl = endpoint;
            pendingBotToken = token;
            
            // Set token display
            document.getElementById('modalToken').textContent = token;
            
            // Set console command
            const consoleCmd = `localStorage.setItem('openclaw_gateway_token', '${token}'); location.reload();`;
            document.getElementById('consoleCommand').textContent = consoleCmd;
            
            document.getElementById('modalOverlay').classList.add('active');
            
            // Auto-copy console command to clipboard
            navigator.clipboard.writeText(consoleCmd).catch(() => {
                console.log('Clipboard copy failed');
            });
        } else {
            window.open(endpoint, '_blank');
        }
    } else {
        showAlert('Bot endpoint not available yet. Try again in a moment.');
    }
}

function proceedToBot() {
    if (pendingBotUrl && pendingBotToken) {
        // Just open the bot - user will manually pair using the token we copied
        window.open(pendingBotUrl, '_blank');
        closeModal();
    }
}

function closeModal(event) {
    // Only close if clicking overlay or close button (not modal content)
    if (!event || event.target.id === 'modalOverlay') {
        document.getElementById('modalOverlay').classList.remove('active');
        pendingBotUrl = null;
        pendingBotToken = null;
    }
}

function showAlert(message) {
    // Simple alert replacement - could be fancier
    alert(message);
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
        // Fallback: show prompt
        prompt('Copy this token manually:', token);
    });
}

// Configure bot
function configureBot(botId) {
    const bot = currentBots.find(b => b.id === botId);
    if (!bot) return;
    
    const config = prompt(
        `Configure ${bot.name}\n\n` +
        `Current settings:\n` +
        `- Name: ${bot.name}\n` +
        `- Role: ${bot.role}\n` +
        `- Template: ${bot.template}\n` +
        `- Status: ${bot.status}\n\n` +
        `Available actions:\n` +
        `1 - Rename bot\n` +
        `2 - View credentials\n` +
        `3 - Restart bot\n` +
        `4 - Cancel\n\n` +
        `Enter 1-4:`,
        '4'
    );
    
    switch (config) {
        case '1':
            const newName = prompt('New name:', bot.name);
            if (newName && newName !== bot.name) {
                alert('Rename feature coming soon! For now, you can recreate the bot with a new name.');
            }
            break;
        case '2':
            const creds = `Bot Credentials:\n\n` +
                `Endpoint: ${bot.endpoint}\n` +
                `Token: ${bot.gatewayToken || 'Not set'}\n\n` +
                `Full URL:\n${bot.endpoint}?token=${bot.gatewayToken}`;
            prompt('Copy these credentials:', creds);
            break;
        case '3':
            if (confirm(`Restart ${bot.name}?`)) {
                botAction(botId, 'restart');
            }
            break;
    }
}

// Show add bot dialog
async function showAddBot() {
    const botName = prompt('What should we call your new AI employee?', 'MyBot');
    if (!botName) return;
    
    const roles = {
        '1': { name: 'Content Creator', template: 'marketing' },
        '2': { name: 'Sales Development', template: 'sales' },
        '3': { name: 'Customer Support', template: 'support' },
        '4': { name: 'Custom (blank canvas)', template: 'blank' }
    };
    
    const choice = prompt(
        'Choose a role:\n\n' +
        '1 - 📣 Content Creator (blogs, social, newsletters)\n' +
        '2 - 💼 Sales Development (outreach, leads, CRM)\n' +
        '3 - 🎧 Customer Support (tickets, FAQ, chat)\n' +
        '4 - 🧪 Custom (blank canvas)\n\n' +
        'Enter 1-4:',
        '4'
    );
    
    const role = roles[choice];
    if (!role) {
        alert('Invalid choice. Please try again.');
        return;
    }
    
    // Generate tenant ID
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 6);
    const tenantId = `tenant-${timestamp}-${random}`;
    
    alert(`Creating ${botName} (${role.name})...\n\nThis will take ~30 seconds.`);
    
    try {
        const res = await fetch('/api/dashboard/create-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: currentEmail,
                tenantId: tenantId,
                botName: botName,
                botRole: role.name,
                template: role.template,
                plan: 'starter'
            })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            alert(`✓ ${botName} is ready!\n\nRefreshing dashboard...`);
            await loadDashboard(currentEmail);
        } else {
            alert(`Failed to create bot:\n${data.error || 'Unknown error'}`);
        }
    } catch (err) {
        console.error('Create bot failed:', err);
        alert('Failed to create bot. Check console for errors.');
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
        alert('Please enter a valid email address.');
    }
}

// Manage billing
async function manageBilling() {
    alert('Billing portal coming soon! Contact support@hireopenclaw.com for billing inquiries.');
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
