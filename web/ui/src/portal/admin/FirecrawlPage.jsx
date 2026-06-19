import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'

function JobRow({ job }) {
    const statusColor = {
        completed: 'bg-green-100 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400',
        running:   'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400',
        failed:    'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400',
        pending:   'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    }
    return (
        <div className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 hover:dark:bg-slate-800/60">
            <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-slate-100 truncate">{job.url || job.base_url || '—'}</p>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                    {job.started_at ? new Date(job.started_at).toLocaleString() : ''} · {job.pages_scraped ?? job.pages ?? '?'} pages
                </p>
            </div>
            <span className={`badge ml-3 ${statusColor[job.status] || 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300'}`}>{job.status}</span>
        </div>
    )
}

export default function FirecrawlPage() {
    const { call } = useApi()
    const [config, setConfig]     = useState(null)
    const [jobs, setJobs]         = useState([])
    const [tab, setTab]           = useState('scrape') // 'scrape' | 'crawl' | 'batch' | 'config'
    const [loading, setLoading]   = useState(true)
    const [running, setRunning]   = useState(false)
    const [result, setResult]     = useState(null)
    const [error, setError]       = useState(null)

    // Scrape
    const [scrapeUrl, setScrapeUrl] = useState('')
    // Crawl
    const [crawlUrl, setCrawlUrl]   = useState('')
    const [maxPages, setMaxPages]   = useState('20')
    // Batch
    const [batchUrls, setBatchUrls] = useState('')
    // Config
    const [configForm, setConfigForm] = useState({})
    // Live service status
    const [status, setStatus]   = useState(null)   // { running, message }
    const [checking, setChecking] = useState(false)

    const [svcBusy, setSvcBusy] = useState(false)

    const checkStatus = useCallback(async () => {
        setChecking(true)
        try {
            const d = await call('/admin/firecrawl/status')
            setStatus(d)
        } catch (e) {
            setStatus({ running: false, message: e.message })
        } finally {
            setChecking(false)
        }
    }, [call])

    // Start/stop the Firecrawl stack. Start takes ~30s to become healthy, so we
    // poll the status a few times after the command returns.
    const controlService = useCallback(async (action) => {
        setSvcBusy(true)
        try {
            await call('/admin/firecrawl/service', { method: 'POST', body: JSON.stringify({ action }) })
            await checkStatus()
            if (action === 'start') {
                for (let i = 0; i < 6; i++) {
                    await new Promise(r => setTimeout(r, 5000))
                    await checkStatus()
                }
            }
        } catch (e) {
            setStatus({ running: false, message: e.message })
        } finally {
            setSvcBusy(false)
        }
    }, [call, checkStatus])

    useEffect(() => {
        Promise.all([
            call('/admin/firecrawl/config').then(d => { setConfig(d); setConfigForm(d || {}) }),
            call('/admin/firecrawl/crawl-jobs').then(d => setJobs(d?.jobs || d || [])),
        ]).catch(e => setError(e.message))
          .finally(() => setLoading(false))
        checkStatus()
    }, [call, checkStatus])

    const run = async (action, body) => {
        setRunning(true); setResult(null); setError(null)
        try {
            const d = await call(action, { method: 'POST', body: JSON.stringify(body) })
            setResult(d)
            const fresh = await call('/admin/firecrawl/crawl-jobs')
            setJobs(fresh?.jobs || fresh || [])
        } catch (e) {
            setError(e.message)
        } finally {
            setRunning(false)
        }
    }

    const saveConfig = async () => {
        setRunning(true)
        try {
            await call('/admin/firecrawl/config', { method: 'POST', body: JSON.stringify(configForm) })
            setResult({ message: 'Config saved' })
        } catch (e) {
            setError(e.message)
        } finally {
            setRunning(false)
        }
    }

    if (loading) return (
        <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
    )

    const tabs = ['scrape', 'crawl', 'batch', 'config']
    const serviceUp = !!status?.running  // gate scrape/crawl/batch inputs on this

    return (
        <div className="max-w-4xl space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Firecrawl</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Scrape and crawl web pages to add to the knowledge base</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        status?.running ? 'bg-green-50 text-green-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : status ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status?.running ? 'bg-green-500' : status ? 'bg-red-500' : 'bg-gray-400'}`} />
                        {checking ? 'Checking…' : status ? (status.running ? 'Service running' : 'Service not reachable') : 'Status unknown'}
                    </span>
                    <button onClick={checkStatus} disabled={checking || svcBusy}
                        className="btn-ghost border border-gray-200 dark:border-slate-700 text-xs px-2.5 py-1">↻ Re-check</button>
                    {status?.running
                        ? <button onClick={() => controlService('stop')} disabled={svcBusy}
                            className="text-xs px-2.5 py-1 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60">
                            {svcBusy ? 'Working…' : '■ Stop'}
                          </button>
                        : <button onClick={() => controlService('start')} disabled={svcBusy}
                            className="text-xs px-2.5 py-1 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-60">
                            {svcBusy ? 'Starting…' : '▶ Start'}
                          </button>}
                </div>
            </div>

            {error  && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}
            {result && <div className="card p-4 bg-green-50 dark:bg-emerald-500/10 border-green-200 dark:border-emerald-500/20 text-green-700 dark:text-emerald-400 text-sm">{
                result.message
                || (result.title ? `✓ Scraped “${result.title}” — added to the Knowledge Base.`
                    : (result.pages_scraped != null || result.count != null) ? `✓ Ingested ${result.pages_scraped ?? result.count} page(s) into the Knowledge Base.`
                    : result.status === 'success' ? '✓ Added to the Knowledge Base.'
                    : JSON.stringify(result))
            }</div>}

            <div className="flex gap-3 border-b border-gray-200 dark:border-slate-700">
                {tabs.map(t => (
                    <button key={t} onClick={() => setTab(t)}
                        className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors capitalize ${
                            tab === t ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 hover:dark:text-slate-300'
                        }`}>
                        {t}
                    </button>
                ))}
            </div>

            {tab === 'scrape' && (
                <div className="card p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Scrape single URL</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Scrape one page and ingest its content into the KB.</p>
                    {!serviceUp && <p className="text-xs text-amber-600 dark:text-amber-400">⚠ Start the Firecrawl service to scrape.</p>}
                    <div className="flex gap-2">
                        <input value={scrapeUrl} onChange={e => setScrapeUrl(e.target.value)} disabled={!serviceUp}
                            placeholder="https://docs.example.com/article"
                            className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 disabled:bg-gray-100 disabled:dark:bg-slate-800 disabled:cursor-not-allowed" />
                        <button onClick={() => run('/admin/kb/ingest-url', { url: scrapeUrl })} disabled={running || !scrapeUrl || !serviceUp}
                            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                            {running && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                            {running ? 'Scraping…' : 'Scrape'}
                        </button>
                    </div>
                    <button onClick={() => { run('/admin/firecrawl/test', {}); checkStatus() }} disabled={running}
                        className="btn-ghost border border-gray-200 dark:border-slate-700 text-xs">
                        Test connection only
                    </button>
                </div>
            )}

            {tab === 'crawl' && (
                <div className="card p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Crawl site</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Crawl an entire site starting from a base URL and ingest all pages.</p>
                    {!serviceUp && <p className="text-xs text-amber-600 dark:text-amber-400">⚠ Start the Firecrawl service to crawl.</p>}
                    <div className="flex gap-2">
                        <input value={crawlUrl} onChange={e => setCrawlUrl(e.target.value)} disabled={!serviceUp}
                            placeholder="https://docs.example.com"
                            className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 disabled:bg-gray-100 disabled:dark:bg-slate-800 disabled:cursor-not-allowed" />
                        <input value={maxPages} onChange={e => setMaxPages(e.target.value)} disabled={!serviceUp}
                            placeholder="Max pages" type="number"
                            className="w-24 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 disabled:bg-gray-100 disabled:dark:bg-slate-800 disabled:cursor-not-allowed" />
                        <button onClick={() => run('/admin/kb/crawl-site', { url: crawlUrl, max_pages: parseInt(maxPages) })}
                            disabled={running || !crawlUrl || !serviceUp} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                            {running ? '…' : 'Crawl'}
                        </button>
                    </div>
                </div>
            )}

            {tab === 'batch' && (
                <div className="card p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Batch URLs</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Enter one URL per line to ingest multiple pages at once.</p>
                    {!serviceUp && <p className="text-xs text-amber-600 dark:text-amber-400">⚠ Start the Firecrawl service to ingest.</p>}
                    <textarea value={batchUrls} onChange={e => setBatchUrls(e.target.value)} disabled={!serviceUp}
                        placeholder="https://docs.example.com/page-1&#10;https://docs.example.com/page-2"
                        className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 resize-none h-36 disabled:bg-gray-100 disabled:dark:bg-slate-800 disabled:cursor-not-allowed" />
                    <button onClick={() => run('/admin/kb/ingest-urls', { urls: batchUrls.split('\n').map(u => u.trim()).filter(Boolean) })}
                        disabled={running || !batchUrls.trim() || !serviceUp} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                        {running ? '…' : 'Ingest all'}
                    </button>
                </div>
            )}

            {tab === 'config' && (
                <div className="card p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Firecrawl settings</h3>
                    {Object.keys(configForm).map(k => (
                        <div key={k}>
                            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1 font-mono">{k}</label>
                            <input value={configForm[k] ?? ''} onChange={e => setConfigForm(p => ({ ...p, [k]: e.target.value }))}
                                className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
                        </div>
                    ))}
                    <button onClick={saveConfig} disabled={running} className="btn-primary">
                        {running ? 'Saving…' : 'Save config'}
                    </button>
                </div>
            )}

            {/* Job history */}
            {jobs.length > 0 && (
                <div className="card overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800">
                        <h3 className="font-semibold text-gray-800 dark:text-slate-200">Crawl job history</h3>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
                        {jobs.map((j, i) => <JobRow key={i} job={j} />)}
                    </div>
                </div>
            )}
        </div>
    )
}
