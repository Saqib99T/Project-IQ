// Firecrawl Web Crawling Admin Logic

// =====================
// Initialization
// =====================

async function loadFirecrawl() {
    await loadFirecrawlConfig();
    await testFirecrawlConnection();
}

// =====================
// Tab Switching
// =====================

function switchFcTab(tab) {
    // Update tab button styles
    document.querySelectorAll('.fc-tab').forEach(btn => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('border-blue-600', isActive);
        btn.classList.toggle('text-blue-600', isActive);
        btn.classList.toggle('border-transparent', !isActive);
        btn.classList.toggle('text-gray-500', !isActive);
    });

    // Show/hide panels
    document.querySelectorAll('.fc-tab-panel').forEach(panel => {
        panel.classList.add('hidden');
    });
    const target = document.getElementById(`fc-tab-${tab}`);
    if (target) target.classList.remove('hidden');

    // Load history when switching to that tab
    if (tab === 'history') {
        loadFirecrawlHistory();
    }
}

// =====================
// Configuration
// =====================

async function loadFirecrawlConfig() {
    try {
        const res = await fetch(`${ADMIN_API}/firecrawl/config`);
        const data = await res.json();
        if (data.success) {
            const urlEl = document.getElementById('fc-cfg-api-url');
            const keyEl = document.getElementById('fc-cfg-api-key');
            if (urlEl) urlEl.value = data.api_url || 'http://localhost:3002';
            if (keyEl) keyEl.value = data.api_key || 'fc-selfhosted';
        }
    } catch (e) {
        console.error('Failed to load Firecrawl config:', e);
    }
}

