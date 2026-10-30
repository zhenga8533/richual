import type { LobbyPlayer, LobbySnapshot } from "@richual/protocol";
import { Bot, Crown, Ellipsis, UserMinus } from "lucide-react";
import { send, useConnection } from "../connection";
import { Button } from "../ui/button";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../ui/radix";

/** The host's actions for another player's seat; renders nothing for everyone else. */
export function PlayerMenu({ lobby, player }: { lobby: LobbySnapshot; player: LobbyPlayer }) {
  const { playerId } = useConnection();
  if (playerId !== lobby.hostId || player.id === playerId) return null;
  const inLobby = lobby.status === "open";
  const inGame = lobby.status === "playing";
  if (player.bot && !inLobby) return null;

  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2" aria-label={`Manage ${player.name}`}>
          <Ellipsis />
        </Button>
      </MenuTrigger>
      <MenuContent>
        {!player.bot && (
          <MenuItem onSelect={() => send({ type: "setHost", playerId: player.id })}>
            <Crown />
            Make host
          </MenuItem>
        )}
        {inLobby && (
          <MenuItem onSelect={() => send({ type: "removePlayer", playerId: player.id })}>
            <UserMinus />
            Remove
          </MenuItem>
        )}
        {inGame && !player.bot && (
          <MenuItem onSelect={() => send({ type: "replaceWithBot", playerId: player.id })}>
            <Bot />
            Replace with a bot
          </MenuItem>
        )}
      </MenuContent>
    </MenuRoot>
  );
}
