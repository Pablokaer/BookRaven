/**
 * Asks `question` and, if confirmed, runs `action` (an alert tells when it fails), then `after`
 * either way, e.g. to show the server's state again.
 */
export async function confirmThen(question: string, action: () => Promise<unknown>, after?: () => void) {
  if (!window.confirm(question)) return;
  try {
    await action();
  } catch {
    window.alert("That did not work, try again.");
  }
  after?.();
}
