import { useRef, useState } from 'react'
import { Paperclip, Upload, Trash2 } from 'lucide-react'
import { useItsmApi, useItsmResource, uploadToPresignedUrl } from '../../shared/itsm/useItsmApi'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../shared/itsm/primitives'
import { Button, IconButton, useToast, useConfirm } from '../../shared/itsm/ui'

function formatSize(bytes) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function KbArticleAttachmentsSection({ articleId }) {
    const { isAgent } = useItsmPermissions()
    const { get, post, remove } = useItsmApi()
    const { toast } = useToast()
    const confirm = useConfirm()
    const fileInput = useRef(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState(null)

    const canEdit = isAgent
    const { data, loading, reload } = useItsmResource(() => get(`/kb/articles/${articleId}/attachments`), [get, articleId])
    const attachments = data || []

    const onFileChosen = async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        if (file.size > 25 * 1024 * 1024) { setError(new Error('File exceeds the 25 MB limit.')); return }
        setUploading(true); setError(null)
        try {
            const presign = await post(`/kb/articles/${articleId}/attachments`, {
                filename: file.name,
                mime_type: file.type || 'application/octet-stream',
                file_size: file.size,
            })
            await uploadToPresignedUrl(presign.upload_url, file)
            toast('File uploaded', 'success')
            reload()
        } catch (err) { setError(err) } finally { setUploading(false) }
    }

    const del = async (id, name) => {
        const ok = await confirm({ title: 'Delete attachment?', message: `"${name}" will be removed.`, danger: true, confirmLabel: 'Delete' })
        if (!ok) return
        try { await remove(`/kb/articles/${articleId}/attachments/${id}`); reload() }
        catch (err) { setError(err) }
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Paperclip className="w-4 h-4 text-slate-400" /> Attachments
                </h3>
                {canEdit && (
                    <>
                        <Button variant="ghost" size="sm" icon={Upload} disabled={uploading} onClick={() => fileInput.current?.click()}>
                            {uploading ? 'Uploading…' : 'Upload'}
                        </Button>
                        <input ref={fileInput} type="file" className="hidden" onChange={onFileChosen} />
                    </>
                )}
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && (
                attachments.length === 0
                    ? <EmptyState>No attachments.</EmptyState>
                    : (
                        <ul className="space-y-1.5">
                            {attachments.map(a => (
                                <li key={a.id} className="flex items-center justify-between text-sm p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                    <div className="min-w-0">
                                        <p className="text-slate-700 dark:text-slate-300 truncate">{a.filename}</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">{formatSize(a.file_size)} · {a.mime_type}</p>
                                    </div>
                                    {canEdit && <IconButton icon={Trash2} label="Delete" size="sm" className="hover:text-red-600 dark:hover:text-red-400" onClick={() => del(a.id, a.filename)} />}
                                </li>
                            ))}
                        </ul>
                    )
            )}
        </div>
    )
}
