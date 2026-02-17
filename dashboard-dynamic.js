// Dynamic dashboard functionality for hireopenclaw
// Fetches real data from API and renders UI

let currentEmail = null;
let currentBots = [];
let currentMaxBots = 3; // Updated from API

// ── Global Error Boundary ────────────────────────────────────────────────────
// Catch unhandled errors and show user-friendly toast instead of breaking the page

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    const message = e.reason?.message || e.reason || 'Something went wrong';
    showToast(`Error: ${message}`, 'error', 5000);
    e.preventDefault(); // Prevent default error logging
});

window.addEventListener('error', (e) => {
    console.error('Unhandled error:', e.error);
    const message = e.error?.message || e.message || 'Something went wrong';
    showToast(`Error: ${message}`, 'error', 5000);
    e.preventDefault(); // Prevent default error logging
});

function formatModelName(model) {
  if (!model) return 'Claude Sonnet';
  // Strip provider prefix (hireopenclaw/, anthropic/, openrouter/ etc)
  const name = model.replace(/^[^/]+\//, '');
  const map = {
    'claude-sonnet-4-5': 'Claude Sonnet 4.5',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
    'claude-opus-4-6': 'Claude Opus 4.6',
    'claude-sonnet-4-0': 'Claude Sonnet 4',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
  };
  return map[name] || name;
}

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

// Check session validity
async function checkSession() {
    const sessionToken = localStorage.getItem('clawops_session_token');
    
    if (!sessionToken) {
        return null;
    }
    
    try {
        const res = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken })
        });
        
        const data = await res.json();
        
        if (data.valid) {
            return data.email;
        } else {
            // Invalid session, clear it
            localStorage.removeItem('clawops_session_token');
            localStorage.removeItem('clawops_email');
            localStorage.removeItem('clawops_session_expires');
            return null;
        }
    } catch (err) {
        console.error('Session check failed:', err);
        return null;
    }
}

