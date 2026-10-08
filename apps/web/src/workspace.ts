/**
 * The browser remembers which study setup (exam) it is working on. There are no accounts yet, so this
 * id is the only key to the data: it is unguessable, and it never leaves this browser except in API calls.
 * Storage can be unavailable (private mode, blocked cookies), so every access is guarded.
 */
const KEY = 'prepflow.examId';

export function getExamId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setExamId(examId: string): void {
  try {
    window.localStorage.setItem(KEY, examId);
  } catch {
    // Without storage the user must set up again after a reload; nothing else breaks.
  }
}

export function clearExamId(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
