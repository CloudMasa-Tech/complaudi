import { describe, expect, it } from 'vitest';
import { boolish } from '../src/lib/boolish';

describe('boolish', () => {
  it('reads the string "false" as false, unlike z.coerce.boolean', () => {
    expect(boolish().parse('false')).toBe(false);
    expect(boolish().parse('0')).toBe(false);
    expect(boolish().parse('no')).toBe(false);
    expect(boolish().parse('off')).toBe(false);
    expect(boolish().parse('')).toBe(false);
  });

  it('reads the usual truthy spellings as true', () => {
    for (const v of ['true', 'TRUE', ' True ', '1', 'yes', 'y', 'on']) {
      expect(boolish().parse(v)).toBe(true);
    }
  });

  it('passes real booleans through', () => {
    expect(boolish().parse(true)).toBe(true);
    expect(boolish().parse(false)).toBe(false);
  });

  it('applies the default when the value is absent', () => {
    expect(boolish(true).parse(undefined)).toBe(true);
    expect(boolish(false).parse(undefined)).toBe(false);
  });

  it('rejects a value that is not a boolean at all, rather than guessing', () => {
    const result = boolish().safeParse('maybe');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('Expected a boolean');
  });
});