async function saveFirecrawlConfig() {
    const apiUrl = document.getElementById('fc-cfg-api-url')?.value?.trim();
    const apiKey = document.getElementById('fc-cfg-api-key')?.value?.trim();
    const resultEl = document.getElementById('fc-config-result');

    if (!apiUrl) {
        if (resultEl) resultEl.innerHTML = '<span class="text-red-600">API URL is required</span>';
        return;
    }

    try {
        const res = await fetch(`${ADMIN_API}/firecrawl/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_url: apiUrl, api_key: apiKey || 'fc-selfhosted' })
        });
        const data = await res.json();
        if (data.success) {
            if (resultEl) resultEl.innerHTML = '<span class="text-green-600">✓ Saved successfully</span>';
            showNotification('Firecrawl configuration saved', 'success');
        } else {
            if (resultEl) resultEl.innerHTML = `<span class="text-red-600">Error: ${data.error}</span>`;
        }
    } catch (e) {
        if (resultEl) resultEl.innerHTML = '<span class="text-red-600">Save failed</span>';
    }
}

async function testFirecrawlConnection() {
    const apiUrl = document.getElementById('fc-cfg-api-url')?.value?.trim();
    const apiKey = document.getElementById('fc-cfg-api-key')?.value?.trim();
    const badge = document.getElementById('fc-status-badge');
    const dot = document.getElementById('fc-status-dot');
    const text = document.getElementById('fc-status-text');
    const resultEl = document.getElementById('fc-config-result');

    if (badge) {
        badge.classList.remove('hidden');
        badge.classList.add('flex');
        badge.className = badge.className.replace(/bg-\w+-\d+/g, '').replace(/text-\w+-\d+/g, '');
        badge.classList.add('bg-gray-100', 'text-gray-600');
    }
    if (dot) { dot.className = 'w-2 h-2 rounded-full bg-gray-400'; }
    if (text) text.textContent = 'Checking...';

    try {
        const body = {};
        if (apiUrl) body.api_url = apiUrl;
        if (apiKey) body.api_key = apiKey;

        const res = await fetch(`${ADMIN_API}/firecrawl/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (badge && dot && text) {
            badge.classList.remove('hidden');
            badge.classList.add('flex');

            if (data.success) {
                badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-green-100 text-green-700';
                dot.className = 'w-2 h-2 rounded-full bg-green-500';
                text.textContent = 'Connected';
                if (resultEl) resultEl.innerHTML = '<span class="text-green-600">✓ Firecrawl is running</span>';
            } else {
                badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-red-100 text-red-700';
                dot.className = 'w-2 h-2 rounded-full bg-red-500';
                text.textContent = 'Offline';
                if (resultEl) resultEl.innerHTML = `<span class="text-red-600">${data.message || 'Not reachable'}</span>`;
            }
        }
    } catch (e) {
        if (badge && dot && text) {
            badge.classList.remove('hidden');
            badge.classList.add('flex');
            badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-red-100 text-red-700';
            dot.className = 'w-2 h-2 rounded-full bg-red-500';
            text.textContent = 'Error';
        }
    }
}

// =====================
// Scrape Single URL
// =====================

async function runScrapeUrl() {
    const url = document.getElementById('fc-scrape-url')?.value?.trim();
    const category = document.getElementById('fc-scrape-category')?.value?.trim();
    const resultDiv = document.getElementById('fc-scrape-result');
    const btn = document.getElementById('btn-fc-scrape');
    const spinner = document.getElementById('fc-scrape-spinner');

    if (!url) {
        showNotification('Please enter a URL', 'warning');
        return;
    }

    setFcLoading(btn, spinner, true);
    if (resultDiv) { resultDiv.classList.remove('hidden'); resultDiv.innerHTML = renderFcLoading('Scraping page...'); }

    try {
        const res = await fetch(`${ADMIN_API}/kb/ingest-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, category: category || null })
        });
        const data = await res.json();

        if (resultDiv) {
            if (data.success) {
                resultDiv.innerHTML = renderScrapeSuccess(data);
                showNotification('Page scraped and saved to KB!', 'success');
            } else {
                resultDiv.innerHTML = renderFcError(data.error || 'Scrape failed');
                showNotification('Scrape failed: ' + (data.error || 'Unknown error'), 'error');
            }
        }
    } catch (e) {
        if (resultDiv) resultDiv.innerHTML = renderFcError(e.message);
        showNotification('Scrape error: ' + e.message, 'error');
    } finally {
        setFcLoading(btn, spinner, false);
    }
}

function renderScrapeSuccess(data) {
    return `
        <div class="space-y-4">
            <div class="flex items-center gap-2 text-green-700">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <span class="font-semibold">Successfully scraped and saved!</span>
            </div>
            <div class="bg-green-50 rounded-lg p-4 space-y-2">
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div>
                        <span class="text-gray-500">Title:</span>
                        <span class="ml-2 font-medium text-gray-800">${escapeHtml(data.title || '--')}</span>
                    </div>
                    <div>
                        <span class="text-gray-500">Category:</span>
                        <span class="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">${escapeHtml(data.category || '--')}</span>
                    </div>
                    <div>
                        <span class="text-gray-500">Article ID:</span>
                        <span class="ml-2 font-mono text-xs text-gray-600">${escapeHtml(data.article_id || '--')}</span>
                    </div>
                    <div>
                        <span class="text-gray-500">Content Length:</span>
                        <span class="ml-2 font-medium text-gray-800">${(data.content_length || 0).toLocaleString()} chars</span>
                    </div>
                </div>
                <div class="pt-2 border-t border-green-200">
                    <span class="text-gray-500 text-sm">Source:</span>
                    <a href="${escapeHtml(data.source_url || '')}" target="_blank" class="ml-2 text-sm text-blue-600 hover:underline break-all">
                        ${escapeHtml(data.source_url || '--')}
                    </a>
                </div>
            </div>
        </div>
    `;
}

// =====================
// Crawl Entire Site
// =====================

async function runCrawlSite() {
    const url = document.getElementById('fc-crawl-url')?.value?.trim();
    const limit = parseInt(document.getElementById('fc-crawl-limit')?.value || '25');
    const category = document.getElementById('fc-crawl-category')?.value?.trim();
    const resultDiv = document.getElementById('fc-crawl-result');
    const btn = document.getElementById('btn-fc-crawl');
    const spinner = document.getElementById('fc-crawl-spinner');

    if (!url) {
        showNotification('Please enter a URL', 'warning');
        return;
    }

    setFcLoading(btn, spinner, true);
    if (resultDiv) { resultDiv.classList.remove('hidden'); resultDiv.innerHTML = renderFcLoading(`Crawling site (up to ${limit} pages)... This may take several minutes.`); }

    try {
        const res = await fetch(`${ADMIN_API}/kb/crawl-site`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, limit, category: category || null })
        });
        const data = await res.json();

        if (resultDiv) {
            if (data.success) {
                resultDiv.innerHTML = renderCrawlSuccess(data);
                showNotification(`Crawl complete! ${data.saved} pages saved to KB.`, 'success');
            } else {
                resultDiv.innerHTML = renderFcError(data.error || 'Crawl failed');
                showNotification('Crawl failed: ' + (data.error || 'Unknown error'), 'error');
            }
        }
    } catch (e) {
        if (resultDiv) resultDiv.innerHTML = renderFcError(e.message);
        showNotification('Crawl error: ' + e.message, 'error');
    } finally {
        setFcLoading(btn, spinner, false);
    }
}

function renderCrawlSuccess(data) {
    const articles = data.articles || [];
    let rows = articles.map(a => `
        <tr class="hover:bg-gray-50">
            <td class="px-4 py-2 text-sm text-gray-800 font-medium max-w-xs truncate">${escapeHtml(a.title || 'Untitled')}</td>
            <td class="px-4 py-2 text-sm text-gray-500">${(a.content_length || 0).toLocaleString()} chars</td>
            <td class="px-4 py-2 text-xs font-mono text-gray-400">${escapeHtml(a.id || '--')}</td>
        </tr>
    `).join('');

    return `
        <div class="space-y-4">
            <div class="flex items-center gap-2 text-emerald-700">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <span class="font-semibold">Crawl complete!</span>
            </div>
            <div class="grid grid-cols-3 gap-4">
                <div class="bg-emerald-50 rounded-lg p-4 text-center">
                    <p class="text-2xl font-bold text-emerald-700">${data.total_pages || 0}</p>
                    <p class="text-sm text-gray-500 mt-1">Pages Found</p>
                </div>
                <div class="bg-blue-50 rounded-lg p-4 text-center">
                    <p class="text-2xl font-bold text-blue-700">${data.saved || 0}</p>
                    <p class="text-sm text-gray-500 mt-1">Saved to KB</p>
                </div>
                <div class="bg-gray-50 rounded-lg p-4 text-center">
                    <p class="text-2xl font-bold text-gray-700">${(data.total_pages || 0) - (data.saved || 0)}</p>
                    <p class="text-sm text-gray-500 mt-1">Skipped</p>
                </div>
            </div>
            ${articles.length > 0 ? `
            <div class="border border-gray-200 rounded-lg overflow-hidden">
                <div class="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <span class="text-sm font-medium text-gray-700">Saved Articles (${articles.length})</span>
                </div>
                <div class="max-h-64 overflow-y-auto">
                    <table class="w-full">
                        <thead class="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
                            <tr>
                                <th class="px-4 py-2 text-left">Title</th>
                                <th class="px-4 py-2 text-left">Length</th>
                                <th class="px-4 py-2 text-left">ID</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">${rows}</tbody>
                    </table>
                </div>
            </div>` : ''}
        </div>
    `;
}

// =====================
// Batch Scrape
// =====================

async function runBatchScrape() {
    const rawUrls = document.getElementById('fc-batch-urls')?.value?.trim();
    const category = document.getElementById('fc-batch-category')?.value?.trim();
    const resultDiv = document.getElementById('fc-batch-result');
    const btn = document.getElementById('btn-fc-batch');
    const spinner = document.getElementById('fc-batch-spinner');

    if (!rawUrls) {
        showNotification('Please enter at least one URL', 'warning');
        return;
    }

    const urls = rawUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    if (urls.length === 0) {
        showNotification('No valid URLs found', 'warning');
        return;
    }

    setFcLoading(btn, spinner, true);
    if (resultDiv) { resultDiv.classList.remove('hidden'); resultDiv.innerHTML = renderFcLoading(`Scraping ${urls.length} URL(s)...`); }

    try {
        const res = await fetch(`${ADMIN_API}/kb/ingest-urls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls, category: category || null })
        });
        const data = await res.json();

        if (resultDiv) {
            if (data.success) {
                resultDiv.innerHTML = renderBatchSuccess(data);
                showNotification(`Batch complete! ${data.saved} / ${data.total_urls} saved to KB.`, 'success');
            } else {
                resultDiv.innerHTML = renderFcError(data.error || 'Batch scrape failed');
                showNotification('Batch failed: ' + (data.error || 'Unknown error'), 'error');
            }
        }
    } catch (e) {
        if (resultDiv) resultDiv.innerHTML = renderFcError(e.message);
        showNotification('Batch error: ' + e.message, 'error');
    } finally {
        setFcLoading(btn, spinner, false);
    }
}

