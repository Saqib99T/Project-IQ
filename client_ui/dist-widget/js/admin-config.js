// Configuration Logic

async function loadConfig() {
    try {
        const res = await fetch(`${ADMIN_API}/admin/config`);
        const data = await res.json();
        if (data.success) {
            Object.entries(data.config).forEach(([key, value]) => {
                const input = document.getElementById(`cfg-${key}`);
                if (input) input.value = value || '';
            });
        }
    } catch (e) {
        console.error('Failed to load config:', e);
    }
}

async function saveConfig() {
    const config = {};
    document.querySelectorAll('[id^="cfg-"]').forEach(input => {
        const key = input.id.replace('cfg-', '');
        config[key] = input.value;
    });

    try {
        const res = await fetch(`${ADMIN_API}/admin/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        const data = await res.json();
        showToast(data.success ? 'Configuration saved!' : 'Error saving config', !data.success);
    } catch (e) {
        showToast('Failed to save configuration', true);
    }
}
