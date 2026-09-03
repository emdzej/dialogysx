/**
 * Which in-flight request is still allowed to write.
 *
 * Every catalogue action is `await`ed against data read over `Range` requests,
 * so two overlapping ones finish in whichever order the network decides — and
 * the naive version let the *older* one write last. Typing a build number and
 * immediately answering a criterion resolved the same plate twice; the
 * build-number pass returned second and restored its own result, computed from
 * a specification that predated the answer. On screen the answer was accepted
 * and the undecided count did not move.
 *
 * A plain counter is enough: claim on entry, check before writing. Kept out of
 * `state.svelte.ts` because runes need the Svelte compiler, and this part is
 * ordinary logic that deserves an ordinary test.
 */
export class Generations {
  private current = 0;

  /** Start a new request; every older one becomes stale. */
  claim(): number {
    return ++this.current;
  }

  /** True once something newer has been claimed — do not write. */
  stale(gen: number): boolean {
    return gen !== this.current;
  }
}
