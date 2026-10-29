import { describe, expect, it } from "vitest";
import { CURSED_APPLE, isOwnable } from "../src/board";
import { DECKS } from "../src/cards";
import { CLASSIC_RULES } from "../src/config";
import { applyAction, createGame } from "../src/game";
import { getLegalActions } from "../src/legal";
import { WALKER } from "../src/rules";
import { act, newGame, own, player, roll, stackCard } from "./helpers";

const legal = (state: Parameters<typeof getLegalActions>[0], id: string) =>
  getLegalActions(state, id).map((a) => a.type);

describe("setup", () => {
  it("starts everyone on the Astral Gate with starting souls", () => {
    const s = newGame(4);
    expect(s.players.map((p) => [p.position, p.cash])).toEqual(Array(4).fill([0, 1500]));
    expect(s.phase).toEqual({ kind: "awaitingRoll" });
  });

  it("rejects too few, too many, or duplicate players", () => {
    const p = (id: string) => ({ id, name: id });
    expect(() => createGame([p("a")], CLASSIC_RULES, 1)).toThrow();
    expect(() => createGame("abcdefg".split("").map(p), CLASSIC_RULES, 1)).toThrow();
    expect(() => createGame([p("a"), p("a")], CLASSIC_RULES, 1)).toThrow();
  });

  it("is deterministic for a seed", () => {
    const players = ["a", "b", "c"].map((id) => ({ id, name: id }));
    expect(createGame(players, CLASSIC_RULES, 9)).toEqual(createGame(players, CLASSIC_RULES, 9));
  });
});

describe("board and card data", () => {
  it("has 40 spaces with 28 ownable", () => {
    expect(CURSED_APPLE.spaces).toHaveLength(40);
    expect(CURSED_APPLE.spaces.filter(isOwnable)).toHaveLength(28);
  });

  it("points every advance-to card at the space its text names", () => {
    for (const deck of Object.values(DECKS)) {
      expect(deck.cards).toHaveLength(16);
      for (const card of deck.cards) {
        if (card.effect.kind !== "advanceTo") continue;
        const space = CURSED_APPLE.spaces[card.effect.space];
        const name = space?.name.replace(/^The /, "").toLowerCase() ?? "missing";
        expect(card.text.toLowerCase(), card.id).toContain(name);
      }
    }
  });
});

describe("movement", () => {
  it("moves by the dice and waits for the turn to end", () => {
    let s = newGame();
    ({ state: s } = roll(s, [1, 3]));
    expect(player(s, "a").position).toBe(4);
    expect(s.phase).toEqual({ kind: "awaitingEndTurn" });
    ({ state: s } = act(s, "a", "endTurn"));
    expect(s.players[s.turn.playerIndex]?.id).toBe("b");
    expect(s.turn.number).toBe(2);
  });

  it("pays salary when passing the Astral Gate", () => {
    const s = newGame();
    player(s, "a").position = 38;
    const { state } = roll(s, [2, 3]);
    expect(player(state, "a").position).toBe(3);
    expect(player(state, "a").cash).toBe(1700);
  });

  it("pays double salary for landing exactly on the Gate only with the house rule", () => {
    for (const [doubleOnExactGo, cash] of [
      [true, 1900],
      [false, 1700],
    ] as const) {
      const s = newGame(2, { doubleOnExactGo });
      player(s, "a").position = 36;
      expect(player(roll(s, [1, 3]).state, "a").cash).toBe(cash);
    }
  });

  it("grants another roll after doubles and jails on the third", () => {
    let s = newGame(2, { auctions: false });
    ({ state: s } = roll(s, [3, 3]));
    ({ state: s } = act(s, "a", "decline"));
    expect(s.phase).toEqual({ kind: "awaitingRoll" });
    ({ state: s } = roll(s, [2, 2]));
    expect(s.phase).toEqual({ kind: "awaitingRoll" });
    const third = roll(s, [4, 4]);
    expect(player(third.state, "a")).toMatchObject({ position: 10, inJail: true });
    expect(third.state.phase).toEqual({ kind: "awaitingEndTurn" });
    expect(third.events.some((e) => e.type === "moved" && e.to === 18)).toBe(false);
  });
});

