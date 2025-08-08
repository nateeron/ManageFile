
let currentClientName = '';
let chatHistory = [];
let isChatJoined = false;
let currentChatFile = null;
let chatSocket = null; // SocketIO connection for chat

// Define chat functions immediately to make them globally available
function toggleChatBox() {
  const chatContainer = document.getElementById('chatContainer');
  if (chatContainer.style.display === 'flex') {
    chatContainer.style.display = 'none';
  } else {
    chatContainer.style.display = 'flex';
    // Initialize socket connection when opening chat
    initializeSocket();
    // Load chat history tabs when opening
    loadChatHistoryTabs();
  }
}

function initializeSocket() {
  if (!chatSocket) {
    chatSocket = io();

    // Handle connection
    chatSocket.on('connect', function () {
      console.log('Connected to chat server');
    });

    // Handle disconnection
    chatSocket.on('disconnect', function () {
      console.log('Disconnected from chat server');
    });

    // Handle new messages from other clients
    chatSocket.on('new_message', function (data) {
      // Only add message if it's not from current user
      if (data.sender !== currentClientName) {
        addMessage(data.sender, data.message, 'other', data.timestamp);
        // Add to history
        chatHistory.push({
          sender: data.sender,
          message: data.message,
          timestamp: data.timestamp,
          type: 'other'
        });
      }
    });

    // Handle user joined notifications
    chatSocket.on('user_joined', function (data) {
      if (data.clientName !== currentClientName) {
        addMessage('System', data.message, 'system');
      }
    });

    // Handle user connected/disconnected notifications
    chatSocket.on('user_connected', function (data) {
      addMessage('System', data.message, 'system');
    });

    chatSocket.on('user_disconnected', function (data) {
      addMessage('System', data.message, 'system');
    });
  }
}

    // Load chat history tabs from server
    function loadChatHistoryTabs() {
      fetch('/get_chat_files')
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            const tabList = document.getElementById('chatTabList');
            // Keep the "New Chat" and "All History" tabs
            const newChatTab = tabList.querySelector('.tab-item');
            const allHistoryTab = tabList.querySelector('.tab-item:nth-child(2)');
            tabList.innerHTML = '';
            tabList.appendChild(newChatTab);
            tabList.appendChild(allHistoryTab);

            // Add Global Chat tab
            const globalChatTab = document.createElement('div');
            globalChatTab.className = 'tab-item';
            globalChatTab.onclick = () => loadGlobalChat();
            globalChatTab.innerHTML = `
                 <i class="fa-solid fa-globe"></i>
                 <span>Global Chat</span>
               `;
            tabList.appendChild(globalChatTab);

        // Add individual chat history tabs
        data.files.forEach(file => {
          // Skip global chat file as it's handled separately
          if (file === 'global_chat.json') return;

          const fileName = file.replace('.json', '');
          const tabItem = document.createElement('div');
          tabItem.className = 'tab-item';
          tabItem.onclick = () => loadChatHistory(fileName);
          tabItem.innerHTML = `
               <i class="fa-solid fa-comments"></i>
               <span>${fileName}</span>
             `;
          tabList.appendChild(tabItem);
        });
      }
    })
    .catch(error => {
      console.error('Error loading chat tabs:', error);
    });
}

// Switch to new chat
function switchToNewChat() {
  // Update active tab
  document.querySelectorAll('.tab-item').forEach(tab => tab.classList.remove('active'));
  event.target.closest('.tab-item').classList.add('active');

  // Reset chat state
  currentClientName = '';
  isChatJoined = false;
  currentChatFile = null;
  chatHistory = [];

  // Clear messages
  document.getElementById('chatMessages').innerHTML = `
         <div class="chat-welcome">
           <h3>💬 Multi-Client Chat</h3>
           <p>Welcome to the chat system!</p>
           <p>Enter your name below to start chatting.</p>
           <p>You can also join the "Global Chat" to chat with all users.</p>
         </div>
       `;

  // Show name input, hide chat input
  document.getElementById('clientNameInput').classList.remove('d-none');
  document.getElementById('chatInputContainer').classList.add('d-none');
}

