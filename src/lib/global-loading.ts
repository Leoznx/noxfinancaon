export const GLOBAL_LOADING_TIMEOUT_MS = 20_000;

/**
 * Keeps concurrent loading operations isolated. Finishing an old request cannot
 * release a newer one because every operation owns a different token.
 */
export class LoadingTokenRegistry {
  private nextToken = 0;
  private readonly tokens = new Set<number>();

  begin() {
    const token = ++this.nextToken;
    this.tokens.add(token);
    return token;
  }

  end(token: number) {
    return this.tokens.delete(token);
  }

  get active() {
    return this.tokens.size > 0;
  }

  get size() {
    return this.tokens.size;
  }
}
