/**
 * Modal and Toast System for ClawOps Dashboard
 * Replaces ugly browser alert()/confirm()/prompt() dialogs
 */

// Helper: Get role label from template
function getRoleLabel(template) {
    const labels = {
        'marketing': 'Content Creator',
        'sales': 'Sales Development',
        'support': 'Customer Support',
        'blank': 'Assistant'
    };
    return labels[template] || 'Assistant';
}

// Toast Notifications
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icon = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ'
    }[type] || 'ℹ';
    
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Auto-remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
    return container;
}

// Modal System
let currentModalResolve = null;

function openModal(modalId) {
    const overlay = document.getElementById('modalOverlay');
    const modal = document.getElementById(modalId);
    
    if (overlay && modal) {
        overlay.style.display = 'flex';
        modal.style.display = 'block';
        
        setTimeout(() => {
            overlay.classList.add('active');
            modal.classList.add('active');
        }, 10);

        // TASK-407: Trap focus inside modal
        setTimeout(() => trapFocus(modal), 50);
    }
}

function closeModal() {
    const overlay = document.getElementById('modalOverlay');
    const modals = document.querySelectorAll('.modal');
    
    if (overlay) {
        overlay.classList.remove('active');
        modals.forEach(m => {
            m.classList.remove('active');
            releaseFocusTrap(m); // TASK-407
        });
        
        setTimeout(() => {
            overlay.style.display = 'none';
            modals.forEach(m => m.style.display = 'none');
        }, 300);
    }
    
    // Reject any pending promises
    if (currentModalResolve) {
        currentModalResolve(false);
        currentModalResolve = null;
    }
}

// Generic confirm dialog
function showConfirmDialog(message, title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        currentModalResolve = resolve;
        
        const modal = document.getElementById('genericModal');
        document.getElementById('genericModalTitle').textContent = title;
        document.getElementById('genericModalMessage').textContent = message;
        
        const actions = document.getElementById('genericModalActions');
        actions.innerHTML = `
            <button class="btn btn-secondary" onclick="confirmDialogResolve(false)">${cancelText}</button>
            <button class="btn btn-primary" onclick="confirmDialogResolve(true)">${confirmText}</button>
        `;
        
        openModal('genericModal');
    });
}

// Helper function for confirm dialog buttons
function confirmDialogResolve(value) {
    if (currentModalResolve) {
        currentModalResolve(value);
        currentModalResolve = null;
    }
    closeModal();
}

// Add bot modal
function showAddBotModal() {
    openModal('addBotModal');
    document.getElementById('newBotName').value = '';
    document.getElementById('newBotRole').value = 'blank';
}

async function confirmAddBot() {
    const name = document.getElementById('newBotName').value.trim();
    const role = document.getElementById('newBotRole').value;
    
    if (!name) {
        showToast('Please enter a bot name', 'error');
        return;
    }
    
    closeModal();
    
    try {
        const res = await fetch('/api/dashboard/create-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: currentEmail,
                botName: name,
                botRole: getRoleLabel(role),
                template: role
            })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast(`Bot "${name}" provisioning...`, 'info', 2000);
            // Refresh immediately to show "provisioning" status
            if (typeof loadDashboard === 'function') loadDashboard(currentEmail);
            // Refresh again after 5s to show "active" status
            setTimeout(() => {
                if (typeof loadDashboard === 'function') loadDashboard(currentEmail);
                // Celebrate with confetti!
                if (typeof celebrateBotCreation === 'function') {
                    celebrateBotCreation(name);
                } else {
                    showToast(`🎉 Bot "${name}" is ready!`, 'success');
                }
            }, 5000);
        } else {
            showToast(`Failed to create bot: ${data.error}`, 'error');
        }
    } catch (err) {
        console.error('Create bot failed:', err);
        showToast('Failed to create bot. Check your connection and try again.', 'error');
    }
}

