import { type BoardDefinition, getBoard, groupIndices, indicesOfKind, isOwnable } from "./board";
import { checkAction, getLegalActions, type LegalView } from "./legal";
import { mortgageValue, sealedTransferFee, standingRent, unsealCost } from "./rules";
import type { Action, PlayerId, PlayerState, Trade } from "./state";

/** Souls a Normal bot keeps in hand for rent before spending on anything optional. */
export const BOT_RESERVE = 200;

export const BOT_LEVELS = ["easy", "normal", "hard"] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];

/** Everything that differs between difficulty levels. */
type Profile = {
  /** Souls kept in hand before spending on anything optional. */
  reserve: (state: LegalView, board: BoardDefinition, me: PlayerState) => number;
  /** Buys a set-completing or set-blocking space even when that dips into the reserve. */
  strategicBuys: boolean;
  /** Worth of a property, as a multiple of its price, by what it does for a set. */
  setValue: { complete: number; block: number; partial: number };
  /** "price" never bids above the printed price; "value" bids up to its valuation. */
  auctionCeiling: "price" | "value";
  /** Builds only with this many reserves left over afterwards. */
  buildReserves: number;
  /** "cost" builds the dearest building first; "rent" the best extra rent per soul. */
  buildOrder: "cost" | "rent";
  /** Accepts a trade only if it gains at least this much more than it gives. */
  acceptRatio: number;
  /** Ratio required before handing the proposer the last property of their set. */
  rivalSetRatio: number | null;
  /** How often, and how generously, it offers to buy the last property of a set. */
  offers: { everyRounds: number; multiple: number; swaps: boolean };
  /** Pays its way out of jail up to this round; later it waits for doubles. */
  leaveJailUntilRound: number;
  /** Seals stray properties to pay for building a complete set up to this many Guardians. */
  leverageTo: number;
};

const constantReserve = (souls: number) => () => souls;

/** Enough to survive the worst rent an opponent could charge right now, within limits. */
function threatReserve(state: LegalView, board: BoardDefinition, me: PlayerState): number {
  let worst = 0;
  state.owners.forEach((owner, index) => {
    if (!owner || owner === me.id || state.sealed[index]) return;
    const rent = standingRent(state, board, index);
    if (!rent) return;
    worst = Math.max(worst, "souls" in rent ? rent.souls : rent.diceTimes * 7);
  });
  return Math.min(600, Math.max(150, worst));
}

const PROFILES: Record<BotLevel, Profile> = {
  easy: {
    reserve: constantReserve(300),
    strategicBuys: false,
    setValue: { complete: 2, block: 1.6, partial: 1.3 },
    auctionCeiling: "price",
    buildReserves: 2,
    buildOrder: "cost",
    acceptRatio: 1,
    rivalSetRatio: null,
    // Rare, stingy offers: without any, games between Easy bots never complete a set.
    offers: { everyRounds: 5, multiple: 1.25, swaps: false },
    leaveJailUntilRound: 0,
    leverageTo: 0,
  },
  normal: {
    reserve: constantReserve(BOT_RESERVE),
    strategicBuys: true,
    setValue: { complete: 2, block: 1.6, partial: 1.3 },
    auctionCeiling: "value",
    buildReserves: 1,
    buildOrder: "cost",
    acceptRatio: 1.1,
    rivalSetRatio: null,
    offers: { everyRounds: 3, multiple: 1.5, swaps: false },
    leaveJailUntilRound: 8,
    leverageTo: 0,
  },
  hard: {
    reserve: threatReserve,
    strategicBuys: true,
    setValue: { complete: 2.5, block: 2, partial: 1.4 },
    auctionCeiling: "value",
    buildReserves: 1,
    buildOrder: "rent",
    acceptRatio: 1.15,
    rivalSetRatio: 2,
    offers: { everyRounds: 2, multiple: 2, swaps: true },
    leaveJailUntilRound: 8,
    leverageTo: 3,
  },
};

/**
 * A predictable opponent at the given level. Always returns one of the legal
 * actions, or null when it has nothing to decide (for example while holding the
 * high bid). Every level offers to buy the last property of a set, Easy rarely.
 */
