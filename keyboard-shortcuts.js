/**
 * Keyboard Shortcuts for Dashboard
 * Cmd/Ctrl+K = Quick search
 * N = New bot
 * Esc = Close modal
 * 1-4 = Switch tabs
 */

const shortcuts = {
    'k': {
        ctrl: true,
        action: () => focusSearch(),
        description: 'Quick search'
    },
    'n': {
        action: () => showAddBot(),
        description: 'New bot'
    },
    'Escape': {
        action: () => closeModal(),
        description: 'Close modal'
    },
    '1': {
        action: () => switchTab('employees'),
        description: 'Employees tab'
    },
    '2': {
        action: () => switchTab('usage'),
        description: 'Usage tab'
    },
    '3': {
        action: () => switchTab('billing'),
        description: 'Billing tab'
    },
    '4': {
        action: () => switchTab('settings'),
        description: 'Settings tab'
    },
    '?': {
        action: () => showShortcutsHelp(),
        description: 'Show shortcuts'
    }
};

function focusSearch() {
    const searchInput = document.getElementById('botSearch');
    if (searchInput) {
        searchInput.focus();
        searchInput.select();
    }
}

function showShortcutsHelp() {
    const helpText = Object.entries(shortcuts)
        .map(([key, config]) => {
            const keyDisplay = config.ctrl ? `⌘/Ctrl+${key.toUpperCase()}` : key === 'Escape' ? 'Esc' : key.toUpperCase();
            return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                <span>${config.description}</span>
                <kbd style="background:rgba(255,255,255,0.1);padding:4px 8px;border-radius:4px;font-family:monospace;">${keyDisplay}</kbd>
            </div>`;
        })
        .join('');
    
    if (typeof showModal === 'function') {
        const modal = document.getElementById('genericModal');
        if (modal) {
            document.getElementById('genericModalTitle').textContent = '⌨️ Keyboard Shortcuts';
            document.getElementById('genericModalMessage').innerHTML = helpText;
            document.getElementById('genericModalActions').innerHTML = `
                <button class="btn btn-primary" onclick="closeModal()">Got It</button>
            `;
            openModal('genericModal');
        }
    }
}

function handleKeydown(e) {
    // Don't trigger if user is typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        // Except for Escape
        if (e.key !== 'Escape') {
            return;
        }
    }
    
    const key = e.key;
    const shortcut = shortcuts[key];
    
    if (shortcut) {
        // Check if ctrl/cmd is required
        if (shortcut.ctrl && !(e.ctrlKey || e.metaKey)) {
            return;
        }
        
        // Check if ctrl/cmd should NOT be pressed
        if (!shortcut.ctrl && (e.ctrlKey || e.metaKey)) {
            return;
        }
        
        e.preventDefault();
        shortcut.action();
    }
}

// Add help button to dashboard
function addShortcutsButton() {
    const dashHeader = document.querySelector('.dash-header .user-info');
    if (!dashHeader) return;
    
    const helpBtn = document.createElement('button');
    helpBtn.className = 'btn btn-secondary';
    helpBtn.innerHTML = '⌨️';
    helpBtn.title = 'Keyboard shortcuts (?)';
    helpBtn.style.cssText = 'padding:6px 12px;font-size:16px;';
    helpBtn.onclick = showShortcutsHelp;
    
    dashHeader.insertBefore(helpBtn, dashHeader.firstChild);
}

// Initialize
if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleKeydown);
    
    window.addEventListener('load', () => {
        setTimeout(addShortcutsButton, 500);
    });
}
