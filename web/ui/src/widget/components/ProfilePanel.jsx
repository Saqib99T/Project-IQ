import React from 'react';
import { User, LogOut, X, Moon, Sun } from 'lucide-react';

const PRODUCT_LABELS = {
    IT: 'IT Support',
    Accounting: 'Accounting',
    shipnest: 'ShipNest',
    greenloop: 'GreenLoop',
    accountwise: 'AccountWise',
    General: 'General',
};

const ProfilePanel = ({ authUser, appId, primaryColor, isDark, onToggleDark, onClose, onLogout }) => {
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

const InfoRow = ({ icon, label, value }) => (
    <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-blue-500 flex-shrink-0">{icon}</span>
        <span className="text-sm text-gray-500 flex-shrink-0 w-28">{label}</span>
        <span className="text-sm font-medium text-gray-800 truncate">{value}</span>
    </div>
);

export default ProfilePanel;
