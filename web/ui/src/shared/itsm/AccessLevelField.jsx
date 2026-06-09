import { useItsmApi, useItsmResource } from './useItsmApi'
import { useItsmPermissions } from './useItsmPermissions'

// The four KB article access levels. `tenant` is the default; `global` and
// `product` are cross-tenant and only offered to platform (99T) staff — the
// backend enforces the same rule (see _resolve_article_scope in kb.py).
export const ACCESS_LEVELS = [
    { value: 'tenant',         label: 'Tenant — all products in this tenant',       crossTenant: false, needsProduct: false },
    { value: 'tenant_product', label: 'Tenant + Product — this tenant, one product', crossTenant: false, needsProduct: true },
    { value: 'global',         label: 'Global — visible to all tenants',            crossTenant: true,  needsProduct: false },
    { value: 'product',        label: 'Product — all tenants, one product',         crossTenant: true,  needsProduct: true },
]

const DESCRIPTIONS = {
    tenant:         'Everyone in this tenant can see it, across every product.',
    tenant_product: 'Only this tenant, and only for the selected product.',
    global:         'Shared knowledge — every tenant and product sees it.',
    product:        'Every tenant that uses the selected product sees it.',
}

/**
 * Access-level selector for KB articles + (when the level needs one) a product
 * picker. Cross-tenant levels are hidden unless the caller is platform staff.
 */
export default function AccessLevelField({ value, onChange, productId, onProductChange }) {
    const { get } = useItsmApi()
    const { isPlatform } = useItsmPermissions()
    const { data: products } = useItsmResource(() => get('/tenant/products'), [get])
    const productList = products || []

    const options = ACCESS_LEVELS.filter(l => isPlatform || !l.crossTenant)
    const current = ACCESS_LEVELS.find(l => l.value === value)
    const needsProduct = !!current?.needsProduct

    return (
        <div className="space-y-2">
            <select className="select" value={value} onChange={e => onChange(e.target.value)}>
                {options.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <p className="text-xs text-fgsubtle">{DESCRIPTIONS[value]}</p>

            {needsProduct && (
                <select
                    className="select"
                    required
                    value={productId || ''}
                    onChange={e => onProductChange(e.target.value)}
                >
                    <option value="">Select a product…</option>
                    {productList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            )}
            {needsProduct && productList.length === 0 && (
                <p className="text-xs text-warning">
                    No products are defined for this tenant yet — add one before using a product-scoped level.
                </p>
            )}
        </div>
    )
}