// Get email from session, URL parameter, or localStorage
async function getUserEmail() {
    // Check hash fragment first (from magic link redirect)
    const hash = window.location.hash;
    if (hash.includes('session=')) {
        const hashParams = new URLSearchParams(hash.substring(1));
        const sessionToken = hashParams.get('session');
        const email = hashParams.get('email');
        if (sessionToken && email) {
            localStorage.setItem('clawops_session_token', sessionToken);
            localStorage.setItem('clawops_email', email);
            // Clean up URL
            history.replaceState(null, '', '/dashboard');
            return email;
        }
    }

    // Check existing session in localStorage
    const sessionEmail = await checkSession();
    if (sessionEmail) {
        return sessionEmail;
    }
    
    return null;
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
        // Session cookie sent automatically — server infers email from session
        const res = await fetch(`/api/dashboard/bots`);
        const data = await res.json();
        
        if (data.bots) {
            currentBots = data.bots;
            currentMaxBots = data.maxBots || 3; // Store for quota check
            
            // Update header user info
            document.querySelector('.user-info .email').textContent = email;
            // Update plan badge and billing card from plans data
            const planBadge = document.getElementById('plan-badge') || document.querySelector('.user-info .plan-badge');
            if (planBadge) planBadge.textContent = (data.plan || 'starter').toUpperCase();
            updateBillingCard(data.plan, data.billing);
            
            // Update stats
            updateStats(data);
            
            // Render bots grid
            renderBots(data.bots, data.maxBots);
            
            // Load usage chart
            loadUsageChart(email);
            
            // Load cost data for all bots
            setTimeout(() => updateBotCosts(), 500);
            
            // Show dashboard, hide login
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('dashboardScreen').style.display = 'block';
        }
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        showToast('Failed to load dashboard. Check your connection and refresh the page.', 'error');
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
    const tokenK = data.totalTokensUsed >= 1000 ? Math.round(data.totalTokensUsed / 1000) : data.totalTokensUsed;
    const limitM = (data.totalTokensLimit / 1000000).toFixed(1);
    const tokenPct = data.totalTokensLimit > 0 
        ? Math.round((data.totalTokensUsed / data.totalTokensLimit) * 100) 
        : 0;
    
    document.querySelector('.stat-card:nth-child(2) .label').textContent = 'Tokens Used';
    document.querySelector('.stat-card:nth-child(2) .value').textContent = data.totalTokensUsed >= 1000 ? `${tokenK}K` : `${tokenK}`;
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

// Show onboarding banner for first-time users
function showOnboardingBanner(grid) {
    // Check if onboarding was already completed
    if (localStorage.getItem('onboarding_completed')) {
        return;
    }
    
    // Check if banner already exists
    if (document.getElementById('onboarding-banner')) {
        return;
    }
    
    // Create banner element
    const banner = document.createElement('div');
    banner.id = 'onboarding-banner';
    banner.style.cssText = `
        background: rgba(124,58,237,0.1);
        border: 1px solid rgba(124,58,237,0.3);
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 24px;
        animation: slideDown 0.4s ease-out;
        grid-column: 1 / -1;
    `;
    
    banner.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 16px;">
            <div style="font-size: 32px; line-height: 1;">👋</div>
            <div style="flex: 1;">
                <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 12px; color: var(--white);">
                    Welcome to HireOpenClaw!
                </h3>
                <p style="font-size: 14px; color: var(--gray); margin-bottom: 16px; line-height: 1.6;">
                    Here's how to get started:
                </p>
                <div style="font-size: 14px; color: var(--white); line-height: 1.8; margin-bottom: 20px;">
                    <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                        <span>1️⃣</span>
                        <span>Create your first AI employee with the "Add" card below</span>
                    </div>
                    <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                        <span>2️⃣</span>
                        <span>Open web chat to talk with your bot</span>
                    </div>
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <span>3️⃣</span>
                        <span>Connect Telegram, Discord, or WhatsApp for external chat</span>
                    </div>
                </div>
                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="createFirstBot()" style="font-size: 14px;">
                        Create My First Bot
                    </button>
                    <button class="btn btn-secondary" onclick="dismissOnboarding()" style="font-size: 14px;">
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Add animation keyframes if not already present
    if (!document.getElementById('onboarding-animation')) {
        const style = document.createElement('style');
        style.id = 'onboarding-animation';
        style.textContent = `
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Insert banner as first child of grid
    grid.insertBefore(banner, grid.firstChild);
}

// Handler for "Create My First Bot" button
function createFirstBot() {
    // Dismiss banner
    dismissOnboarding();
    // Show add bot modal
    showAddBot();
}

// Handler for "Dismiss" button
function dismissOnboarding() {
    const banner = document.getElementById('onboarding-banner');
    if (banner) {
        // Fade out animation
        banner.style.animation = 'slideUp 0.3s ease-out';
        banner.style.animationFillMode = 'forwards';
        
        // Add slideUp animation if not present
        if (!document.getElementById('onboarding-animation-out')) {
            const style = document.createElement('style');
            style.id = 'onboarding-animation-out';
            style.textContent = `
                @keyframes slideUp {
                    from {
                        opacity: 1;
                        transform: translateY(0);
                    }
                    to {
                        opacity: 0;
                        transform: translateY(-20px);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Remove after animation
        setTimeout(() => {
            banner.remove();
        }, 300);
    }
    
    // Mark onboarding as completed
    localStorage.setItem('onboarding_completed', 'true');
}

// Render bots grid
function renderBots(bots, maxBots) {
    currentBots = bots; // Store for filtering
    
    // If search/filter is active, use filtered render
    if (typeof filterAndRenderBots === 'function' && (searchQuery || statusFilter !== 'all')) {
        filterAndRenderBots();
        return;
    }
    
    const grid = document.querySelector('.bots-grid');
    grid.innerHTML = ''; // Clear existing
    
    // Show onboarding banner if first-time user
    showOnboardingBanner(grid);
    
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
    card.id = `bot-${bot.id}`;
    if (bot.status === 'terminated') {
        card.style.opacity = '0.6';
        card.style.border = '2px dashed var(--red)';
    }
    
    const statusClass = bot.status === 'active' ? 'active' : 
                       bot.status === 'paused' ? 'paused' :
                       bot.status === 'terminated' ? 'error' : 'error';
    
    const healthColor = bot.health === 'healthy' ? 'var(--green)' :
                       bot.health === 'unhealthy' ? 'var(--red)' : 'var(--yellow)';
    
    const lastActiveText = formatLastActive(bot.lastActive);
    
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
            <span id="badge-${bot.id}" style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:12px;text-transform:uppercase;letter-spacing:0.5px;
                ${bot.status === 'active' ? 'background:rgba(0,200,83,0.15);color:#00c853;' : 
                  bot.status === 'paused' ? 'background:rgba(255,193,7,0.15);color:#ffc107;' :
                  'background:rgba(255,82,82,0.15);color:#ff5252;'}">${bot.status === 'active' ? 'Active' : bot.status === 'paused' ? 'Paused' : bot.status === 'terminated' ? 'Deleted' : bot.status}</span>
        </div>
        

        <div class="bot-stats">
            <div class="bot-stat">
                <div class="label">Tokens</div>
                <div class="value">${bot.tokensUsed >= 1000 ? Math.round(bot.tokensUsed / 1000) + 'K' : bot.tokensUsed}</div>
            </div>
            <div class="bot-stat">
                <div class="label">Memory</div>
                <div class="value" id="memory-${bot.id}">--</div>
            </div>
            <div class="bot-stat">
                <div class="label">Uptime</div>
                <div class="value" id="uptime-${bot.id}">--</div>
            </div>
            <div class="bot-stat">
                <div class="label">Last active</div>
                <div class="value">${lastActiveText}</div>
            </div>
            <div class="bot-stat">
                <div class="label">Model</div>
                <div class="value" id="model-${bot.id}">${formatModelName(bot.model)}</div>
            </div>
            <div class="bot-stat">
                <div class="label">Health</div>
                <div class="value" style="color:${healthColor};">${bot.health}</div>
            </div>
        </div>
        
        <div class="bot-cost" id="cost-${bot.id}" style="margin-top:16px;padding:12px;background:rgba(0,180,216,0.1);border-radius:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="font-size:11px;color:var(--gray);">💰 Usage Cost</div>
                <div style="font-size:14px;font-weight:600;color:var(--primary);" id="cost-value-${bot.id}">Loading...</div>
            </div>
            <div style="display:flex;gap:12px;font-size:11px;margin-bottom:8px;">
                <div style="flex:1;">
                    <div style="color:var(--gray);">Today</div>
                    <div style="color:var(--white);font-weight:500;" id="cost-today-${bot.id}">--</div>
                </div>
                <div style="flex:1;">
                    <div style="color:var(--gray);">This month</div>
                    <div style="color:var(--white);font-weight:500;" id="cost-month-${bot.id}">--</div>
                </div>
            </div>
            <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:6px;overflow:hidden;">
                <div class="budget-bar" id="budget-bar-${bot.id}" style="height:100%;background:var(--green);transition:width 0.3s ease,background 0.3s ease;width:0%;"></div>
            </div>
            <div style="font-size:10px;color:var(--gray);margin-top:4px;" id="budget-text-${bot.id}">0% of budget used</div>
        </div>
        
        <!-- Gateway token hidden — managed server-side for security -->
        
        <div class="bot-actions">
            ${bot.status === 'terminated' 
                ? `<div style="padding:12px;background:rgba(255,0,0,0.1);border-radius:8px;text-align:center;">
                    <div style="color:var(--red);font-weight:600;">🗑 Deleted ${bot.terminatedAt ? 'on ' + new Date(bot.terminatedAt).toLocaleDateString() : ''}</div>
                    <div style="font-size:11px;color:var(--gray);margin-top:4px;">Historical stats preserved</div>
                   </div>`
                : `<div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-sm btn-primary" aria-label="Open chat with ${escapeHtml(bot.name)}" onclick="openBot('${bot.id}', '${bot.endpoint}')">💬 Web Chat</button>
                    <button class="btn btn-sm btn-secondary" aria-label="Connect channels" onclick="toggleChannels('${bot.id}')" id="channel-toggle-${bot.id}">📡 Channels</button>
                    ${bot.status === 'active' 
                        ? `<button class="btn btn-sm btn-secondary" aria-label="Pause ${escapeHtml(bot.name)}" onclick="botAction('${bot.id}', 'pause')">⏸ Pause</button>
                           <button class="btn btn-sm btn-secondary" aria-label="Restart ${escapeHtml(bot.name)}" onclick="botAction('${bot.id}', 'restart')">🔄 Restart</button>`
                        : `<button class="btn btn-sm btn-primary" aria-label="Resume ${escapeHtml(bot.name)}" onclick="botAction('${bot.id}', 'resume')">▶ Resume</button>`
                    }
                    <button class="btn btn-sm btn-danger" aria-label="Delete ${escapeHtml(bot.name)}" onclick="showDeleteModal('${bot.id}', '${escapeHtml(bot.name)}')">🗑 Delete</button>
                   </div>
                   <div class="channel-panel" id="channels-${bot.id}" style="display:none;margin-top:12px;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;">
                    <div style="font-size:12px;font-weight:600;color:var(--white);margin-bottom:8px;">Connect Channels</div>
                    <div class="channel-list" id="channel-list-${bot.id}">
                      <div style="color:var(--gray);font-size:12px;">Loading channels...</div>
                    </div>
                   </div>`
            }
        </div>
    `;
    
    // Fetch container stats asynchronously and update
    fetchContainerStats(bot.id);
    
    return card;
}

// Fetch and update container stats
async function fetchContainerStats(botId) {
    try {
        const res = await fetch(`/api/dashboard/container-stats?tenantId=${encodeURIComponent(botId)}`);
        if (!res.ok) return;
        
        const data = await res.json();
        if (data.ok && data.stats && data.metadata) {
            // Update memory
            const memEl = document.getElementById(`memory-${botId}`);
            if (memEl) {
                memEl.textContent = `${Math.round(data.stats.memoryValue)}${data.stats.memoryUnit}`;
            }
            
            // Update uptime
            const uptimeEl = document.getElementById(`uptime-${botId}`);
            if (uptimeEl) {
                uptimeEl.textContent = data.metadata.uptimeFormatted;
            }
        }
    } catch (err) {
        // Silently fail - stats are nice to have but not critical
        console.warn('Failed to fetch container stats:', err);
    }
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

// Track in-progress actions to prevent double-tap
const pendingActions = new Set();

// Bot actions
async function botAction(tenantId, action) {
    // Prevent double-tap
    const actionKey = `${tenantId}-${action}`;
    if (pendingActions.has(actionKey)) return;

    // Confirm pause action
    if (action === 'pause') {
        const confirmed = await showConfirm(
            'Pause this AI employee? They will stop responding until resumed.',
            'Confirm Pause'
        );
        if (!confirmed) return;
    }
    
    // Lock buttons and show transitional state with loading spinner
    pendingActions.add(actionKey);
    const card = document.getElementById(`bot-${tenantId}`);
    const buttons = card ? card.querySelectorAll('.bot-actions button') : [];
    // Find the clicked button via matching action text
    const actionTextMap = { pause: 'Pausing…', resume: 'Resuming…', restart: 'Restarting…' };
    let clickedBtn = null;
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        const btnText = btn.textContent.trim();
        if (btnText.includes('Pause') || btnText.includes('Resume') || btnText.includes('Restart')) {
            if ((action === 'pause' && btnText.includes('Pause')) ||
                (action === 'resume' && btnText.includes('Resume')) ||
                (action === 'restart' && btnText.includes('Restart'))) {
                clickedBtn = btn;
                btn.classList.add('loading');
                btn.dataset.origHtml = btn.innerHTML;
                btn.innerHTML = `<span class="btn-spinner"></span> ${actionTextMap[action]}`;
            }
        }
    });
    
    // Update badge to show action in progress
    const actionLabels = { restart: 'Restarting…', pause: 'Pausing…', resume: 'Resuming…' };
    const badge = document.getElementById(`badge-${tenantId}`);
    if (badge) {
        badge.textContent = actionLabels[action] || `${action}…`;
        badge.style.background = 'rgba(255,193,7,0.15)';
        badge.style.color = '#ffc107';
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
            // Re-enable buttons on error
            buttons.forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
                if (btn.classList.contains('loading')) {
                    btn.classList.remove('loading');
                    if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
                }
            });
        }
    } catch (err) {
        console.error('Bot action failed:', err);
        showToast('Could not complete that action. Check your connection and try again.', 'error');
        // Re-enable buttons on error
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            if (btn.classList.contains('loading')) {
                btn.classList.remove('loading');
                if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
            }
        });
    } finally {
        pendingActions.delete(actionKey);
    }
}

// Open bot chat interface
function openBot(botId, endpoint, token) {
    if (!endpoint) {
        showToast('Bot endpoint not available yet. Try again in a moment.', 'warning');
        return;
    }

    // Find bot name for the chat header
    const bot = currentBots?.find(b => b.id === botId);
    const botName = bot?.name || 'AI Employee';

    // Open secure chat page — tokens stay server-side
    const chatUrl = `/chat?botId=${encodeURIComponent(botId)}&name=${encodeURIComponent(botName)}`;
    window.open(chatUrl, '_blank');
    showTemporaryMessage('🚀 Opening chat...', 'info', 2000);
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

// Rename bot (uses modal from modal.js)
function renameBot(botId, currentName) {
    showRenameBotModal(botId, currentName);
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

// Fetch and update cost data for all bots
async function updateBotCosts() {
    if (!currentBots || currentBots.length === 0) return;
    
    for (const bot of currentBots) {
        await updateBotCost(bot.id);
    }
}

// Fetch and update cost data for a single bot
async function updateBotCost(botId) {
    try {
        const res = await fetch(`/api/dashboard/usage/${botId}`);
        const data = await res.json();
        
        if (data.error) {
            console.error(`Failed to get usage for ${botId}:`, data.error);
            return;
        }
        
        // Update cost display
        const costValue = document.getElementById(`cost-value-${botId}`);
        const costToday = document.getElementById(`cost-today-${botId}`);
        const costMonth = document.getElementById(`cost-month-${botId}`);
        const budgetBar = document.getElementById(`budget-bar-${botId}`);
        const budgetText = document.getElementById(`budget-text-${botId}`);
        
        if (!costValue) return; // Bot card not rendered yet
        
        const totalCost = data.usage.totalCost || 0;
        const todayCost = data.usage.todayCost || 0;
        const utilization = data.budget.utilization || 0;
        const alertLevel = data.budget.alertLevel || 'ok';
        
        costValue.textContent = `$${totalCost.toFixed(2)}`;
        costToday.textContent = `$${todayCost.toFixed(2)}`;
        costMonth.textContent = `$${totalCost.toFixed(2)}`;
        
        // Update budget bar
        budgetBar.style.width = `${Math.min(100, utilization)}%`;
        
        // Color based on alert level
        if (alertLevel === 'critical') {
            budgetBar.style.background = 'var(--red)';
        } else if (alertLevel === 'danger') {
            budgetBar.style.background = '#ff8c00'; // Orange
        } else if (alertLevel === 'warning') {
            budgetBar.style.background = 'var(--yellow)';
        } else {
            budgetBar.style.background = 'var(--green)';
        }
        
        budgetText.textContent = `${utilization.toFixed(1)}% of $${data.budget.limit.toFixed(2)} budget used`;
        
        // Add alert indicator if needed
        if (alertLevel === 'warning' || alertLevel === 'danger' || alertLevel === 'critical') {
            const costSection = document.getElementById(`cost-${botId}`);
            if (costSection && !costSection.querySelector('.alert-badge')) {
                const alertBadge = document.createElement('div');
                alertBadge.className = 'alert-badge';
                alertBadge.style.cssText = 'position:absolute;top:8px;right:8px;background:var(--red);color:white;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;';
                alertBadge.textContent = alertLevel === 'critical' ? '🚨 OVER BUDGET' : 
                                        alertLevel === 'danger' ? '⚠️ 90%+' : 
                                        '⚠️ 80%+';
                costSection.style.position = 'relative';
                costSection.appendChild(alertBadge);
            }
        }
        
    } catch (err) {
        console.error(`Error updating cost for ${botId}:`, err);
    }
}

// Login prompt
function showLoginPrompt() {
    document.getElementById('dashboardScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
}

// Handle login — sends magic link, does NOT auto-login
async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    if (!email || !email.includes('@')) {
        showToast('Please enter a valid email address', 'error');
        return;
    }

    const btn = document.querySelector('#loginScreen .btn-primary');
    const origText = btn.textContent;
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<span class="btn-spinner"></span> Sending…';
    btn.disabled = true;
    btn.classList.add('loading');
    btn.style.cursor = 'not-allowed';

    try {
        const response = await fetch('/api/auth/magic-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await response.json();

        if (data.ok) {
            // Show "check your email" message
            const loginBox = document.querySelector('.login-box');
            const sentMsg = document.createElement('div');
            sentMsg.style.cssText = 'margin-top:20px;padding:16px;background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.3);border-radius:8px;text-align:center;';
            sentMsg.innerHTML = `<p style="color:#ff6b35;font-weight:600;margin-bottom:8px;">✓ Magic link sent!</p>
                <p style="color:#aaa;font-size:13px;">Check your email for <strong>${email}</strong></p>`;
            
            // In dev mode, show clickable link
            if (data.magicLink) {
                sentMsg.innerHTML += `<p style="margin-top:12px;"><a href="${data.magicLink}" style="color:#ff6b35;font-size:13px;">🔗 Click here to log in (dev mode)</a></p>`;
            }
            
            // Remove any previous sent message
            const prev = loginBox.querySelector('.magic-link-sent');
            if (prev) prev.remove();
            sentMsg.className = 'magic-link-sent';
            loginBox.appendChild(sentMsg);
        } else {
            showToast(data.error || 'Failed to send magic link', 'error');
        }
    } catch (err) {
        showToast('Network error. Please try again.', 'error');
    } finally {
        btn.innerHTML = origHtml;
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.style.cursor = 'pointer';
    }
}

// Handle logout
async function handleLogout() {
    const sessionToken = localStorage.getItem('clawops_session_token');
    
    // Show loading state on logout button
    const logoutBtn = event?.target;
    if (logoutBtn) {
        const origHtml = logoutBtn.innerHTML;
        logoutBtn.innerHTML = '<span class="btn-spinner"></span> Logging out…';
        logoutBtn.disabled = true;
        logoutBtn.classList.add('loading');
        logoutBtn.style.cursor = 'not-allowed';
    }
    
    if (sessionToken) {
        try {
            await fetch('/api/auth/session', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionToken })
            });
        } catch (err) {
            console.error('Logout API call failed:', err);
        }
    }
    
    currentEmail = null;
    localStorage.removeItem('clawops_session_token');
    localStorage.removeItem('clawops_email');
    localStorage.removeItem('clawops_session_expires');
    
    showToast('Logged out successfully', 'success');
    
    setTimeout(() => {
        document.getElementById('dashboardScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'flex';
    }, 500);
}

// Manage billing
async function manageBilling() {
    showToast('Billing portal coming soon! Contact support@hireopenclaw.com for billing inquiries.', 'info', 5000);
}

// Upgrade plan
// Plan display names and pricing (client-side mirror of plans.json)
const PLAN_DISPLAY = {
    free: { name: 'Free Plan', price: '$0/mo' },
    starter: { name: 'Starter Plan', price: '$29/mo' },
    pro: { name: 'Pro Plan', price: '$99/mo' },
    business: { name: 'Business Plan', price: '$299/mo' },
    enterprise: { name: 'Enterprise', price: 'Custom' }
};

function updateBillingCard(planId, billing) {
    const plan = PLAN_DISPLAY[planId] || PLAN_DISPLAY.starter;
    const nameEl = document.getElementById('billing-plan-name');
    const dateEl = document.getElementById('billing-next-date');
    if (nameEl) nameEl.textContent = `${plan.name} - ${plan.price}`;
    if (dateEl) {
        if (billing && billing.nextBillingDate) {
            dateEl.textContent = `Next billing date: ${new Date(billing.nextBillingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
        } else if (planId === 'free') {
            dateEl.textContent = 'Free tier — no billing';
        } else {
            dateEl.textContent = 'Billing not configured';
        }
    }
}

function upgradePlan() {
    window.location.href = '/#pricing';
}

// Utility: Escape HTML
// ── Channel Connection Panel ────────────────────────────────────────────────

const CHANNEL_DEFS = [
    { id: 'telegram', name: 'Telegram', icon: '📱', tokenKey: 'TELEGRAM_BOT_TOKEN', guide: [
        '1. Open <a href="https://t.me/BotFather" target="_blank">@BotFather</a> on Telegram',
        '2. Send /newbot and follow the prompts',
        '3. Copy the bot token and paste it below'
    ]},
    { id: 'whatsapp', name: 'WhatsApp', icon: '💬', tokenKey: 'WHATSAPP_TOKEN', guide: [
        '1. Go to <a href="https://developers.facebook.com" target="_blank">Meta for Developers</a>',
        '2. Create a WhatsApp Business app',
        '3. Copy the permanent token and paste below'
    ]},
    { id: 'discord', name: 'Discord', icon: '🎮', tokenKey: 'DISCORD_BOT_TOKEN', guide: [
        '1. Go to <a href="https://discord.com/developers" target="_blank">Discord Developer Portal</a>',
        '2. Create an application → Bot → Reset Token',
        '3. Copy the bot token and paste below'
    ]},
    { id: 'signal', name: 'Signal', icon: '📡', tokenKey: 'SIGNAL_NUMBER', guide: [
        '1. Set up signal-cli or signal-rest-api',
        '2. Register a phone number',
        '3. Enter the Signal number below'
    ]}
];

function toggleChannels(botId) {
    const panel = document.getElementById(`channels-${botId}`);
    if (!panel) return;
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) loadChannelStatus(botId);
}

async function loadChannelStatus(botId) {
    const list = document.getElementById(`channel-list-${botId}`);
    if (!list) return;

    // Fetch instance secrets to see which tokens are configured
    let secrets = [];
    try {
        const res = await fetch(`/api/dashboard/bots/${encodeURIComponent(botId)}/secrets`);
        if (res.ok) {
            const data = await res.json();
            secrets = data.secrets || [];
        }
    } catch {}

    const configuredKeys = new Set(secrets.map(s => s.key));

    list.innerHTML = CHANNEL_DEFS.map(ch => {
        const connected = configuredKeys.has(ch.tokenKey);
        return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:16px;">${ch.icon}</span>
                    <span style="font-size:13px;color:var(--white);">${ch.name}</span>
                    ${connected ? '<span style="font-size:10px;color:#00c853;margin-left:4px;">● Connected</span>' : ''}
                </div>
                <div>
                    ${connected 
                        ? `<button class="btn btn-sm btn-danger" style="font-size:11px;padding:2px 8px;" onclick="disconnectChannel('${botId}','${ch.tokenKey}','${ch.name}')">Disconnect</button>`
                        : `<button class="btn btn-sm btn-primary" style="font-size:11px;padding:2px 8px;" onclick="showChannelSetup('${botId}','${ch.id}')">Connect</button>`
                    }
                </div>
            </div>
        `;
    }).join('') + `
        <div style="padding:8px 0;display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:16px;">🌐</span>
                <span style="font-size:13px;color:var(--white);">Web Chat</span>
                <span style="font-size:10px;color:#00c853;margin-left:4px;">● Always On</span>
            </div>
        </div>
    `;
}

function showChannelSetup(botId, channelId) {
    const ch = CHANNEL_DEFS.find(c => c.id === channelId);
    if (!ch) return;
    const list = document.getElementById(`channel-list-${botId}`);
    if (!list) return;

    list.innerHTML = `
        <div style="padding:8px 0;">
            <div style="font-size:13px;font-weight:600;color:var(--white);margin-bottom:8px;">${ch.icon} Connect ${ch.name}</div>
            <div style="font-size:12px;color:var(--gray);line-height:1.8;margin-bottom:12px;">
                ${ch.guide.map(s => `<div>${s}</div>`).join('')}
            </div>
            <div style="display:flex;gap:8px;">
                <input type="text" id="channel-token-${botId}" placeholder="Paste your ${ch.name} token here" 
                    style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--white);font-size:13px;font-family:monospace;" />
                <button class="btn btn-sm btn-primary" onclick="saveChannelToken('${botId}','${ch.tokenKey}','${ch.name}')">Save</button>
            </div>
            <div id="channel-status-${botId}" style="margin-top:8px;font-size:12px;display:none;"></div>
            <button class="btn btn-sm btn-secondary" style="margin-top:8px;font-size:11px;" onclick="loadChannelStatus('${botId}')">← Back</button>
        </div>
    `;
}

async function saveChannelToken(botId, tokenKey, channelName) {
    const input = document.getElementById(`channel-token-${botId}`);
    const status = document.getElementById(`channel-status-${botId}`);
    if (!input || !input.value.trim()) {
        if (status) {
            status.style.display = 'block';
            status.style.color = 'var(--red)';
            status.textContent = 'Please enter a token';
        }
        return;
    }

    const token = input.value.trim();
    
    // Find and disable the Save button, add loading state
    const saveBtn = event?.target;
    if (saveBtn) {
        saveBtn.dataset.origHtml = saveBtn.innerHTML;
        saveBtn.innerHTML = '<span class="btn-spinner"></span> Saving…';
        saveBtn.disabled = true;
        saveBtn.classList.add('loading');
        saveBtn.style.cursor = 'not-allowed';
    }
    
    if (status) {
        status.style.display = 'block';
        status.style.color = 'var(--gray)';
        status.textContent = `Saving ${channelName} token...`;
    }

    try {
        const res = await fetch(`/api/dashboard/bots/${encodeURIComponent(botId)}/secrets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: tokenKey, value: token, label: `${channelName} Bot Token` })
        });
        const data = await res.json();

        if (res.ok) {
            if (status) {
                status.style.color = '#00c853';
                status.textContent = `✅ ${channelName} connected! Restarting bot...`;
            }
            // Restart bot to pick up new channel config
            try {
                await fetch(`/api/dashboard/bot-action?tenantId=${encodeURIComponent(botId)}&action=restart`, { method: 'POST' });
                setTimeout(() => {
                    if (status) status.textContent = `✅ ${channelName} connected and bot restarted!`;
                    setTimeout(() => loadChannelStatus(botId), 2000);
                }, 3000);
            } catch {
                if (status) status.textContent = `✅ Token saved. Restart bot manually to activate.`;
            }
        } else {
            if (status) {
                status.style.color = 'var(--red)';
                status.textContent = `Error: ${data.error || 'Failed to save'}`;
            }
            // Re-enable button on error
            if (saveBtn && saveBtn.dataset.origHtml) {
                saveBtn.innerHTML = saveBtn.dataset.origHtml;
                saveBtn.disabled = false;
                saveBtn.classList.remove('loading');
                saveBtn.style.cursor = 'pointer';
            }
        }
    } catch (err) {
        if (status) {
            status.style.color = 'var(--red)';
            status.textContent = `Error: ${err.message}`;
        }
        // Re-enable button on error
        if (saveBtn && saveBtn.dataset.origHtml) {
            saveBtn.innerHTML = saveBtn.dataset.origHtml;
            saveBtn.disabled = false;
            saveBtn.classList.remove('loading');
            saveBtn.style.cursor = 'pointer';
        }
    }
}