// Join chat with client name
function joinChat() {
  const clientName = document.getElementById('clientName').value.trim();
  if (!clientName) {
    alert('Please enter your name!');
    return;
  }

  currentClientName = clientName;
  isChatJoined = true;

  // Initialize socket if not already done
  initializeSocket();

  // Emit join event for global chat
  if (chatSocket) {
    chatSocket.emit('join_chat', { clientName: clientName });
  }

  // Hide name input, show chat input
  document.getElementById('clientNameInput').classList.add('d-none');
  document.getElementById('chatInputContainer').classList.remove('d-none');

  // Load existing chat history for this client
  loadClientChatHistory();

  // Create/update chat folder and save initial data
  createChatFolder();

  // Refresh tab list to include new chat
  loadChatHistoryTabs();

  // Update chat title
  document.getElementById('chatTitle').textContent = `💬 Chat - ${clientName}`;
}

// Load existing chat history
function loadChatHistory(name) {
  // Update active tab
  document.querySelectorAll('.tab-item').forEach(tab => tab.classList.remove('active'));
  event.target.closest('.tab-item').classList.add('active');

  currentClientName = name;
  isChatJoined = true;
  currentChatFile = `${name}.json`;

  // Initialize socket if not already done
  initializeSocket();

  if (chatSocket) {
    chatSocket.emit('join_chat', { clientName: name });
  }

  // Hide name input, show chat input
  document.getElementById('clientNameInput').classList.add('d-none');
  document.getElementById('chatInputContainer').classList.remove('d-none');

  // Load chat history from server
  fetch(`/load_chat_file/${name}.json`)
    .then(response => response.json())
    .then(data => {
      if (data.success && data.chatData) {
        // Clear current messages
        document.getElementById('chatMessages').innerHTML = '';

        // Load existing messages
        const existingMessages = data.chatData.messages || [];
        chatHistory = existingMessages;

        // Display existing messages
        existingMessages.forEach(msg => {
          addMessage(msg.sender, msg.message, msg.type || 'other', msg.timestamp);
        });

        console.log('Loaded chat history for:', name);
      }
    })
    .catch(error => {
      console.error('Error loading chat history:', error);
      // Show error message
      document.getElementById('chatMessages').innerHTML = `
           <div class="chat-welcome">
             <p>Error loading chat history. Please try again.</p>
           </div>
         `;
    });

  // Update chat title
  document.getElementById('chatTitle').textContent = `💬 Chat - ${name}`;
}

// Load global chat
function loadGlobalChat() {
  // Update active tab
  document.querySelectorAll('.tab-item').forEach(tab => tab.classList.remove('active'));
  event.target.closest('.tab-item').classList.add('active');

  // Set current client to global mode
  currentClientName = 'Global';
  isChatJoined = true;
  currentChatFile = 'global_chat.json';

  // Initialize socket if not already done
  initializeSocket();

  // Hide name input, show chat input
  document.getElementById('clientNameInput').classList.add('d-none');
  document.getElementById('chatInputContainer').classList.remove('d-none');

  // Load global chat history
  fetch('/load_global_chat')
    .then(response => response.json())
    .then(data => {
      if (data.success && data.chatData) {
        // Clear current messages
        document.getElementById('chatMessages').innerHTML = '';

        // Load existing messages
        const existingMessages = data.chatData.messages || [];
        chatHistory = existingMessages;

        // Display existing messages
        existingMessages.forEach(msg => {
          addMessage(msg.sender, msg.message, msg.type || 'other', msg.timestamp);
        });

        console.log('Loaded global chat history');
      }
    })
    .catch(error => {
      console.error('Error loading global chat history:', error);
      // Show error message
      document.getElementById('chatMessages').innerHTML = `
           <div class="chat-welcome">
             <p>Error loading global chat history. Please try again.</p>
           </div>
         `;
    });

  // Update chat title
  document.getElementById('chatTitle').textContent = '💬 Global Chat';
}

