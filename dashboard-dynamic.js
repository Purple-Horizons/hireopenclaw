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
            document.querySelector('.login-screen').style.display = 'none';
            document.querySelector('.dashboard').style.display = 'block';
        }
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        alert('Failed to load dashboard. Check console for errors.');
    }
}

// Update stats cards
function updateStats(data) {
    const activeBots = data.bots.filter(b => b.status === 'active').length;
    
    // Active bots stat
    document.querySelector('.stat-card:nth-child(1) .value').textContent = activeBots;
    document.querySelector('.stat-card:nth-child(1) .sub').textContent = `of ${data.maxBots} available`;
    
    // Token usage stat
    const tokenK = Math.round(data.totalTokensUsed / 1000);
    const limitM = (data.totalTokensLimit / 1000000).toFixed(1);
    const tokenPct = data.totalTokensLimit > 0 
        ? Math.round((data.totalTokensUsed / data.totalTokensLimit) * 100) 
        : 0;
    
    document.querySelector('.stat-card:nth-child(2) .value').textContent = `${tokenK}K`;
    document.querySelector('.stat-card:nth-child(2) .sub').textContent = `of ${limitM}M this month`;
    
    // Usage bar
    const bar = document.querySelector('.usage-bar');
    bar.style.width = `${tokenPct}%`;
    bar.className = `usage-bar ${tokenPct > 90 ? 'red' : tokenPct > 70 ? 'yellow' : 'green'}`;
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
        <div class="bot-actions">
            <button class="btn btn-primary" onclick="openBot('${bot.id}', '${bot.endpoint}')">Chat</button>
            <button class="btn btn-secondary" onclick="configurBot('${bot.id}')">Configure</button>
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

// Open bot chat interface
function openBot(botId, endpoint) {
    if (endpoint) {
        window.open(endpoint, '_blank');
    } else {
        alert('Bot endpoint not available yet. Try again in a moment.');
    }
}

// Configure bot
function configureBot(botId) {
    alert('Bot configuration coming soon!');
    // TODO: Open configuration modal
}

// Show add bot dialog
function showAddBot() {
    const roles = [
        '📣 Content Creator (blogs, social, newsletters)',
        '💼 Sales Development (outreach, leads, CRM)',
        '📱 Social Media Manager (scheduling, engagement)',
        '📅 Executive Assistant (email, calendar, tasks)',
        '🎧 Customer Support (tickets, FAQ, chat)',
        '🧪 Custom (blank canvas)'
    ];
    
    alert('Choose a role for your new AI employee:\n\n' + 
          roles.join('\n') + 
          '\n\nContact us to add a new employee to your plan!');
    
    // TODO: Redirect to onboarding or upgrade flow
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
    document.querySelector('.dashboard').style.display = 'none';
    document.querySelector('.login-screen').style.display = 'flex';
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
