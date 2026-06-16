/** Opaque, collision-resistant id for user records. */
export function newId(): string {
  return crypto.randomUUID();
}
