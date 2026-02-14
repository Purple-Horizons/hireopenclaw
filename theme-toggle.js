/**
 * Dark Mode Theme Toggle
 * Supports light/dark modes with smooth transitions
 */

const THEME_KEY = 'clawops_theme';

function initTheme() {
    // Get saved theme or default to dark
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    setTheme(savedTheme, false); // Don't animate on initial load
    
    // Add toggle button to header
    addThemeToggle();
}

function addThemeToggle() {
    const userInfo = document.querySelector('.user-info');
    if (!userInfo) return;
    
    const toggle = document.createElement('button');
    toggle.id = 'themeToggle';
    toggle.className = 'btn btn-secondary theme-toggle';
    toggle.innerHTML = getCurrentTheme() === 'dark' ? '☀️' : '🌙';
    toggle.title = 'Toggle theme';
    toggle.style.cssText = 'padding:6px 12px;font-size:16px;';
    toggle.onclick = toggleTheme;
    
    // Insert before logout button
    userInfo.insertBefore(toggle, userInfo.querySelector('button'));
}

function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
}

function setTheme(theme, animate = true) {
    const root = document.documentElement;
    
    if (animate) {
        root.style.transition = 'background-color 0.3s ease, color 0.3s ease';
    }
    
    root.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    
    // Update toggle button if it exists
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
        toggle.innerHTML = theme === 'dark' ? '☀️' : '🌙';
    }
    
    // Update CSS variables
    if (theme === 'light') {
        root.style.setProperty('--bg', '#ffffff');
        root.style.setProperty('--bg-card', '#f5f5f5');
        root.style.setProperty('--bg-card-hover', '#eeeeee');
        root.style.setProperty('--white', '#0a0a0a');
        root.style.setProperty('--gray', '#666666');
        root.style.setProperty('--light-gray', '#dddddd');
    } else {
        root.style.setProperty('--bg', '#0a0a0a');
        root.style.setProperty('--bg-card', '#1a1a1a');
        root.style.setProperty('--bg-card-hover', '#222222');
        root.style.setProperty('--white', '#ffffff');
        root.style.setProperty('--gray', '#888888');
        root.style.setProperty('--light-gray', '#333333');
    }
    
    // Remove transition after animation
    if (animate) {
        setTimeout(() => {
            root.style.transition = '';
        }, 300);
    }
}

function toggleTheme() {
    const currentTheme = getCurrentTheme();
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme, true);
    
    // Show toast
    if (typeof showToast === 'function') {
        showToast(`Switched to ${newTheme} mode`, 'info', 1500);
    }
}

// Initialize on page load
if (typeof document !== 'undefined') {
    // Wait for DOM and dashboard to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initTheme, 100);
        });
    } else {
        setTimeout(initTheme, 100);
    }
}
