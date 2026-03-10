// Knowledge Base Management Logic

let kbRefreshInterval = null;
let currentKBPage = 1;
let currentKBLimit = 50;
let currentKBFilter = '';

// =====================
// Main Load Function
// =====================

async function loadKnowledgeBase() {
    await Promise.all([
        loadKBStatus(),
        loadKBArticles(1),
        loadKBStatistics()
    ]);
    updateKBLastUpdated();

    // Auto-refresh status every 30 seconds
    if (!kbRefreshInterval) {
        kbRefreshInterval = setInterval(loadKBStatus, 30000);
    }
}

function updateKBLastUpdated() {
    const el = document.getElementById('kb-last-updated');
    if (el) {
        el.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
    }
}

// =====================
// KB Status Functions
// =====================

async function loadKBStatus() {
    try {
        const res = await fetch(`${ADMIN_API}/kb/status?t=${Date.now()}`);
        const data = await res.json();

        if (data.success && data.status) {
            const status = data.status;

            // Article Count
            const countEl = document.getElementById('kb-article-count');
            if (countEl) {
                countEl.textContent = status.article_count || 0;
            }

            // Source
            const sourceEl = document.getElementById('kb-source');
            const sourceIconEl = document.getElementById('kb-source-icon');
            const sourceDetailEl = document.getElementById('kb-source-detail');
            if (sourceEl && sourceIconEl && sourceDetailEl) {
                const source = status.source || 'Unknown';
                if (source === 'glpi') {
                    sourceEl.textContent = 'Project IQ KB';
                    sourceIconEl.innerHTML = '🌐';
                    sourceIconEl.className = 'w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-2xl';
                    sourceDetailEl.textContent = 'Live from Project IQ API';
                } else if (source === 'json') {
                    sourceEl.textContent = 'Local JSON';
                    sourceIconEl.innerHTML = '📄';
                    sourceIconEl.className = 'w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center text-2xl';
                    sourceDetailEl.textContent = 'Fallback mode';
                } else {
                    sourceEl.textContent = source;
                    sourceIconEl.innerHTML = '❓';
                    sourceIconEl.className = 'w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-2xl';
                    sourceDetailEl.textContent = 'Unknown source';
                }
            }

            // Last Refresh
            const lastRefreshEl = document.getElementById('kb-last-refresh');
            const nextRefreshEl = document.getElementById('kb-next-refresh');
            if (lastRefreshEl && status.last_refresh) {
                const lastRefresh = new Date(status.last_refresh);
                lastRefreshEl.textContent = formatRelativeTime(lastRefresh);

                // Calculate next refresh (30 min from last)
                if (nextRefreshEl && status.refresh_interval) {
                    const nextRefresh = new Date(lastRefresh.getTime() + (status.refresh_interval * 1000));
                    const minutesUntil = Math.max(0, Math.round((nextRefresh - new Date()) / 60000));
                    nextRefreshEl.textContent = `Next: in ${minutesUntil} min`;
                }
            }

            // Model Info
            const modelNameEl = document.getElementById('kb-model-name');
            const modelDimEl = document.getElementById('kb-model-dim');
            const cacheSizeEl = document.getElementById('kb-cache-size');

            if (modelNameEl && status.model_info) {
                modelNameEl.textContent = status.model_info.model_name || '--';
            }
            if (modelDimEl && status.model_info) {
                modelDimEl.textContent = status.model_info.embedding_dimension || '--';
            }
            if (cacheSizeEl && status.cache_size_mb !== undefined) {
                cacheSizeEl.textContent = status.cache_size_mb.toFixed(1) + ' MB';
            }
        }

    } catch (e) {
        console.error('Error loading KB status:', e);
        showNotification('Failed to load KB status', 'error');
    }
}

async function refreshKBStatus() {
    await loadKBStatus();
    updateKBLastUpdated();
}

// =====================
// Manual Refresh
// =====================

