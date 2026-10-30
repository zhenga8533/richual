import { getBoard, getLegalActions, type PublicGameState } from "@richual/engine";
import type { LobbySnapshot } from "@richual/protocol";
import { X } from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useNeedsYouAlert, useNotificationPreference } from "../alerts";
import { type LoggedEvent, useConnection } from "../connection";
import { describeEvent } from "../describe";
import { useGameFeedback } from "../gameFeedback";
import { SHORTCUTS, useShortcuts } from "../shortcuts";
import { SOULS } from "../theme";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { cn } from "../ui/cn";
import {
  PopoverAnchor,
  PopoverContent,
  PopoverRoot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../ui/radix";
import { ActionCard } from "./ActionCard";
import { Board } from "./Board";
import { Chat } from "./ChatPanel";
import { GameToolbar } from "./GameToolbar";
import { heroLabel } from "./heroLabel";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerMenu } from "./PlayerMenu";
import { PropertyDetails } from "./PropertyDetails";
import { TradesTab } from "./TradesTab";

const TABS = ["players", "trades", "log", "chat"] as const;
type Tab = (typeof TABS)[number];

export function GameView({ lobby, game }: { lobby: LobbySnapshot; game: PublicGameState }) {
  const { playerId, log, historySeq, pendingActionId } = useConnection();
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("players");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [previewOwner, setPreviewOwner] = useState<string | null>(null);
  const [pinnedOwner, setPinnedOwner] = useState<string | null>(null);
  const [seenChatId, setSeenChatId] = useState(() => lobby.chat.at(-1)?.id ?? 0);
  const [attention, setAttention] = useState(0);
  const anchor = useRef<HTMLElement | null>(null);
  const [notify, setNotify] = useNotificationPreference();

  const lastChatId = lobby.chat.at(-1)?.id ?? 0;
  useEffect(() => {
    if (tab === "chat") setSeenChatId(lastChatId);
  }, [tab, lastChatId]);
  const unreadChat = lobby.chat.filter((m) => m.id > seenChatId && m.playerId !== playerId).length;
  const incomingTrades = game.trades.filter((t) => t.to === playerId).length;

  const lastDraw = log.findLast((l) => l.event.type === "cardDrawn");
  const lastCard =
    lastDraw?.event.type === "cardDrawn"
      ? { seq: lastDraw.seq, deck: lastDraw.event.deck, cardId: lastDraw.event.cardId }
      : null;

  // Anything but withdrawing your own offer means the game is waiting on you.
  const needsMe =
    !lobby.paused &&
    playerId !== null &&
    getLegalActions(game, playerId).some((a) => a.type !== "cancelTrade");
  useNeedsYouAlert(needsMe, notify, "It's your move.");
  const wasNeeded = useRef(needsMe);
  useEffect(() => {
    if (needsMe && !wasNeeded.current) setAttention((n) => n + 1);
    wasNeeded.current = needsMe;
  }, [needsMe]);
  useEffect(() => {
    document.title = needsMe ? `${SOULS} Your move — Richual` : "Richual";
    return () => {
      document.title = "Richual";
    };
  }, [needsMe]);

  useGameFeedback(log, historySeq, playerId, lobby);
  useShortcuts({
    game,
    playerId,
    paused: lobby.paused,
    pending: pendingActionId !== null,
    onTab: useCallback((i: number) => setTab(TABS[i] ?? "players"), []),
    onToggleHelp: useCallback(() => setShowShortcuts((s) => !s), []),
  });

  return (
    <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
      <PopoverRoot
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <PopoverAnchor virtualRef={anchor as RefObject<HTMLElement>} />
        {/* As large as the window allows while staying square and fully visible. */}
        <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-5.5rem))]">
          <Board
            game={game}
            players={lobby.players}
            myId={playerId}
            selected={selected}
            anchorRef={anchor}
            onSelect={(space) => setSelected(space === selected ? null : space)}
            lastCard={lastCard}
            highlightOwner={previewOwner ?? pinnedOwner}
          />
        </div>
        {selected !== null && (
          <PopoverContent side="right" align="center" aria-labelledby="property-heading">
            <PropertyDetails lobby={lobby} game={game} space={selected} />
          </PopoverContent>
        )}
      </PopoverRoot>

      <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-3 lg:max-h-[calc(100dvh-4.5rem)]">
        <GameToolbar
          lobby={lobby}
          game={game}
          notify={notify}
          onNotifyChange={setNotify}
          onShowShortcuts={() => setShowShortcuts((s) => !s)}
        />
        {showShortcuts && <ShortcutHelp onClose={() => setShowShortcuts(false)} />}
        <ActionCard lobby={lobby} game={game} attention={attention} />
        <Card className="flex min-h-0 flex-col p-2 lg:flex-1">
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList aria-label="Game details">
              <TabsTrigger value="players">Players</TabsTrigger>
              <TabsTrigger value="trades">
                Trades
                {incomingTrades > 0 && (
                  <Badge variant="solid" className="px-1.5 py-0">
                    {incomingTrades}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="log">Log</TabsTrigger>
              <TabsTrigger value="chat">
                Chat
                {unreadChat > 0 && (
                  <Badge variant="solid" className="px-1.5 py-0">
                    {unreadChat}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <div className="h-[min(24rem,60dvh)] overflow-y-auto px-2 pt-3 pb-2 lg:h-auto lg:min-h-48 lg:flex-1">
              <TabsContent value="players">
                <Players
                  lobby={lobby}
                  game={game}
                  pinned={pinnedOwner}
                  onPreview={setPreviewOwner}
                  onPin={(id) => setPinnedOwner((p) => (p === id ? null : id))}
                />
              </TabsContent>
              <TabsContent value="trades">
                <TradesTab lobby={lobby} game={game} />
              </TabsContent>
              <TabsContent value="log">
                <EventLog log={log} lobby={lobby} game={game} />
              </TabsContent>
              <TabsContent value="chat" className="h-full">
                <Chat lobby={lobby} className="h-full min-h-48" />
              </TabsContent>
            </div>
          </Tabs>
        </Card>
      </aside>
    </div>
  );
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Card className="card-reveal p-3" aria-labelledby="shortcuts-heading">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="shortcuts-heading" className="text-sm font-semibold">
          Keyboard shortcuts
        </h2>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="contents">
            <dt>
              <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                {s.keys}
              </kbd>
            </dt>
            <dd className="text-muted">{s.does}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Players({
  lobby,
  game,
  pinned,
  onPreview,
  onPin,
}: {
  lobby: LobbySnapshot;
  game: PublicGameState;
  pinned: string | null;
  onPreview: (id: string | null) => void;
  onPin: (id: string) => void;
}) {
  const { playerId } = useConnection();
  const current = game.players[game.turn.playerIndex];
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1" aria-label="Players">
        {game.players.map((p) => {
          const info = lobby.players.find((lp) => lp.id === p.id);
          const owned = game.owners.filter((o) => o === p.id).length;
          const isCurrent = p.id === current?.id && game.phase.kind !== "gameOver";
          return (
            <li key={p.id} className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={pinned === p.id}
                aria-label={`${p.name}: show their holdings on the board`}
                onMouseEnter={() => onPreview(p.id)}
                onMouseLeave={() => onPreview(null)}
                onFocus={() => onPreview(p.id)}
                onBlur={() => onPreview(null)}
                onClick={() => onPin(p.id)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2",
                  isCurrent && "bg-accent-soft hover:bg-accent-soft",
                  pinned === p.id && "ring-2 ring-accent ring-inset",
                  p.bankrupt && "opacity-50",
                )}
              >
                <PlayerAvatar
                  seat={info?.seat ?? 0}
                  hero={info?.hero ?? null}
                  name={p.name}
                  online={info?.connected}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate font-medium">
                    {p.name}
                    {p.id === playerId && <Badge>You</Badge>}
                    {info?.bot && <Badge>Bot</Badge>}
                    {isCurrent && <Badge variant="accent">Turn</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {[
                      heroLabel(info?.hero ?? null, ""),
                      `${owned} owned`,
                      p.inJail && "in the Lost Whisper",
                      p.getOutCards.length > 0 && `${p.getOutCards.length} escape card`,
                      p.bankrupt && "bankrupt",
                      info && !info.connected && !info.bot && "offline",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">
                  {p.cash} <span className="text-accent-text">{SOULS}</span>
                </span>
              </button>
              {info && !p.bankrupt && <PlayerMenu lobby={lobby} player={info} />}
            </li>
          );
        })}
      </ul>
      <p className="px-2 text-xs text-muted">
        Hover or tap a player to see what they own on the board.
      </p>
    </div>
  );
}

function EventLog({
  log,
  lobby,
  game,
}: {
  log: LoggedEvent[];
  lobby: LobbySnapshot;
  game: PublicGameState;
}) {
  const board = getBoard(game.config.boardId);
  const name = (id: string) => lobby.players.find((p) => p.id === id)?.name ?? "Someone";
  const lines = log
    // Banishment already says where the player went.
    .filter((l, i) => !(l.event.type === "moved" && log[i + 1]?.event.type === "sentToJail"))
    .map(({ seq, event }) => ({ seq, text: describeEvent(event, name, board), event }))
    .filter((l): l is typeof l & { text: string } => l.text !== null);
  const end = useRef<HTMLLIElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever new events arrive
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [log]);

  return (
    <ol className="space-y-1 text-sm" aria-live="polite" aria-label="Ritual log">
      {lines.length === 0 && (
        <li className="py-6 text-center text-muted">Nothing has happened yet.</li>
      )}
      {lines.map((l) =>
        l.event.type === "turnStarted" ? (
          <li
            key={l.seq}
            className="flex items-center gap-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-accent-text uppercase"
          >
            {l.text}
            <span className="h-px flex-1 bg-line" aria-hidden />
          </li>
        ) : (
          <li key={l.seq} className="text-fg/90">
            {l.text}
          </li>
        ),
      )}
      <li ref={end} aria-hidden />
    </ol>
  );
}
