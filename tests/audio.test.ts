import { describe, expect, it, vi } from 'vitest';
import { holdGain } from '../src/music';

describe('portable audio gain automation', () => {
  it('uses native hold semantics when available', () => {
    const param = {
      value: 0.3,
      cancelAndHoldAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
    };
    holdGain(param as unknown as AudioParam, 7);
    expect(param.cancelAndHoldAtTime).toHaveBeenCalledWith(7);
    expect(param.cancelScheduledValues).not.toHaveBeenCalled();
    expect(param.setValueAtTime).not.toHaveBeenCalled();
  });
  it('captures the instantaneous level before cancelling old automation', () => {
    const calls: unknown[] = [];
    const param = {
      value: 0.27,
      cancelScheduledValues: (time: number) => {
        calls.push(['cancel', time]);
        param.value = 1;
      },
      setValueAtTime: (value: number, time: number) => {
        calls.push(['hold', value, time]);
      },
    };
    holdGain(param as unknown as AudioParam, 7);
    expect(calls).toEqual([
      ['cancel', 7],
      ['hold', 0.27, 7],
    ]);
  });
});