async function manualRefreshKB() {
    const btn = document.getElementById('btn-refresh-kb');
    const progress = document.getElementById('refresh-progress');

    if (!btn || !progress) return;

    // Disable button and show progress
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    progress.classList.remove('hidden');
    progress.classList.add('flex');

    try {
        const res = await fetch(`${ADMIN_API}/kb/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.success) {
            showNotification(`KB cache refreshed! Loaded ${data.status.article_count} articles.`, 'success');

            // Reload all data
            await Promise.all([
                loadKBStatus(),
                loadKBArticles(currentKBPage),
                loadKBStatistics()
            ]);
        } else {
            showNotification('KB refresh failed: ' + (data.message || data.error), 'error');
        }

    } catch (e) {
        console.error('Error refreshing KB cache:', e);
        showNotification('Failed to refresh KB cache: ' + e.message, 'error');
    } finally {
        // Re-enable button and hide progress
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        progress.classList.remove('flex');
        progress.classList.add('hidden');
    }
}

// =====================
// Search Tester
// =====================

async function testKBSearch() {
    const input = document.getElementById('kb-search-input');
    const resultsDiv = document.getElementById('kb-search-results');
    const btn = document.getElementById('btn-test-search');

    if (!input || !resultsDiv || !btn) return;

    const query = input.value.trim();
    if (!query) {
        showNotification('Please enter a search query', 'warning');
        return;
    }

    // Show loading state
    btn.disabled = true;
    btn.classList.add('opacity-50');
    resultsDiv.innerHTML = '<p class="text-gray-400 text-center py-4">Searching...</p>';

    try {
        const res = await fetch(`${ADMIN_API}/kb/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const data = await res.json();

        if (data.success) {
            if (data.results && data.results.length > 0) {
                resultsDiv.innerHTML = renderSearchResults(data.results, query);
            } else {
                resultsDiv.innerHTML = '<p class="text-gray-400 text-center py-4">No results found</p>';
            }
        } else {
            resultsDiv.innerHTML = `<p class="text-red-500 text-center py-4">Search failed: ${data.error}</p>`;
        }

    } catch (e) {
        console.error('Error testing KB search:', e);
        resultsDiv.innerHTML = `<p class="text-red-500 text-center py-4">Error: ${e.message}</p>`;
    } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-50');
    }
}

function renderSearchResults(results, query) {
    let html = `<div class="space-y-3">`;
    html += `<p class="text-sm text-gray-600 mb-3">Found ${results.length} results for "<strong>${escapeHtml(query)}</strong>"</p>`;

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const article = result.article;
        const scores = result.scores;

        // Score color based on final score
        let scoreColor = 'bg-gray-100 text-gray-700';
        if (scores.final_score >= 0.7) scoreColor = 'bg-green-100 text-green-700';
        else if (scores.final_score >= 0.4) scoreColor = 'bg-yellow-100 text-yellow-700';

        html += `
            <div class="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                <div class="flex items-start justify-between mb-2">
                    <div class="flex-1">
                        <h4 class="font-semibold text-gray-800">${i + 1}. ${escapeHtml(article.title)}</h4>
                        <div class="flex gap-2 mt-1">
                            <span class="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">${escapeHtml(article.category)}</span>
                            ${article.is_faq ? '<span class="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">FAQ</span>' : ''}
                            <span class="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded">${escapeHtml(article.source || 'unknown')}</span>
                        </div>
                    </div>
                    <div class="flex flex-col items-end gap-1 ml-4">
                        <span class="text-xs px-2 py-1 ${scoreColor} rounded font-semibold">
                            Score: ${scores.final_score.toFixed(3)}
                        </span>
                    </div>
                </div>

                <p class="text-sm text-gray-600 mb-3">${escapeHtml(article.content)}</p>

                <div class="flex gap-4 text-xs text-gray-500">
                    <span>🧠 Semantic: ${scores.semantic_score.toFixed(3)}</span>
                    <span>🔤 Keyword: ${scores.keyword_score.toFixed(3)}</span>
                    ${article.glpi_id ? `<span>📋 GLPI ID: ${article.glpi_id}</span>` : ''}
                </div>
            </div>
        `;
    }

    html += `</div>`;
    return html;
}

