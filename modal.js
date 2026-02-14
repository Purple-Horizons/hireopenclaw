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
        overlay.style.display = 'block';
        modal.style.display = 'block';
        
        // Trigger animation
        setTimeout(() => {
            overlay.classList.add('active');
            modal.classList.add('active');
        }, 10);
    }
}

function closeModal() {
    const overlay = document.getElementById('modalOverlay');
    const modals = document.querySelectorAll('.modal');
    
    if (overlay) {
        overlay.classList.remove('active');
        modals.forEach(m => m.classList.remove('active'));
        
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
            <button class="btn btn-secondary" onclick="closeModal(); currentModalResolve?.(false);">${cancelText}</button>
            <button class="btn btn-primary" onclick="closeModal(); currentModalResolve?.(true);">${confirmText}</button>
        `;
        
        openModal('genericModal');
    });
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
            showToast(`Bot "${name}" created successfully!`, 'success');
            setTimeout(() => {
                if (typeof loadDashboard === 'function') loadDashboard(currentEmail);
            }, 1500);
        } else {
            showToast(`Failed to create bot: ${data.error}`, 'error');
        }
    } catch (err) {
        console.error('Create bot failed:', err);
        showToast('Failed to create bot. Try again.', 'error');
    }
}

// Delete confirmation
let pendingDeleteBotId = null;

function showDeleteBotModal(botId, botName) {
    pendingDeleteBotId = botId;
    document.getElementById('deleteModalMessage').textContent = 
        `Are you sure you want to delete "${botName}"? This will permanently remove the bot and all its data.`;
    openModal('deleteModal');
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
        showToast('Failed to delete bot. Try again.', 'error');
    }
}

// Close modal on overlay click
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) {
        overlay.addEventListener('click', closeModal);
    }
});
