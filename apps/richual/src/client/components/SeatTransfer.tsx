import { MonitorSmartphone } from "lucide-react";
import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { send, useConnection } from "../connection";
import { lobbyPath, seatHash } from "../router";
import { Button } from "../ui/button";
import { PopoverContent, PopoverRoot, PopoverTrigger } from "../ui/radix";
import { useServerNow } from "./Countdown";

/** Shows a one-time code, link and QR code that move this seat to another device. */
export function SeatTransfer({ code, compact = false }: { code: string; compact?: boolean }) {
  const seatCode = useConnection((s) => s.seatCode);
  const now = useServerNow(1000);
  const live = seatCode && seatCode.expiresAt > now ? seatCode : null;
  const link = live ? `${location.origin}${lobbyPath(code)}${seatHash(live.code)}` : null;

  return (
    <PopoverRoot
      onOpenChange={(open) => {
        if (open && !live) send({ type: "createSeatCode" });
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant={compact ? "ghost" : "outline"}
          size="sm"
          aria-label={compact ? "Continue on another device" : undefined}
          title="Continue on another device"
        >
          <MonitorSmartphone />
          {!compact && "Continue on another device"}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start">
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium">Continue on another device</p>
          {live && link ? (
            <>
              <QrCode text={link} />
              <p className="text-muted">
                Scan this, or open the lobby there and enter the seat code{" "}
                <span className="font-mono font-semibold tracking-[0.2em] text-fg">
                  {live.code}
                </span>
                . It works once and expires in{" "}
                {Math.max(1, Math.ceil((live.expiresAt - now) / 60_000))} min. This device leaves
                the game when it's used.
              </p>
            </>
          ) : (
            <p className="text-muted">Getting a code…</p>
          )}
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}

function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { size: count, path: d };
  }, [text]);
  const margin = 2;
  return (
    <svg
      viewBox={`${-margin} ${-margin} ${size + margin * 2} ${size + margin * 2}`}
      className="mx-auto size-44 rounded-lg bg-white"
      role="img"
      aria-label="QR code for the seat link"
      shapeRendering="crispEdges"
    >
      <path d={path} fill="black" />
    </svg>
  );
}
