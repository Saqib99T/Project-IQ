/**
 * Analyze recent user messages to pre-fill ticket fields.
 * Identical logic to web/ui/src/widget/utils/prefillTicket.js — zero cost.
 */

const CATEGORY_KEYWORDS = {
    Hardware: ['laptop', 'computer', 'keyboard', 'mouse', 'monitor', 'screen', 'printer',
               'hardware', 'device', 'headset', 'charger', 'battery', 'cable', 'usb', 'docking'],
    Network:  ['network', 'internet', 'wifi', 'vpn', 'connection', 'slow', 'disconnected',
               'proxy', 'firewall', 'ethernet', 'bandwidth', 'ping', 'dns', 'ip'],
    Software: ['software', 'app', 'application', 'install', 'update', 'crash', 'error',
               'bug', 'login', 'password', 'account', 'access', 'permission', 'license',
               'office', 'excel', 'word', 'teams', 'outlook', 'browser', 'chrome', 'email'],
};

const PRIORITY_HIGH_WORDS = ['urgent', 'asap', 'immediately', 'critical', 'emergency',
                              "can't work", 'cannot work', 'blocked', 'down', 'broken', 'not working'];
const PRIORITY_LOW_WORDS  = ['whenever', 'no rush', 'low priority', 'minor', 'small', 'sometime'];

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

function detectCategory(text) {
    const lower = text.toLowerCase();
    for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
        if (words.some(w => lower.includes(w))) return cat;
    }
    return 'Other';
}

function detectPriority(text) {
    const lower = text.toLowerCase();
    if (PRIORITY_HIGH_WORDS.some(w => lower.includes(w))) return 'High';
    if (PRIORITY_LOW_WORDS.some(w => lower.includes(w)))  return 'Minor';
    return 'Medium';
}

function extractTitle(text) {
    const sentence = text.split(/[.!?\n]/)[0].trim();
    return sentence.length > 80
        ? sentence.slice(0, 77) + '…'
        : capitalize(sentence);
}

export function prefillFromMessages(messages = []) {
    const userMessages = messages.filter(
        m => m.sender !== 'bot' && m.text && !m.text.startsWith('/')
    );
    if (!userMessages.length) return {};
    const lastText = userMessages[userMessages.length - 1].text || '';
    const allText  = userMessages.map(m => m.text).join(' ');
    return {
        title:    extractTitle(lastText),
        category: detectCategory(allText),
        priority: detectPriority(allText),
        detail:   lastText.length > 80 ? lastText : '',
    };
}
