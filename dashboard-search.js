/**
 * Search & Filter Functionality for Dashboard
 */

let searchQuery = '';
let statusFilter = 'all'; // all, active, paused, error

function initSearch() {
    const searchInput = document.getElementById('botSearch');
    const filterSelect = document.getElementById('statusFilter');
    const sortSelect = document.getElementById('sortBy');
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase();
            filterAndRenderBots();
        });
    }
    
    if (filterSelect) {
        filterSelect.addEventListener('change', (e) => {
            statusFilter = e.target.value;
            filterAndRenderBots();
        });
    }
    
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            filterAndRenderBots();
        });
    }
}

function filterAndRenderBots() {
    if (!currentBots || currentBots.length === 0) {
        return;
    }
    
    // Filter bots
    let filteredBots = currentBots.filter(bot => {
        // Search filter
        const matchesSearch = !searchQuery || 
            bot.name.toLowerCase().includes(searchQuery) ||
            bot.role.toLowerCase().includes(searchQuery) ||
            bot.id.toLowerCase().includes(searchQuery);
        
        // Status filter
        const matchesStatus = statusFilter === 'all' || bot.status === statusFilter;
        
        return matchesSearch && matchesStatus;
    });
    
    // Sort bots
    const sortBy = document.getElementById('sortBy')?.value || 'name';
    filteredBots.sort((a, b) => {
        switch(sortBy) {
            case 'name':
                return a.name.localeCompare(b.name);
            case 'usage':
                return (b.tokensUsed || 0) - (a.tokensUsed || 0);
            case 'lastActive':
                return (b.lastActive || 0) - (a.lastActive || 0);
            default:
                return 0;
        }
    });
    
    // Render filtered bots
    renderFilteredBots(filteredBots);
}

function renderFilteredBots(bots) {
    const grid = document.querySelector('.bots-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (bots.length === 0) {
        // Empty state
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
                <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
                <h3 style="color: var(--gray); font-weight: 600; margin-bottom: 8px;">No bots found</h3>
                <p style="color: var(--gray); font-size: 14px;">
                    ${searchQuery ? `No results for "${searchQuery}"` : 'Try adjusting your filters'}
                </p>
                ${searchQuery || statusFilter !== 'all' ? `
                    <button class="btn btn-secondary" onclick="clearFilters()" style="margin-top: 16px;">
                        Clear Filters
                    </button>
                ` : ''}
            </div>
        `;
        return;
    }
    
    // Render each bot using the same card function from dashboard-dynamic.js
    bots.forEach(bot => {
        const card = createBotCard(bot);
        grid.appendChild(card);
    });
    
    // Add "Add Bot" card if there's space
    const maxBots = 10; // Get from user data
    if (bots.length < maxBots && statusFilter === 'all' && !searchQuery) {
        const addCard = createAddBotCard(maxBots - bots.length);
        grid.appendChild(addCard);
    }
}

function clearFilters() {
    searchQuery = '';
    statusFilter = 'all';
    
    const searchInput = document.getElementById('botSearch');
    const filterSelect = document.getElementById('statusFilter');
    const sortSelect = document.getElementById('sortBy');
    
    if (searchInput) searchInput.value = '';
    if (filterSelect) filterSelect.value = 'all';
    if (sortSelect) sortSelect.value = 'name';
    
    filterAndRenderBots();
}

// Initialize search on page load
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        // Wait a bit for dashboard to load first
        setTimeout(initSearch, 500);
    });
}
