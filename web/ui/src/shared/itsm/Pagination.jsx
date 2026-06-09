import { ChevronLeft, ChevronRight } from 'lucide-react'

// Standard page-numbered pagination. Renders Prev · windowed page numbers · Next.
// page is 1-based. Shows up to `window` numbers around the current page with
// first/last anchors and ellipses.
export default function Pagination({ page, pageCount, onChange, total, pageSize, window = 1 }) {
    if (pageCount <= 1) return null

    const nums = []
    const push = (n) => { if (!nums.includes(n)) nums.push(n) }
    push(1)
    for (let p = page - window; p <= page + window; p++) if (p >= 1 && p <= pageCount) push(p)
    push(pageCount)
    nums.sort((a, b) => a - b)

    // Insert ellipsis markers between non-consecutive numbers
    const items = []
    for (let i = 0; i < nums.length; i++) {
        if (i > 0 && nums[i] - nums[i - 1] > 1) items.push(`gap-${i}`)
        items.push(nums[i])
    }

    const go = (p) => { if (p >= 1 && p <= pageCount && p !== page) onChange(p) }
    const btn = 'min-w-[34px] h-[34px] px-2 inline-flex items-center justify-center rounded-lg text-sm border transition-colors'

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            {total != null && pageSize != null && (
                <p className="text-xs text-fgsubtle">
                    {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
                </p>
            )}
            <div className="flex items-center gap-1 ml-auto">
                <button onClick={() => go(page - 1)} disabled={page <= 1}
                    className={`${btn} border-bordc text-fgmuted hover:bg-surface2 disabled:opacity-40 disabled:cursor-not-allowed`}>
                    <ChevronLeft className="w-4 h-4" />
                </button>
                {items.map(it =>
                    typeof it === 'number' ? (
                        <button key={it} onClick={() => go(it)}
                            className={`${btn} ${it === page
                                ? 'border-primary bg-primary/10 text-primary font-medium'
                                : 'border-bordc text-fgmuted hover:bg-surface2'}`}>
                            {it}
                        </button>
                    ) : (
                        <span key={it} className="px-1 text-fgsubtle">…</span>
                    )
                )}
                <button onClick={() => go(page + 1)} disabled={page >= pageCount}
                    className={`${btn} border-bordc text-fgmuted hover:bg-surface2 disabled:opacity-40 disabled:cursor-not-allowed`}>
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    )
}
