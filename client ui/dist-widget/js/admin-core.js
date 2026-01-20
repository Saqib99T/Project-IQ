const ADMIN_API = '';

// Dynamic Component Loader
async function loadComponent(sectionId) {
    const container = document.getElementById(`section-${sectionId}`);
    if (container && container.innerHTML.trim() === '') {
        try {
            const res = await fetch(`components/${sectionId}.html`);
            if (res.ok) {
                const html = await res.text();
                container.innerHTML = html;
                return true;
            }
        } catch (e) {
            console.error(`Failed to load component: ${sectionId}`, e);
            showToast(`Error loading ${sectionId} component`, true);
        }
    }
    return false;
}

// Section Navigation
async function showSection(section) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));

    // Update sidebar navigation
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.section === section) item.classList.add('active');
    });

    // Ensure component is loaded
    await loadComponent(section);

    // Show the selected section
    const sectionElement = document.getElementById(`section-${section}`);
    if (sectionElement) sectionElement.classList.remove('hidden');

    // Section-specific initialization
    if (section === 'analytics' && window.loadAnalytics) {
        if (!window.analyticsLoaded) {
            // Initial load
            await loadAppList();
            window.analyticsLoaded = true;
        }
        loadAnalytics();
    }
    else if (section === 'configuration' && window.loadConfig) {
        loadConfig();
    }
    else if (section === 'themes' && window.loadThemes) {
        loadThemes();
        // Re-attach event listeners for color inputs if needed
        // (But themes.html content is static once loaded, so inline onchange might work or need re-attachment)
        // Since we use onchange="..." attrs in HTML, they should work immediately after injection.
        // However, the DOMContentLoaded listener in admin-themes.js won't fire for dynamically loaded content.
        // We might need to manually trigger setup if needed.
    }
    else if (section === 'inspector' && window.loadInspectorConversations) {
        loadInspectorConversations();
    }
}

// Toast Notification
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = message;
    toast.className = `fixed bottom-4 right-4 ${isError ? 'bg-red-600' : 'bg-gray-800'} text-white px-6 py-3 rounded-lg shadow-lg transform translate-y-0 opacity-100 transition-all duration-300 z-50`;

    setTimeout(() => {
        toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg transform translate-y-20 opacity-0 transition-all duration-300 z-50';
    }, 3000);
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Default to analytics
    await showSection('analytics');
});
