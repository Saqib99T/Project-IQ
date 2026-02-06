// Themes Logic

let currentThemeId = null;

async function loadThemes() {
    try {
        const res = await fetch(`${ADMIN_API}/themes`);
        const data = await res.json();
        if (data.success) {
            const selector = document.getElementById('theme-selector');
            const intTheme = document.getElementById('int-theme-id');

            // Populate theme-selector if it exists (Themes page)
            if (selector) {
                selector.innerHTML = '<option value="new">+ New Theme</option>';
                data.themes.forEach(theme => {
                    selector.innerHTML += `<option value="${theme.id}">${theme.name}${theme.is_default ? ' ★' : ''}</option>`;
                });
            }

            // Populate int-theme-id if it exists (Integration page)
            if (intTheme) {
                intTheme.innerHTML = '<option value="">Default (Black)</option>';
                data.themes.forEach(theme => {
                    intTheme.innerHTML += `<option value="${theme.id}">${theme.name}</option>`;
                });
            }
        }
    } catch (e) {
        console.error('Failed to load themes:', e);
    }
}

async function loadTheme(themeId) {
    if (themeId === 'new') {
        currentThemeId = null;
        document.getElementById('theme-name').value = '';
        document.getElementById('theme-primary-color').value = '#6366f1';
        document.getElementById('theme-primary-color-text').value = '#6366f1';
        document.getElementById('theme-secondary-color').value = '#8b5cf6';
        document.getElementById('theme-secondary-color-text').value = '#8b5cf6';
        document.getElementById('theme-bg-color').value = '#ffffff';
        document.getElementById('theme-bg-color-text').value = '#ffffff';
        document.getElementById('theme-text-color').value = '#1f2937';
        document.getElementById('theme-text-color-text').value = '#1f2937';
        document.getElementById('theme-font').value = 'Inter';
        document.getElementById('theme-radius').value = '12';
        document.getElementById('theme-bot-icon').value = '🤖';
        document.getElementById('theme-bot-color').value = '#6366f1';
        document.getElementById('theme-bot-color-text').value = '#6366f1';
        document.getElementById('theme-user-icon').value = '👤';
        document.getElementById('theme-user-color').value = '#6366f1';
        document.getElementById('theme-user-color-text').value = '#6366f1';
        document.getElementById('theme-send-icon').value = '➤';
        document.getElementById('theme-send-color').value = '#6366f1';
        document.getElementById('theme-send-color-text').value = '#6366f1';
        document.getElementById('theme-attach-icon').value = '📎';
        document.getElementById('theme-header-size').value = '16';
        document.getElementById('theme-message-size').value = '14';
        document.getElementById('theme-button-size').value = '13';
        document.getElementById('theme-input-size').value = '14';
        document.getElementById('theme-default').checked = false;
        updatePreview();
        return;
    }

    try {
        const res = await fetch(`${ADMIN_API}/themes/${themeId}`);
        const data = await res.json();
        if (data.success && data.theme) {
            currentThemeId = themeId;
            const theme = data.theme;
            const settings = theme.settings || {};
            const primaryColor = settings.primaryColor || '#6366f1';

            document.getElementById('theme-name').value = theme.name;
            document.getElementById('theme-primary-color').value = primaryColor;
            document.getElementById('theme-primary-color-text').value = primaryColor;
            document.getElementById('theme-secondary-color').value = settings.secondaryColor || '#8b5cf6';
            document.getElementById('theme-secondary-color-text').value = settings.secondaryColor || '#8b5cf6';
            document.getElementById('theme-bg-color').value = settings.bgColor || '#ffffff';
            document.getElementById('theme-bg-color-text').value = settings.bgColor || '#ffffff';
            document.getElementById('theme-text-color').value = settings.textColor || '#1f2937';
            document.getElementById('theme-text-color-text').value = settings.textColor || '#1f2937';
            document.getElementById('theme-font').value = settings.fontFamily || 'Inter';
            document.getElementById('theme-radius').value = settings.borderRadius || '12';
            document.getElementById('theme-bot-icon').value = settings.botIcon || '🤖';
            document.getElementById('theme-bot-color').value = settings.botIconColor || primaryColor;
            document.getElementById('theme-bot-color-text').value = settings.botIconColor || primaryColor;
            document.getElementById('theme-user-icon').value = settings.userIcon || '👤';
            document.getElementById('theme-user-color').value = settings.userIconColor || primaryColor;
            document.getElementById('theme-user-color-text').value = settings.userIconColor || primaryColor;
            document.getElementById('theme-send-icon').value = settings.sendIcon || '➤';
            document.getElementById('theme-send-color').value = settings.sendIconColor || primaryColor;
            document.getElementById('theme-send-color-text').value = settings.sendIconColor || primaryColor;
            document.getElementById('theme-attach-icon').value = settings.attachIcon || '📎';
            document.getElementById('theme-delete-icon').value = settings.deleteIcon || '🗑️';
            document.getElementById('theme-collapse-icon').value = settings.collapseIcon || '➖';
            document.getElementById('theme-header-size').value = settings.headerFontSize || '16';
            document.getElementById('theme-message-size').value = settings.messageFontSize || '14';
            document.getElementById('theme-button-size').value = settings.buttonFontSize || '13';
            document.getElementById('theme-input-size').value = settings.inputFontSize || '14';
            document.getElementById('theme-default').checked = theme.is_default === 1;

            updatePreview();
        }
    } catch (e) {
        showToast('Failed to load theme', true);
    }
}