async function disconnectChannel(botId, tokenKey, channelName) {
    const list = document.getElementById(`channel-list-${botId}`);
    if (!list) return;

    // Inline confirmation
    const existing = list.querySelector('.inline-confirm');
    if (existing) existing.remove();

    const confirm = document.createElement('div');
    confirm.className = 'inline-confirm';
    confirm.style.cssText = 'padding:8px;background:rgba(255,82,82,0.1);border:1px solid rgba(255,82,82,0.3);border-radius:6px;margin-top:8px;display:flex;align-items:center;gap:8px;';
    confirm.innerHTML = `
        <span style="font-size:12px;color:var(--red);">Disconnect ${channelName}?</span>
        <button class="btn btn-sm btn-danger" style="font-size:11px;padding:2px 8px;" onclick="confirmDisconnect('${botId}','${tokenKey}')">Yes</button>
        <button class="btn btn-sm btn-secondary" style="font-size:11px;padding:2px 8px;" onclick="this.parentElement.remove()">No</button>
    `;
    list.appendChild(confirm);
}

async function confirmDisconnect(botId, tokenKey) {
    try {
        await fetch(`/api/dashboard/bots/${encodeURIComponent(botId)}/secrets`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: tokenKey })
        });
        // Restart to remove channel
        await fetch(`/api/dashboard/bot-action?tenantId=${encodeURIComponent(botId)}&action=restart`, { method: 'POST' });
        showTemporaryMessage('Channel disconnected. Bot restarting...', 'info', 3000);
        setTimeout(() => loadChannelStatus(botId), 3000);
    } catch (err) {
        showTemporaryMessage('Error: ' + err.message, 'error', 3000);
    }
}

// ── Utilities ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Initialize dashboard on page load
document.addEventListener('DOMContentLoaded', async () => {
    const email = await getUserEmail();
    
    // Hide loading screen
    const loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) loadingScreen.remove();

    if (email) {
        loadDashboard(email);

        // Set up auto-refresh every 30 seconds
        setInterval(() => loadDashboard(email), 30000);
        
        // Update costs more frequently (every 60 seconds)
        setInterval(() => updateBotCosts(), 60000);
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
