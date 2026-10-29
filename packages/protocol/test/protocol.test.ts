import { describe, expect, it } from "vitest";
import { ClientMessage, LobbyCode, PlayerName } from "../src";

describe("LobbyCode", () => {
  it("accepts valid codes case-insensitively", () => {
    expect(LobbyCode.parse("ab12cd")).toBe("AB12CD");
  });

  it("rejects confusable characters and wrong lengths", () => {
    for (const bad of ["AB12CI", "ABCDE", "ABCDEFG", "AB-2CD", "OOOOOO"]) {
      expect(LobbyCode.safeParse(bad).success).toBe(false);
    }
  });
});

describe("PlayerName", () => {
  it("trims whitespace", () => {
    expect(PlayerName.parse("  Haze  ")).toBe("Haze");
  });

  it("rejects empty, overlong, and control-character names", () => {
    for (const bad of ["", "   ", "x".repeat(21), "bad\nname"]) {
      expect(PlayerName.safeParse(bad).success).toBe(false);
    }
  });
});

describe("ClientMessage", () => {
  it("rejects unknown message types", () => {
    expect(ClientMessage.safeParse({ type: "nope" }).success).toBe(false);
  });
});