export function botAction(
  state: LegalView,
  botId: PlayerId,
  level: BotLevel = "normal",
): Action | null {
  const legal = getLegalActions(state, botId);
  const me = state.players.find((p) => p.id === botId);
  if (legal.length === 0 || !me) return null;
  const board = getBoard(state.config.boardId);
  const profile = PROFILES[level];
  const reserve = profile.reserve(state, board, me);
  const find = <T extends Action["type"]>(type: T) =>
    legal.find((a): a is Extract<Action, { type: T }> => a.type === type);

  // Offers first, so nobody waits on a bot to answer.
  for (const trade of state.trades.filter((t) => t.to === botId)) {
    const accept = legal.find((a) => a.type === "acceptTrade" && a.tradeId === trade.id);
    if (accept && tradeRatio(state, board, me, trade, profile) >= profile.acceptRatio) {
      return accept;
    }
    const reject = legal.find((a) => a.type === "rejectTrade" && a.tradeId === trade.id);
    if (reject) return reject;
  }

  const { phase } = state;
  switch (phase.kind) {
    case "raisingFunds": {
      const pay = find("payDebt");
      if (pay) return pay;
      // Sell buildings before sealing, and seal what matters least first.
      const sell = legal.find((a) => a.type === "sellBuilding");
      if (sell) return sell;
      const seals = legal.filter((a): a is Extract<Action, { type: "seal" }> => a.type === "seal");
      if (seals.length > 0) {
        return [...seals].sort(
          (x, y) =>
            keepScore(state, board, botId, x.space) - keepScore(state, board, botId, y.space),
        )[0] as Action;
      }
      return find("declareBankruptcy") ?? null;
    }

    case "auction": {
      // Raising your own high bid is legal but pointless.
      if (phase.highBidder === botId) return null;
      const bid = find("bid");
      const pass = find("passAuction");
      const space = board.spaces[phase.space];
      const price = space && isOwnable(space) ? space.price : 0;
      const worth =
        profile.auctionCeiling === "price"
          ? price
          : spaceValue(state, board, botId, phase.space, level);
      const ceiling = Math.min(Math.floor(worth), me.cash - Math.floor(reserve / 2));
      if (bid && ceiling > phase.highBid) {
        const step = Math.max(5, Math.round(price / 20));
        return { type: "bid", amount: Math.min(ceiling, phase.highBid + step) };
      }
      return pass ?? null;
    }

    case "awaitingBuy": {
      const buy = find("buy");
      const space = board.spaces[phase.space];
      if (buy && space && isOwnable(space)) {
        const strategic =
          profile.strategicBuys &&
          spaceValue(state, board, botId, phase.space, level) >=
            space.price * profile.setValue.block;
        if (me.cash - space.price >= reserve || strategic) return buy;
      }
      return find("decline") ?? null;
    }

    case "awaitingRoll":
    case "awaitingEndTurn": {
      const improvement = improve(state, board, me, legal, reserve, profile);
      if (improvement) return improvement;
      if (phase.kind === "awaitingEndTurn") {
        return setCompletingOffer(state, board, me, reserve, profile) ?? find("endTurn") ?? null;
      }
      if (me.inJail) {
        // Early on, the board is worth getting around; later, jail is a safe place to wait.
        const early = state.turn.round <= profile.leaveJailUntilRound;
        const fine = find("payJailFine");
        if (fine && early && me.cash - state.config.jailFine >= reserve) return fine;
        const card = find("useGetOutCard");
        if (card && early) return card;
      }
      return find("roll") ?? null;
    }

    default:
      return null;
  }
}

/**
 * Unseals when rich, then builds where the profile prefers, as far as it can
 * afford. A leveraging profile first seals stray properties to fund building
 * its complete sets, and leaves them sealed until that building is done.
 */
