// HireOpenClaw AI Chat Intake Widget
// Replaces traditional form with conversational interview

class IntakeChat {
  constructor(containerId, onComplete) {
    this.container = document.getElementById(containerId);
    this.onComplete = onComplete;
    this.messages = [];
    this.clientInfo = {};
    this.isComplete = false;
    
    this.init();
  }

  init() {
    this.container.innerHTML = `
      <div class="chat-widget">
        <div class="chat-header">
          <div class="chat-avatar">🤖</div>
          <div class="chat-header-text">
            <div class="chat-title">Let's build your AI employee</div>
            <div class="chat-subtitle">Quick chat • 2 minutes</div>
          </div>
        </div>
        
        <div class="chat-messages" id="chatMessages"></div>
        
        <div class="chat-input-area">
          <textarea 
            id="chatInput" 
            placeholder="Type your answer..." 
            rows="1"
            disabled
          ></textarea>
          <button id="chatSend" class="chat-send-btn" disabled>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    this.messagesEl = document.getElementById('chatMessages');
    this.inputEl = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSend');

    // Auto-resize textarea
    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
    });

    // Send on Enter (not Shift+Enter)
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.sendBtn.addEventListener('click', () => this.sendMessage());
  }

  setClientInfo(info) {
    this.clientInfo = info;
    this.inputEl.disabled = false;
    this.sendBtn.disabled = false;
    
    // Start the conversation
    this.startConversation();
  }

  async startConversation() {
    this.addMessage('assistant', `Hey ${this.clientInfo.name?.split(' ')[0] || 'there'}! 👋 I'm going to ask you a few quick questions so we can build the perfect AI employee for ${this.clientInfo.business || 'your business'}.\n\nFirst up: What tasks are eating up most of your time right now?`);
  }

  addMessage(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'chat-bubble';
    bubbleDiv.innerHTML = this.formatMessage(content);
    
    messageDiv.appendChild(bubbleDiv);
    this.messagesEl.appendChild(messageDiv);
    
    // Scroll to bottom
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    
    // Store in messages array (for API)
    if (role !== 'system') {
      this.messages.push({ role, content });
    }
  }

  formatMessage(text) {
    return text
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  }

  async sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isComplete) return;

    // Add user message
    this.addMessage('user', text);
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    
    // Disable input while processing
    this.inputEl.disabled = true;
    this.sendBtn.disabled = true;
    
    // Show typing indicator
    this.showTyping();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.messages,
          clientInfo: this.clientInfo
        })
      });

      const data = await response.json();
      
      this.hideTyping();
      
      if (data.error) {
        this.addMessage('assistant', "Sorry, I hit a snag. Let me try again...");
        this.inputEl.disabled = false;
        this.sendBtn.disabled = false;
        return;
      }

      this.addMessage('assistant', data.message);
      
      if (data.isComplete) {
        this.isComplete = true;
        this.inputEl.placeholder = "Interview complete!";
        
        // Extract summary and call completion handler
        setTimeout(() => {
          if (this.onComplete) {
            this.onComplete({
              ...this.clientInfo,
              chatTranscript: this.messages,
              summary: data.message
            });
          }
        }, 2000);
      } else {
        this.inputEl.disabled = false;
        this.sendBtn.disabled = false;
        this.inputEl.focus();
      }
      
    } catch (error) {
      console.error('Chat error:', error);
      this.hideTyping();
      this.addMessage('assistant', "Oops, connection hiccup. Try again?");
      this.inputEl.disabled = false;
      this.sendBtn.disabled = false;
    }
  }

  showTyping() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message assistant typing';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `
      <div class="chat-bubble typing-bubble">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    `;
    this.messagesEl.appendChild(typingDiv);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  hideTyping() {
    const typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();
  }
}

// CSS for the chat widget
const chatStyles = `
<style>
.chat-widget {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 500px;
  max-height: 70vh;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: rgba(255, 107, 53, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.chat-avatar {
  font-size: 28px;
}

.chat-title {
  font-weight: 600;
  font-size: 1rem;
}

.chat-subtitle {
  font-size: 0.85rem;
  color: #888;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chat-message {
  display: flex;
  max-width: 85%;
}

.chat-message.user {
  align-self: flex-end;
}

.chat-message.assistant {
  align-self: flex-start;
}

.chat-bubble {
  padding: 12px 16px;
  border-radius: 16px;
  font-size: 0.95rem;
  line-height: 1.5;
}

.chat-message.user .chat-bubble {
  background: linear-gradient(135deg, #ff6b35, #f7931e);
  color: white;
  border-bottom-right-radius: 4px;
}

.chat-message.assistant .chat-bubble {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom-left-radius: 4px;
}

.typing-bubble {
  display: flex;
  gap: 4px;
  padding: 16px 20px;
}

.typing-bubble .dot {
  width: 8px;
  height: 8px;
  background: rgba(255, 255, 255, 0.4);
  border-radius: 50%;
  animation: typing 1.4s infinite;
}

.typing-bubble .dot:nth-child(2) { animation-delay: 0.2s; }
.typing-bubble .dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

.chat-input-area {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.2);
}

.chat-input-area textarea {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 12px 16px;
  color: white;
  font-size: 0.95rem;
  resize: none;
  font-family: inherit;
}

.chat-input-area textarea:focus {
  outline: none;
  border-color: #ff6b35;
}

.chat-input-area textarea::placeholder {
  color: #666;
}

.chat-send-btn {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, #ff6b35, #f7931e);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, opacity 0.2s;
}

.chat-send-btn:hover:not(:disabled) {
  transform: scale(1.05);
}

.chat-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
`;

// Inject styles
document.head.insertAdjacentHTML('beforeend', chatStyles);

// Export for use
window.IntakeChat = IntakeChat;
