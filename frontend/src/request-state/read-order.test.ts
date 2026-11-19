import { describe, expect, it } from 'vitest';
import { ReadOrder } from './read-order';

describe('resource read ordering', () => {
  it('accepts completed data while newer reads remain pending', () => {
    const order = new ReadOrder();
    const first = order.start();
    const second = order.start();
    expect(order.acceptData(first)).toBe(true);
    expect(order.acceptData(second)).toBe(true);
  });

  it('keeps a newer transient error without discarding an older revocation', () => {
    const order = new ReadOrder();
    const revoked = order.start();
    const failed = order.start();
    expect(order.acceptFeedback(failed)).toBe(true);
    expect(order.acceptData(revoked)).toBe(true);
    expect(order.acceptFeedback(revoked)).toBe(false);
  });

  it('rejects older data and errors after newer authoritative data', () => {
    const order = new ReadOrder();
    const old = order.start();
    const latest = order.start();
    expect(order.acceptData(latest)).toBe(true);
    expect(order.acceptFeedback(latest)).toBe(true);
    expect(order.acceptData(old)).toBe(false);
    expect(order.acceptFeedback(old)).toBe(false);
  });

});
