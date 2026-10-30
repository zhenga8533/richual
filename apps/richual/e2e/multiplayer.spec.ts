import { type Browser, expect, type Page, test } from "@playwright/test";

async function newPlayer(browser: Browser): Promise<Page> {
  // Separate contexts have separate storage, so each is a distinct guest.
  const context = await browser.newContext();
  return context.newPage();
}

async function createLobby(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Create lobby" }).click();
  await expect(page).toHaveURL(/\/l\/[0-9A-Z]{6}$/);
  return page.url();
}

async function joinLobby(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByText(`${name} (you)`)).toBeVisible();
}

/** Returns the page whose turn it is, and the other one. */
async function byTurn(a: Page, b: Page): Promise<[Page, Page]> {
  const roll = (p: Page) => p.getByRole("button", { name: "Roll dice" });
  await expect
    .poll(async () => (await roll(a).isVisible()) || (await roll(b).isVisible()))
    .toBe(true);
  return (await roll(a).isVisible()) ? [a, b] : [b, a];
}

test("two players create, join, start and play in sync", async ({ browser }) => {
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser);

  const url = await createLobby(host, "Host");
  await joinLobby(guest, url, "Guest");
  await expect(host.getByRole("heading", { name: "Players (2/6)" })).toBeVisible();

  await expect(guest.getByText("Waiting for the host to start")).toBeVisible();
  await host.getByRole("button", { name: "Begin the ritual" }).click();

  const [current, other] = await byTurn(host, guest);
  await expect(current).toHaveTitle(/Your move/);
  await current.getByRole("button", { name: "Roll dice" }).click();

  // The roll reaches the other player's log.
  await expect(other.getByRole("list").getByText(/ rolled \d \+ \d/)).toBeVisible();
  await expect(current.getByRole("list").getByText(/ rolled \d \+ \d/)).toBeVisible();
});

test("a player reconnects to the same seat after reloading", async ({ browser }) => {
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser);
  const url = await createLobby(host, "Host");
  await joinLobby(guest, url, "Guest");
  await host.getByRole("button", { name: "Begin the ritual" }).click();

  const [current] = await byTurn(host, guest);
  await current.reload();
  await expect(current.getByText("Connected")).toBeVisible();
  await expect(current.getByRole("button", { name: "Roll dice" })).toBeVisible();
});

test("a third player cannot join a game in progress", async ({ browser }) => {
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser);
  const late = await newPlayer(browser);
  const url = await createLobby(host, "Host");
  await joinLobby(guest, url, "Guest");
  await host.getByRole("button", { name: "Begin the ritual" }).click();
  await byTurn(host, guest);

  await late.goto(url);
  await late.getByLabel("Your name").fill("Late");
  await late.getByRole("button", { name: "Join" }).click();
  await expect(late.getByRole("alert")).toHaveText("This game has already started");
});

test("declining a property starts an auction both players see", async ({ browser }) => {
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser);
  const url = await createLobby(host, "Host");
  await joinLobby(guest, url, "Guest");
  await host.getByRole("button", { name: "Begin the ritual" }).click();

  const turnButton = (p: Page) =>
    p.getByRole("button", { name: /^(Roll dice|End turn|Pass to auction)$/ }).first();
  for (let step = 0; step < 40; step++) {
    await expect
      .poll(
        async () => (await turnButton(host).isVisible()) || (await turnButton(guest).isVisible()),
      )
      .toBe(true);
    const current = (await turnButton(host).isVisible()) ? host : guest;
    const pass = current.getByRole("button", { name: "Pass to auction" });
    if (await pass.isVisible()) {
      await pass.click();
      await expect(host.getByRole("heading", { name: /^Auction:/ })).toBeVisible();
      await expect(guest.getByRole("heading", { name: /^Auction:/ })).toBeVisible();
      return;
    }
    const logLines = current.locator('section[aria-labelledby="game-log"] li');
    const before = await logLines.count();
    await turnButton(current).click();
    // Wait for this action's result before looking for the next button.
    await expect.poll(() => logLines.count()).toBeGreaterThan(before);
  }
  throw new Error("no unowned property was landed on in 40 steps");
});

test("the host can pause, resume and end a game with standings", async ({ browser }) => {
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser);
  const url = await createLobby(host, "Host");
  await joinLobby(guest, url, "Guest");
  await host.getByRole("button", { name: "Begin the ritual" }).click();
  await byTurn(host, guest);

  await expect(guest.getByRole("button", { name: "Pause" })).toHaveCount(0);
  await host.getByRole("button", { name: "Pause" }).click();
  await expect(guest.getByRole("status").filter({ hasText: "Paused" })).toBeVisible();
  await expect(guest.getByText("The host has paused the game")).toBeVisible();

  await host.getByRole("button", { name: "Resume" }).click();
  await expect(guest.getByRole("status").filter({ hasText: "Paused" })).toHaveCount(0);

  await host.getByRole("button", { name: "End game" }).click();
  await host.getByRole("button", { name: "End and score now" }).click();
  for (const page of [host, guest]) {
    await expect(page.getByText("Provisional", { exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "Final standings" })).toBeVisible();
  }
});
