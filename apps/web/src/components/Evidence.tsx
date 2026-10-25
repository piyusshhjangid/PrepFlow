import type { TopicEvidence } from '@prepflow/shared';
import { formatPageRef } from '../lib/format';

const SUPPORT_LABEL = {
  direct: 'Direct support',
  nearby: 'Nearby support',
  weak: 'Weak topic link',
} as const;
const SUPPORT_DESCRIPTION = {
  direct: 'The quote itself uses the topic’s words.',
  nearby: 'The topic’s words appear elsewhere in the same paragraph.',
  weak: 'The quote is verified, but does not clearly connect to this topic. Review it before relying on the topic.',
} as const;

/** Checkpoint C's verified evidence: canonical quotes with the page PrepFlow derived itself. */
export function EvidenceList({ evidence }: { evidence: TopicEvidence[] }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-indigo-700">
        Evidence ({evidence.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {evidence.map((item, index) => (
          <li key={index} className="rounded border-l-2 border-indigo-300 bg-slate-50 px-3 py-2">
            <blockquote className="text-sm text-slate-800">“{item.snippet}”</blockquote>
            <p className="mt-1 text-xs text-slate-500">
              {item.materialName ?? 'Pasted text'} · {formatPageRef(item.page, item.pageEnd)}
            </p>
            {item.support && (
              <p className="mt-1 text-xs text-slate-600" title={SUPPORT_DESCRIPTION[item.support]}>
                <span className="font-medium">{SUPPORT_LABEL[item.support]}.</span>{' '}
                {SUPPORT_DESCRIPTION[item.support]}
              </p>
            )}
            {item.importanceCue && (
              <p className="mt-1 text-xs text-emerald-800">
                Material importance signal: “{item.importanceCue}”
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