function renderBatchSuccess(data) {
    const errors = data.errors || [];
    let errorRows = errors.map(e => `
        <tr class="hover:bg-red-50">
            <td class="px-4 py-2 text-sm text-red-700 break-all">${escapeHtml(e.url || '--')}</td>
            <td class="px-4 py-2 text-sm text-red-600">${escapeHtml(e.error || 'Unknown error')}</td>
        </tr>
    `).join('');

    return `
        <div class="space-y-4">
            <div class="flex items-center gap-2 text-purple-700">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <span class="font-semibold">Batch scrape complete!</span>
            </div>
            <div class="grid grid-cols-3 gap-4">
                <div class="bg-purple-50 rounded-lg p-4 text-center">
                    <p class="text-2xl font-bold text-purple-700">${data.total_urls || 0}</p>
                    <p class="text-sm text-gray-500 mt-1">Total URLs</p>
                </div>
                <div class="bg-green-50 rounded-lg p-4 text-center">
                    <p class="text-2xl font-bold text-green-700">${data.saved || 0}</p>
                    <p class="text-sm text-gray-500 mt-1">Saved to KB</p>
                </div>
                <div class="bg-red-50 rounded-lg p-4 text-center">
                    <p class="text-2xl font-bold text-red-700">${errors.length}</p>
                    <p class="text-sm text-gray-500 mt-1">Failed</p>
                </div>
            </div>
            ${errors.length > 0 ? `
            <div class="border border-red-200 rounded-lg overflow-hidden">
                <div class="px-4 py-3 bg-red-50 border-b border-red-200">
                    <span class="text-sm font-medium text-red-700">Failed URLs (${errors.length})</span>
                </div>
                <div class="max-h-48 overflow-y-auto">
                    <table class="w-full">
                        <thead class="bg-red-50 text-xs text-gray-500 uppercase sticky top-0">
                            <tr>
                                <th class="px-4 py-2 text-left">URL</th>
                                <th class="px-4 py-2 text-left">Error</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-red-100">${errorRows}</tbody>
                    </table>
                </div>
            </div>` : ''}
        </div>
    `;
}