function improve(
  state: LegalView,
  board: BoardDefinition,
  me: PlayerState,
  legal: Action[],
  reserve: number,
  profile: Profile,
): Action | null {
  const toBuild = buildingWanted(state, board, me, profile.leverageTo);
  if (toBuild !== null && me.cash - toBuild < reserve) {
    const stray = legal
      .filter((a): a is Extract<Action, { type: "seal" }> => a.type === "seal")
      .filter((a) => !ownsWholeGroup(state, board, me.id, a.space))
      .sort(
        (x, y) => keepScore(state, board, me.id, x.space) - keepScore(state, board, me.id, y.space),
      )[0];
    if (stray) return stray;
  }

  const unseals = legal.filter(
    (a): a is Extract<Action, { type: "unseal" }> => a.type === "unseal",
  );
  const affordableUnseal = unseals
    .map((a) => ({ a, cost: unsealCost(board, a.space) }))
    .filter(({ cost }) => me.cash - cost >= reserve * 3)
    .sort((x, y) => x.cost - y.cost)[0];
  if (affordableUnseal && toBuild === null) return affordableUnseal.a;

  const builds = legal
    .filter((a): a is Extract<Action, { type: "build" }> => a.type === "build")
    .map((a) => {
      const space = board.spaces[a.space];
      if (space?.kind !== "property") return { a, cost: Number.POSITIVE_INFINITY, gain: 0 };
      const now = state.buildings[a.space] ?? 0;
      const extraRent = (space.rent[now + 1] ?? 0) - (space.rent[now] ?? 0);
      return { a, cost: space.buildCost, gain: extraRent / space.buildCost };
    })
    .filter(({ cost }) => me.cash - cost >= reserve * profile.buildReserves)
    .sort((x, y) => (profile.buildOrder === "rent" ? y.gain - x.gain : y.cost - x.cost));
  return builds[0]?.a ?? null;
}

/**
 * What a space is worth to this bot: its price, raised when it completes or
 * blocks a set, or adds to ziplines and utilities the bot already owns.
 */
export function spaceValue(
  state: LegalView,
  board: BoardDefinition,
  botId: PlayerId,
  index: number,
  level: BotLevel = "normal",
): number {
  const space = board.spaces[index];
  if (!space || !isOwnable(space)) return 0;
  if (space.kind === "property") {
    const { complete, block, partial } = PROFILES[level].setValue;
    const others = groupIndices(board, space.group).filter((i) => i !== index);
    const mine = others.filter((i) => state.owners[i] === botId).length;
    if (mine === others.length) return space.price * complete;
    const owners = others.map((i) => state.owners[i]).filter((o) => o && o !== botId);
    const blocking = owners.length === others.length && new Set(owners).size === 1;
    if (blocking) return space.price * block;
    return space.price * (mine > 0 ? partial : 1);
  }
  const owned = indicesOfKind(board, space.kind).filter(
    (i) => i !== index && state.owners[i] === botId,
  ).length;
  return space.price * (1 + (space.kind === "zipline" ? 0.25 : 0.3) * owned);
}

/**
 * The cheapest building the bot still wants on its complete, unsealed sets
 * (below `upTo` Guardians), or null when there is nothing left to leverage for.
 */
function buildingWanted(
  state: LegalView,
  board: BoardDefinition,
  me: PlayerState,
  upTo: number,
): number | null {
  let cheapest: number | null = null;
  state.owners.forEach((owner, index) => {
    const space = board.spaces[index];
    if (owner !== me.id || space?.kind !== "property") return;
    const group = groupIndices(board, space.group);
    if (!group.every((i) => state.owners[i] === me.id && !state.sealed[i])) return;
    if ((state.buildings[index] ?? 0) >= upTo) return;
    cheapest = cheapest === null ? space.buildCost : Math.min(cheapest, space.buildCost);
  });
  return cheapest;
}

/** How much the bot wants to keep a space it owns; low scores are sealed first. */
function keepScore(
  state: LegalView,
  board: BoardDefinition,
  botId: PlayerId,
  index: number,
): number {
  const space = board.spaces[index];
  if (space?.kind === "property" && ownsWholeGroup(state, board, botId, index)) {
    return 10_000 + mortgageValue(board, index);
  }
  return mortgageValue(board, index);
}

function ownsWholeGroup(
  state: LegalView,
  board: BoardDefinition,
  botId: PlayerId,
  index: number,
): boolean {
  const space = board.spaces[index];
  return (
    space?.kind === "property" &&
    groupIndices(board, space.group).every((i) => state.owners[i] === botId)
  );
}

/** True when handing `index` to `to` would give them every property of its set. */
function completesSetFor(
  state: LegalView,
  board: BoardDefinition,
  to: PlayerId,
  index: number,
): boolean {
  const space = board.spaces[index];
  return (
    space?.kind === "property" &&
    groupIndices(board, space.group).every((i) => i === index || state.owners[i] === to)
  );
}

