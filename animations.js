/**
 * Micro-animations for Dashboard
 * Confetti on bot creation, smooth transitions, loading states
 */

// Confetti animation on bot creation success
function celebrateBotCreation(botName) {
    // Simple confetti effect
    const confettiContainer = document.createElement('div');
    confettiContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10000;
    `;
    document.body.appendChild(confettiContainer);
    
    const colors = ['#ff6b35', '#10b981', '#fbbf24', '#3b82f6', '#ef4444'];
    
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.style.cssText = `
            position: absolute;
            width: 10px;
            height: 10px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            top: 50%;
            left: 50%;
            border-radius: 50%;
            animation: confettiFall ${1 + Math.random()}s ease-out forwards;
            transform: translate(-50%, -50%);
        `;
        
        // Random animation
        const angle = Math.random() * 360;
        const velocity = 200 + Math.random() * 200;
        confetti.style.setProperty('--angle', `${angle}deg`);
        confetti.style.setProperty('--velocity', `${velocity}px`);
        
        confettiContainer.appendChild(confetti);
    }
    
    // Add keyframes if not exists
    if (!document.getElementById('confetti-styles')) {
        const style = document.createElement('style');
        style.id = 'confetti-styles';
        style.textContent = `
            @keyframes confettiFall {
                to {
                    transform: translate(
                        calc(-50% + cos(var(--angle)) * var(--velocity)),
                        calc(-50% + sin(var(--angle)) * var(--velocity))
                    );
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Clean up
    setTimeout(() => {
        confettiContainer.remove();
    }, 2000);
    
    // Show success toast
    if (typeof showToast === 'function') {
        showToast(`🎉 ${botName} is ready to work!`, 'success', 3000);
    }
}

// Skeleton loading state for bot cards
function createSkeletonCard() {
    const skeleton = document.createElement('div');
    skeleton.className = 'bot-card skeleton-loading';
    skeleton.innerHTML = `
        <div class="skeleton-line" style="width:60%;height:20px;margin-bottom:8px;"></div>
        <div class="skeleton-line" style="width:40%;height:14px;margin-bottom:16px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:16px 0;">
            <div class="skeleton-line" style="height:40px;"></div>
            <div class="skeleton-line" style="height:40px;"></div>
            <div class="skeleton-line" style="height:40px;"></div>
        </div>
        <div class="skeleton-line" style="width:100%;height:36px;margin-top:16px;"></div>
    `;
    return skeleton;
}

// Add skeleton loading styles
function addSkeletonStyles() {
    if (document.getElementById('skeleton-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'skeleton-styles';
    style.textContent = `
        .skeleton-loading {
            animation: pulse 1.5s ease-in-out infinite;
        }
        
        .skeleton-line {
            background: linear-gradient(90deg, 
                rgba(255,255,255,0.05) 25%, 
                rgba(255,255,255,0.1) 50%, 
                rgba(255,255,255,0.05) 75%
            );
            background-size: 200% 100%;
            animation: shimmer 1.5s ease-in-out infinite;
            border-radius: 4px;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        
        @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
        
        /* Hover scale animation for bot cards */
        .bot-card {
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        
        .bot-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 8px 24px rgba(255, 107, 53, 0.2);
        }
        
        /* Button press animation */
        .btn {
            transition: transform 0.1s ease, box-shadow 0.1s ease;
        }
        
        .btn:active {
            transform: scale(0.97);
        }
        
        /* Tab switch animation */
        .tab-content {
            animation: slideIn 0.3s ease-out;
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        /* Success checkmark animation */
        @keyframes checkmark {
            0% {
                transform: scale(0) rotate(-45deg);
            }
            50% {
                transform: scale(1.2) rotate(-45deg);
            }
            100% {
                transform: scale(1) rotate(-45deg);
            }
        }
        
        .success-checkmark {
            animation: checkmark 0.4s ease-out;
        }
    `;
    document.head.appendChild(style);
}

// Smooth scroll to element
function smoothScrollTo(element) {
    if (!element) return;
    
    element.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
}

// Initialize animations
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        addSkeletonStyles();
    });
}
