// Compile-time exhaustiveness guard (AD-1: pure). Call it in the `default:` branch of
// a switch over a CLOSED union — or anywhere that should be unreachable given the
// types. If the union later grows a member, `value` is no longer `never`, so this
// stops type-checking AT THAT SITE: adding a new kind surfaces as a compile error at
// every place obligated to handle it, instead of a silent runtime fall-through. This
// is the codebase's contract that "adding a new thing doesn't quietly break others".
//
// If it is ever reached at runtime (an invalid value slipped past the type system, e.g.
// from unvalidated I/O), it throws and names the offending value rather than limping on.

export function assertNever(value: never, message?: string): never {
  throw new Error(
    message ?? `codegraph: unreachable — unhandled variant ${JSON.stringify(value)}`,
  );
}
