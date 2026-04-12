import { describe, expect, it } from 'vitest';

import { clampTerminalHeight, getTerminalMaxHeight } from './constants';

describe('terminal height helpers', () => {
  it('uses most of the viewport instead of a fixed half-screen cap', () => {
    expect(getTerminalMaxHeight(900)).toBe(760);
  });

  it('clamps requested heights to the dynamic max and min bounds', () => {
    expect(clampTerminalHeight(10_000, 900)).toBe(760);
    expect(clampTerminalHeight(40, 900)).toBe(100);
  });
});
