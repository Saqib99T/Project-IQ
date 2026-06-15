// Friendly display names for product slugs (the `product_id` stored on a handoff
// is the slug from the IAM `products` claim). Unknown slugs fall back to a
// title-cased version of the slug itself.
export const PRODUCT_LABELS = {
    IT: 'IT Support',
    Accounting: 'Accounting',
    shipnest: 'ShipNest',
    greenloop: 'GreenLoop',
    'account-wise': 'AccountWise',
    accountwise: 'AccountWise',
    'stock-wise': 'StockWise',
    'stock-wise-app': 'StockWise App',
    'project-iq': 'Project IQ',
    'brain-box': 'BrainBox',
    'e-manifest_app': 'e-Manifest',
    'app-1': 'App 1',
    'clear-portal': 'Clear Portal',
    General: 'General',
}

export function productLabel(id) {
    if (!id) return ''
    return PRODUCT_LABELS[id] || String(id).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