describe("buying", () => {
  it("offers unowned property and transfers it on purchase", () => {
    let s = newGame();
    ({ state: s } = roll(s, [1, 2]));
    expect(s.phase).toEqual({ kind: "awaitingBuy", space: 3 });
    expect(legal(s, "a")).toEqual(["buy", "decline"]);
    ({ state: s } = act(s, "a", "buy"));
    expect(s.owners[3]).toBe("a");
    expect(player(s, "a").cash).toBe(1440);
    expect(s.phase).toEqual({ kind: "awaitingEndTurn" });
  });

  it("leaves property unowned when declined", () => {
    let s = newGame(2, { auctions: false });
    ({ state: s } = roll(s, [1, 2]));
    ({ state: s } = act(s, "a", "decline"));
    expect(s.owners[3]).toBeNull();
    expect(player(s, "a").cash).toBe(1500);
  });

  it("only allows declining when the player cannot afford it", () => {
    const s = newGame();
    player(s, "a").cash = 10;
    expect(legal(roll(s, [1, 2]).state, "a")).toEqual(["decline"]);
  });
});

describe("rent", () => {
  it("charges base rent, doubled for a full unimproved set", () => {
    const single = newGame();
    own(single, "b", 3);
    expect(player(roll(single, [1, 2]).state, "b").cash).toBe(1504);

    const set = newGame();
    own(set, "b", 1, 3);
    expect(player(roll(set, [1, 2]).state, "b").cash).toBe(1508);
  });

  it("charges building rent instead of the set bonus", () => {
    const s = newGame();
    own(s, "b", 1, 3);
    s.buildings[3] = 2;
    expect(player(roll(s, [1, 2]).state, "b").cash).toBe(1560);
  });

  it("charges nothing on your own property", () => {
    const s = newGame();
    own(s, "a", 3);
    expect(player(roll(s, [1, 2]).state, "a").cash).toBe(1500);
  });

  it("scales zipline rent with the number owned", () => {
    for (const [owned, rent] of [
      [[5], 25],
      [[5, 15], 50],
      [[5, 15, 25], 100],
      [[5, 15, 25, 35], 200],
    ] as const) {
      const s = newGame();
      own(s, "b", ...owned);
      expect(player(roll(s, [2, 3]).state, "b").cash).toBe(1500 + rent);
    }
  });

  it("multiplies utility rent by the dice", () => {
    for (const [owned, rent] of [
      [[12], 12],
      [[12, 28], 30],
    ] as const) {
      const s = newGame();
      own(s, "b", ...owned);
      player(s, "a").position = 9;
      expect(player(roll(s, [1, 2]).state, "b").cash).toBe(1500 + rent);
    }
  });
});

describe("taxes and the Soul Urn", () => {
  it("sends taxes to the urn with the jackpot rule", () => {
    const { state } = roll(newGame(), [1, 3]);
    expect(player(state, "a").cash).toBe(1300);
    expect(state.urn).toBe(200);
  });

  it("sends taxes to the bank without the jackpot rule", () => {
    const { state } = roll(newGame(2, { freeParkingJackpot: false }), [1, 3]);
    expect(player(state, "a").cash).toBe(1300);
    expect(state.urn).toBe(0);
  });

  it("pays out the urn on landing", () => {
    const s = newGame();
    s.urn = 300;
    player(s, "a").position = 15;
    const { state } = roll(s, [2, 3]);
    expect(player(state, "a").cash).toBe(1800);
    expect(state.urn).toBe(0);
  });
});