// =====================
// History
// =====================

async function loadFirecrawlHistory() {
    const tableDiv = document.getElementById('fc-history-table');
    if (!tableDiv) return;

    tableDiv.innerHTML = '<p class="text-gray-400 text-center py-6">Loading...</p>';

    try {
        const res = await fetch(`${ADMIN_API}/firecrawl/crawl-jobs`);
        const data = await res.json();

        if (data.success && data.data && data.data.length > 0) {
            tableDiv.innerHTML = renderHistoryTable(data.data);
        } else if (data.success) {
            tableDiv.innerHTML = '<p class="text-gray-400 text-center py-6">No crawl jobs yet. Start scraping to see history here.</p>';
        } else {
            tableDiv.innerHTML = `<p class="text-red-500 text-center py-6">Error: ${data.error}</p>`;
        }
    } catch (e) {
        tableDiv.innerHTML = `<p class="text-red-500 text-center py-6">Error: ${e.message}</p>`;
    }
}

function renderHistoryTable(jobs) {
    const rows = jobs.map(job => {
        const config = typeof job.source_config === 'string' ? JSON.parse(job.source_config || '{}') : (job.source_config || {});
        const sourceUrl = config.url || config.source_url || '--';
        const typeIcon = job.source_type === 'firecrawl_crawl' ? '🕷️' : (job.source_type === 'firecrawl_scrape' ? '📄' : '📋');
        const typeLabel = (job.source_type || 'unknown').replace('firecrawl_', '').replace('_', ' ');
        const createdAt = job.created_at ? new Date(job.created_at).toLocaleString() : '--';

        return `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 text-sm">${typeIcon} <span class="capitalize font-medium text-gray-700">${typeLabel}</span></td>
                <td class="px-4 py-3 text-sm text-blue-600 max-w-xs truncate">
                    <a href="${escapeHtml(sourceUrl)}" target="_blank" class="hover:underline">${escapeHtml(sourceUrl)}</a>
                </td>
                <td class="px-4 py-3 text-sm text-center font-semibold text-gray-800">${job.articles_count || 0}</td>
                <td class="px-4 py-3 text-sm text-gray-500">${createdAt}</td>
                <td class="px-4 py-3 text-sm">
                    <span class="px-2 py-0.5 rounded text-xs font-medium ${job.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}">
                        ${escapeHtml(job.status || 'unknown')}
                    </span>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <table class="w-full">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                <tr>
                    <th class="px-4 py-3 text-left">Type</th>
                    <th class="px-4 py-3 text-left">Source URL</th>
                    <th class="px-4 py-3 text-center">Articles</th>
                    <th class="px-4 py-3 text-left">Date</th>
                    <th class="px-4 py-3 text-left">Status</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">${rows}</tbody>
        </table>
    `;
}

// =====================
// Shared Utilities
// =====================

function setFcLoading(btn, spinner, loading) {
    if (btn) {
        btn.disabled = loading;
        btn.classList.toggle('opacity-50', loading);
        btn.classList.toggle('cursor-not-allowed', loading);
    }
    if (spinner) {
        spinner.classList.toggle('hidden', !loading);
        spinner.classList.toggle('flex', loading);
    }
}

function renderFcLoading(message) {
    return `
        <div class="flex items-center gap-3 text-gray-500 py-4">
            <svg class="animate-spin w-5 h-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
            </svg>
            <span>${escapeHtml(message)}</span>
        </div>
    `;
}

function renderFcError(message) {
    return `
        <div class="flex items-start gap-3 text-red-700 bg-red-50 p-4 rounded-lg">
            <svg class="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <div>
                <p class="font-semibold">Error</p>
                <p class="text-sm mt-1">${escapeHtml(message)}</p>
            </div>
        </div>
    `;
}
