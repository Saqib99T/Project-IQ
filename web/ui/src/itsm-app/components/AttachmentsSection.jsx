import { useRef, useState } from 'react'
import { useItsmApi, useItsmResource, uploadToPresignedUrl } from '../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../shared/itsm/primitives'
import { useConfirm } from '../../shared/itsm/ui'

function formatSize(bytes) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function AttachmentsSection({ ticketId }) {
    const { get, post, remove } = useItsmApi()
    const confirm = useConfirm()
    const fileInput = useRef(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState(null)
    const [broken, setBroken] = useState(() => new Set())  // ids whose object 404s

    const { data, loading, reload } = useItsmResource(
        () => get(`/tickets/${ticketId}/attachments`),
        [get, ticketId]
    )
    const attachments = data || []

    const pickFile = () => fileInput.current?.click()

    const onFileChosen = async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        if (file.size > 25 * 1024 * 1024) {
            setError(new Error('File exceeds the 25 MB limit.'))
            return
        }
        setUploading(true); setError(null)
        try {
            const presign = await post(`/tickets/${ticketId}/attachments`, {
                filename: file.name,
                mime_type: file.type || 'application/octet-stream',
                file_size: file.size,
            })
            await uploadToPresignedUrl(presign.upload_url, file)
            reload()
        } catch (err) { setError(err) } finally { setUploading(false) }
    }

    const del = async (attachmentId) => {
        if (!(await confirm({ title: 'Delete attachment?', message: 'This attachment will be removed.', danger: true, confirmLabel: 'Delete' }))) return
        setError(null)
        try {
            await remove(`/tickets/${ticketId}/attachments/${attachmentId}`)
            reload()
        } catch (err) { setError(err) }
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Attachments</h3>
                <button onClick={pickFile} disabled={uploading} className="btn-ghost text-xs py-1.5">
                    {uploading ? 'Uploading…' : '+ Upload file'}
                </button>
                <input ref={fileInput} type="file" className="hidden" onChange={onFileChosen} />
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && (
                attachments.length === 0
                    ? <EmptyState>No attachments.</EmptyState>
                    : (
                        <div className="flex flex-wrap gap-2.5">
                            {attachments.map(a => {
                                const isImg = (a.mime_type || '').startsWith('image/')
                                return (
                                    <div key={a.id} className="group relative w-28 rounded-lg border border-bordc bg-surface2 overflow-hidden">
                                        <a href={a.download_url} target="_blank" rel="noopener noreferrer" title={a.filename} className="block">
                                            {isImg && a.download_url && !broken.has(a.id)
                                                ? <img src={a.download_url} alt={a.filename} loading="lazy"
                                                       onError={() => setBroken(s => new Set(s).add(a.id))}
                                                       className="w-full h-20 object-cover bg-bg" />
                                                : <div className="w-full h-20 flex items-center justify-center text-2xl text-fgsubtle">📄</div>}
                                        </a>
                                        <div className="p-1.5">
                                            <p className="text-[11px] text-fg truncate" title={a.filename}>{a.filename}</p>
                                            <div className="flex items-center justify-between gap-1">
                                                <span className="text-[10px] text-fgsubtle">{formatSize(a.file_size)}</span>
                                                <button onClick={() => del(a.id)} className="text-[10px] text-danger hover:underline shrink-0">Delete</button>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )
            )}
        </div>
    )
}
