/**
 * Auto-Auth Script for OpenClaw Gateway
 * Handles hash fragment token extraction and localStorage injection
 * 
 * Usage: https://bot.clawops.io/#token=gt_xxx&exp=1234567890
 */

(function() {
    // Only run if we have a hash
    if (!window.location.hash || window.location.hash.length <= 1) {
        return;
    }
    
    try {
        // Extract hash parameters
        const hash = window.location.hash.substring(1); // Remove #
        const params = new URLSearchParams(hash);
        const token = params.get('token');
        const exp = params.get('exp');
        
        // No token in hash, skip
        if (!token) {
            return;
        }
        
        console.log('[auto-auth] Token detected in hash, processing...');
        
        // Validate token format (reasonable length, alphanumeric)
        // Supports both gt_ prefixed tokens and legacy tokens
        if (token.length < 20 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
            console.error('[auto-auth] Invalid token format');
            showMessage('Invalid authentication token format', 'error');
            clearHash();
            return;
        }
        
        // Validate expiry if present
        if (exp) {
            const expiryTime = parseInt(exp, 10);
            const now = Date.now();
            
            if (isNaN(expiryTime)) {
                console.error('[auto-auth] Invalid expiry timestamp');
                showMessage('Invalid link format', 'error');
                clearHash();
                return;
            }
            
            if (now > expiryTime) {
                console.warn('[auto-auth] Link expired');
                showMessage('Magic link expired. Please provision a new container.', 'error');
                clearHash();
                return;
            }
            
            const remainingMin = Math.floor((expiryTime - now) / 60000);
            console.log(`[auto-auth] Link valid for ${remainingMin} more minutes`);
        }
        
        // Store token in localStorage (OpenClaw gateway expects this)
        localStorage.setItem('openclaw_gateway_token', token);
        localStorage.setItem('openclaw_auth_method', 'token');
        
        console.log('[auto-auth] Token stored in localStorage');
        
        // Clear hash immediately (security - removes token from URL)
        clearHash();
        
        // Show success message
        showMessage('✅ Authentication successful! Connecting to gateway...', 'success');
        
        // Redirect to main UI after short delay (let success message show)
        setTimeout(() => {
            // Check if we're already on root path
            if (window.location.pathname === '/' || window.location.pathname === '') {
                // Reload to trigger gateway connection
                window.location.reload();
            } else {
                // Navigate to root
                window.location.href = '/';
            }
        }, 1500);
        
    } catch (err) {
        console.error('[auto-auth] Error processing token:', err);
        showMessage('Authentication failed. Please try again.', 'error');
        clearHash();
    }
    
    function clearHash() {
        // Remove hash from URL without reloading page
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    
    function showMessage(text, type = 'info') {
        // Create toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-family: 'Inter', sans-serif;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            max-width: 400px;
            animation: slideIn 0.3s ease-out;
        `;
        toast.textContent = text;
        
        // Add animation keyframes
        if (!document.getElementById('auto-auth-styles')) {
            const style = document.createElement('style');
            style.id = 'auto-auth-styles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(400px); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(400px); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(toast);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
})();
