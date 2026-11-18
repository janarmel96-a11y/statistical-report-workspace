// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { describe, expect, it } from 'vitest';
import { MIN_BOX, moveBox, resizeBox, type Box, type Handle } from '../src/video/project';

const box: Box = { x: 0.2, y: 0.3, w: 0.4, h: 0.3 };
const onFrame = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9;

describe('moving an item', () => {
  it('moves without changing size', () => {
    const b = moveBox(box, 0.1, -0.1);
    expect(b.x).toBeCloseTo(0.3, 9);
    expect(b.y).toBeCloseTo(0.2, 9);
    expect(b.w).toBe(box.w);
    expect(b.h).toBe(box.h);
  });
  it('stops at every edge of the frame', () => {
    expect(moveBox(box, -5, -5)).toMatchObject({ x: 0, y: 0 });
    const far = moveBox(box, 5, 5);
    expect(far.x + far.w).toBeCloseTo(1, 9);
    expect(far.y + far.h).toBeCloseTo(1, 9);
  });
});

describe('resizing an item', () => {
  it('keeps the opposite corner still', () => {
    const b = resizeBox(box, 'se', 0.1, 0.1);
    expect(b.x).toBe(box.x);
    expect(b.y).toBe(box.y);
    expect(b.w).toBeCloseTo(0.5, 9);
    expect(b.h).toBeCloseTo(0.4, 9);
    const c = resizeBox(box, 'nw', 0.1, 0.1);
    expect(c.x + c.w).toBeCloseTo(box.x + box.w, 9);
    expect(c.y + c.h).toBeCloseTo(box.y + box.h, 9);
  });
  it('changes one direction from an edge', () => {
    const b = resizeBox(box, 'e', 0.1, 0.2);
    expect(b.w).toBeCloseTo(0.5, 9);
    expect(b.h).toBe(box.h);
  });
  it.each<Handle>(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'])('%s never leaves the frame or collapses', (h) => {
    [[-5, -5], [5, 5], [-5, 5], [5, -5]].forEach(([dx, dy]) => {
      const b = resizeBox(box, h, dx, dy);
      expect(onFrame(b)).toBe(true);
      expect(b.w).toBeGreaterThanOrEqual(Math.min(box.w, MIN_BOX) - 1e-9);
      expect(b.h).toBeGreaterThanOrEqual(Math.min(box.h, MIN_BOX) - 1e-9);
    });
  });
});
