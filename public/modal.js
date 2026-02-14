// Modal system - replaces alert(), confirm(), prompt()

let modalResolve = null;
let pendingDeleteId = null;

// Show alert modal
function showAlert(message, title = 'Notice') {
    const modal = document.getElementById('genericModal');
    document.getElementById('genericModalTitle').textContent = title;
    document.getElementById('genericModalMessage').textContent = message;
    document.getElementById('genericModalActions').innerHTML = `
        <button class="btn btn-primary" onclick="closeModal()">OK</button>
    `;
    
    modal.style.display = 'block';
    document.getElementById('modalOverlay').classList.add('active');
}

// Show confirm modal (async)
function showConfirm(message, title = 'Confirm') {
    return new Promise((resolve) => {
        const modal = document.getElementById('genericModal');
        document.getElementById('genericModalTitle').textContent = title;
        document.getElementById('genericModalMessage').textContent = message;
        document.getElementById('genericModalActions').innerHTML = `
            <button class="btn btn-secondary" onclick="resolveModal(false)">Cancel</button>
            <button class="btn btn-primary" onclick="resolveModal(true)">Confirm</button>
        `;
        
        modalResolve = resolve;
        modal.style.display = 'block';
        document.getElementById('modalOverlay').classList.add('active');
    });
}

function resolveModal(value) {
    if (modalResolve) {
        modalResolve(value);
        modalResolve = null;
    }
    closeModal();
}

// Show add bot modal
function showAddBot() {
    const modal = document.getElementById('addBotModal');
    document.getElementById('newBotName').value = '';
    document.getElementById('newBotRole').value = 'blank';
    
    modal.style.display = 'block';
    document.getElementById('modalOverlay').classList.add('active');
    
    // Focus name input
    setTimeout(() => document.getElementById('newBotName').focus(), 100);
}

// Show delete modal
function showDeleteModal(botId, botName) {
    pendingDeleteId = botId;
    document.getElementById('deleteModalMessage').textContent = 
        `Are you sure you want to delete "${botName}"? All data and configuration will be permanently removed.`;
    
    const modal = document.getElementById('deleteModal');
    modal.style.display = 'block';
    document.getElementById('modalOverlay').classList.add('active');
}

// Close any modal
function closeModal(event) {
    if (event && event.target.id !== 'modalOverlay') return;
    
    document.getElementById('modalOverlay').classList.remove('active');
    document.getElementById('genericModal').style.display = 'none';
    document.getElementById('addBotModal').style.display = 'none';
    document.getElementById('deleteModal').style.display = 'none';
    
    pendingDeleteId = null;
    modalResolve = null;
}

// Confirm add bot
async function confirmAddBot() {
    const name = document.getElementById('newBotName').value.trim();
    const roleTemplate = document.getElementById('newBotRole').value;
    
    if (!name) {
        showAlert('Please enter a name for your bot.', 'Name Required');
        return;
    }
    
    const roleMap = {
        marketing: 'Content Creator',
        sales: 'Sales Development',
        support: 'Customer Support',
        blank: 'Custom'
    };
    
    closeModal();
    
    // Generate tenant ID
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 6);
    const tenantId = `tenant-${timestamp}-${random}`;
    
    showAlert(`Creating ${name}...\n\nThis will take about 30 seconds.`, 'Creating Bot');
    
    try {
        const res = await fetch('/api/dashboard/create-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: currentEmail,
                tenantId: tenantId,
                botName: name,
                botRole: roleMap[roleTemplate],
                template: roleTemplate,
                plan: 'starter'
            })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            closeModal();
            showAlert(`✓ ${name} is ready!\n\nRefreshing dashboard...`, 'Success');
            setTimeout(() => {
                closeModal();
                loadDashboard(currentEmail);
            }, 2000);
        } else {
            closeModal();
            showAlert(`Failed to create bot:\n${data.error || 'Unknown error'}`, 'Error');
        }
    } catch (err) {
        console.error('Create bot failed:', err);
        closeModal();
        showAlert('Failed to create bot. Check console for errors.', 'Error');
    }
}

// Confirm delete
async function confirmDelete() {
    if (!pendingDeleteId) return;
    
    const tenantId = pendingDeleteId;
    closeModal();
    
    showAlert('Deleting bot...', 'Please Wait');
    
    try {
        const res = await fetch('/api/dashboard/bot-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, action: 'terminate' })
        });
        
        const data = await res.json();
        
        closeModal();
        
        if (data.ok) {
            showAlert('Bot deleted successfully.', 'Deleted');
            setTimeout(() => {
                closeModal();
                loadDashboard(currentEmail);
            }, 1500);
        } else {
            showAlert(`Failed to delete bot: ${data.error}`, 'Error');
        }
    } catch (err) {
        console.error('Delete failed:', err);
        closeModal();
        showAlert('Delete operation failed.', 'Error');
    }
}
