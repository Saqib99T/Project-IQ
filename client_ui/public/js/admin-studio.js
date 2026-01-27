
// Rasa Studio Logic - Monaco Editor & File Management

// State
let studioState = {
    currentFile: null,
    isDirty: false,
    editor: null,
    files: [],
    trainingInterval: null
};

// Initialize
async function loadStudio() {
    console.log('Loading Studio...');

    // Initialize Monaco if not already done
    if (!studioState.editor && window.monaco) {
        initMonaco();
    } else if (!window.monaco) {
        // Wait for loader
        require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.36.1/min/vs' } });
        require(['vs/editor/editor.main'], function () {
            initMonaco();
        });
    }

    await loadFileList();
    await loadStats();
    checkTrainingStatus();
}

async function loadStats() {
    try {
        const res = await fetch(`${ADMIN_API}/studio/stats`);
        const data = await res.json();

        if (data.success) {
            const stats = data.data;
            const setStat = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            };

            setStat('stat-intents', stats.intents || 0);
            setStat('stat-stories', stats.stories || 0);
            setStat('stat-rules', stats.rules || 0);
        }
    } catch (e) {
        console.error('Failed to load stats:', e);
    }
}

function initMonaco() {
    const container = document.getElementById('monaco-container');
    container.innerHTML = ''; // Clear placeholder

    studioState.editor = monaco.editor.create(container, {
        value: '# Select a file to start editing',
        language: 'yaml',
        theme: 'vs-light',
        automaticLayout: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace"
    });

    // Track changes
    studioState.editor.onDidChangeModelContent(() => {
        if (studioState.currentFile && !studioState.isDirty) {
            setDirty(true);
        }
    });

    // Ctrl+S to save
    studioState.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (studioState.currentFile) saveCurrentFile();
    });
}

// File Management
async function loadFileList() {
    try {
        const res = await fetch(`${ADMIN_API}/studio/files`);
        const data = await res.json();

        if (data.success) {
            studioState.files = data.files;
            renderFileList();
        }
    } catch (e) {
        console.error('Failed to load files:', e);
        document.getElementById('studio-file-list').innerHTML = '<div class="text-red-500 text-center p-4">Failed to load files</div>';
    }
}

