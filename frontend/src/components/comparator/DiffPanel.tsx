import type { DiffResult, DiffOp } from '@/api/comparator'

interface Props { result: DiffResult }

function pct(n: number) { return `${Math.round(n * 100)}%` }

export default function DiffPanel({ result }: Props) {
  return (
    <div className="space-y-4">
      {/* Metrics */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Jaccard', value: pct(result.similarity_jaccard) },
          { label: 'Levenshtein', value: pct(result.similarity_levenshtein) },
          { label: 'Tokens communs', value: result.common.length },
        ].map(({ label, value }) => (
          <div key={label} className="card p-3 text-center">
            <div className="text-xl font-display font-semibold text-white">{value}</div>
            <div className="text-xs text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Diff tokens */}
      <div className="card p-4">
        <div className="text-xs text-gray-500 mb-3 font-mono uppercase tracking-wider">Diff token-par-token</div>
        <div className="flex flex-wrap gap-1.5 text-sm font-mono leading-relaxed">
          {result.diff.map((op: DiffOp, i: number) =>
            op.tokens.map((token, j) => (
              <span
                key={`${i}-${j}`}
                className={
                  op.op === 'equal'  ? 'text-gray-300' :
                  op.op === 'insert' ? 'bg-studio-nl/20 text-studio-nl px-1 rounded' :
                                       'bg-studio-danger/20 text-studio-danger px-1 rounded line-through'
                }
              >
                {token}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Sets */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3">
          <div className="text-xs text-studio-danger mb-2">Uniquement à gauche ({result.left_only.length})</div>
          <div className="flex flex-wrap gap-1">
            {result.left_only.slice(0, 30).map((t) => (
              <span key={t} className="badge bg-studio-danger/15 text-studio-danger">{t}</span>
            ))}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-studio-nl mb-2">Uniquement à droite ({result.right_only.length})</div>
          <div className="flex flex-wrap gap-1">
            {result.right_only.slice(0, 30).map((t) => (
              <span key={t} className="badge bg-studio-nl/15 text-studio-nl">{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