// =====================
// Article Browser
// =====================

async function loadKBArticles(page = 1, limit = 50) {
    currentKBPage = page;
    currentKBLimit = limit;

    const tableDiv = document.getElementById('kb-article-table');
    const paginationDiv = document.getElementById('kb-pagination-buttons');
    const showingInfo = document.getElementById('kb-showing-info');

    if (!tableDiv) return;

    tableDiv.innerHTML = '<p class="text-gray-400 text-center py-8">Loading articles...</p>';

    try {
        const filter = currentKBFilter || '';
        const url = `${ADMIN_API}/kb/articles?page=${page}&limit=${limit}&filter=${encodeURIComponent(filter)}&t=${Date.now()}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.success) {
            if (data.articles && data.articles.length > 0) {
                tableDiv.innerHTML = renderArticleTable(data.articles);

                // Update pagination
                if (paginationDiv) {
                    paginationDiv.innerHTML = renderPagination(page, data.total_pages);
                }

                // Update showing info
                if (showingInfo) {
                    const start = ((page - 1) * limit) + 1;
                    const end = Math.min(start + data.count - 1, data.total);
                    showingInfo.textContent = `Showing ${start}-${end} of ${data.total} articles`;
                }
            } else {
                tableDiv.innerHTML = '<p class="text-gray-400 text-center py-8">No articles found</p>';
                if (showingInfo) showingInfo.textContent = 'Showing 0 articles';
            }
        } else {
            tableDiv.innerHTML = `<p class="text-red-500 text-center py-8">Error: ${data.error}</p>`;
        }

    } catch (e) {
        console.error('Error loading KB articles:', e);
        tableDiv.innerHTML = `<p class="text-red-500 text-center py-8">Error: ${e.message}</p>`;
    }
}

function renderArticleTable(articles) {
    let html = `
        <table class="w-full table-auto">
            <thead class="bg-gray-50 border-b border-gray-200">
                <tr>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">ID</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Title</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Category</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Source</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Modified</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Actions</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
    `;

    for (const article of articles) {
        const articleId = article.id || '--';
        const title = escapeHtml(article.title || 'Untitled');
        const category = escapeHtml(article.category || 'Uncategorized');
        const source = article.source || 'unknown';
        const dateModified = article.date_modified ? new Date(article.date_modified).toLocaleDateString() : '--';
        const glpiId = article.glpi_id || '';
        const isFaq = article.is_faq ? '<span class="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded ml-2">FAQ</span>' : '';

        html += `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 text-sm text-gray-600">${escapeHtml(articleId)}</td>
                <td class="px-4 py-3 text-sm font-medium text-gray-800">${title}${isFaq}</td>
                <td class="px-4 py-3 text-sm"><span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">${category}</span></td>
                <td class="px-4 py-3 text-sm text-gray-600">${source}${glpiId ? ' #' + glpiId : ''}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${dateModified}</td>
                <td class="px-4 py-3 text-sm">
                    <button onclick='viewArticle(${JSON.stringify(article)})' class="text-blue-600 hover:text-blue-800">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }

    html += `</tbody></table>`;
    return html;
}

function renderPagination(currentPage, totalPages) {
    let html = '';

    // Previous button
    if (currentPage > 1) {
        html += `<button onclick="loadKBArticles(${currentPage - 1})" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50">Previous</button>`;
    }

    // Page numbers (show max 5 pages around current)
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
        if (i === currentPage) {
            html += `<button class="px-3 py-1 bg-blue-600 text-white rounded">${i}</button>`;
        } else {
            html += `<button onclick="loadKBArticles(${i})" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50">${i}</button>`;
        }
    }

    // Next button
    if (currentPage < totalPages) {
        html += `<button onclick="loadKBArticles(${currentPage + 1})" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50">Next</button>`;
    }

    return html;
}

function filterKBArticles() {
    const input = document.getElementById('kb-article-filter');
    if (input) {
        currentKBFilter = input.value.trim();
        loadKBArticles(1); // Reset to page 1 when filtering
    }
}

// =====================
// Article Detail Modal
// =====================

