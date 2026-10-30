import { getBoard, isOwnable } from "./board";
import {
  canBuild,
  canSeal,
  canSellBuilding,
  canUnseal,
  currentPlayer,
  type EconomyView,
  proposalProblem,
  type TurnView,
  tradeProblem,
} from "./rules";
import type { Action, GameState, PlayerId, RuleError } from "./state";

export type LegalView = TurnView & EconomyView & Pick<GameState, "debts">;

const TURN_ACTIONS = new Set<Action["type"]>([
  "roll",
  "payJailFine",
  "useGetOutCard",
  "buy",
  "decline",
  "endTurn",
]);

/**
 * Every action `playerId` may take right now, fully specified, except for
 * open-ended ones: a bid is listed once at the minimum amount, and trade
 * proposals are not listed (any valid proposal is allowed).
 */
export function getLegalActions(state: LegalView, playerId: PlayerId): Action[] {
  const { phase } = state;
  if (phase.kind === "gameOver") return [];
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.bankrupt) return [];
  const board = getBoard(state.config.boardId);
  const actions: Action[] = [];

  const manage = (kinds: { build: boolean; unseal: boolean }) => {
    state.owners.forEach((owner, space) => {
      if (owner !== playerId) return;
      if (kinds.build && canBuild(state, board, playerId, space)) {
        actions.push({ type: "build", space });
      }
      if (canSellBuilding(state, board, playerId, space)) {
        actions.push({ type: "sellBuilding", space });
      }
      if (canSeal(state, board, playerId, space)) actions.push({ type: "seal", space });
      if (kinds.unseal && canUnseal(state, board, playerId, space)) {
        actions.push({ type: "unseal", space });
      }
    });
  };

  switch (phase.kind) {
    case "raisingFunds": {
      const debt = state.debts[0];
      if (debt?.debtor === playerId) {
        if (player.cash >= debt.amount) actions.push({ type: "payDebt" });
        actions.push({ type: "declareBankruptcy" });
        manage({ build: false, unseal: false });
      }
      break;
    }
    case "auction":
      if (phase.bidders.includes(playerId)) {
        if (player.cash > phase.highBid) actions.push({ type: "bid", amount: phase.highBid + 1 });
        if (phase.highBidder !== playerId) actions.push({ type: "passAuction" });
      }
      break;
    case "awaitingRoll":
    case "awaitingBuy":
    case "awaitingEndTurn": {
      if (currentPlayer(state).id !== playerId) break;
      if (phase.kind === "awaitingRoll") {
        actions.push({ type: "roll" });
        if (player.inJail && player.cash >= state.config.jailFine) {
          actions.push({ type: "payJailFine" });
        }
        if (player.inJail && player.getOutCards.length > 0) actions.push({ type: "useGetOutCard" });
      } else if (phase.kind === "awaitingBuy") {
        const space = board.spaces[phase.space];
        if (space && isOwnable(space) && player.cash >= space.price) actions.push({ type: "buy" });
        actions.push({ type: "decline" });
      } else {
        actions.push({ type: "endTurn" });
      }
      // While deciding on a purchase you may only raise cash, not spend it elsewhere.
      manage({ build: phase.kind !== "awaitingBuy", unseal: phase.kind !== "awaitingBuy" });
      break;
    }
  }

  for (const trade of state.trades) {
    if (trade.to === playerId) {
      if (phase.kind !== "auction" && tradeProblem(state, board, trade) === null) {
        actions.push({ type: "acceptTrade", tradeId: trade.id });
      }
      actions.push({ type: "rejectTrade", tradeId: trade.id });
    }
    if (trade.from === playerId) actions.push({ type: "cancelTrade", tradeId: trade.id });
  }
  return actions;
}

function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  if ("space" in a && "space" in b) return a.space === b.space;
  if ("tradeId" in a && "tradeId" in b) return a.tradeId === b.tradeId;
  return true;
}

/** Why `playerId` may not take `action` now, or null if they may. */
export function checkAction(
  state: LegalView,
  playerId: PlayerId,
  action: Action,
): RuleError | null {
  if (state.phase.kind === "gameOver") return { code: "game_over", message: "The game is over" };
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.bankrupt) {
    return { code: "unknown_player", message: "You are not playing in this game" };
  }
  const illegal = (message: string): RuleError => ({ code: "illegal_action", message });

  switch (action.type) {
    case "bid": {
      const { phase } = state;
      if (phase.kind !== "auction" || !phase.bidders.includes(playerId)) {
        return illegal("You are not bidding in an auction");
      }
      if (!Number.isInteger(action.amount) || action.amount <= phase.highBid) {
        return illegal(`Bids must be more than ${phase.highBid}`);
      }
      if (action.amount > player.cash) return illegal("You cannot bid more souls than you have");
      return null;
    }
    case "proposeTrade": {
      if (state.phase.kind === "auction") return illegal("Wait for the auction to finish");
      const problem = proposalProblem(state, getBoard(state.config.boardId), {
        from: playerId,
        to: action.to,
        offer: action.offer,
        request: action.request,
      });
      return problem ? illegal(problem) : null;
    }
    default: {
      if (getLegalActions(state, playerId).some((a) => sameAction(a, action))) return null;
      if (TURN_ACTIONS.has(action.type) && currentPlayer(state).id !== playerId) {
        return { code: "not_your_turn", message: "It is not your turn" };
      }
      return illegal(`Cannot ${action.type} right now`);
    }
  }
}
