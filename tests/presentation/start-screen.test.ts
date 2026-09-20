import { describe, expect, it } from 'vitest';
import { shouldShowStart } from '../../src/client/ui/StartScreen';

describe('start screen storage', () => {
  it.each(['', '?mode=coop'])('keeps startup usable when storage reads throw (%s)', (search) => {
    const storage = {
      getItem(): string | null {
        throw new DOMException('Access denied', 'SecurityError');
      },
    };

    expect(shouldShowStart(search, storage)).toBe(true);
  });
});