function viewArticle(article) {
    const modal = document.getElementById('kb-article-modal');
    const titleEl = document.getElementById('modal-article-title');
    const contentEl = document.getElementById('modal-article-content');

    if (modal && titleEl && contentEl) {
        titleEl.textContent = article.title;

        let content = `
            <div class="space-y-4">
                <div class="flex gap-2">
                    <span class="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">${escapeHtml(article.category)}</span>
                    ${article.is_faq ? '<span class="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">FAQ</span>' : ''}
                    <span class="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded">${escapeHtml(article.source || 'unknown')}</span>
                    ${article.glpi_id ? `<span class="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">GLPI #${article.glpi_id}</span>` : ''}
                </div>
                ${article.question ? `<div class="bg-yellow-50 p-3 rounded"><strong>Question:</strong> ${escapeHtml(article.question)}</div>` : ''}
                <div class="prose max-w-none">${article.content || 'No content available'}</div>
                ${article.keywords && article.keywords.length > 0 ? `
                    <div class="mt-4">
                        <strong class="text-sm text-gray-600">Keywords:</strong>
                        <div class="flex flex-wrap gap-2 mt-2">
                            ${article.keywords.map(kw => `<span class="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">${escapeHtml(kw)}</span>`).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        contentEl.innerHTML = content;
        modal.classList.remove('hidden');
    }
}

function closeArticleModal() {
    const modal = document.getElementById('kb-article-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// =====================
// Statistics
// =====================

async function loadKBStatistics() {
    try {
        const res = await fetch(`${ADMIN_API}/kb/articles?page=1&limit=10000&t=${Date.now()}`);
        const data = await res.json();

        if (data.success && data.articles) {
            renderCategoryStats(data.articles);
            renderSourceStats(data.articles);
        }

    } catch (e) {
        console.error('Error loading KB statistics:', e);
    }
}

function renderCategoryStats(articles) {
    const statsDiv = document.getElementById('kb-category-stats');
    if (!statsDiv) return;

    // Count articles by category
    const categoryCounts = {};
    articles.forEach(article => {
        const category = article.category || 'Uncategorized';
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });

    // Sort by count
    const sortedCategories = Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // Top 10 categories

    let html = '';
    const maxCount = sortedCategories[0]?.[1] || 1;

    for (const [category, count] of sortedCategories) {
        const percentage = (count / maxCount) * 100;
        html += `
            <div class="flex items-center gap-3">
                <div class="flex-1">
                    <div class="flex justify-between mb-1">
                        <span class="text-sm text-gray-700">${escapeHtml(category)}</span>
                        <span class="text-sm font-semibold text-gray-900">${count}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                        <div class="bg-blue-600 h-2 rounded-full" style="width: ${percentage}%"></div>
                    </div>
                </div>
            </div>
        `;
    }

    statsDiv.innerHTML = html || '<p class="text-gray-400 text-center py-4">No data</p>';
}

function renderSourceStats(articles) {
    const statsDiv = document.getElementById('kb-source-stats');
    if (!statsDiv) return;

    // Count articles by source
    const sourceCounts = {};
    articles.forEach(article => {
        const source = article.source || 'unknown';
        sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    });

    let html = '';
    const total = articles.length;

    for (const [source, count] of Object.entries(sourceCounts)) {
        const percentage = ((count / total) * 100).toFixed(1);
        html += `
            <div class="flex items-center justify-between p-3 bg-gray-50 rounded">
                <div>
                    <span class="font-semibold text-gray-800">${escapeHtml(source.toUpperCase())}</span>
                    <span class="text-sm text-gray-500 ml-2">${count} articles</span>
                </div>
                <span class="text-lg font-bold text-blue-600">${percentage}%</span>
            </div>
        `;
    }

    statsDiv.innerHTML = html || '<p class="text-gray-400 text-center py-4">No data</p>';
}

// =====================
// Utility Functions
// =====================

function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toggleSemanticSearch() {
    // TODO: Implement toggle semantic search on/off
    showNotification('Toggle semantic search feature coming soon', 'info');
}