// Send message
function sendMessage() {
  const messageInput = document.getElementById('chatInput');
  const message = messageInput.value.trim();

  if (!message || !isChatJoined) return;

  const now = new Date();
  const timestamp = now.toISOString();

  // Add message to UI
  addMessage(currentClientName, message, 'own', timestamp);

  // Clear input
  messageInput.value = '';

  // Send message to all clients via SocketIO for global chat
  if (chatSocket) {
    chatSocket.emit('send_message', {
      sender: currentClientName,
      message: message,
      timestamp: timestamp,
      currentClient: currentClientName
    });
  }

  // Save message to individual client file if not in global chat
  if (currentChatFile !== 'global_chat.json') {
    saveChatMessage(currentClientName, message);
  }
}

// Add message to chat display
function addMessage(sender, message, type, timestamp) {
  const chatMessages = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${type}`;

  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  messageDiv.innerHTML = `
         <div class="message-header">
           <span class="sender">${sender}</span>
           <span class="time">${time}</span>
         </div>
         <div class="message-content">${message}</div>
       `;

  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Save individual message to chat file
function saveChatMessage(sender, message) {
  const now = new Date();

  // Update chat history
  chatHistory.push({
    sender: sender,
    message: message,
    timestamp: now.toISOString(),
    type: 'own'
  });

  const chatData = {
    clientName: currentClientName,
    startTime: new Date().toISOString(),
    messages: chatHistory
  };

  // Save updated data (one file per client)
  fetch('/save_chat_file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientName: currentClientName,
      chatData: chatData
    })
  })
    .then(response => response.json())
    .then(data => {
      if (!data.success) {
        console.error('Error saving message:', data.error);
      } else {
        // Refresh tab list to update timestamps
        loadChatHistoryTabs();
      }
    })
    .catch(error => {
      console.error('Error saving message:', error);
    });
}

// Create chat folder and save initial data
function createChatFolder() {
  const now = new Date();

  const chatData = {
    clientName: currentClientName,
    startTime: now.toISOString(),
    messages: chatHistory
  };

  // Save to server (one file per client)
  fetch('/save_chat_file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientName: currentClientName,
      chatData: chatData
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        console.log('Client chat file created/updated successfully');
      } else {
        console.error('Error creating chat file:', data.error);
      }
    })
    .catch(error => {
      console.error('Error saving chat file:', error);
    });
}

// Load existing chat history for client
function loadClientChatHistory() {
  fetch(`/load_chat_file/${currentClientName}.json`)
    .then(response => response.json())
    .then(data => {
      if (data.success && data.chatData) {
        // Load existing messages
        const existingMessages = data.chatData.messages || [];
        chatHistory = existingMessages;

        // Display existing messages with their original timestamps
        existingMessages.forEach(msg => {
          addMessage(msg.sender, msg.message, msg.type || 'own', msg.timestamp);
        });

        console.log('Loaded existing chat history for:', currentClientName);
      }
    })
    .catch(error => {
      console.log('No existing chat history found for:', currentClientName);
    });
}

// Load and display all chat history in a list format
function showAllChatHistory() {
  console.log('Loading all chat history...');
  fetch('/get_chat_files')
    .then(response => response.json())
    .then(data => {
      console.log('Chat files response:', data);
      if (data.success) {
        const chatMessages = document.getElementById('chatMessages');
        chatMessages.innerHTML = '<div class="chat-history-list"></div>';
        const historyList = chatMessages.querySelector('.chat-history-list');
        
        // Add header
        historyList.innerHTML = `
          <div class="history-header">
            <h3>📋 All Chat History</h3>
            <p>Showing all available chat sessions</p>
          </div>
        `;

        // Process each chat file
        console.log('Processing files:', data.files);
        const chatPromises = data.files.map(file => {
          console.log('Processing file:', file);
          if (file === 'global_chat.json') {
            return fetch('/load_global_chat')
              .then(response => response.json())
              .then(data => {
                console.log('Global chat data:', data);
                return {
                  fileName: 'Global Chat',
                  chatData: data.chatData,
                  isGlobal: true
                };
              });
          } else {
            const clientName = file.replace('.json', '');
            return fetch(`/load_chat_file/${file}`)
              .then(response => response.json())
              .then(data => {
                console.log('Chat data for', file, ':', data);
                return {
                  fileName: clientName,
                  chatData: data.chatData,
                  isGlobal: false
                };
              });
          }
        });

        Promise.all(chatPromises)
          .then(chatResults => {
            console.log('All chat results:', chatResults);
            let hasValidChats = false;
            chatResults.forEach(result => {
              console.log('Processing result:', result);
              if (result.chatData && result.chatData.messages) {
                hasValidChats = true;
                const chatContainer = document.createElement('div');
                chatContainer.className = 'history-chat-container';
                
                const messageCount = result.chatData.messages.length;
                const lastMessage = result.chatData.messages[messageCount - 1];
                const lastTime = lastMessage ? new Date(lastMessage.timestamp).toLocaleString() : 'No messages';
                
                chatContainer.innerHTML = `
                  <div class="history-chat-header">
                    <h4>${result.isGlobal ? '🌐' : '💬'} ${result.fileName}</h4>
                    <div class="history-chat-info">
                      <span class="message-count">${messageCount} messages</span>
                      <span class="last-message-time">Last: ${lastTime}</span>
                    </div>
                  </div>
                  <div class="history-chat-messages">
                    ${result.chatData.messages.slice(-5).map(msg => `
                      <div class="history-message">
                        <span class="history-sender">${msg.sender}:</span>
                        <span class="history-text">${msg.message}</span>
                        <span class="history-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
                      </div>
                    `).join('')}
                  </div>
                  <div class="history-chat-actions">
                    <button onclick="loadChatHistory('${result.fileName}')" class="history-action-btn">
                      Open Chat
                    </button>
                    ${result.isGlobal ? '' : `
                      <button onclick="deleteChatHistory('${result.fileName}.json')" class="history-action-btn delete-btn">
                        Delete
                      </button>
                    `}
                  </div>
                `;
                
                historyList.appendChild(chatContainer);
              }
            });
            
            if (!hasValidChats) {
              historyList.innerHTML += `
                <div class="history-chat-container">
                  <div class="history-chat-header">
                    <h4>📭 No Chat History</h4>
                  </div>
                  <div class="history-chat-messages">
                    <p>No chat history found. Start a new chat to create history!</p>
                  </div>
                </div>
              `;
            }
          })
          .catch(error => {
            console.error('Error loading chat history:', error);
            historyList.innerHTML += '<p class="error-message">Error loading chat history</p>';
          });
      }
    })
    .catch(error => {
      console.error('Error loading chat files:', error);
    });
}

// Delete chat history for a specific client
function deleteChatHistory(filename) {
  if (confirm(`Are you sure you want to delete the chat history for "${filename.replace('.json', '')}"?`)) {
    fetch(`/delete_chat_file/${filename}`, {
      method: 'DELETE'
    })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          alert(`Chat history for "${filename.replace('.json', '')}" has been deleted.`);
          // Refresh the history list
          showAllChatHistory();
          // Refresh the tab list
          loadChatHistoryTabs();
        } else {
          alert('Error deleting chat history: ' + data.error);
        }
      })
      .catch(error => {
        console.error('Error deleting chat history:', error);
        alert('Error deleting chat history');
      });
  }
}

// Initialize chat system when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Handle Enter key in chat input
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      if (document.getElementById('chatInput').matches(':focus')) {
        sendMessage();
      } else if (document.getElementById('clientName').matches(':focus')) {
        joinChat();
      }
    }
  });

  // Make functions globally available
  window.toggleChatBox = toggleChatBox;
  window.joinChat = joinChat;
  window.sendMessage = sendMessage;
  window.switchToNewChat = switchToNewChat;
  window.loadChatHistory = loadChatHistory;
  window.loadGlobalChat = loadGlobalChat;
  window.showAllChatHistory = showAllChatHistory;
  window.deleteChatHistory = deleteChatHistory;
});
