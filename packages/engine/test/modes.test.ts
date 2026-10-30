import { describe, expect, it } from "vitest";
import { CURSED_APPLE, isOwnable } from "../src/board";
import { CLASSIC_RULES, QUICK_RULES } from "../src/config";
import { applyAction, applyTimeout, createGame, endEarly, startFinalRound } from "../src/game";
import { WALKER } from "../src/rules";
import { computeStandings } from "../src/scoring";
import type { GameState } from "../src/state";
import { act, apply, newGame, own, player, roll } from "./helpers";

const ok = (result: ReturnType<typeof applyTimeout>) => {
  if (!result.ok) throw new Error(result.error.message);
  return result;
};

describe("Quick mode", () => {
  it("deals two paid-for properties to each player", () => {
    const s = createGame(
      ["a", "b", "c"].map((id) => ({ id, name: id })),
      QUICK_RULES,
      11,
    );
    for (const p of s.players) {
      const owned = s.owners.flatMap((o, i) => (o === p.id ? [i] : []));
      expect(owned).toHaveLength(2);
      const paid = owned.reduce((sum, i) => {
        const space = CURSED_APPLE.spaces[i];
        return sum + (space && isOwnable(space) ? space.price : 0);
      }, 0);
      expect(p.cash).toBe(1500 - paid);
    }
  });

  it("upgrades to a Walker after three Guardians and sells back down to three", () => {
    let s = newGame(2, QUICK_RULES);
    s.owners = s.owners.map(() => null);
    own(s, "a", 1, 3);
    s.buildings[1] = 3;
    s.buildings[3] = 3;
    s.phase = { kind: "awaitingEndTurn" };
    ({ state: s } = apply(s, "a", { type: "build", space: 1 }));
    expect(s.buildings[1]).toBe(WALKER);
    const before = player(s, "a").cash;
    ({ state: s } = apply(s, "a", { type: "sellBuilding", space: 1 }));
    expect(s.buildings[1]).toBe(3);
    expect(player(s, "a").cash).toBe(before + 25);
  });

  it("ends and scores the game at the second bankruptcy", () => {
    let s = newGame(4, { bankruptciesToEnd: 2, auctions: false });
    player(s, "a").cash = 10;
    ({ state: s } = roll(s, [1, 3]));
    expect(player(s, "a").bankrupt).toBe(true);
    expect(s.phase.kind).toBe("awaitingRoll");
    player(s, "b").cash = 10;
    ({ state: s } = roll(s, [1, 3]));
    expect(s.phase).toMatchObject({ kind: "gameOver", reason: "bankruptcies" });
    if (s.phase.kind !== "gameOver") throw new Error("unreachable");
    expect(s.phase.standings.map((st) => st.playerId).slice(-2)).toEqual(["b", "a"]);
  });
});

describe("rounds and limits", () => {
  const endTurn = (s: GameState, id: string) => act(s, id, "endTurn").state;

  it("counts a round each time play wraps to the first seat", () => {
    let s = newGame(3, { auctions: false });
    for (const id of ["a", "b", "c"]) {
      ({ state: s } = roll(s, [1, 3]));
      s = endTurn(s, id);
    }
    expect(s.turn.round).toBe(2);
    expect(s.turn.number).toBe(4);
  });

  it("ends after the round limit", () => {
    let s = newGame(2, { roundLimit: 1, auctions: false });
    ({ state: s } = roll(s, [1, 3]));
    s = endTurn(s, "a");
    ({ state: s } = roll(s, [1, 3]));
    const { state, events } = act(s, "b", "endTurn");
    expect(state.phase).toMatchObject({ kind: "gameOver", reason: "roundLimit" });
    expect(events.at(-1)).toMatchObject({ type: "gameOver", reason: "roundLimit" });
  });

  it("finishes the current round after the time limit expires", () => {
    let s = newGame(3, { auctions: false });
    ({ state: s } = roll(s, [1, 3]));
    s = endTurn(s, "a");
    s = ok(startFinalRound(s)).state;
    expect(s.finalRound).toBe(1);
    ({ state: s } = roll(s, [1, 3]));
    s = endTurn(s, "b");
    expect(s.phase.kind).toBe("awaitingRoll");
    ({ state: s } = roll(s, [1, 3]));
    s = endTurn(s, "c");
    expect(s.phase).toMatchObject({ kind: "gameOver", reason: "timeLimit" });
  });

  it("ends early on request and rejects further actions", () => {
    const s = newGame();
    const { state, events } = ok(endEarly(s));
    expect(state.phase).toMatchObject({ kind: "gameOver", reason: "endedEarly" });
    expect(events).toEqual([expect.objectContaining({ type: "gameOver", reason: "endedEarly" })]);
    expect(applyAction(state, "a", { type: "roll" }).ok).toBe(false);
    expect(endEarly(state).ok).toBe(false);
  });
});

