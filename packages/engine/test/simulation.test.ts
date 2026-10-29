import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { getBoard, isOwnable } from "../src/board";
import { DECKS, type DeckId } from "../src/cards";
import { CLASSIC_RULES, type RuleConfig } from "../src/config";
import { activePlayers, currentPlayer, getLegalActions } from "../src/game";
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

  const active = activePlayers(after);
  if (after.phase.kind === "gameOver") {
    check(
      active.length === 1 && active[0]?.id === after.phase.winnerId,
      "winner is the last player",
    );
    return;
  }
  check(active.length >= 2, "an ongoing game has at least two players");
  const current = currentPlayer(after);
  check(!current.bankrupt, "the current player is active");
  check(getLegalActions(after, current.id).length > 0, "the current player can act");
  for (const other of after.players) {
    if (other.id !== current.id) {
      check(getLegalActions(after, other.id).length === 0, `${other.id} cannot act out of turn`);
    }
  }
  if (after.phase.kind === "awaitingBuy") {
    check(after.phase.space === current.position, "the offered space is where the player stands");
    check(after.owners[after.phase.space] === null, "the offered space is unowned");
  }
}

const players = (n: number) => IDS.slice(0, n).map((id) => ({ id, name: id }));

describe("simulation", () => {
  it("upholds every invariant across random games", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 2, max: 6 }),
        fc.record({ doubleOnExactGo: fc.boolean(), freeParkingJackpot: fc.boolean() }),
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
        expect(replay(result.initial, result.actions)).toEqual(result.final);
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

    for (const n of [2, 4, 6]) {
      it(`plays ${n}-player classic games`, () => {
        const maxTurns = 1000;
        const results: { finished: boolean; turns: number }[] = [];
        for (let seed = 0; seed < 40; seed++) {
          results.push(simulateGame({ players: players(n), rules: CLASSIC_RULES, seed, maxTurns }));
        }
        const finished = results.filter((r) => r.finished);
        const turns = finished.map((r) => r.turns).sort((a, b) => a - b);
        rows.push({
          players: n,
          games: results.length,
          maxTurns,
          finished: `${finished.length}/${results.length}`,
          medianTurns: turns[Math.floor(turns.length / 2)] ?? "-",
          medianRounds: turns.length
            ? Math.round((turns[Math.floor(turns.length / 2)] ?? 0) / n)
            : "-",
        });
        expect(results.length).toBe(40);
      }, 60_000);
    }
  });
});