async function saveTheme() {
    const name = document.getElementById('theme-name').value || 'Untitled Theme';
    const settings = {
        primaryColor: document.getElementById('theme-primary-color').value,
        secondaryColor: document.getElementById('theme-secondary-color').value,
        bgColor: document.getElementById('theme-bg-color').value,
        textColor: document.getElementById('theme-text-color').value,
        fontFamily: document.getElementById('theme-font').value,
        borderRadius: document.getElementById('theme-radius').value,
        botIcon: document.getElementById('theme-bot-icon').value,
        botIconColor: document.getElementById('theme-bot-color').value,
        userIcon: document.getElementById('theme-user-icon').value,
        userIconColor: document.getElementById('theme-user-color').value,
        sendIcon: document.getElementById('theme-send-icon').value,
        sendIconColor: document.getElementById('theme-send-color').value,
        attachIcon: document.getElementById('theme-attach-icon').value,
        deleteIcon: document.getElementById('theme-delete-icon').value,
        collapseIcon: document.getElementById('theme-collapse-icon').value,
        headerFontSize: document.getElementById('theme-header-size').value,
        messageFontSize: document.getElementById('theme-message-size').value,
        buttonFontSize: document.getElementById('theme-button-size').value,
        inputFontSize: document.getElementById('theme-input-size').value
    };
    const isDefault = document.getElementById('theme-default').checked;

    try {
        const url = currentThemeId
            ? `${ADMIN_API}/themes/${currentThemeId}`
            : `${ADMIN_API}/themes`;
        const method = currentThemeId ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, settings, is_default: isDefault })
        });
        const data = await res.json();

        if (data.success) {
            if (data.theme_id) currentThemeId = data.theme_id;
            showToast('Theme saved!');
            loadThemes();
        } else {
            showToast('Error saving theme', true);
        }
    } catch (e) {
        showToast('Failed to save theme', true);
    }
}

async function deleteCurrentTheme() {
    if (!currentThemeId) return showToast('Select a theme first', true);
    if (!confirm('Delete this theme?')) return;

    try {
        await fetch(`${ADMIN_API}/themes/${currentThemeId}`, { method: 'DELETE' });
        currentThemeId = null;
        document.getElementById('theme-selector').value = 'new';
        loadTheme('new');
        loadThemes();
        showToast('Theme deleted');
    } catch (e) {
        showToast('Failed to delete theme', true);
    }
}

function syncColor(type) {
    const textInput = document.getElementById(`theme-${type}-color-text`);
    const colorInput = document.getElementById(`theme-${type}-color`);
    // Sync text input with color picker value
    textInput.value = colorInput.value;

    // Auto-sync Bot, Button, and Send icon colors when primary color changes
    if (type === 'primary') {
        const primaryColor = colorInput.value;
        document.getElementById('theme-bot-color').value = primaryColor;
        document.getElementById('theme-bot-color-text').value = primaryColor;
        document.getElementById('theme-user-color').value = primaryColor;
        document.getElementById('theme-user-color-text').value = primaryColor;
        document.getElementById('theme-send-color').value = primaryColor;
        document.getElementById('theme-send-color-text').value = primaryColor;
    }
    updatePreview();
}

function syncIconColor(type) {
    const textInput = document.getElementById(`theme-${type}-color-text`);
    const colorInput = document.getElementById(`theme-${type}-color`);
    colorInput.value = textInput.value;
    updatePreview();
}

function syncColorText(type) {
    const textInput = document.getElementById(`theme-${type}-color-text`);
    const colorInput = document.getElementById(`theme-${type}-color`);
    // Sync color picker with text input value
    colorInput.value = textInput.value;

    // Auto-sync Bot, Button, and Send icon colors when primary color changes
    if (type === 'primary') {
        const primaryColor = textInput.value;
        document.getElementById('theme-bot-color').value = primaryColor;
        document.getElementById('theme-bot-color-text').value = primaryColor;
        document.getElementById('theme-user-color').value = primaryColor;
        document.getElementById('theme-user-color-text').value = primaryColor;
        document.getElementById('theme-send-color').value = primaryColor;
        document.getElementById('theme-send-color-text').value = primaryColor;
    }
    updatePreview();
}

function updatePreview() {
    const primary = document.getElementById('theme-primary-color').value;
    const secondary = document.getElementById('theme-secondary-color').value;
    const fontFamily = document.getElementById('theme-font').value;
    const borderRadius = document.getElementById('theme-radius').value;
    const botIcon = document.getElementById('theme-bot-icon').value;
    const botColor = document.getElementById('theme-bot-color').value;
    const userColor = document.getElementById('theme-user-color').value;
    const sendColor = document.getElementById('theme-send-color').value;
    const headerSize = document.getElementById('theme-header-size').value;
    const messageSize = document.getElementById('theme-message-size').value;
    const inputSize = document.getElementById('theme-input-size').value;

    // Apply to preview container
    const previewContainer = document.getElementById('preview-container');
    if (previewContainer) {
        previewContainer.style.fontFamily = fontFamily + ', sans-serif';
        previewContainer.style.borderRadius = borderRadius + 'px';
    }

    document.getElementById('preview-header').style.background = `linear-gradient(135deg, ${primary}, ${secondary})`;
    document.getElementById('preview-header').style.fontSize = `${headerSize}px`;
    document.getElementById('preview-avatar').style.background = botColor;
    document.getElementById('preview-avatar').innerHTML = botIcon;
    document.getElementById('preview-user-msg').style.background = userColor;
    document.getElementById('preview-user-msg').style.fontSize = `${messageSize}px`;
    document.getElementById('preview-send-btn').style.background = sendColor;
    const botMsg = document.querySelector('#theme-preview .bg-white.p-3');
    if (botMsg) botMsg.style.fontSize = `${messageSize}px`;
    const previewInput = document.querySelector('#theme-preview input[type="text"]');
    if (previewInput) previewInput.style.fontSize = `${inputSize}px`;
}