describe("the Lost Whisper", () => {
  const jailed = () => {
    const s = newGame(2, { auctions: false });
    Object.assign(player(s, "a"), { position: 10, inJail: true });
    return s;
  };

  it("banishes a player who lands on Banished", () => {
    const s = newGame();
    player(s, "a").position = 25;
    const { state } = roll(s, [2, 3]);
    expect(player(state, "a")).toMatchObject({ position: 10, inJail: true });
    expect(state.phase).toEqual({ kind: "awaitingEndTurn" });
  });

  it("lets a jailed player pay the fine and then roll normally", () => {
    let s = jailed();
    expect(legal(s, "a")).toEqual(["roll", "payJailFine"]);
    ({ state: s } = act(s, "a", "payJailFine"));
    expect(player(s, "a")).toMatchObject({ inJail: false, cash: 1450 });
    expect(s.phase).toEqual({ kind: "awaitingRoll" });
    ({ state: s } = roll(s, [1, 2]));
    expect(player(s, "a").position).toBe(13);
  });

  it("releases on doubles without an extra roll", () => {
    let s = jailed();
    ({ state: s } = roll(s, [3, 3]));
    expect(player(s, "a")).toMatchObject({ inJail: false, position: 16 });
    ({ state: s } = act(s, "a", "decline"));
    expect(s.phase).toEqual({ kind: "awaitingEndTurn" });
  });

  it("keeps the player jailed after a failed attempt", () => {
    const { state } = roll(jailed(), [1, 2]);
    expect(player(state, "a")).toMatchObject({ inJail: true, position: 10, jailAttempts: 1 });
    expect(state.phase).toEqual({ kind: "awaitingEndTurn" });
  });

  it("forces the fine after the last failed attempt and moves", () => {
    const s = jailed();
    player(s, "a").jailAttempts = 2;
    const { state } = roll(s, [1, 2]);
    expect(player(state, "a")).toMatchObject({ inJail: false, position: 13, cash: 1450 });
  });

  it("uses a held card and returns it to the bottom of its deck", () => {
    const s = jailed();
    const cardIndex = DECKS.oracle.cards.findIndex((c) => c.effect.kind === "getOutOfJail");
    s.decks.oracle.drawPile = s.decks.oracle.drawPile.filter((i) => i !== cardIndex);
    player(s, "a").getOutCards = ["oracle"];
    expect(legal(s, "a")).toContain("useGetOutCard");
    const { state } = act(s, "a", "useGetOutCard");
    expect(player(state, "a")).toMatchObject({ inJail: false, getOutCards: [] });
    expect(state.decks.oracle.drawPile.at(-1)).toBe(cardIndex);
    expect(state.phase).toEqual({ kind: "awaitingRoll" });
  });
});

describe("cards", () => {
  /** Lands player a on the Oracle space at 7 with `cardId` on top. */
  const drawOracle = (cardId: string, setup?: (s: ReturnType<typeof newGame>) => void) => {
    const s = newGame(3);
    stackCard(s, "oracle", cardId);
    setup?.(s);
    return roll(s, [3, 4]);
  };

  it("advances to the Gate, paying the exact-landing bonus", () => {
    const { state } = drawOracle("oracle-gate");
    expect(player(state, "a")).toMatchObject({ position: 0, cash: 1900 });
  });

  it("charges double fare at the nearest zipline", () => {
    const { state } = drawOracle("oracle-nearest-zip-1", (s) => own(s, "b", 15));
    expect(player(state, "a").position).toBe(15);
    expect(player(state, "b").cash).toBe(1550);
  });

  it("offers an unowned nearest zipline for purchase", () => {
    const { state } = drawOracle("oracle-nearest-zip-1");
    expect(state.phase).toEqual({ kind: "awaitingBuy", space: 15 });
  });

  it("charges ten times a fresh roll at the nearest utility", () => {
    const { state, events } = drawOracle("oracle-nearest-utility", (s) => own(s, "b", 12));
    expect(events.filter((e) => e.type === "rolled")).toHaveLength(2);
    expect(player(state, "b").cash).toBe(1570);
  });

  it("moves back three spaces and resolves the new space", () => {
    const { state } = drawOracle("oracle-back-three");
    expect(player(state, "a")).toMatchObject({ position: 4, cash: 1300 });
  });

  it("banishes without passing the Gate", () => {
    const { state } = drawOracle("oracle-banished");
    expect(player(state, "a")).toMatchObject({ position: 10, inJail: true, cash: 1500 });
  });

  it("keeps a get-out card out of the deck while held", () => {
    const { state } = drawOracle("oracle-free");
    expect(player(state, "a").getOutCards).toEqual(["oracle"]);
    expect(state.decks.oracle.drawPile).toHaveLength(15);
  });

  it("pays each other player", () => {
    const { state } = drawOracle("oracle-chairman");
    expect(state.players.map((p) => p.cash)).toEqual([1400, 1550, 1550]);
  });

  it("charges repairs per Guardian and Walker", () => {
    const { state } = drawOracle("oracle-repairs", (s) => {
      own(s, "a", 1, 3);
      s.buildings[1] = 2;
      s.buildings[3] = WALKER;
    });
    expect(player(state, "a").cash).toBe(1350);
    expect(state.urn).toBe(150);
  });

  it("collects from every other player", () => {
    const s = newGame(3);
    stackCard(s, "coven", "coven-birthday");
    const { state } = roll(s, [1, 1]);
    expect(state.players.map((p) => p.cash)).toEqual([1520, 1490, 1490]);
  });

  it("moves played cards to the bottom of the deck", () => {
    const { state } = drawOracle("oracle-dividend");
    const index = DECKS.oracle.cards.findIndex((c) => c.id === "oracle-dividend");
    expect(state.decks.oracle.drawPile.at(-1)).toBe(index);
    expect(state.decks.oracle.drawPile).toHaveLength(16);
  });
});

