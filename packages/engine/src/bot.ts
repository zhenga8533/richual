import { type BoardDefinition, getBoard, groupIndices, indicesOfKind, isOwnable } from "./board";
import { checkAction, getLegalActions, type LegalView } from "./legal";
import { mortgageValue, sealedTransferFee, unsealCost } from "./rules";
import type { Action, PlayerId, PlayerState, Trade } from "./state";

/** Souls a bot keeps in hand for rent before spending on anything optional. */
export const BOT_RESERVE = 200;
/** A bot accepts a trade only if what it gets is worth this much more than what it gives. */
const TRADE_MARGIN = 1.1;

/**
 * A steady, predictable opponent. Always returns one of the legal actions, or
 * null when it has nothing to decide (for example while holding the high bid).
 * Its only trade offers buy the last property of a set it is one short of.
 */
export function botAction(state: LegalView, botId: PlayerId): Action | null {
  const legal = getLegalActions(state, botId);
  const me = state.players.find((p) => p.id === botId);
  if (legal.length === 0 || !me) return null;
  const board = getBoard(state.config.boardId);
  const find = <T extends Action["type"]>(type: T) =>
    legal.find((a): a is Extract<Action, { type: T }> => a.type === type);

  // Offers first, so nobody waits on a bot to answer.
  for (const trade of state.trades.filter((t) => t.to === botId)) {
    const accept = legal.find((a) => a.type === "acceptTrade" && a.tradeId === trade.id);
    if (accept && tradeRatio(state, board, me, trade) >= TRADE_MARGIN) return accept;
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
      const ceiling = Math.min(
        Math.floor(spaceValue(state, board, botId, phase.space)),
        me.cash - Math.floor(BOT_RESERVE / 2),
      );
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
        const strategic = spaceValue(state, board, botId, phase.space) >= space.price * 1.6;
        if (me.cash - space.price >= BOT_RESERVE || strategic) return buy;
      }
      return find("decline") ?? null;
    }

    case "awaitingRoll":
    case "awaitingEndTurn": {
      const improvement = improve(board, me, legal);
      if (improvement) return improvement;
      if (phase.kind === "awaitingEndTurn") {
        return setCompletingOffer(state, board, me) ?? find("endTurn") ?? null;
      }
      if (me.inJail) {
        // Early on, the board is worth getting around; later, jail is a safe place to wait.
        const fine = find("payJailFine");
        if (fine && state.turn.round <= 8 && me.cash - state.config.jailFine >= BOT_RESERVE) {
          return fine;
        }
        const card = find("useGetOutCard");
        if (card && state.turn.round <= 8) return card;
      }
      return find("roll") ?? null;
    }

    default:
      return null;
  }
}

/** Unseals when rich, then builds on the most valuable complete set it can afford. */
function improve(board: BoardDefinition, me: PlayerState, legal: Action[]): Action | null {
  const unseals = legal.filter(
    (a): a is Extract<Action, { type: "unseal" }> => a.type === "unseal",
  );
  const affordableUnseal = unseals
    .map((a) => ({ a, cost: unsealCost(board, a.space) }))
    .filter(({ cost }) => me.cash - cost >= BOT_RESERVE * 3)
    .sort((x, y) => x.cost - y.cost)[0];
  if (affordableUnseal) return affordableUnseal.a;

  const builds = legal
    .filter((a): a is Extract<Action, { type: "build" }> => a.type === "build")
    .map((a) => {
      const space = board.spaces[a.space];
      return { a, cost: space?.kind === "property" ? space.buildCost : Number.POSITIVE_INFINITY };
    })
    .filter(({ cost }) => me.cash - cost >= BOT_RESERVE)
    .sort((x, y) => y.cost - x.cost);
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
): number {
  const space = board.spaces[index];
  if (!space || !isOwnable(space)) return 0;
  if (space.kind === "property") {
    const others = groupIndices(board, space.group).filter((i) => i !== index);
    const mine = others.filter((i) => state.owners[i] === botId).length;
    if (mine === others.length) return space.price * 2;
    const owners = others.map((i) => state.owners[i]).filter((o) => o && o !== botId);
    const blocking = owners.length === others.length && new Set(owners).size === 1;
    if (blocking) return space.price * 1.6;
    return space.price * (mine > 0 ? 1.3 : 1);
  }
  const owned = indicesOfKind(board, space.kind).filter(
    (i) => i !== index && state.owners[i] === botId,
  ).length;
  return space.price * (1 + (space.kind === "zipline" ? 0.25 : 0.3) * owned);
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

/** Value received over value given, from the bot's point of view; 0 if it would break a set. */
function tradeRatio(
  state: LegalView,
  board: BoardDefinition,
  me: PlayerState,
  trade: Trade,
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
  return gain / Math.max(1, loss);
}

/** Offered price, as a multiple of the printed price, for the last property of a set. */
const SET_OFFER_MULTIPLE = 1.5;
/** Rounds between repeat offers, so an owner who said no isn't asked every turn. */
const OFFER_EVERY_ROUNDS = 3;

/**
 * Offers to buy the one property standing between this bot and a full set,
 * for cash it can spare. Without these offers, all-bot games rarely end.
 */
function setCompletingOffer(
  state: LegalView,
  board: BoardDefinition,
  me: PlayerState,
): Action | null {
  const seat = state.players.findIndex((p) => p.id === me.id);
  if ((state.turn.round + seat) % OFFER_EVERY_ROUNDS !== 0) return null;
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
    const cash = Math.round(space.price * SET_OFFER_MULTIPLE);
    if (me.cash - cash < BOT_RESERVE) continue;
    const offer: Action = {
      type: "proposeTrade",
      to: owner,
      offer: { cash, spaces: [], getOutCards: [] },
      request: { cash: 0, spaces: [target], getOutCards: [] },
    };
    if (checkAction(state, me.id, offer) === null) return offer;
  }
  return null;
}
