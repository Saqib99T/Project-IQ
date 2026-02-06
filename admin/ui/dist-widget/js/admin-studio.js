// Studio Dashboard - No-Code Editor
// NLU editing, story visualization, model training

let studioNluData = {};
let studioFlowsData = [];
let studioResponsesData = {};
let selectedIntent = null;
let currentTrainingJobId = null;

async function loadStudioData() {
    await Promise.all([
        loadNLUData(),
        loadFlowsData(),
        loadResponsesData(),
        loadModelsData(),
        loadDataSummary()
    ]);
}

// Alias for admin-core.js compatibility
async function loadStudio() {
    await loadStudioData();
}

function refreshStudioData() {
    showToast('Refreshing data...', false);
    loadStudioData();
}

// ============================================================================
// NLU Tab
// ============================================================================

async function loadNLUData() {
    try {
        const res = await fetch(`${ADMIN_API}/studio/nlu`);
        const data = await res.json();

        if (data.success) {
            studioNluData = data.intents || {};
            renderNLUIntentList(studioNluData);
            document.getElementById('nlu-intent-count').textContent = Object.keys(studioNluData).length;
            document.getElementById('summary-intents').textContent = data.total_intents || 0;
            document.getElementById('summary-examples').textContent = data.total_examples || 0;
        } else {
            document.getElementById('nlu-intent-list').innerHTML = `<div class="text-yellow-600 text-sm">${data.error}</div>`;
        }
    } catch (e) {
        console.error('Failed to load NLU data:', e);
        document.getElementById('nlu-intent-list').innerHTML = '<div class="text-red-400 text-sm">Failed to load</div>';
    }
}

function renderNLUIntentList(intents) {
    const container = document.getElementById('nlu-intent-list');
    const intentNames = Object.keys(intents).sort();

    if (intentNames.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-sm">No intents found</div>';
        return;
    }

    const html = intentNames.map(name => {
        const count = intents[name].length;
        const isSelected = selectedIntent === name;

        return `
        <div onclick="selectNLUIntent('${name}')" 
             class="p-2 rounded-lg cursor-pointer flex justify-between items-center transition-all ${isSelected ? 'bg-purple-100 border-purple-300 border' : 'hover:bg-gray-100 border border-transparent'}">
            <span class="font-mono text-sm ${isSelected ? 'text-purple-700 font-medium' : 'text-gray-700'}">${name}</span>
            <span class="text-xs ${isSelected ? 'bg-purple-200 text-purple-800' : 'bg-gray-200 text-gray-600'} px-2 py-0.5 rounded-full">${count}</span>
        </div>`;
    }).join('');

    container.innerHTML = html;
}

function filterNLUIntents(query) {
    const filtered = {};
    for (const [name, examples] of Object.entries(studioNluData)) {
        if (name.toLowerCase().includes(query.toLowerCase())) {
            filtered[name] = examples;
        }
    }
    renderNLUIntentList(filtered);
}

function selectNLUIntent(intentName) {
    selectedIntent = intentName;
    const examples = studioNluData[intentName] || [];

    document.getElementById('nlu-selected-intent').textContent = intentName;
    document.getElementById('nlu-example-count').textContent = examples.length;
    document.getElementById('btn-add-example').disabled = false;

    // Re-render intent list to show selection
    renderNLUIntentList(studioNluData);

    // Render examples
    renderNLUExamples(examples);
}

