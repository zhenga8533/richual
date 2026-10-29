import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nextFloat, nextInt, seedRng, shuffle } from "../src/rng";

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const run = (seed: number) => {
      let s = seedRng(seed);
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        let v: number;
        [v, s] = nextInt(s, 1, 6);
        out.push(v);
      }
      return out;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it("produces floats in [0, 1)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const [v] = nextFloat(seedRng(seed));
        return v >= 0 && v < 1;
      }),
    );
  });

  it("produces ints within the inclusive range", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const [v] = nextInt(seedRng(seed), 1, 6);
        return Number.isInteger(v) && v >= 1 && v <= 6;
      }),
    );
  });

  it("covers every die face with a roughly uniform distribution", () => {
    let s = seedRng(7);
    const counts = [0, 0, 0, 0, 0, 0];
    const n = 60_000;
    for (let i = 0; i < n; i++) {
      let v: number;
      [v, s] = nextInt(s, 1, 6);
      counts[v - 1] = (counts[v - 1] ?? 0) + 1;
    }
    for (const c of counts) expect(Math.abs(c - n / 6)).toBeLessThan(n * 0.01);
  });

  it("rejects invalid ranges", () => {
    expect(() => nextInt(0, 6, 1)).toThrow(RangeError);
    expect(() => nextInt(0, 0.5, 2)).toThrow(RangeError);
  });

  it("shuffles into a permutation without mutating the input", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.array(fc.integer()), (seed, xs) => {
        const input = [...xs];
        const [out] = shuffle(seedRng(seed), input);
        expect(input).toEqual(xs);
        expect([...out].sort()).toEqual([...xs].sort());
      }),
    );
  });
});
