import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { getBoard, groupIndices, isOwnable } from "../src/board";
import { DECKS, type DeckId } from "../src/cards";
import { CLASSIC_RULES, QUICK_RULES, type RuleConfig } from "../src/config";
import { getLegalActions } from "../src/legal";
import { activePlayers, buildingsInUse, currentPlayer, tradeProblem } from "../src/rules";
import { replay, type SimulationStep, simulateGame } from "../src/simulate";
import { IDS, totalCash } from "./helpers";

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`invariant violated: ${message}`);
}

/** Plain checks rather than `expect`: this runs after every simulated action. */
function checkInvariants({ before, after, events }: SimulationStep): void {
  const board = getBoard(after.config.boardId);

  // Money only enters or leaves through the bank, and every movement is reported.
  let bankDelta = 0;
  for (const e of events) {
    if (e.type !== "transfer") continue;
    if (e.from === "bank") bankDelta += e.amount;
    if (e.to === "bank") bankDelta -= e.amount;
  }
  check(totalCash(after) === totalCash(before) + bankDelta, "souls are conserved");
  check(after.urn >= 0, "urn is never negative");

  for (const p of after.players) {
    check(p.cash >= 0, `${p.id} has negative cash`);
    check(p.position >= 0 && p.position < board.spaces.length, `${p.id} is on the board`);
    if (p.inJail) check(board.spaces[p.position]?.kind === "jail", `${p.id} is jailed in jail`);
    if (p.bankrupt) {
      check(p.cash === 0 && p.getOutCards.length === 0 && !p.inJail, `${p.id} is fully bankrupt`);
      check(!after.owners.includes(p.id), `${p.id} owns nothing after bankruptcy`);
    }
  }

  after.owners.forEach((owner, i) => {
    const space = board.spaces[i];
    check(space !== undefined, `owner entry ${i} has a space`);
    if (owner !== null) {
      check(isOwnable(space), `space ${i} is ownable`);
      check(
        after.players.find((p) => p.id === owner)?.bankrupt === false,
        `owner of ${i} is active`,
      );
    }
    if ((after.buildings[i] ?? 0) > 0) {
      check(space.kind === "property" && owner !== null, `buildings on ${i} sit on owned property`);
    }
  });

  // Each deck's cards are either in its pile or held, exactly once.
  for (const deck of Object.keys(DECKS) as DeckId[]) {
    const pile = after.decks[deck].drawPile;
    const held = after.players.flatMap((p) => p.getOutCards).filter((d) => d === deck).length;
    check(new Set(pile).size === pile.length, `${deck} pile has no duplicates`);
    check(pile.length + held === DECKS[deck].cards.length, `${deck} cards are all accounted for`);
  }

  // Sealing and buildings stay consistent with ownership and the bank's supply.
  after.sealed.forEach((sealed, i) => {
    if (!sealed) return;
    check(after.owners[i] !== null, `sealed space ${i} is owned`);
    const space = board.spaces[i];
    if (space?.kind === "property") {
      const group = groupIndices(board, space.group);
      check(
        group.every((g) => (after.buildings[g] ?? 0) === 0),
        `no buildings beside sealed ${i}`,
      );
    }
  });
  if (after.config.limitedBuildings) {
    const inUse = buildingsInUse(after);
    check(inUse.guardians <= board.guardianSupply, "guardian supply respected");
    check(inUse.walkers <= board.walkerSupply, "walker supply respected");
  }
  for (const trade of after.trades) {
    check(tradeProblem(after, board, trade) === null, `open trade ${trade.id} is executable`);
  }

  const active = activePlayers(after);
  if (after.phase.kind === "gameOver") {
    const { standings, winnerId, reason } = after.phase;
    check(standings.length === after.players.length, "every player is ranked");
    check(standings[0]?.playerId === winnerId, "the winner ranks first");
    check(
      standings.every((st, i) => st.rank === i + 1),
      "ranks are consecutive",
    );
    if (reason === "lastStanding") {
      check(active.length === 1 && active[0]?.id === winnerId, "winner is the last player");
    } else {
      check(active.length >= 1, "a scored game has survivors");
    }
    return;
  }
  check(active.length >= 2, "an ongoing game has at least two players");
  // A bankrupt player's turn only lasts until their debts and auctions are settled.
  const current = currentPlayer(after);

  const deciding = (id: string) =>
    getLegalActions(after, id).filter(
      (a) => !["acceptTrade", "rejectTrade", "cancelTrade", "proposeTrade"].includes(a.type),
    );
  const phase = after.phase;
  switch (phase.kind) {
    case "raisingFunds": {
      const debt = after.debts[0];
      check(debt !== undefined, "raising funds implies a debt");
      check(debt.amount > 0, "debts are positive");
      check(!after.players.find((p) => p.id === debt.debtor)?.bankrupt, "the debtor is active");
      check(deciding(debt.debtor).length > 0, "the debtor can act");
      break;
    }
    case "auction": {
      check(phase.bidders.length > 0, "an auction has bidders");
      check(after.owners[phase.space] === null, "the auctioned space is unowned");
      if (phase.highBidder) {
        const cash = after.players.find((p) => p.id === phase.highBidder)?.cash ?? 0;
        check(phase.highBid <= cash, "the high bidder can pay");
      }
      check(
        phase.bidders.some((id) => deciding(id).length > 0),
        "a bidder can act",
      );
      break;
    }
    default:
      check(!current.bankrupt, "the current player is active");
      check(after.debts.length === 0, "debts only exist while raising funds");
      check(deciding(current.id).length > 0, "the current player can act");
      for (const other of after.players) {
        if (other.id !== current.id) {
          check(deciding(other.id).length === 0, `${other.id} cannot act out of turn`);
        }
      }
      if (phase.kind === "awaitingBuy") {
        check(phase.space === current.position, "the offered space is where the player stands");
        check(after.owners[phase.space] === null, "the offered space is unowned");
      }
  }
}

