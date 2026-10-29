import { describe, expect, it } from "vitest";
import { CURSED_APPLE } from "../src/board";
import { applyAction, createGame } from "../src/game";
import { getLegalActions } from "../src/legal";
import { migrateState } from "../src/migrations";
import { sealedTransferFee, unsealCost, WALKER } from "../src/rules";
import type { Action, GameState, TradeBundle } from "../src/state";
import { act, apply, newGame, own, player, roll } from "./helpers";

const types = (s: GameState, id: string) => getLegalActions(s, id).map((a) => a.type);
const rejected = (s: GameState, id: string, action: Action) => {
  const result = applyAction(s, id, action);
  expect(result.ok, `${action.type} should be rejected`).toBe(false);
  return result.ok ? null : result.error;
};
const bundle = (b: Partial<TradeBundle> = {}): TradeBundle => ({
  cash: 0,
  spaces: [],
  getOutCards: [],
  ...b,
});

describe("building", () => {
  /** Player a owns the brown set (1, 3) and it is a's turn to manage. */
  const brownSet = (rules = {}) => {
    const s = newGame(2, rules);
    own(s, "a", 1, 3);
    s.phase = { kind: "awaitingEndTurn" };
    return s;
  };

  it("requires the full color set", () => {
    const s = newGame();
    own(s, "a", 1);
    s.phase = { kind: "awaitingEndTurn" };
    expect(rejected(s, "a", { type: "build", space: 1 })?.code).toBe("illegal_action");
  });

  it("charges the build cost and raises rent", () => {
    const { state } = apply(brownSet(), "a", { type: "build", space: 1 });
    expect(state.buildings[1]).toBe(1);
    expect(player(state, "a").cash).toBe(1450);
  });

  it("enforces even building and even selling", () => {
    let s = brownSet();
    ({ state: s } = apply(s, "a", { type: "build", space: 1 }));
    expect(rejected(s, "a", { type: "build", space: 1 })).not.toBeNull();
    ({ state: s } = apply(s, "a", { type: "build", space: 3 }));
    ({ state: s } = apply(s, "a", { type: "build", space: 1 }));
    expect(rejected(s, "a", { type: "sellBuilding", space: 3 })).not.toBeNull();
    ({ state: s } = apply(s, "a", { type: "sellBuilding", space: 1 }));
    expect(s.buildings.slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(player(s, "a").cash).toBe(1500 - 150 + 25);
  });

  it("allows uneven building when the rule is off", () => {
    let s = brownSet({ evenBuilding: false });
    ({ state: s } = apply(s, "a", { type: "build", space: 1 }));
    ({ state: s } = apply(s, "a", { type: "build", space: 1 }));
    expect(s.buildings[1]).toBe(2);
  });

  it("upgrades four Guardians to a Walker", () => {
    const s = brownSet();
    s.buildings[1] = 4;
    s.buildings[3] = 4;
    const { state } = apply(s, "a", { type: "build", space: 1 });
    expect(state.buildings[1]).toBe(WALKER);
    expect(rejected(state, "a", { type: "build", space: 1 })).not.toBeNull();
  });

  it("respects the bank's limited Guardian supply", () => {
    const s = brownSet();
    own(s, "b", 37, 39);
    s.buildings[37] = 4;
    s.buildings[39] = 4;
    // 24 more Guardians elsewhere exhausts the supply of 32.
    own(s, "b", 31, 32, 34, 26, 27, 29);
    for (const i of [31, 32, 34, 26, 27, 29]) s.buildings[i] = 4;
    expect(types(s, "a")).not.toContain("build");
    expect(
      getLegalActions({ ...s, config: { ...s.config, limitedBuildings: false } }, "a"),
    ).toContainEqual({
      type: "build",
      space: 1,
    });
  });

  it("breaks a Walker down into only as many Guardians as the bank has", () => {
    const s = brownSet();
    s.buildings[1] = WALKER;
    s.buildings[3] = WALKER;
    own(s, "b", 31, 32, 34, 26, 27, 29, 37, 39);
    for (const i of [31, 32, 34, 26, 27, 29, 37]) s.buildings[i] = 4; // 28 in use
    const { state } = apply(s, "a", { type: "sellBuilding", space: 1 });
    expect(state.buildings[1]).toBe(4);
    s.buildings[39] = 2; // 30 in use: only 2 left
    const short = apply(s, "a", { type: "sellBuilding", space: 1 }).state;
    expect(short.buildings[1]).toBe(2);
    expect(player(short, "a").cash).toBe(1500 + 75);
  });

  it("only lets the current player build", () => {
    const s = brownSet();
    s.turn.playerIndex = 1;
    expect(rejected(s, "a", { type: "build", space: 1 })?.code).toBe("illegal_action");
  });
});

describe("sealing", () => {
  const owned = () => {
    const s = newGame();
    own(s, "a", 1, 3);
    s.phase = { kind: "awaitingEndTurn" };
    return s;
  };

  it("pays half the price and stops rent", () => {
    let s = owned();
    ({ state: s } = apply(s, "a", { type: "seal", space: 3 }));
    expect(s.sealed[3]).toBe(true);
    expect(player(s, "a").cash).toBe(1530);
    ({ state: s } = act(s, "a", "endTurn"));
    ({ state: s } = roll(s, [1, 2]));
    expect(player(s, "b").cash).toBe(1500);
  });

  it("costs the mortgage plus 10% to unseal", () => {
    const s = owned();
    own(s, "a", 37);
    s.sealed[37] = true;
    const { state } = apply(s, "a", { type: "unseal", space: 37 });
    expect(state.sealed[37]).toBe(false);
    expect(player(state, "a").cash).toBe(1500 - 193);
  });

  it("computes unseal costs and transfer interest without rounding errors", () => {
    expect(unsealCost(CURSED_APPLE, 6)).toBe(55);
    expect(unsealCost(CURSED_APPLE, 37)).toBe(193);
    expect(sealedTransferFee(CURSED_APPLE, 6)).toBe(5);
    expect(sealedTransferFee(CURSED_APPLE, 37)).toBe(18);
  });

  it("refuses to seal while the set has buildings, and blocks building on a sealed set", () => {
    const s = owned();
    s.buildings[1] = 1;
    expect(rejected(s, "a", { type: "seal", space: 3 })).not.toBeNull();
    s.buildings[1] = 0;
    s.sealed[3] = true;
    expect(rejected(s, "a", { type: "build", space: 1 })).not.toBeNull();
  });
});

describe("auctions", () => {
  const declined = (players = 3) => {
    let s = newGame(players);
    ({ state: s } = roll(s, [1, 2]));
    ({ state: s } = act(s, "a", "decline"));
    return s;
  };

  it("auctions a declined property to every solvent player", () => {
    const s = declined();
    expect(s.phase).toEqual({
      kind: "auction",
      space: 3,
      highBid: 0,
      highBidder: null,
      bidders: ["a", "b", "c"],
    });
  });

  it("sells to the last bidder standing", () => {
    let s = declined();
    ({ state: s } = apply(s, "b", { type: "bid", amount: 20 }));
    ({ state: s } = apply(s, "c", { type: "bid", amount: 35 }));
    ({ state: s } = apply(s, "a", { type: "passAuction" }));
    ({ state: s } = apply(s, "b", { type: "passAuction" }));
    expect(s.owners[3]).toBe("c");
    expect(player(s, "c").cash).toBe(1465);
    expect(s.phase).toEqual({ kind: "awaitingEndTurn" });
  });

  it("leaves the property unsold when everyone passes", () => {
    let s = declined(2);
    ({ state: s } = apply(s, "a", { type: "passAuction" }));
    ({ state: s } = apply(s, "b", { type: "passAuction" }));
    expect(s.owners[3]).toBeNull();
    expect(s.phase).toEqual({ kind: "awaitingEndTurn" });
  });

  it("validates bids", () => {
    let s = declined();
    ({ state: s } = apply(s, "b", { type: "bid", amount: 20 }));
    expect(rejected(s, "c", { type: "bid", amount: 20 })).not.toBeNull();
    expect(rejected(s, "c", { type: "bid", amount: 1501 })).not.toBeNull();
    expect(rejected(s, "c", { type: "bid", amount: 25.5 })).not.toBeNull();
    expect(rejected(s, "b", { type: "passAuction" })).not.toBeNull();
    ({ state: s } = apply(s, "a", { type: "passAuction" }));
    expect(rejected(s, "a", { type: "bid", amount: 50 })).not.toBeNull();
  });

  it("keeps an extra roll earned before the auction", () => {
    let s = newGame(2);
    ({ state: s } = roll(s, [3, 3]));
    ({ state: s } = act(s, "a", "decline"));
    ({ state: s } = apply(s, "a", { type: "passAuction" }));
    ({ state: s } = apply(s, "b", { type: "passAuction" }));
    expect(s.phase).toEqual({ kind: "awaitingRoll" });
    expect(s.players[s.turn.playerIndex]?.id).toBe("a");
  });

  it("auctions a bankrupt player's holdings when they owed the bank", () => {
    let s = newGame(3);
    own(s, "a", 5, 1);
    player(s, "a").cash = 10;
    ({ state: s } = roll(s, [1, 3]));
    expect(player(s, "a").bankrupt).toBe(true);
    expect(s.phase).toMatchObject({ kind: "auction", space: 1, bidders: ["b", "c"] });
    expect(s.auctionQueue).toEqual([5]);
    ({ state: s } = apply(s, "b", { type: "passAuction" }));
    ({ state: s } = apply(s, "c", { type: "passAuction" }));
    expect(s.phase).toMatchObject({ kind: "auction", space: 5 });
    ({ state: s } = apply(s, "b", { type: "bid", amount: 100 }));
    ({ state: s } = apply(s, "c", { type: "passAuction" }));
    expect(s.owners[5]).toBe("b");
    expect(s.phase).toEqual({ kind: "awaitingRoll" });
    expect(s.players[s.turn.playerIndex]?.id).toBe("b");
  });
});

describe("raising funds", () => {
  /** a lands on b's Bear Pit with three Guardians (rent 180) holding only 100. */
  const inDebt = () => {
    const s = newGame();
    own(s, "b", 1, 3);
    s.buildings[1] = 3;
    s.buildings[3] = 3;
    own(s, "a", 37, 39);
    player(s, "a").cash = 100;
    return roll(s, [1, 2]).state;
  };

  it("lets a debtor seal and pay instead of going bankrupt", () => {
    let s = inDebt();
    expect(s.phase).toEqual({ kind: "raisingFunds" });
    expect(s.debts).toEqual([{ debtor: "a", creditor: "b", amount: 180, reason: "rent" }]);
    expect(types(s, "a")).toEqual(["declareBankruptcy", "seal", "seal"]);
    expect(types(s, "b")).toEqual([]);
    ({ state: s } = apply(s, "a", { type: "seal", space: 37 }));
    ({ state: s } = apply(s, "a", { type: "payDebt" }));
    expect(player(s, "a").cash).toBe(95);
    expect(player(s, "b").cash).toBe(1680);
    expect(s.phase).toEqual({ kind: "awaitingEndTurn" });
  });

  it("hands everything to the creditor on a declared bankruptcy", () => {
    let s = inDebt();
    ({ state: s } = apply(s, "a", { type: "declareBankruptcy" }));
    expect(s.owners[37]).toBe("b");
    expect(s.phase).toEqual({ kind: "gameOver", winnerId: "b" });
  });

  it("goes straight to bankruptcy when even selling everything would not cover it", () => {
    const s = newGame();
    own(s, "b", 39);
    s.buildings[39] = WALKER;
    own(s, "b", 37);
    player(s, "a").position = 36;
    player(s, "a").cash = 100;
    expect(roll(s, [1, 2]).state.phase).toEqual({ kind: "gameOver", winnerId: "b" });
  });

  it("moves a jailed player only after the forced fine is paid", () => {
    let s = newGame(2, { freeParkingJackpot: false });
    Object.assign(player(s, "a"), { position: 10, inJail: true, jailAttempts: 2, cash: 20 });
    own(s, "a", 39);
    ({ state: s } = roll(s, [1, 2]));
    expect(s.phase).toEqual({ kind: "raisingFunds" });
    expect(player(s, "a")).toMatchObject({ position: 10, inJail: true });
    ({ state: s } = apply(s, "a", { type: "seal", space: 39 }));
    ({ state: s } = apply(s, "a", { type: "payDebt" }));
    expect(player(s, "a")).toMatchObject({ position: 13, inJail: false, cash: 170 });
    expect(s.phase).toEqual({ kind: "awaitingBuy", space: 13 });
  });

  it("lets another player raise funds for a card, then resumes the turn", () => {
    let s = newGame(2);
    const cardIndex = s.decks.coven.drawPile.find((i) => i === 8) ?? 8;
    s.decks.coven.drawPile = [cardIndex, ...s.decks.coven.drawPile.filter((i) => i !== cardIndex)];
    player(s, "b").cash = 5;
    own(s, "b", 39);
    ({ state: s } = roll(s, [1, 1]));
    expect(s.debts).toEqual([{ debtor: "b", creditor: "a", amount: 10, reason: "card" }]);
    expect(types(s, "a")).toEqual([]);
    ({ state: s } = apply(s, "b", { type: "seal", space: 39 }));
    ({ state: s } = apply(s, "b", { type: "payDebt" }));
    expect(s.phase).toEqual({ kind: "awaitingRoll" });
    expect(s.players[s.turn.playerIndex]?.id).toBe("a");
  });
});

describe("trades", () => {
  const setup = () => {
    const s = newGame(3);
    own(s, "a", 1);
    own(s, "b", 3, 5);
    return s;
  };
  const propose = (
    s: GameState,
    from: string,
    to: string,
    offer: TradeBundle,
    request: TradeBundle,
  ) => apply(s, from, { type: "proposeTrade", to, offer, request });

  it("swaps properties and souls on acceptance", () => {
    let s = setup();
    ({ state: s } = propose(
      s,
      "a",
      "b",
      bundle({ spaces: [1], cash: 40 }),
      bundle({ spaces: [3] }),
    ));
    expect(s.trades).toHaveLength(1);
    expect(types(s, "b")).toEqual(["acceptTrade", "rejectTrade"]);
    ({ state: s } = apply(s, "b", { type: "acceptTrade", tradeId: 1 }));
    expect(s.owners[1]).toBe("b");
    expect(s.owners[3]).toBe("a");
    expect(player(s, "a").cash).toBe(1460);
    expect(player(s, "b").cash).toBe(1540);
    expect(s.trades).toEqual([]);
  });

  it("can be proposed outside your turn and rejected or withdrawn", () => {
    let s = setup();
    ({ state: s } = propose(s, "b", "c", bundle({ spaces: [5] }), bundle({ cash: 150 })));
    expect(rejected(s, "a", { type: "rejectTrade", tradeId: 1 })).not.toBeNull();
    const rejectedState = apply(s, "c", { type: "rejectTrade", tradeId: 1 }).state;
    expect(rejectedState.trades).toEqual([]);
    const cancelled = apply(s, "b", { type: "cancelTrade", tradeId: 1 });
    expect(cancelled.events).toContainEqual({
      type: "tradeCancelled",
      tradeId: 1,
      from: "b",
      to: "c",
      reason: "withdrawn",
    });
  });

  it("refuses invalid offers", () => {
    const s = setup();
    const propose = (offer: TradeBundle, request: TradeBundle, from = "a", to = "b") =>
      rejected(s, from, { type: "proposeTrade", to, offer, request });
    expect(propose(bundle({ spaces: [3] }), bundle())).not.toBeNull();
    expect(propose(bundle({ cash: 2000 }), bundle())).not.toBeNull();
    expect(propose(bundle(), bundle())).not.toBeNull();
    expect(propose(bundle({ spaces: [1] }), bundle(), "a", "a")).not.toBeNull();
    expect(propose(bundle({ spaces: [0] }), bundle())).not.toBeNull();
    expect(propose(bundle({ getOutCards: ["oracle"] }), bundle())).not.toBeNull();
    s.buildings[3] = 1;
    own(s, "b", 1);
    expect(propose(bundle(), bundle({ spaces: [5, 3] }))).not.toBeNull();
  });

  it("charges interest when receiving a Sealed property", () => {
    let s = setup();
    s.sealed[5] = true;
    ({ state: s } = propose(s, "b", "a", bundle({ spaces: [5] }), bundle({ cash: 50 })));
    ({ state: s } = apply(s, "a", { type: "acceptTrade", tradeId: 1 }));
    expect(player(s, "a").cash).toBe(1500 - 50 - 10);
    expect(s.sealed[5]).toBe(true);
  });

  it("withdraws offers that can no longer be honored", () => {
    let s = setup();
    ({ state: s } = propose(s, "a", "b", bundle({ cash: 1400 }), bundle({ spaces: [3] })));
    ({ state: s } = roll(s, [1, 3]));
    expect(s.trades).toEqual([]);
  });

  it("limits open offers per player", () => {
    let s = setup();
    for (let i = 0; i < 3; i++) {
      ({ state: s } = propose(s, "a", "b", bundle({ cash: 10 + i }), bundle({ spaces: [3] })));
    }
    expect(
      rejected(s, "a", {
        type: "proposeTrade",
        to: "c",
        offer: bundle({ cash: 1 }),
        request: bundle(),
      }),
    ).not.toBeNull();
  });

  it("cannot be accepted mid-auction", () => {
    let s = setup();
    ({ state: s } = propose(s, "b", "c", bundle({ spaces: [5] }), bundle({ cash: 10 })));
    ({ state: s } = roll(s, [3, 4]));
    s.phase = { kind: "auction", space: 6, highBid: 0, highBidder: null, bidders: ["a", "b", "c"] };
    expect(rejected(s, "c", { type: "acceptTrade", tradeId: 1 })).not.toBeNull();
  });
});

describe("state migration", () => {
  it("upgrades a version 1 game", () => {
    const current = createGame(
      ["a", "b"].map((id) => ({ id, name: id })),
      {
        boardId: "cursed-apple",
        startingCash: 1500,
        goSalary: 200,
        doubleOnExactGo: true,
        freeParkingJackpot: true,
        jailFine: 50,
        maxJailTurns: 3,
        auctions: true,
        evenBuilding: true,
        limitedBuildings: true,
      },
      3,
    );
    const { sealed, debts, auctionQueue, trades, nextTradeId, ...rest } = current;
    const { auctions, evenBuilding, limitedBuildings, ...v1Config } = current.config;
    const v1 = { ...rest, schemaVersion: 1, config: v1Config };
    expect(migrateState(JSON.parse(JSON.stringify(v1)))).toEqual(current);
    expect([
      sealed,
      debts,
      auctionQueue,
      trades,
      nextTradeId,
      auctions,
      evenBuilding,
      limitedBuildings,
    ]).toBeDefined();
  });

  it("refuses unknown or newer versions", () => {
    expect(() => migrateState({ schemaVersion: 99 })).toThrow();
    expect(() => migrateState({})).toThrow();
  });
});