describe("bankruptcy", () => {
  it("hands everything to the creditor and ends a two-player game", () => {
    const s = newGame();
    own(s, "b", 37, 39);
    s.buildings[39] = WALKER;
    own(s, "a", 1);
    player(s, "a").getOutCards = ["coven"];
    Object.assign(player(s, "a"), { position: 36, cash: 100 });
    const { state, events } = roll(s, [1, 2]);
    expect(player(state, "a")).toMatchObject({ bankrupt: true, cash: 0, getOutCards: [] });
    expect(player(state, "b")).toMatchObject({ cash: 1600, getOutCards: ["coven"] });
    expect(state.owners[1]).toBe("b");
    expect(state.phase).toEqual({ kind: "gameOver", winnerId: "b" });
    expect(events.at(-1)).toEqual({ type: "gameOver", winnerId: "b" });
  });

  it("returns assets to the bank on an unpayable tax and skips the player afterwards", () => {
    let s = newGame(3, { auctions: false });
    own(s, "a", 1);
    s.buildings[1] = 3;
    player(s, "a").cash = 10;
    ({ state: s } = roll(s, [1, 3]));
    expect(player(s, "a").bankrupt).toBe(true);
    expect(s.owners[1]).toBeNull();
    expect(s.buildings[1]).toBe(0);
    expect(s.players[s.turn.playerIndex]?.id).toBe("b");
    expect(s.phase).toEqual({ kind: "awaitingRoll" });

    ({ state: s } = roll(s, [1, 3]));
    ({ state: s } = act(s, "b", "endTurn"));
    ({ state: s } = roll(s, [1, 3]));
    ({ state: s } = act(s, "c", "endTurn"));
    expect(s.players[s.turn.playerIndex]?.id).toBe("b");
  });
});

describe("validation", () => {
  it("rejects actions out of turn", () => {
    const result = applyAction(newGame(), "b", { type: "roll" });
    expect(result).toMatchObject({ ok: false, error: { code: "not_your_turn" } });
  });

  it("rejects actions that are not legal in the current phase", () => {
    const result = applyAction(newGame(), "a", { type: "endTurn" });
    expect(result).toMatchObject({ ok: false, error: { code: "illegal_action" } });
  });

  it("rejects unknown players", () => {
    const result = applyAction(newGame(), "zz", { type: "roll" });
    expect(result).toMatchObject({ ok: false, error: { code: "unknown_player" } });
  });

  it("rejects everything once the game is over", () => {
    const s = newGame();
    s.phase = { kind: "gameOver", winnerId: "a" };
    expect(applyAction(s, "a", { type: "roll" })).toMatchObject({
      ok: false,
      error: { code: "game_over" },
    });
    expect(getLegalActions(s, "a")).toEqual([]);
  });

  it("never mutates the input state", () => {
    const s = newGame();
    const before = JSON.stringify(s);
    roll(s, [1, 2]);
    expect(JSON.stringify(s)).toBe(before);
  });
});
