import { describe, expect, it } from "vitest";
import { BOT_RESERVE, botAction } from "../src/bot";
import { checkAction } from "../src/legal";
import { WALKER } from "../src/rules";
import type { GameState, TradeBundle } from "../src/state";
import { act, apply, newGame, own, player, roll } from "./helpers";

const bundle = (b: Partial<TradeBundle> = {}): TradeBundle => ({
  cash: 0,
  spaces: [],
  getOutCards: [],
  ...b,
});

/** a has landed on the unowned Bear Pit (3). */
const deciding = (cash: number, rules = {}) => {
  const s = newGame(2, rules);
  player(s, "a").cash = cash;
  return roll(s, [1, 2]).state;
};

describe("bot buying", () => {
  it("buys when it keeps its reserve", () => {
    expect(botAction(deciding(1500), "a")).toEqual({ type: "buy" });
  });

  it("passes when buying would eat into its reserve", () => {
    expect(botAction(deciding(BOT_RESERVE + 30), "a")).toEqual({ type: "decline" });
  });

  it("still buys a property that completes a set", () => {
    const s = newGame(2);
    own(s, "a", 1);
    player(s, "a").cash = BOT_RESERVE;
    expect(botAction(roll(s, [1, 2]).state, "a")).toEqual({ type: "buy" });
  });
});

describe("bot building and turns", () => {
  it("builds on a complete set while it can afford to", () => {
    const s = newGame(2);
    own(s, "a", 37, 39);
    s.phase = { kind: "awaitingEndTurn" };
    expect(botAction(s, "a")).toMatchObject({ type: "build" });
  });

  it("ends its turn once nothing is worth doing", () => {
    const s = newGame(2);
    s.phase = { kind: "awaitingEndTurn" };
    expect(botAction(s, "a")).toEqual({ type: "endTurn" });
  });

  it("does nothing out of turn", () => {
    expect(botAction(newGame(2), "b")).toBeNull();
  });
});

describe("bot auctions", () => {
  const auction = (cash: number) => {
    let s = newGame(3);
    ({ state: s } = roll(s, [1, 2]));
    ({ state: s } = act(s, "a", "decline"));
    player(s, "b").cash = cash;
    return s;
  };

  it("bids in small steps up to what the space is worth", () => {
    const action = botAction(auction(1500), "b");
    expect(action).toMatchObject({ type: "bid" });
    if (action?.type !== "bid") throw new Error("unreachable");
    expect(action.amount).toBeLessThanOrEqual(60);
  });

  it("drops out once the price passes its valuation", () => {
    let s = auction(1500);
    ({ state: s } = apply(s, "c", { type: "bid", amount: 100 }));
    expect(botAction(s, "b")).toEqual({ type: "passAuction" });
  });

  it("waits while holding the high bid", () => {
    let s = auction(1500);
    ({ state: s } = apply(s, "b", { type: "bid", amount: 10 }));
    expect(botAction(s, "b")).toBeNull();
  });
});

describe("bot debts", () => {
  /** a owes b 180 rent holding 100, with buildings and a spare property to fall back on. */
  const inDebt = (withBuildings: boolean) => {
    const s = newGame();
    own(s, "b", 1, 3);
    s.buildings[1] = 3;
    s.buildings[3] = 3;
    own(s, "a", 37, 39, 5);
    if (withBuildings) {
      s.buildings[37] = 1;
      s.buildings[39] = 1;
    }
    player(s, "a").cash = 100;
    return roll(s, [1, 2]).state;
  };

  it("sells buildings before sealing", () => {
    expect(botAction(inDebt(true), "a")).toMatchObject({ type: "sellBuilding" });
  });

  it("seals what is not part of a complete set first", () => {
    expect(botAction(inDebt(false), "a")).toEqual({ type: "seal", space: 5 });
  });
});

describe("bot trades", () => {
  const offerTo = (offer: TradeBundle, request: TradeBundle): GameState => {
    const s = newGame(2);
    own(s, "b", 1);
    own(s, "a", 3, 6);
    return apply(s, "b", { type: "proposeTrade", to: "a", offer, request }).state;
  };

  it("accepts a clearly favourable offer", () => {
    const s = offerTo(bundle({ cash: 200 }), bundle({ spaces: [6] }));
    expect(botAction(s, "a")).toEqual({ type: "acceptTrade", tradeId: 1 });
  });

  it("declines a poor offer", () => {
    const s = offerTo(bundle({ cash: 50 }), bundle({ spaces: [6] }));
    expect(botAction(s, "a")).toEqual({ type: "rejectTrade", tradeId: 1 });
  });

  it("never breaks up its own complete set", () => {
    const s = newGame(2);
    own(s, "a", 1, 3);
    own(s, "b", 6);
    const offered = apply(s, "b", {
      type: "proposeTrade",
      to: "a",
      offer: bundle({ cash: 1000 }),
      request: bundle({ spaces: [3] }),
    }).state;
    expect(botAction(offered, "a")).toEqual({ type: "rejectTrade", tradeId: 1 });
  });

  it("offers cash for the last property of a set, but not every round", () => {
    const s = newGame(2);
    own(s, "a", 1);
    own(s, "b", 3);
    s.phase = { kind: "awaitingEndTurn" };
    const offers = [1, 2, 3].map((round) => {
      s.turn.round = round;
      return botAction(s, "a");
    });
    const made = offers.filter((o) => o?.type === "proposeTrade");
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({
      to: "b",
      offer: { cash: 90 },
      request: { spaces: [3] },
    });
    expect(checkAction(s, "a", made[0] as never)).toBeNull();
  });

  it("does not raise funds by selling a Walker it can keep", () => {
    const s = newGame(2);
    own(s, "a", 37, 39);
    s.buildings[37] = WALKER;
    s.buildings[39] = WALKER;
    s.phase = { kind: "awaitingEndTurn" };
    expect(botAction(s, "a")).not.toMatchObject({ type: "sellBuilding" });
  });
});