function renderFileList() {
    const container = document.getElementById('studio-file-list');
    if (!container) return;

    // Icons
    const icons = {
        folder: `<svg class="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>`,
        file: `<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>`,
        config: `<svg class="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
        domain: `<svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>`
    };

    let html = '';

    // Group files by logic (Root vs Data)
    const rootFiles = studioState.files.filter(f => !f.name.includes('/'));
    const dataFiles = studioState.files.filter(f => f.name.includes('/'));

    const renderFileItem = (file, iconType = 'file', indent = false) => {
        const isSelected = studioState.currentFile === file.name;
        const activeClass = isSelected ? 'bg-blue-50 text-blue-700 border-blue-200' : 'hover:bg-gray-50 border-transparent text-gray-700';
        const pl = indent ? 'pl-8' : 'px-3';

        let icon = icons.file;
        if (iconType === 'config') icon = icons.config;
        if (iconType === 'domain') icon = icons.domain;

        return `
            <div onclick="openFile('${file.name}')" 
                class="flex items-center gap-2 ${pl} py-2 rounded-lg border cursor-pointer transition-all text-sm mb-1 ${activeClass}">
                ${icon}
                <div class="flex-1 truncate font-medium">${file.name.split('/').pop()}</div>
                ${isSelected ? '<span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>' : ''}
            </div>
        `;
    };

    // Render Root Files
    if (rootFiles.length > 0) {
        rootFiles.forEach(f => {
            let type = 'file';
            if (f.name.includes('config') || f.name.includes('credentials') || f.name.includes('endpoints')) type = 'config';
            if (f.name.includes('domain')) type = 'domain';
            html += renderFileItem(f, type);
        });
    }

    // Render Data Folder
    if (dataFiles.length > 0) {
        html += `
            <div class="mt-4 mb-1 px-3 flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                ${icons.folder}
                <span>Data</span>
            </div>
            <div class="space-y-0.5">
        `;
        dataFiles.forEach(f => html += renderFileItem(f, 'file', true));
        html += `</div>`;
    }

    container.innerHTML = html;
}

async function openFile(filename) {
    if (studioState.isDirty) {
        if (!confirm('You have unsaved changes. Discard them?')) return;
    }

    try {
        const res = await fetch(`${ADMIN_API}/studio/file?file=${encodeURIComponent(filename)}`);
        const data = await res.json();

        if (data.success) {
            studioState.currentFile = filename;
            setDirty(false);

            // Set Editor Content
            if (studioState.editor) {
                studioState.editor.setValue(data.content);
                // Scroll to top
                studioState.editor.setScrollTop(0);
            }

            // GUI Update
            document.getElementById('current-filename').textContent = filename;
            document.getElementById('btn-save').disabled = false;
            document.getElementById('btn-history').disabled = false;

            // Re-render list to show active state
            renderFileList();
        }
    } catch (e) {
        showToast('Failed to open file', 'error');
    }
}

async function saveCurrentFile() {
    if (!studioState.currentFile || !studioState.editor) return;

    const content = studioState.editor.getValue();
    const btn = document.getElementById('btn-save');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
        const res = await fetch(`${ADMIN_API}/studio/file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file: studioState.currentFile,
                content: content
            })
        });
        const data = await res.json();

        if (data.success) {
            setDirty(false);
            showToast('File saved successfully');
        } else {
            showToast('Save failed: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Save failed: Network error', 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function setDirty(isDirty) {
    studioState.isDirty = isDirty;
    const indicator = document.getElementById('file-unsaved-indicator');
    if (indicator) {
        indicator.classList.toggle('hidden', !isDirty);
    }
}

// Training Logic
async function triggerTraining() {
    const btn = document.getElementById('btn-train');
    if (btn.classList.contains('opacity-50')) return; // Already training

    if (studioState.isDirty) {
        alert('Please save your changes before training.');
        return;
    }

    if (!confirm('Start model training? This may take several minutes.')) return;

    try {
        const res = await fetch(`${ADMIN_API}/studio/train`, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            showToast('Training started');
            openConsole();
            pollTrainingStatus();
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {
        showToast('Failed to start training', 'error');
    }
}

function pollTrainingStatus() {
    if (studioState.trainingInterval) clearInterval(studioState.trainingInterval);

    studioState.trainingInterval = setInterval(async () => {
        try {
            const res = await fetch(`${ADMIN_API}/studio/train/status`);
            const data = await res.json();

            if (data.success) {
                const logs = document.getElementById('training-logs');
                if (logs) logs.textContent = data.status.logs || "Waiting for logs...";

                // Auto-scroll
                logs.scrollTop = logs.scrollHeight;

                updateTrainingUI(data.status.is_training);

                if (!data.status.is_training) {
                    clearInterval(studioState.trainingInterval);
                }
            }
        } catch (e) {
            console.error('Poll error', e);
        }
    }, 2000);
}

function checkTrainingStatus() {
    fetch(`${ADMIN_API}/studio/train/status`)
        .then(r => r.json())
        .then(data => {
            if (data.success && data.status.is_training) {
                pollTrainingStatus();
            }
        });
}

function updateTrainingUI(isTraining) {
    const btn = document.getElementById('btn-train');
    const badge = document.getElementById('train-status-badge');
    const badgeDot = badge.querySelector('span');

    if (isTraining) {
        // Training State
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            Training...
        `;

        badge.classList.remove('hidden');
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span> Training in progress';

    } else {
        // Idle State
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        btn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
            Train Model
        `;

        // Check logs for success/fail to color the badge
        const logs = document.getElementById('training-logs').textContent;
        if (logs.includes('success')) {
            badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-500"></span> Ready';
        } else if (logs.includes('failed')) {
            badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span> Last Training Failed';
        } else {
            badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-gray-400"></span> Idle';
        }
        badge.classList.remove('hidden');
    }
}

// Console UI
function toggleConsole() {
    const console = document.getElementById('training-console');
    if (console.style.height === '0px' || console.style.height === '') {
        console.style.height = '200px';
    } else {
        console.style.height = '0px';
    }
}

function openConsole() {
    const console = document.getElementById('training-console');
    console.style.height = '200px';
}


function showHistory() {
    if (!studioState.currentFile) return;

    const modal = document.getElementById('history-modal');
    const title = document.getElementById('history-filename');
    const container = document.getElementById('history-list');

    modal.classList.remove('hidden');
    title.textContent = studioState.currentFile;
    container.innerHTML = '<div class="text-center py-8 text-gray-400">Loading history...</div>';

    fetch(`${ADMIN_API}/studio/history?file=${encodeURIComponent(studioState.currentFile)}`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                renderHistoryList(data.history);
            } else {
                container.innerHTML = `<div class="text-red-500 text-center p-4">${data.error}</div>`;
            }
        })
        .catch(e => {
            container.innerHTML = `<div class="text-red-500 text-center p-4">Failed to load history</div>`;
        });
}

function closeHistory() {
    document.getElementById('history-modal').classList.add('hidden');
}

function renderHistoryList(history) {
    const container = document.getElementById('history-list');

    if (!history || history.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-400">No backup history found for this file.</div>';
        return;
    }

    container.innerHTML = history.map(item => `
        <div class="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex justify-between items-center hover:border-blue-300 transition-colors">
            <div>
                <p class="font-bold text-gray-700 text-sm">
                    ${formatDate(item.timestamp)}
                </p>
                <p class="text-xs text-gray-400 mt-1">
                    Size: ${formatBytes(item.size)}
                </p>
            </div>
            <button onclick="restoreBackup('${item.filename}')" 
                class="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded text-gray-700 hover:bg-gray-50 hover:text-blue-600 transition-colors">
                Restore
            </button>
        </div>
    `).join('');
}

async function restoreBackup(backupFile) {
    if (!confirm('Are you sure you want to restore this version? Current changes will be overwritten.')) return;

    try {
        const res = await fetch(`${ADMIN_API}/studio/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file: studioState.currentFile,
                backup: backupFile
            })
        });

        const data = await res.json();

        if (data.success) {
            showToast('File restored successfully');
            closeHistory();
            // Reload file content in editor
            openFile(studioState.currentFile);
        } else {
            showToast('Restore failed: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Restore failed: Network error', 'error');
    }
}

function formatDate(timestampStr) {
    // timestampStr is YYYYMMDD_HHMMSS
    if (!timestampStr) return 'Unknown Date';
    // Simple parsing
    const Y = timestampStr.substring(0, 4);
    const M = timestampStr.substring(4, 6);
    const D = timestampStr.substring(6, 8);
    const h = timestampStr.substring(9, 11);
    const m = timestampStr.substring(11, 13);
    const s = timestampStr.substring(13, 15);
    return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