describe("standings", () => {
  it("adds cash, property value (half if sealed) and building cost", () => {
    const s = newGame(3);
    own(s, "a", 1, 3);
    s.buildings[1] = 2;
    s.sealed[3] = false;
    own(s, "b", 39);
    s.sealed[39] = true;
    player(s, "c").cash = 1000;
    const standings = computeStandings(s);
    expect(standings.map((st) => [st.playerId, st.netWorth])).toEqual([
      ["a", 1500 + 120 + 100],
      ["b", 1500 + 200],
      ["c", 1000],
    ]);
    expect(standings[0]).toMatchObject({ rank: 1, propertyValue: 120, buildingValue: 100 });
  });

  it("breaks ties by cash, then seat, and ranks the last to fall above earlier bankruptcies", () => {
    const s = newGame(4);
    own(s, "b", 1);
    player(s, "b").cash = 1440;
    Object.assign(player(s, "c"), { bankrupt: true, cash: 0 });
    Object.assign(player(s, "d"), { bankrupt: true, cash: 0 });
    s.eliminationOrder = ["d", "c"];
    expect(computeStandings(s).map((st) => st.playerId)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("timeouts", () => {
  it("rolls for a player who stalls", () => {
    const { state, events } = ok(applyTimeout(newGame(2, { auctions: false })));
    expect(events[0]).toEqual({ type: "timedOut", playerIds: ["a"] });
    expect(events.some((e) => e.type === "rolled")).toBe(true);
    expect(state.turn.lastRoll).not.toBeNull();
  });

  it("declines a purchase and ends a turn", () => {
    let s = roll(newGame(2, { auctions: false }), [1, 2]).state;
    s = ok(applyTimeout(s)).state;
    expect(s.owners[3]).toBeNull();
    expect(s.phase).toEqual({ kind: "awaitingEndTurn" });
    s = ok(applyTimeout(s)).state;
    expect(s.players[s.turn.playerIndex]?.id).toBe("b");
  });

  it("drops idle bidders out of an auction, leaving the high bid to win", () => {
    let s = roll(newGame(3), [1, 2]).state;
    ({ state: s } = act(s, "a", "decline"));
    ({ state: s } = apply(s, "b", { type: "bid", amount: 30 }));
    const { state, events } = ok(applyTimeout(s));
    expect(events[0]).toEqual({ type: "timedOut", playerIds: ["a", "c"] });
    expect(state.owners[3]).toBe("b");
  });

  it("raises just enough owed funds by selling, then pays", () => {
    const s = newGame();
    own(s, "b", 1, 3);
    s.buildings[1] = 3;
    s.buildings[3] = 3;
    own(s, "a", 31, 32, 34);
    s.buildings[31] = 1;
    s.buildings[32] = 1;
    s.buildings[34] = 1;
    player(s, "a").cash = 100;
    const inDebt = roll(s, [1, 2]).state;
    expect(inDebt.phase.kind).toBe("raisingFunds");
    const { state } = ok(applyTimeout(inDebt));
    expect(state.debts).toEqual([]);
    expect(player(state, "a").bankrupt).toBe(false);
    expect(player(state, "b").cash).toBe(1680);
    // Only as much is sold as the debt needs.
    expect([31, 32, 34].reduce((n, i) => n + (state.buildings[i] ?? 0), 0)).toBe(2);
    expect(player(state, "a").cash).toBe(20);
  });

  it("refuses once the game is over", () => {
    const over = ok(endEarly(newGame())).state;
    expect(applyTimeout(over).ok).toBe(false);
  });
});

describe("classic defaults", () => {
  it("leaves Quick-only rules off", () => {
    expect(CLASSIC_RULES).toMatchObject({
      guardiansPerWalker: 4,
      startingProperties: 0,
      bankruptciesToEnd: null,
      roundLimit: null,
    });
  });
});
