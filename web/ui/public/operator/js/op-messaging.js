// ═══════════════════════════════════════════════════════════
// SEND MESSAGE
// ═══════════════════════════════════════════════════════════
async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !_activeQueueId) return;
  const chat = _chats[_activeQueueId];
  if (!chat) return;
  input.value = '';
  stopTyping();

  // Optimistic append — uses _activeQueueId which is a string key
  appendMessage(_activeQueueId, 'operator', text);

  try {
    const r = await apiFetch('/operator/message', 'POST', {
      conversation_id: chat.conversationId,
      text,
    });
    if (!r.ok) { showToast('Send failed', true); }
  } catch(_) { showToast('Send failed', true); }
}

function handleMsgKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

// ═══════════════════════════════════════════════════════════
// TYPING INDICATOR (outgoing)
// ═══════════════════════════════════════════════════════════
function handleTyping() {
  if (!_socket || !_activeQueueId) return;
  const chat = _chats[_activeQueueId];
  if (!chat) return;
  if (!_typingActive) {
    _typingActive = true;
    _socket.emit('operator_typing', { sender_id: chat.senderId, conversation_id: chat.conversationId, typing: true });
  }
  clearTimeout(_typingTimer);
  _typingTimer = setTimeout(() => stopTyping(), 3000);
}

function stopTyping() {
  if (!_typingActive || !_socket || !_activeQueueId) return;
  const chat = _chats[_activeQueueId];
  if (chat) {
    _socket.emit('operator_typing', { sender_id: chat.senderId, conversation_id: chat.conversationId, typing: false });
  }
  _typingActive = false;
}