/**
 * Value received over value given, from the bot's point of view; 0 if it would
 * break its own set. A profile that guards rivals' sets scales the ratio down
 * when the trade would hand the proposer a complete set, so it then needs
 * `rivalSetRatio` instead of `acceptRatio`.
 */
function tradeRatio(
  state: LegalView,
  board: BoardDefinition,
  me: PlayerState,
  trade: Trade,
  profile: Profile,
): number {
  const received = trade.offer;
  const given = trade.request;
  if (given.spaces.some((i) => ownsWholeGroup(state, board, me.id, i))) return 0;
  const cardValue = 50;
  const gain =
    received.cash +
    received.spaces.reduce(
      (sum, i) =>
        sum +
        spaceValue(state, board, me.id, i) -
        (state.sealed[i] ? mortgageValue(board, i) + sealedTransferFee(board, i) : 0),
      0,
    ) +
    received.getOutCards.length * cardValue;
  const loss =
    given.cash +
    given.spaces.reduce((sum, i) => {
      const space = board.spaces[i];
      return sum + (space && isOwnable(space) ? space.price : 0);
    }, 0) +
    given.getOutCards.length * cardValue;
  const ratio = gain / Math.max(1, loss);
  const handsOverSet = given.spaces.some((i) => completesSetFor(state, board, trade.from, i));
  if (handsOverSet && profile.rivalSetRatio !== null) {
    return (ratio * profile.acceptRatio) / profile.rivalSetRatio;
  }
  return ratio;
}

/**
 * Offers to buy the one property standing between this bot and a full set, for
 * cash it can spare or, if the profile allows, a spare property plus cash.
 * Offers repeat only every few rounds, so an owner who said no isn't asked every
 * turn. Without these offers, all-bot games rarely end.
 */
function setCompletingOffer(
  state: LegalView,
  board: BoardDefinition,
  me: PlayerState,
  reserve: number,
  profile: Profile,
): Action | null {
  const { offers } = profile;
  const seat = state.players.findIndex((p) => p.id === me.id);
  if ((state.turn.round + seat) % offers.everyRounds !== 0) return null;
  const groups = new Set(board.spaces.flatMap((s) => (s.kind === "property" ? [s.group] : [])));
  for (const group of groups) {
    const members = groupIndices(board, group);
    const missing = members.filter((i) => state.owners[i] !== me.id);
    const target = missing[0];
    if (missing.length !== 1 || target === undefined) continue;
    const owner = state.owners[target];
    const space = board.spaces[target];
    if (!owner || owner === me.id || !space || !isOwnable(space)) continue;
    if (state.trades.some((t) => t.from === me.id && t.request.spaces.includes(target))) continue;
    const price = Math.round(space.price * offers.multiple);
    const swap = offers.swaps ? spareFor(state, board, me, owner, group) : undefined;
    const cash = Math.max(0, price - (swap?.worth ?? 0));
    if (me.cash - cash < reserve) continue;
    const offer: Action = {
      type: "proposeTrade",
      to: owner,
      offer: { cash, spaces: swap ? [swap.index] : [], getOutCards: [] },
      request: { cash: 0, spaces: [target], getOutCards: [] },
    };
    if (checkAction(state, me.id, offer) === null) return offer;
  }
  return null;
}

/**
 * A property the bot can give away without hurting itself or handing the
 * recipient a set: unbuilt, unsealed, outside the wanted group and the only one
 * the bot holds in its own group. Its printed price counts towards the offer.
 */
function spareFor(
  state: LegalView,
  board: BoardDefinition,
  me: PlayerState,
  to: PlayerId,
  wantedGroup: string,
): { index: number; worth: number } | undefined {
  return state.owners
    .flatMap((owner, index) => {
      const space = board.spaces[index];
      if (owner !== me.id || space?.kind !== "property" || space.group === wantedGroup) return [];
      if (state.sealed[index] || (state.buildings[index] ?? 0) > 0) return [];
      const mineInGroup = groupIndices(board, space.group).filter(
        (i) => state.owners[i] === me.id,
      ).length;
      if (mineInGroup > 1 || completesSetFor(state, board, to, index)) return [];
      return [{ index, worth: space.price }];
    })
    .sort((x, y) => y.worth - x.worth)[0];
}