const players = (n: number) => IDS.slice(0, n).map((id) => ({ id, name: id }));

describe("simulation", () => {
  it("upholds every invariant across random games", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 2, max: 6 }),
        fc.record({
          doubleOnExactGo: fc.boolean(),
          freeParkingJackpot: fc.boolean(),
          auctions: fc.boolean(),
          evenBuilding: fc.boolean(),
          limitedBuildings: fc.boolean(),
          guardiansPerWalker: fc.constantFrom(3, 4),
          startingProperties: fc.constantFrom(0, 2),
          bankruptciesToEnd: fc.constantFrom(null, 1, 2),
          roundLimit: fc.constantFrom(null, 5, 20),
        }),
        (seed, n, toggles) => {
          const rules: RuleConfig = { ...CLASSIC_RULES, ...toggles };
          simulateGame({
            players: players(n),
            rules,
            seed,
            maxTurns: 300,
            onStep: checkInvariants,
          });
        },
      ),
      { numRuns: 60 },
    );
  }, 60_000);

  it("reproduces a game exactly from its action log", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const result = simulateGame({
          players: players(4),
          rules: CLASSIC_RULES,
          seed,
          maxTurns: 200,
        });
        expect(replay(result.initial, result.moves)).toEqual(result.final);
      }),
      { numRuns: 20 },
    );
  }, 60_000);

  describe("length report", () => {
    const rows: Record<string, string | number>[] = [];
    afterAll(() => {
      // Informational: shows how long unattended random games run, to guide preset tuning.
      console.table(rows);
    });

    const modes = { classic: CLASSIC_RULES, quick: QUICK_RULES };
    for (const [mode, rules] of Object.entries(modes)) {
      for (const n of [2, 4, 6]) {
        it(`plays ${n}-player ${mode} games`, () => {
          const maxTurns = 1000;
          const results = Array.from({ length: 40 }, (_, seed) =>
            simulateGame({ players: players(n), rules, seed, maxTurns }),
          );
          const finished = results.filter((r) => r.finished);
          const median = (xs: number[]) =>
            xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? "-";
          rows.push({
            mode,
            players: n,
            finished: `${finished.length}/${results.length}`,
            medianRounds: median(finished.map((r) => r.final.turn.round)),
            medianMoves: median(finished.map((r) => r.moves.length)),
          });
          expect(results.length).toBe(40);
        }, 120_000);
      }
    }
  });
});
