// why: Cursor payloads use camelCase hook_event_name + workspace_roots; Claude payloads don't.
const CAMEL_CASE_EVENT_NAME = /^[a-z][a-zA-Z0-9]*$/;

export function detectCursor(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return false;
  }
  const value = raw as Record<string, unknown>;
  const eventName = value.hook_event_name;
  if (typeof eventName !== "string" || !CAMEL_CASE_EVENT_NAME.test(eventName)) {
    return false;
  }
  return Array.isArray(value.workspace_roots);
}
