import { Trash2 } from "lucide-react";
import { useState } from "react";
import { send } from "../connection";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";

/** Host only: deletes the lobby for everyone, after an inline confirmation. */
export function CloseLobbyButton({ className }: { className?: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn("text-muted", className)}
        onClick={() => setConfirming(true)}
      >
        <Trash2 />
        Close lobby
      </Button>
    );
  }
  return (
    <div className={cn("flex flex-col gap-2 rounded-lg bg-surface-2 p-3", className)}>
      <p className="text-sm">Close this lobby for everyone? The game and its code are deleted.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="danger" size="sm" onClick={() => send({ type: "closeLobby" })}>
          Close for everyone
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
