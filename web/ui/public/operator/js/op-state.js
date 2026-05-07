window._dbg = function(){};  // no-op stub

// ═══════════════════════════════════════════════════════════
// VERSION — [OP] v15b
// ═══════════════════════════════════════════════════════════
console.log('[OP] v15b');

// ═══════════════════════════════════════════════════════════
// STATE  — ALL queueId keys are STRINGS everywhere
// ═══════════════════════════════════════════════════════════
const API = '';  // same origin
let _token      = localStorage.getItem('op_token') || '';
let _opId       = parseInt(localStorage.getItem('op_id') || '0');
let _opName     = localStorage.getItem('op_name') || '';
let _opStatus   = 'available';

let _socket     = null;
let _heartbeatTimer = null;
let _typingTimer    = null;
let _typingActive   = false;

const _chats = {};          // keyed by String(queueId)
const _historyMeta = {};    // keyed by conversation_id — stores label/sub for popup
let _activeQueueId = null;  // always a STRING or null

const _queueItems = {};

/** Normalise any id to a string key */
function K(id) { return String(id); }

