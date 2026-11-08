// Sealed tests: AI-built mocks keep their questions and answers hidden until you've taken them.
import { confirmDialog } from '../components/ui';
import { db } from './db';
import type { Attempt, Test } from './types';

export function hasCompleted(t: Test, attempts: Attempt[]) {
  return attempts.some((a) => a.testId === t.id && a.status === 'completed' && a.kind === 'full');
}

/** Still sealed: built by AI and not yet finished once. */
export function isLocked(t: Test, attempts: Attempt[]) {
  return !!t.sealed && !hasCompleted(t, attempts);
}

/** Ask before revealing; unseals permanently if the student agrees. */
export async function confirmUnseal(t: Test): Promise<boolean> {
  const ok = await confirmDialog({
    title: 'Reveal the answers?',
    body: 'This test is sealed so you can take it without spoilers. Opening it now shows every question, answer and explanation — it won’t be a fair mock any more.',
    ok: 'Reveal anyway',
    danger: true,
  });
  if (ok) await db.putTest({ ...t, sealed: false, updatedAt: Date.now() });
  return ok;
}
