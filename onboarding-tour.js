/**
 * Onboarding Tour for First-Time Users
 * Interactive walkthrough of dashboard features
 */

const TOUR_COMPLETE_KEY = 'clawops_tour_complete';

const TOUR_STEPS = [
    {
        target: '.dash-header',
        title: '👋 Welcome to ClawOps!',
        content: 'Your AI employee dashboard. Let\'s take a quick tour to get you started.',
        position: 'bottom'
    },
    {
        target: '.tabs-nav',
        title: '📑 Navigate Your Dashboard',
        content: 'Switch between Employees, Usage, Billing, and Settings tabs to manage your AI workforce.',
        position: 'bottom'
    },
    {
        target: '.search-filter-bar',
        title: '🔍 Find What You Need',
        content: 'Search, filter, and sort your AI employees. Try searching by name or filtering by status.',
        position: 'bottom'
    },
    {
        target: '.btn-primary[onclick="showAddBot()"]',
        title: '➕ Create Your First Employee',
        content: 'Click here to add your first AI employee. Choose from pre-trained roles or start with a blank canvas.',
        position: 'left',
        highlight: true
    }
];

let currentStep = 0;
let tourOverlay = null;
let tourTooltip = null;

function shouldShowTour() {
    // Check if tour was already completed
    if (localStorage.getItem(TOUR_COMPLETE_KEY) === 'true') {
        return false;
    }
    
    // Only show for users with 0 bots
    if (currentBots && currentBots.length > 0) {
        return false;
    }
    
    return true;
}

function startTour() {
    if (!shouldShowTour()) return;
    
    createTourOverlay();
    showStep(0);
}

function createTourOverlay() {
    // Create overlay
    tourOverlay = document.createElement('div');
    tourOverlay.id = 'tourOverlay';
    tourOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        z-index: 9998;
        backdrop-filter: blur(2px);
    `;
    
    // Create tooltip container
    tourTooltip = document.createElement('div');
    tourTooltip.id = 'tourTooltip';
    tourTooltip.style.cssText = `
        position: fixed;
        background: white;
        color: #0a0a0a;
        padding: 24px;
        border-radius: 12px;
        max-width: 400px;
        z-index: 9999;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    `;
    
    document.body.appendChild(tourOverlay);
    document.body.appendChild(tourTooltip);
    
    // Click overlay to skip
    tourOverlay.addEventListener('click', skipTour);
}

function showStep(stepIndex) {
    if (stepIndex >= TOUR_STEPS.length) {
        completeTour();
        return;
    }
    
    currentStep = stepIndex;
    const step = TOUR_STEPS[stepIndex];
    
    // Find target element
    const target = document.querySelector(step.target);
    if (!target) {
        // Skip this step if target doesn't exist
        showStep(stepIndex + 1);
        return;
    }
    
    // Highlight target
    if (step.highlight) {
        target.style.boxShadow = '0 0 0 4px #ff6b35';
        target.style.position = 'relative';
        target.style.zIndex = '10000';
    }
    
    // Position tooltip
    const rect = target.getBoundingClientRect();
    let top, left;
    
    switch(step.position) {
        case 'bottom':
            top = rect.bottom + 16;
            left = rect.left;
            break;
        case 'top':
            top = rect.top - tourTooltip.offsetHeight - 16;
            left = rect.left;
            break;
        case 'left':
            top = rect.top;
            left = rect.left - 420;
            break;
        case 'right':
            top = rect.top;
            left = rect.right + 16;
            break;
        default:
            top = rect.bottom + 16;
            left = rect.left;
    }
    
    tourTooltip.style.top = `${top}px`;
    tourTooltip.style.left = `${left}px`;
    
    // Render tooltip content
    const isLast = stepIndex === TOUR_STEPS.length - 1;
    tourTooltip.innerHTML = `
        <h3 style="margin:0 0 12px;font-size:18px;font-weight:700;">${step.title}</h3>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#333;">${step.content}</p>
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:12px;color:#888;">
                ${stepIndex + 1} of ${TOUR_STEPS.length}
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="skipTour()" style="padding:8px 16px;background:#f0f0f0;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">
                    Skip
                </button>
                <button onclick="nextStep()" style="padding:8px 16px;background:#ff6b35;color:white;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">
                    ${isLast ? 'Got It!' : 'Next'}
                </button>
            </div>
        </div>
    `;
}

function nextStep() {
    // Remove highlight from current step
    const currentTarget = document.querySelector(TOUR_STEPS[currentStep].target);
    if (currentTarget) {
        currentTarget.style.boxShadow = '';
        currentTarget.style.zIndex = '';
    }
    
    showStep(currentStep + 1);
}

function skipTour() {
    localStorage.setItem(TOUR_COMPLETE_KEY, 'true');
    removeTour();
}

function completeTour() {
    localStorage.setItem(TOUR_COMPLETE_KEY, 'true');
    removeTour();
    
    if (typeof showToast === 'function') {
        showToast('🎉 You\'re all set! Create your first AI employee to get started.', 'success', 4000);
    }
}

function removeTour() {
    if (tourOverlay) {
        tourOverlay.remove();
        tourOverlay = null;
    }
    if (tourTooltip) {
        tourTooltip.remove();
        tourTooltip = null;
    }
    
    // Remove any lingering highlights
    TOUR_STEPS.forEach(step => {
        const target = document.querySelector(step.target);
        if (target) {
            target.style.boxShadow = '';
            target.style.zIndex = '';
        }
    });
}

// Start tour automatically for new users
if (typeof document !== 'undefined') {
    // Wait for dashboard to fully load
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (document.getElementById('dashboardScreen')?.style.display !== 'none') {
                startTour();
            }
        }, 1000);
    });
}
