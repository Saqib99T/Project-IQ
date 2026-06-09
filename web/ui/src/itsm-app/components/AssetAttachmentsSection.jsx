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

export default function AssetAttachmentsSection({ assetId }) {
    const { post, remove } = useItsmApi()
    const confirm = useConfirm()
    const fileInput = useRef(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState(null)

    const { get } = useItsmApi()
    const { data, loading, reload } = useItsmResource(
        () => get(`/assets/${assetId}/attachments`),
        [get, assetId]
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
            const presign = await post(`/assets/${assetId}/attachments`, {
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
            await remove(`/assets/${assetId}/attachments/${attachmentId}`)
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
                        <ul className="space-y-1.5">
                            {attachments.map(a => (
                                <li key={a.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                    <div className="min-w-0">
                                        <p className="text-slate-700 dark:text-slate-300 truncate">{a.filename}{a.label ? ` — ${a.label}` : ''}</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">{formatSize(a.file_size)} · {a.mime_type}</p>
                                    </div>
                                    <button onClick={() => del(a.id)} className="text-xs text-red-600 dark:text-red-400 hover:underline shrink-0 ml-3">Delete</button>
                                </li>
                            ))}
                        </ul>
                    )
            )}
        </div>
    )
}
