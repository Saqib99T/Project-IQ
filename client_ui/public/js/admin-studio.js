// Studio Logic - Rasa Studio-like Interface

let studioData = {
    flows: [],
    responses: [],
    intents: []
};

async function loadStudio() {
    await Promise.all([
        loadStudioFlows(),
        loadStudioResponses()
    ]);
}

// ===== CHAT TESTING =====

function clearTestChat() {
    const container = document.getElementById('studio-chat-messages');
    if (container) {
        container.innerHTML = `
            <div class="flex justify-start">
                <div class="bg-white border border-gray-200 px-4 py-2 rounded-lg rounded-bl-none max-w-xs shadow-sm">
                    <p class="text-sm text-gray-700">👋 Hello! Type a message to test your bot.</p>
                </div>
            </div>
        `;
    }
    // Clear analysis panels
    document.getElementById('studio-intent-result').innerHTML = '<div class="text-gray-400 text-sm text-center py-4">Send a message to see intent analysis</div>';
    document.getElementById('studio-entity-result').innerHTML = '<div class="text-gray-400 text-sm text-center py-4">Entities will appear here</div>';
    document.getElementById('studio-response-preview').innerHTML = '<div class="text-gray-400 text-sm text-center py-4">Bot responses will appear here</div>';
}

async function sendStudioTestMessage() {
    const input = document.getElementById('studio-chat-input');
    const message = input?.value?.trim();
    if (!message) return;

    input.value = '';

    // Add user message
    const messagesContainer = document.getElementById('studio-chat-messages');
    messagesContainer.innerHTML += `
        <div class="flex justify-end">
            <div class="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 rounded-lg rounded-br-none max-w-xs shadow-sm">
                <p class="text-sm">${escapeHtml(message)}</p>
            </div>
        </div>
    `;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
        // Send to Rasa
        const res = await fetch(`${ADMIN_API}/test/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sender: 'studio-test-' + Date.now() })
        });
        const data = await res.json();

        // Add bot responses
        if (data.responses && data.responses.length > 0) {
            const responseHtml = data.responses.map(resp => {
                const text = resp.text || resp.custom?.text || JSON.stringify(resp);
                return `
                    <div class="flex justify-start">
                        <div class="bg-white border border-gray-200 px-4 py-2 rounded-lg rounded-bl-none max-w-xs shadow-sm">
                            <p class="text-sm text-gray-700">${escapeHtml(text)}</p>
                        </div>
                    </div>
                `;
            }).join('');
            messagesContainer.innerHTML += responseHtml;

            // Update response preview
            updateResponsePreview(data.responses);
        } else {
            messagesContainer.innerHTML += `
                <div class="flex justify-start">
                    <div class="bg-yellow-50 border border-yellow-200 px-4 py-2 rounded-lg rounded-bl-none max-w-xs">
                        <p class="text-sm text-yellow-700">No response from bot</p>
                    </div>
                </div>
            `;
        }

        // Update NLU analysis
        if (data.nlu) {
            updateIntentAnalysis(data.nlu);
            updateEntityAnalysis(data.nlu);
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;

    } catch (e) {
        messagesContainer.innerHTML += `
            <div class="flex justify-start">
                <div class="bg-red-50 border border-red-200 px-4 py-2 rounded-lg rounded-bl-none max-w-xs">
                    <p class="text-sm text-red-600">❌ Error: Could not reach Rasa</p>
                </div>
            </div>
        `;
        console.error('Test message error:', e);
    }
}

function updateIntentAnalysis(nlu) {
    const container = document.getElementById('studio-intent-result');
    if (!container || !nlu) return;

    const intent = nlu.intent || {};
    const ranking = nlu.intent_ranking || [];
    const confidence = (intent.confidence || 0) * 100;

    // Determine confidence color
    let confColor = 'text-green-600';
    let confBg = 'bg-green-50';
    if (confidence < 50) { confColor = 'text-red-600'; confBg = 'bg-red-50'; }
    else if (confidence < 80) { confColor = 'text-yellow-600'; confBg = 'bg-yellow-50'; }

    let html = `
        <div class="p-4 ${confBg} rounded-lg border">
            <div class="flex items-center justify-between mb-2">
                <span class="font-semibold text-lg ${confColor}">${intent.name || 'Unknown'}</span>
                <span class="text-sm ${confColor} font-medium">${confidence.toFixed(1)}%</span>
            </div>
            <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div class="h-full ${confidence >= 80 ? 'bg-green-500' : confidence >= 50 ? 'bg-yellow-500' : 'bg-red-500'} rounded-full transition-all" style="width: ${confidence}%"></div>
            </div>
        </div>
    `;

    // Show top 5 alternative intents
    if (ranking.length > 1) {
        html += '<div class="mt-3 space-y-1">';
        html += '<p class="text-xs text-gray-500 font-medium mb-2">Alternative Intents:</p>';
        ranking.slice(1, 6).forEach(alt => {
            const altConf = (alt.confidence || 0) * 100;
            html += `
                <div class="flex items-center justify-between text-sm py-1.5 px-2 bg-gray-50 rounded">
                    <span class="text-gray-600">${alt.name}</span>
                    <span class="text-gray-400">${altConf.toFixed(1)}%</span>
                </div>
            `;
        });
        html += '</div>';
    }

    container.innerHTML = html;
}

function updateEntityAnalysis(nlu) {
    const container = document.getElementById('studio-entity-result');
    if (!container) return;

    const entities = nlu.entities || [];

    if (entities.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-sm text-center py-4">No entities detected</div>';
        return;
    }

    const colors = {
        'ticket_subject': 'bg-purple-100 text-purple-700 border-purple-200',
        'ticket_id': 'bg-blue-100 text-blue-700 border-blue-200',
        'username': 'bg-green-100 text-green-700 border-green-200',
        'default': 'bg-gray-100 text-gray-700 border-gray-200'
    };

    let html = '<div class="space-y-2">';
    entities.forEach(e => {
        const colorClass = colors[e.entity] || colors['default'];
        html += `
            <div class="flex items-center justify-between p-2 rounded-lg border ${colorClass}">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold uppercase">${e.entity}</span>
                </div>
                <span class="font-medium">"${escapeHtml(e.value)}"</span>
            </div>
        `;
    });
    html += '</div>';

    container.innerHTML = html;
}

function updateResponsePreview(responses) {
    const container = document.getElementById('studio-response-preview');
    if (!container) return;

    let html = '<div class="space-y-2">';
    responses.forEach(resp => {
        const text = resp.text || JSON.stringify(resp);
        html += `
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <p class="text-sm text-gray-700">${escapeHtml(text)}</p>
            </div>
        `;
    });
    html += '</div>';

    container.innerHTML = html;
}

// ===== FLOWS =====
async function loadStudioFlows() {
    try {
        const res = await fetch(`${ADMIN_API}/studio/flows?t=${Date.now()}`);
        const data = await res.json();

        if (data.success) {
            studioData.flows = data.flows || [];
            renderStudioFlowList();
            document.getElementById('flow-count').textContent = studioData.flows.length;
        }
    } catch (e) {
        console.error('Failed to load flows:', e);
        document.getElementById('studio-flow-list').innerHTML = '<div class="text-red-400 text-sm">Failed to load flows</div>';
    }
}

function renderStudioFlowList() {
    const container = document.getElementById('studio-flow-list');
    if (!container) return;

    if (studioData.flows.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-sm">No flows found</div>';
        return;
    }

    let html = '';
    studioData.flows.forEach((flow, idx) => {
        const icon = flow.type === 'rule' ? '📋' : '📖';
        const typeLabel = flow.type === 'rule' ? 'Rule' : 'Story';
        html += `
            <div onclick="selectStudioFlow(${idx})" 
                class="p-3 rounded-lg border border-gray-200 hover:border-purple-400 hover:bg-purple-50 cursor-pointer transition-all group">
                <div class="flex items-center gap-2">
                    <span class="text-lg">${icon}</span>
                    <div class="flex-1 min-w-0">
                        <p class="font-medium text-gray-800 text-sm truncate group-hover:text-purple-700">${flow.name || 'Unnamed'}</p>
                        <p class="text-xs text-gray-400">${typeLabel} • ${flow.steps?.length || 0} steps</p>
                    </div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function selectStudioFlow(idx) {
    const flow = studioData.flows[idx];
    if (!flow) return;

    const container = document.getElementById('studio-flow-diagram');
    if (!container) return;

    // Create Mermaid diagram
    let mermaidDef = 'graph TD\n';
    mermaidDef += '    Start([Start]) --> Step0\n';

    (flow.steps || []).forEach((step, i) => {
        const safeStep = step.replace(/[^a-zA-Z0-9_:]/g, ' ').substring(0, 30);
        const nodeId = `Step${i}`;
        const nextId = i < flow.steps.length - 1 ? `Step${i + 1}` : 'End';

        if (step.startsWith('intent:')) {
            mermaidDef += `    ${nodeId}[/"🎯 ${safeStep}"/]\n`;
        } else if (step.startsWith('action_') || step.startsWith('utter_')) {
            mermaidDef += `    ${nodeId}["⚙️ ${safeStep}"]\n`;
        } else {
            mermaidDef += `    ${nodeId}["${safeStep}"]\n`;
        }
        mermaidDef += `    ${nodeId} --> ${nextId}\n`;
    });

    mermaidDef += '    End([End])\n';

    // Render with Mermaid
    container.innerHTML = `<div class="mermaid">${mermaidDef}</div>`;

    try {
        mermaid.init(undefined, container.querySelector('.mermaid'));
    } catch (e) {
        // Fallback to simple list if Mermaid fails
        let fallbackHtml = `<div class="space-y-2">
            <h4 class="font-semibold text-gray-800 mb-3">${flow.name}</h4>`;
        (flow.steps || []).forEach((step, i) => {
            const icon = step.startsWith('intent:') ? '🎯' : step.startsWith('action_') || step.startsWith('utter_') ? '⚙️' : '▶️';
            fallbackHtml += `
                <div class="flex items-center gap-2">
                    <div class="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-medium">${i + 1}</div>
                    <div class="flex-1 p-2 bg-white border border-gray-200 rounded-lg text-sm">${icon} ${step}</div>
                </div>
                ${i < flow.steps.length - 1 ? '<div class="ml-3 h-3 border-l-2 border-purple-200"></div>' : ''}
            `;
        });
        fallbackHtml += '</div>';
        container.innerHTML = fallbackHtml;
    }
}

// ===== RESPONSES =====
async function loadStudioResponses() {
    try {
        const res = await fetch(`${ADMIN_API}/studio/responses?t=${Date.now()}`);
        const data = await res.json();

        if (data.success) {
            studioData.responses = data.responses || [];
            renderStudioResponseList();
            document.getElementById('response-count').textContent = studioData.responses.length;
        }
    } catch (e) {
        console.error('Failed to load responses:', e);
    }
}

function renderStudioResponseList() {
    const container = document.getElementById('studio-response-list');
    if (!container) return;

    if (studioData.responses.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-sm col-span-full">No responses found</div>';
        return;
    }

    let html = '';
    studioData.responses.forEach(resp => {
        const preview = (resp.text || '').substring(0, 80);
        html += `
            <div class="p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer response-card" data-name="${resp.name}">
                <p class="font-medium text-gray-800 text-sm truncate">${resp.name}</p>
                <p class="text-xs text-gray-500 mt-1 line-clamp-2">${escapeHtml(preview)}${resp.text?.length > 80 ? '...' : ''}</p>
                ${resp.variations > 1 ? `<span class="text-xs text-blue-600 mt-1 inline-block">${resp.variations} variations</span>` : ''}
            </div>
        `;
    });
    container.innerHTML = html;
}

function filterStudioResponses() {
    const query = document.getElementById('studio-response-search')?.value.toLowerCase() || '';
    const cards = document.querySelectorAll('.response-card');
    cards.forEach(card => {
        const name = card.dataset.name.toLowerCase();
        card.style.display = name.includes(query) ? '' : 'none';
    });
}

// Utility
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