// Delete confirmation
let pendingDeleteBotId = null;

function showDeleteBotModal(botId, botName) {
    pendingDeleteBotId = botId;
    const phrase = `delete ${botName}`;
    document.getElementById('deleteModalMessage').textContent = 
        `Are you sure you want to delete "${botName}"? This will permanently remove the bot and all its data.`;
    document.getElementById('deleteConfirmPhrase').textContent = phrase;
    document.getElementById('deleteConfirmInput').value = '';
    document.getElementById('deleteConfirmInput').dataset.phrase = phrase.toLowerCase();
    document.getElementById('deleteConfirmBtn').disabled = true;
    document.getElementById('deleteConfirmBtn').style.opacity = '0.5';
    openModal('deleteModal');
    setTimeout(() => document.getElementById('deleteConfirmInput').focus(), 100);
}

function checkDeleteConfirm() {
    const input = document.getElementById('deleteConfirmInput');
    const btn = document.getElementById('deleteConfirmBtn');
    const match = input.value.toLowerCase().trim() === input.dataset.phrase;
    btn.disabled = !match;
    btn.style.opacity = match ? '1' : '0.5';
}

// Rename bot
let pendingRenameBotId = null;

function showRenameBotModal(botId, currentName) {
    pendingRenameBotId = botId;
    document.getElementById('renameInput').value = currentName;
    openModal('renameModal');
    
    // Focus the input after modal opens
    setTimeout(() => {
        const input = document.getElementById('renameInput');
        if (input) {
            input.focus();
            input.select();
        }
    }, 100);
}

async function confirmDelete() {
    if (!pendingDeleteBotId) return;
    
    const botId = pendingDeleteBotId;
    pendingDeleteBotId = null;
    closeModal();
    
    try {
        const res = await fetch('/api/dashboard/bot-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: botId, action: 'terminate' })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast('Bot deleted successfully', 'success');
            setTimeout(() => {
                if (typeof loadDashboard === 'function') loadDashboard(currentEmail);
            }, 1500);
        } else {
            showToast(`Failed to delete bot: ${data.error}`, 'error');
        }
    } catch (err) {
        console.error('Delete failed:', err);
        showToast('Failed to delete bot. Check your connection and try again.', 'error');
    }
}

async function confirmRename() {
    if (!pendingRenameBotId) return;
    
    const botId = pendingRenameBotId;
    const newName = document.getElementById('renameInput').value.trim();
    
    if (!newName) {
        showToast('Please enter a name', 'error');
        return;
    }
    
    pendingRenameBotId = null;
    closeModal();
    
    try {
        const res = await fetch('/api/dashboard/rename-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: botId, newName })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast(`Bot renamed to "${newName}"`, 'success');
            setTimeout(() => {
                if (typeof loadDashboard === 'function') loadDashboard(currentEmail);
            }, 1000);
        } else {
            showToast(`Failed to rename: ${data.error}`, 'error');
        }
    } catch (err) {
        console.error('Rename failed:', err);
        showToast('Failed to rename bot. Check your connection and try again.', 'error');
    }
}

// TASK-407: Focus trap for modals
function trapFocus(modal) {
    const focusable = modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    modal._focusTrapHandler = (e) => {
        if (e.key === 'Tab') {
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }
        if (e.key === 'Escape') closeModal();
    };
    modal.addEventListener('keydown', modal._focusTrapHandler);
    first.focus();
}

function releaseFocusTrap(modal) {
    if (modal._focusTrapHandler) {
        modal.removeEventListener('keydown', modal._focusTrapHandler);
        delete modal._focusTrapHandler;
    }
}

// TASK-419: Network offline/online detection
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => showToast('Back online', 'success'));
    window.addEventListener('offline', () => showToast("You're offline. Changes won't be saved.", 'error', 10000));
}

// Close modal on overlay click
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) {
        overlay.addEventListener('click', closeModal);
    }
});