function renderNLUExamples(examples) {
    const container = document.getElementById('nlu-examples-container');

    if (!examples || examples.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">No examples for this intent</div>';
        return;
    }

    const html = examples.map((ex, i) => {
        const hasEntities = ex.entities && ex.entities.length > 0;

        return `
        <div class="p-3 rounded-lg border border-gray-200 hover:border-purple-300 transition-colors group">
            <div class="flex justify-between items-start">
                <div class="flex-1">
                    <div class="text-sm">${highlightEntities(ex.text)}</div>
                    ${hasEntities ? `
                    <div class="mt-1 flex flex-wrap gap-1">
                        ${ex.entities.map(e => `
                            <span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                                ${e.entity}: "${e.value}"
                            </span>
                        `).join('')}
                    </div>` : ''}
                </div>
                <button onclick="deleteNLUExample('${selectedIntent}', '${escapeForJs(ex.text)}')" 
                    class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity p-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = html;
}

function highlightEntities(text) {
    // Highlight [value](entity) patterns
    return escapeHtml(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g,
        '<span class="bg-blue-100 text-blue-700 px-1 rounded">$1</span><span class="text-xs text-blue-500">:$2</span>');
}

function showAddExampleModal() {
    if (!selectedIntent) return;

    document.getElementById('modal-intent').value = selectedIntent;
    document.getElementById('modal-example-text').value = '';
    document.getElementById('add-example-modal').classList.remove('hidden');
    document.getElementById('add-example-modal').classList.add('flex');
}

function hideAddExampleModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('add-example-modal').classList.add('hidden');
    document.getElementById('add-example-modal').classList.remove('flex');
}

async function saveNewExample() {
    const intent = document.getElementById('modal-intent').value;
    const text = document.getElementById('modal-example-text').value.trim();

    if (!text) {
        showToast('Please enter example text', true);
        return;
    }

    try {
        const res = await fetch(`${ADMIN_API}/studio/nlu/example`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intent, text })
        });

        const data = await res.json();

        if (data.success) {
            showToast('Example added successfully!', false);
            hideAddExampleModal();
            await loadNLUData();
            if (selectedIntent === intent) {
                selectNLUIntent(intent);
            }
        } else {
            showToast(data.error || 'Failed to add example', true);
        }
    } catch (e) {
        showToast('Failed to add example: ' + e.message, true);
    }
}

async function deleteNLUExample(intent, text) {
    if (!confirm('Delete this example?')) return;

    try {
        const res = await fetch(`${ADMIN_API}/studio/nlu/example`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intent, text })
        });

        const data = await res.json();

        if (data.success) {
            showToast('Example deleted', false);
            await loadNLUData();
            if (selectedIntent === intent) {
                selectNLUIntent(intent);
            }
        } else {
            showToast(data.error || 'Failed to delete', true);
        }
    } catch (e) {
        showToast('Failed to delete: ' + e.message, true);
    }
}

// ============================================================================
// Flows Tab (Stories & Rules)
// ============================================================================

async function loadFlowsData() {
    try {
        const res = await fetch(`${ADMIN_API}/studio/flows`);
        const data = await res.json();

        if (data.success) {
            studioFlowsData = data.flows || [];

            const stories = studioFlowsData.filter(f => f.type === 'story');
            const rules = studioFlowsData.filter(f => f.type === 'rule');

            renderFlowsList('story', stories, 'flow-stories-list');
            renderFlowsList('rule', rules, 'flow-rules-list');

            document.getElementById('flow-story-count').textContent = stories.length;
            document.getElementById('flow-rule-count').textContent = rules.length;
            document.getElementById('summary-stories').textContent = stories.length;
            document.getElementById('summary-rules').textContent = rules.length;
        }
    } catch (e) {
        console.error('Failed to load flows:', e);
    }
}

function renderFlowsList(type, flows, containerId) {
    const container = document.getElementById(containerId);

    if (!flows || flows.length === 0) {
        container.innerHTML = `<div class="text-gray-400 text-sm">No ${type}s found</div>`;
        return;
    }

    const html = flows.map(flow => `
        <div onclick="visualizeFlow('${escapeForJs(flow.name)}', '${type}')" 
             class="p-3 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 cursor-pointer transition-all">
            <div class="font-medium text-sm">${flow.name}</div>
            <div class="text-xs text-gray-500 mt-1">${flow.steps.length} steps</div>
        </div>
    `).join('');

    container.innerHTML = html;
}

function visualizeFlow(name, type) {
    const flow = studioFlowsData.find(f => f.name === name && f.type === type);
    if (!flow) return;

    document.getElementById('flow-selected-name').textContent = name;

    const container = document.getElementById('flow-visualizer');
    const steps = flow.steps || [];

    if (steps.length === 0) {
        container.innerHTML = '<div class="text-gray-400">No steps in this flow</div>';
        return;
    }

    const html = steps.map((step, i) => {
        let stepHtml = '';
        let bgColor = 'bg-gray-100';
        let icon = '❓';

        switch (step.type) {
            case 'intent':
                bgColor = 'bg-green-100 text-green-700';
                icon = '🎯';
                stepHtml = `<span class="font-mono">${step.name}</span>`;
                break;
            case 'action':
                bgColor = 'bg-orange-100 text-orange-700';
                icon = '⚡';
                stepHtml = `<span class="font-mono">${step.name}</span>`;
                break;
            case 'slot':
                bgColor = 'bg-purple-100 text-purple-700';
                icon = '🗂️';
                stepHtml = `<span class="font-mono">${step.name}=${JSON.stringify(step.value)}</span>`;
                break;
            case 'or':
                bgColor = 'bg-blue-100 text-blue-700';
                icon = '🔀';
                stepHtml = 'OR branch';
                break;
            case 'checkpoint':
                bgColor = 'bg-pink-100 text-pink-700';
                icon = '📍';
                stepHtml = `<span class="font-mono">${step.name}</span>`;
                break;
        }

        return `
            <div class="flex items-center">
                <div class="p-3 rounded-lg ${bgColor} min-w-32 text-center">
                    <div class="text-lg mb-1">${icon}</div>
                    <div class="text-xs">${stepHtml}</div>
                </div>
                ${i < steps.length - 1 ? '<div class="mx-2 text-gray-400">→</div>' : ''}
            </div>
        `;
    }).join('');

    container.innerHTML = `<div class="flex flex-wrap items-center gap-2">${html}</div>`;
}

// ============================================================================
// Responses Tab
// ============================================================================

async function loadResponsesData() {
    try {
        const res = await fetch(`${ADMIN_API}/studio/responses`);
        const data = await res.json();

        if (data.success) {
            studioResponsesData = data.responses || {};
            renderResponses(studioResponsesData);
            document.getElementById('response-count').textContent = data.total || 0;
        }
    } catch (e) {
        console.error('Failed to load responses:', e);
    }
}

function renderResponses(responses) {
    const container = document.getElementById('responses-container');
    const entries = Object.entries(responses);

    if (entries.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-sm">No responses found</div>';
        return;
    }

    const html = entries.map(([name, variations]) => `
        <div class="p-3 rounded-lg border border-gray-200">
            <div class="font-mono text-sm text-purple-700 mb-2">${name}</div>
            <div class="space-y-1">
                ${variations.map(v => `
                    <div class="text-xs text-gray-600 p-2 bg-gray-50 rounded">"${escapeHtml(v)}"</div>
                `).join('')}
            </div>
        </div>
    `).join('');

    container.innerHTML = html;
}

function filterResponses(query) {
    const filtered = {};
    for (const [name, variations] of Object.entries(studioResponsesData)) {
        if (name.toLowerCase().includes(query.toLowerCase())) {
            filtered[name] = variations;
        }
    }
    renderResponses(filtered);
}

// ============================================================================
// Training Tab
// ============================================================================

async function loadModelsData() {
    try {
        const res = await fetch(`${ADMIN_API}/studio/models`);
        const data = await res.json();

        if (data.success) {
            renderModelsList(data.models || []);
        }
    } catch (e) {
        console.error('Failed to load models:', e);
    }
}

function renderModelsList(models) {
    const container = document.getElementById('models-list');

    if (!models || models.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-sm">No trained models found</div>';
        return;
    }

    const html = models.map((m, i) => `
        <div class="p-3 rounded-lg border ${i === 0 ? 'border-green-300 bg-green-50' : 'border-gray-200'}">
            <div class="flex justify-between items-start">
                <div>
                    <div class="font-mono text-sm ${i === 0 ? 'text-green-700' : 'text-gray-700'}">${m.name}</div>
                    <div class="text-xs text-gray-500 mt-1">${m.size_mb} MB • ${formatDate(m.created)}</div>
                </div>
                ${i === 0 ? '<span class="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded">Latest</span>' : ''}
            </div>
        </div>
    `).join('');

    container.innerHTML = html;
}

async function loadDataSummary() {
    // Summary is populated by loadNLUData and loadFlowsData
}

async function startTraining() {
    const btn = document.getElementById('btn-train');
    btn.disabled = true;
    btn.textContent = 'Starting...';

    document.getElementById('training-status').textContent = 'Starting training...';
    document.getElementById('training-status').className = 'text-lg font-medium text-yellow-600';
    document.getElementById('training-progress-container').classList.remove('hidden');

    try {
        const res = await fetch(`${ADMIN_API}/studio/train`, {
            method: 'POST'
        });

        const data = await res.json();

        if (data.success) {
            currentTrainingJobId = data.job_id;
            showToast('Training started!', false);
            pollTrainingStatus();
        } else {
            btn.disabled = false;
            btn.textContent = 'Start Training';
            document.getElementById('training-status').textContent = 'Failed to start: ' + data.error;
            document.getElementById('training-status').className = 'text-lg font-medium text-red-600';
        }
    } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Start Training';
        showToast('Failed to start training: ' + e.message, true);
    }
}

async function pollTrainingStatus() {
    if (!currentTrainingJobId) return;

    try {
        const res = await fetch(`${ADMIN_API}/studio/train/${currentTrainingJobId}`);
        const data = await res.json();

        if (data.success) {
            const progress = data.progress || 0;
            document.getElementById('training-progress-bar').style.width = `${progress}%`;
            document.getElementById('training-progress-text').textContent = `${progress}%`;

            if (data.output && data.output.length > 0) {
                document.getElementById('training-output').textContent = data.output.join('\n');
            }

            if (data.status === 'completed') {
                document.getElementById('training-status').textContent = '✅ Training completed!';
                document.getElementById('training-status').className = 'text-lg font-medium text-green-600';
                document.getElementById('btn-train').disabled = false;
                document.getElementById('btn-train').textContent = 'Start Training';
                showToast('Model trained successfully: ' + (data.model || 'new model'), false);
                loadModelsData();
                currentTrainingJobId = null;
            } else if (data.status === 'failed') {
                document.getElementById('training-status').textContent = '❌ Training failed: ' + (data.error || 'Unknown error');
                document.getElementById('training-status').className = 'text-lg font-medium text-red-600';
                document.getElementById('btn-train').disabled = false;
                document.getElementById('btn-train').textContent = 'Start Training';
                currentTrainingJobId = null;
            } else {
                document.getElementById('training-status').textContent = `🔄 ${data.status}...`;
                document.getElementById('training-status').className = 'text-lg font-medium text-blue-600';
                setTimeout(pollTrainingStatus, 3000);  // Poll every 3 seconds
            }
        }
    } catch (e) {
        console.error('Poll error:', e);
        setTimeout(pollTrainingStatus, 5000);  // Retry after 5 seconds
    }
}

// ============================================================================
// Tab Navigation
// ============================================================================

function showStudioTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.studio-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.studio-tab').forEach(el => {
        el.classList.remove('border-purple-600', 'text-purple-600');
        el.classList.add('border-transparent', 'text-gray-500');
    });

    // Show selected tab
    const tabContent = document.getElementById(`studio-tab-${tabName}`);
    const tabButton = document.querySelector(`.studio-tab[data-tab="${tabName}"]`);

    if (tabContent) tabContent.classList.remove('hidden');
    if (tabButton) {
        tabButton.classList.add('border-purple-600', 'text-purple-600');
        tabButton.classList.remove('border-transparent', 'text-gray-500');
    }
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function escapeForJs(text) {
    return (text || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}
