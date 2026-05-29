import React, { useState, useRef } from 'react';
import { AlertCircle, CheckCircle, XCircle, Paperclip, X as XIcon, Loader } from 'lucide-react';

const MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB

const TicketForm = ({ onSubmit, onCancel, primaryColor = '#6366f1', prefill = {}, sessionToken = null }) => {
    const [formData, setFormData] = useState({
        title:    prefill.title    || '',
        detail:   prefill.detail   || '',
        priority: prefill.priority || 'Medium',
        urgency:  'Medium',
        category: prefill.category || 'Hardware',
    });

    const [showConfirm, setShowConfirm] = useState(false);
    const [isCompleted, setIsCompleted] = useState(false);
    const [error, setError] = useState('');
    const [attachment, setAttachment] = useState(null); // { name, doc_id, sizeLabel } after upload
    const [fileError, setFileError] = useState('');
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef(null);

    const priorityOptions = ['Minor', 'Major', 'Medium', 'High', 'Critical'];
    const urgencyOptions = ['Low', 'Medium', 'High'];
    const categoryOptions = ['Hardware', 'Software', 'Network', 'Other'];

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (name === 'title' && value.trim()) setError('');
    };

    const handleFileChange = async (e) => {
        setFileError('');
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
            setFileError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 1 MB.`);
            e.target.value = '';
            return;
        }
        e.target.value = '';
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            if (sessionToken) fd.append('session_token', sessionToken);
            const resp = await fetch('/api/ticket-attachment', { method: 'POST', body: fd });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                setFileError(err.error || 'Upload failed. Please try again.');
                return;
            }
            const { doc_id, name } = await resp.json();
            const sizeLabel = file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`;
            setAttachment({ name, doc_id, sizeLabel });
        } catch (err) {
            setFileError('Upload failed. Check your connection.');
        } finally {
            setUploading(false);
        }
    };

    const handleSubmitClick = (e) => {
        e.preventDefault();
        if (!formData.title.trim()) {
            setError('Title is required');
            return;
        }
        setShowConfirm(true);
    };

    const handleConfirm = () => {
        setIsCompleted(true);
        onSubmit({ ...formData, attachment });
    };

    const handleCancel = () => {
        setIsCompleted(true);
        onCancel();
    };

    if (isCompleted) return null;

    return (
        <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-200 w-full mt-2 mb-2">
            <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2 text-sm">
                <span className="p-1 bg-purple-100 text-purple-600 rounded">📝</span>
                New Ticket
            </h3>

            {!showConfirm ? (
                <form className="space-y-2">
                    {/* Quick issue chips */}
                    <div>
                        <p className="text-xs text-gray-400 mb-1">Common issues:</p>
                        <div className="flex flex-wrap gap-1 mb-2">
                            {[
                                { label: '💻 Laptop issue',      title: 'Laptop not working',          category: 'Hardware' },
                                { label: '🌐 No internet',       title: 'Unable to connect to internet', category: 'Network'  },
                                { label: '🔑 Can\'t log in',     title: 'Cannot access my account',    category: 'Software' },
                                { label: '📧 Email problem',     title: 'Email not working',            category: 'Software' },
                                { label: '🖨️ Printer issue',     title: 'Printer not printing',         category: 'Hardware' },
                                { label: '🔒 Need access',       title: 'Requesting system access',     category: 'Software' },
                            ].map(chip => (
                                <button key={chip.label} type="button"
                                    onClick={() => setFormData(p => ({ ...p, title: chip.title, category: chip.category }))}
                                    className="text-xs px-2 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors bg-gray-50"
                                >
                                    {chip.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* Title (Mandatory) */}
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Title <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            name="title"
                            value={formData.title}
                            onChange={handleChange}
                            placeholder="Brief summary of the issue"
                            className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-1 ${error ? 'border-red-500' : 'border-gray-300'}`}
                            style={{ '--tw-ring-color': primaryColor, borderColor: error ? '#ef4444' : '' }}
                        />
                        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                    </div>

                    {/* Detail (Optional) */}
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Detail</label>
                        <textarea
                            name="detail"
                            value={formData.detail}
                            onChange={handleChange}
                            rows="3"
                            placeholder="Describe the issue in detail..."
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1"
                            style={{ '--tw-ring-color': primaryColor }}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {/* Priority */}
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                            <select
                                name="priority"
                                value={formData.priority}
                                onChange={handleChange}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1"
                                style={{ '--tw-ring-color': primaryColor }}
                            >
                                {priorityOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                        </div>

                        {/* Urgency */}
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Urgency</label>
                            <select
                                name="urgency"
                                value={formData.urgency}
                                onChange={handleChange}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1"
                                style={{ '--tw-ring-color': primaryColor }}
                            >
                                {urgencyOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Category */}
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                        <select
                            name="category"
                            value={formData.category}
                            onChange={handleChange}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1"
                            style={{ '--tw-ring-color': primaryColor }}
                        >
                            {categoryOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                    </div>

                    {/* Attachment */}
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Attachment <span className="text-gray-400 font-normal">(max 1 MB)</span></label>
                        <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange}
                            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.png,.jpg,.jpeg" />
                        {uploading ? (
                            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-600">
                                <Loader size={13} className="animate-spin flex-shrink-0" />
                                <span>Uploading…</span>
                            </div>
                        ) : attachment ? (
                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-md">
                                <Paperclip size={13} className="text-gray-400 flex-shrink-0" />
                                <span className="text-xs text-gray-700 truncate flex-1">{attachment.name}</span>
                                <span className="text-xs text-gray-400">{attachment.sizeLabel}</span>
                                <button type="button" onClick={() => setAttachment(null)} className="text-gray-400 hover:text-gray-600">
                                    <XIcon size={13} />
                                </button>
                            </div>
                        ) : (
                            <button type="button" onClick={() => fileRef.current?.click()}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-dashed border-gray-300 rounded-md text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors w-full"
                            >
                                <Paperclip size={13} /> Choose file…
                            </button>
                        )}
                        {fileError && <p className="text-xs text-red-500 mt-1">{fileError}</p>}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmitClick}
                            className="flex-1 px-3 py-1.5 text-xs font-medium text-white rounded-md transition-shadow shadow-sm hover:shadow-md"
                            style={{ backgroundColor: primaryColor }}
                        >
                            Submit
                        </button>
                    </div>
                </form>
            ) : (
                <div className="text-center py-4 px-2 space-y-4 animate-in fade-in zoom-in duration-200">
                    <div className="mx-auto w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                        <AlertCircle size={24} />
                    </div>
                    <div>
                        <h4 className="font-semibold text-gray-800">Confirm Submission?</h4>
                        <p className="text-sm text-gray-500 mt-1">
                            Are you sure you want to create this ticket?
                        </p>
                    </div>

                    <div className="text-left bg-gray-50 p-3 rounded-md text-xs text-gray-600 space-y-1">
                        <p><strong>Title:</strong> {formData.title}</p>
                        <p><strong>Category:</strong> {formData.category}</p>
                        <p><strong>Priority:</strong> {formData.priority}</p>
                        {attachment && <p><strong>Attachment:</strong> {attachment.name} ({attachment.sizeLabel})</p>}
                    </div>

                    <div className="flex gap-2 justify-center">
                        <button
                            type="button"
                            onClick={() => setShowConfirm(false)}
                            className="px-4 py-2 text-xs font-medium text-gray-600 hover:text-gray-800"
                        >
                            Back
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            className="px-6 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 shadow-sm"
                        >
                            Yes, Create It
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TicketForm;
