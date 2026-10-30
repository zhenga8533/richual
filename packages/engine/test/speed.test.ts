import { describe, expect, it } from "vitest";
import { CURSED_APPLE, isOwnable } from "../src/board";
import { QUICK_RULES } from "../src/config";
import type { GameState } from "../src/state";
import { newGame, own, player, roll, rollWithSpeed } from "./helpers";

/** A two-player game with the Speed Die on, already in round 2, and no properties dealt. */
function speedGame(): GameState {
  const s = newGame(2, { speedDie: true, auctions: false });
  s.turn.round = 2;
  return s;
}

describe("Speed Die", () => {
  it("is on in Quick mode", () => {
    expect(QUICK_RULES.speedDie).toBe(true);
  });

  it("stays out of the first round", () => {
    const s = speedGame();
    s.turn.round = 1;
    const { events, state } = roll(s, [1, 2]);
    expect(events[0]).toEqual({ type: "rolled", playerId: "a", dice: [1, 2] });
    expect(player(state, "a").position).toBe(3);
  });

  it("adds a number face to the move", () => {
    const { state, events } = rollWithSpeed(speedGame(), [1, 2], 3);
    expect(events[0]).toMatchObject({ dice: [1, 2], speed: 3 });
    expect(player(state, "a").position).toBe(6);
    expect(state.turn.lastSpeed).toBe(3);
  });

  it("stays on an unowned property reached with the Patron", () => {
    const { state } = rollWithSpeed(speedGame(), [1, 2], "patron");
    expect(player(state, "a").position).toBe(3);
    expect(state.phase).toEqual({ kind: "awaitingBuy", space: 3 });
  });

  it("carries on to the next unowned property with the Patron", () => {
    const s = speedGame();
    own(s, "b", 3, 5);
    // 1 + 3 lands on the Tithe; the next unowned property is Harlem Numbers Den (6).
    const { state } = rollWithSpeed(s, [1, 3], "patron");
    expect(player(state, "a")).toMatchObject({ position: 6, cash: 1500 });
    expect(state.phase).toEqual({ kind: "awaitingBuy", space: 6 });
  });

  it("goes to the next space where rent is owed once everything is owned", () => {
    const s = speedGame();
    // a owns the first three ownable spaces; b owns every other one.
    s.owners = CURSED_APPLE.spaces.map((space, i) =>
      isOwnable(space) ? (i <= 5 ? "a" : "b") : null,
    );
    s.sealed[6] = true;
    // 1 + 3 lands on the Tithe; 5 is a's own and 6 is sealed (no rent), so it stops at 8.
    const { state } = rollWithSpeed(s, [1, 3], "patron");
    expect(player(state, "a").position).toBe(8);
  });

  it("does not save you from Banished", () => {
    const s = speedGame();
    player(s, "a").position = 25;
    const { state } = rollWithSpeed(s, [2, 3], "patron");
    expect(player(state, "a")).toMatchObject({ position: 10, inJail: true });
  });

  it("is not rolled to leave the Lost Whisper", () => {
    const s = speedGame();
    Object.assign(player(s, "a"), { position: 10, inJail: true });
    const { events } = rollWithSpeed(s, [3, 3], 3);
    expect(events[0]).not.toHaveProperty("speed");
  });
});
