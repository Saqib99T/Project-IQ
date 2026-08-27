import React, { useEffect, useState } from 'react';
import { User, LogOut, X, Moon, Sun, MessageCircle } from 'lucide-react';

const PRODUCT_LABELS = {
    IT: 'IT Support',
    Accounting: 'Accounting',
    shipnest: 'ShipNest',
    greenloop: 'GreenLoop',
    accountwise: 'AccountWise',
    General: 'General',
};

const ADMIN_API_URL = window.location.origin;

const ProfilePanel = ({ authUser, appId, primaryColor, isDark, iamToken, onToggleDark, onClose, onLogout }) => {
    const initial = authUser?.[0]?.toUpperCase() || 'U';
    const productLabel = PRODUCT_LABELS[appId] || appId || 'General';

    return (
        <div
            className="absolute inset-0 z-[70] flex flex-col"
            style={{ backgroundColor: '#f9fafb' }}
        >
            {/* Header */}
            <div
                className="flex items-center justify-between px-4 py-3 border-b border-gray-100"
                style={{ backgroundColor: '#ffffff' }}
            >
                <h2 className="text-base font-semibold text-gray-800">My Profile</h2>
                <button
                    onClick={onClose}
                    className="p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-500"
                >
                    <X size={18} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* Avatar section */}
                <div className="flex flex-col items-center py-8 bg-white border-b border-gray-100">
                    <div
                        className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold text-white mb-3"
                        style={{ backgroundColor: primaryColor }}
                    >
                        {initial}
                    </div>
                    <p className="text-lg font-semibold text-gray-800">{authUser}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Support User</p>
                </div>

                {/* Info section */}
                <div className="p-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">Account</p>
                    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
                        <InfoRow icon={<User size={16} />} label="Username" value={authUser} />
                        <div className="border-t border-gray-50" />
                        <InfoRow icon={<span className="text-sm">📦</span>} label="Active Product" value={productLabel} />
                    </div>

                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 pt-2">WhatsApp</p>
                    <WhatsAppLinkSection iamToken={iamToken} />

                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 pt-2">Actions</p>
                    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
                        <button
                            onClick={onToggleDark}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                {isDark ? <Moon size={16} className="text-blue-400" /> : <Sun size={16} className="text-amber-400" />}
                                <span className="text-sm font-medium text-gray-700">Dark Mode</span>
                            </div>
                            <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${isDark ? 'bg-blue-500' : 'bg-gray-200'}`}>
                                <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${isDark ? 'translate-x-4' : 'translate-x-0'}`} />
                            </div>
                        </button>
                        <div className="border-t border-gray-50" />
                        <button
                            onClick={onLogout}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 transition-colors text-left"
                        >
                            <LogOut size={16} className="text-red-500" />
                            <span className="text-sm font-medium text-red-600">Sign Out</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Self-contained mini-flow (enter phone -> send code -> enter code -> confirm)
// deliberately kept local to this component rather than lifted into
// ChatWindow's state, since nothing outside this panel needs to react to
// "is the OTP step open". Mirrors the initiate/confirm split in
// extensions/whatsapp/routes.py — proves phone ownership via a code sent
// over WhatsApp itself, confirmed back here in the (already-authenticated)
// portal, never the other way around.
const WhatsAppLinkSection = ({ iamToken }) => {
    const [status, setStatus] = useState(null);   // {wa_id, status, confirmed_at} | null
    const [loading, setLoading] = useState(true);
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [step, setStep] = useState('idle');      // idle | code_sent | error
    const [error, setError] = useState('');

    const authHeaders = { Authorization: `Bearer ${iamToken}`, 'Content-Type': 'application/json' };

    const refreshStatus = () => {
        if (!iamToken) { setLoading(false); return; }
        fetch(`${ADMIN_API_URL}/portal/whatsapp/link/status`, { headers: authHeaders })
            .then((r) => r.json())
            .then((data) => setStatus(data.link))
            .catch(() => {})
            .finally(() => setLoading(false));
    };

    useEffect(refreshStatus, [iamToken]);

    const sendCode = async () => {
        setError('');
        try {
            const res = await fetch(`${ADMIN_API_URL}/portal/whatsapp/link/initiate`, {
                method: 'POST', headers: authHeaders, body: JSON.stringify({ wa_id: phone }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error || 'Could not send code'); return; }
            setStep('code_sent');
        } catch {
            setError('Network error — try again');
        }
    };

    const confirmCode = async () => {
        setError('');
        try {
            const res = await fetch(`${ADMIN_API_URL}/portal/whatsapp/link/confirm`, {
                method: 'POST', headers: authHeaders, body: JSON.stringify({ wa_id: phone, code }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error || 'Invalid or expired code'); return; }
            setStep('idle');
            setPhone(''); setCode('');
            refreshStatus();
        } catch {
            setError('Network error — try again');
        }
    };

    const removeLink = async () => {
        await fetch(`${ADMIN_API_URL}/portal/whatsapp/link`, { method: 'DELETE', headers: authHeaders }).catch(() => {});
        refreshStatus();
    };

    if (loading) return null;

    return (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-3">
                <MessageCircle size={16} className="text-green-500 flex-shrink-0" />
                {status?.status === 'confirmed' ? (
                    <span className="text-sm text-gray-700">Linked to <span className="font-medium">+{status.wa_id}</span></span>
                ) : (
                    <span className="text-sm text-gray-500">Not linked — chat with the bot on WhatsApp using your own account</span>
                )}
            </div>

            {status?.status === 'confirmed' ? (
                <button
                    onClick={removeLink}
                    className="text-xs font-medium text-red-600 hover:underline"
                >
                    Unlink this number
                </button>
            ) : step === 'idle' ? (
                <div className="flex gap-2">
                    <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="923214421327"
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <button
                        onClick={sendCode}
                        disabled={!phone}
                        className="text-sm font-medium text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
                        style={{ backgroundColor: '#25D366' }}
                    >
                        Send code
                    </button>
                </div>
            ) : (
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="6-digit code"
                        maxLength={6}
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <button
                        onClick={confirmCode}
                        disabled={code.length !== 6}
                        className="text-sm font-medium text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
                        style={{ backgroundColor: '#25D366' }}
                    >
                        Confirm
                    </button>
                </div>
            )}
            {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
};

const InfoRow = ({ icon, label, value }) => (
    <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-blue-500 flex-shrink-0">{icon}</span>
        <span className="text-sm text-gray-500 flex-shrink-0 w-28">{label}</span>
        <span className="text-sm font-medium text-gray-800 truncate">{value}</span>
    </div>
);

export default ProfilePanel;
