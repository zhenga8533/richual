import {
  type Browser,
  type BrowserContext,
  devices,
  expect,
  type Page,
  test,
} from "@playwright/test";

// Contexts opened by a test are closed after it, so open game sockets don't pile up
// on the shared dev server and slow down later tests.
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

async function newPlayer(browser: Browser, options = {}): Promise<Page> {
  const context = await browser.newContext(options);
  contexts.push(context);
  return context.newPage();
}

async function createLobby(page: Page, name = "Host"): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Create lobby" }).click();
  await expect(page).toHaveURL(/\/l\/[0-9A-Z]{6}$/, { timeout: 30_000 });
  return page.url();
}

/** A host and one bot, with the game started. */
async function startBotGame(browser: Browser, options = {}): Promise<Page> {
  const host = await newPlayer(browser, options);
  await createLobby(host);
  await host.getByRole("button", { name: "Add a bot", exact: true }).click();
  await expect(host.getByRole("heading", { name: "Players (2/6)" })).toBeVisible();
  await host.getByRole("button", { name: "Begin the ritual" }).click();
  await expect(host.getByRole("tablist", { name: "Game details" })).toBeVisible();
  return host;
}

test("a bot fills a seat and takes its turns", async ({ browser }) => {
  const host = await startBotGame(browser);
  const log = host.getByRole("list", { name: "Ritual log" });
  await host.getByRole("tab", { name: "Log" }).click();
  const botRolled = log.getByText(/^Bot · .+ rolled/).first();
  // Play our own turns with the main action until the bot has had one.
  await expect(async () => {
    if (!(await botRolled.isVisible())) {
      // Clicking the Log tab leaves it focused, and Space on a focused button is the button's.
      await host.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await host.keyboard.press("Space");
    }
    await expect(botRolled).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 45_000 });
});

test("a seat moves to another device with a one-time code", async ({ browser }) => {
  const oldDevice = await newPlayer(browser);
  const url = await createLobby(oldDevice, "Mover");
  await oldDevice.getByRole("button", { name: "Continue on another device" }).click();
  const popover = oldDevice.getByRole("dialog");
  await expect(popover.getByRole("img", { name: "QR code for the seat link" })).toBeVisible();
  const code = (await popover.locator(".font-mono").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[0-9A-Z]{6}$/);

  const newDevice = await newPlayer(browser);
  await newDevice.goto(`${url}#seat=${code}`);
  await expect(newDevice.getByRole("heading", { name: /^Players \(/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(newDevice.getByText("Mover")).toBeVisible();
  // The code never stays in the address bar.
  expect(new URL(newDevice.url()).hash).toBe("");
  await expect(
    oldDevice.getByRole("heading", { name: "Your seat moved to another device" }),
  ).toBeVisible();
});

test("the board is navigable with arrow keys", async ({ browser }) => {
  const host = await startBotGame(browser);
  const gate = host.getByRole("button", { name: /^Astral Gate/ });
  await gate.focus();
  await host.keyboard.press("ArrowRight");
  await expect(host.getByRole("button", { name: /^Rat Warrens/ })).toBeFocused();
  await host.keyboard.press("ArrowLeft");
  await expect(gate).toBeFocused();
  await host.keyboard.press("End");
  await host.keyboard.press("Enter");
  await expect(host.getByRole("dialog")).toBeVisible();
});

test("phones can switch the board to a readable list", async ({ browser }) => {
  const host = await startBotGame(browser, devices["Pixel 7"]);
  await host.getByRole("button", { name: "List" }).click();
  await host.getByRole("button", { name: /^Rat Warrens/ }).click();
  const sheet = host.getByRole("dialog", { name: "Property details" });
  await expect(sheet.getByRole("heading", { name: "Rat Warrens" })).toBeVisible();
  const overflow = await host.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("uncaught errors are reported to the server", async ({ browser }) => {
  const page = await newPlayer(browser);
  await page.goto("/");
  const reported = page.waitForResponse("**/api/client-errors");
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("e2e test error");
    });
  });
  expect((await reported).status()).toBe(204);
});

test("Your games lists every lobby this browser is in, and Rejoin opens it", async ({
  browser,
}) => {
  const page = await newPlayer(browser);
  const first = await createLobby(page, "Juggler");
  const second = await createLobby(page, "Juggler");
  await page.goto("/");
  const games = page.getByRole("list", { name: "Your games" });
  const code = (url: string) => url.slice(-6);
  await expect(games.getByText(code(first))).toBeVisible();
  await expect(games.getByText(code(second))).toBeVisible();
  await games
    .getByRole("listitem")
    .filter({ hasText: code(first) })
    .getByRole("button", { name: "Rejoin" })
    .click();
  await expect(page).toHaveURL(first);
  await expect(page.getByRole("heading", { name: /^Players \(/ })).toBeVisible();
});

test("the host can close a lobby from Your games", async ({ browser }) => {
  const host = await newPlayer(browser);
  const url = await createLobby(host, "Tidier");
  const code = url.slice(-6);
  const guest = await newPlayer(browser);
  await guest.goto(url);
  await guest.getByLabel("Your name").fill("Guest");
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest.getByRole("heading", { name: /^Players \(/ })).toBeVisible();

  // Only the host gets the option.
  await guest.goto("/");
  const guestRow = guest.getByRole("list", { name: "Your games" }).getByRole("listitem");
  await expect(guestRow.getByText(code)).toBeVisible();
  await expect(guestRow.getByRole("button", { name: `Close ${code} for everyone` })).toHaveCount(0);

  await host.goto("/");
  const row = host.getByRole("list", { name: "Your games" }).getByRole("listitem");
  await row.getByRole("button", { name: `Close ${code} for everyone` }).click();
  await row.getByRole("button", { name: "Close for everyone" }).click();
  await expect(host.getByRole("list", { name: "Your games" })).toHaveCount(0);

  await host.goto(url);
  await expect(host.getByRole("heading", { name: "This lobby no longer exists" })).toBeVisible();
});

test("a public lobby shows up in Browse for another player, who can join it", async ({
  browser,
}) => {
  const host = await newPlayer(browser);
  const url = await createLobby(host, "Opener");
  await host.getByRole("combobox", { name: /Who can join/ }).selectOption("Public");
  await expect(host.getByText("Anyone can join.")).toBeVisible();

  const stranger = await newPlayer(browser);
  await stranger.goto("/");
  await stranger.getByRole("tab", { name: "Browse" }).click();
  const listing = stranger
    .getByRole("list", { name: "Public lobbies" })
    .getByRole("listitem")
    .filter({ hasText: "Opener's lobby" });
  await expect(async () => {
    await stranger.getByRole("button", { name: "Refresh public lobbies" }).click();
    await expect(listing).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await listing.getByRole("button", { name: "Join" }).click();
  await expect(stranger).toHaveURL(url);
  await stranger.getByLabel("Your name").fill("Stranger");
  await stranger.getByRole("button", { name: "Join" }).click();
  await expect(host.getByText("Stranger")).toBeVisible();
});

test("a passcode lobby is listed with a lock and asks joiners for the passcode", async ({
  browser,
}) => {
  const host = await newPlayer(browser);
  await createLobby(host, "Gatekeeper");
  await host.getByRole("combobox", { name: /Who can join/ }).selectOption("Public with passcode");
  await host.getByRole("textbox", { name: "Passcode" }).fill("open sesame");
  await host.getByRole("button", { name: "Set", exact: true }).click();
  await expect(host.getByRole("button", { name: "Change passcode" })).toBeVisible();

  const stranger = await newPlayer(browser);
  await stranger.goto("/");
  await stranger.getByRole("tab", { name: "Browse" }).click();
  const listing = stranger
    .getByRole("list", { name: "Public lobbies" })
    .getByRole("listitem")
    .filter({ hasText: "Gatekeeper's lobby" });
  await expect(async () => {
    await stranger.getByRole("button", { name: "Refresh public lobbies" }).click();
    await expect(listing).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(listing.getByText("Needs a passcode")).toBeAttached();
  await listing.getByRole("button", { name: "Join" }).click();

  await stranger.getByLabel("Your name").fill("Stranger");
  // The join page already knows the lobby is locked, so it asks up front.
  await stranger.getByLabel("Passcode").fill("wrong");
  await stranger.getByRole("button", { name: "Join" }).click();
  await expect(stranger.getByRole("alert")).toHaveText("That passcode isn't right");
  await stranger.getByLabel("Passcode").fill("open sesame");
  await stranger.getByRole("button", { name: "Join" }).click();
  await expect(host.getByText("Stranger")).toBeVisible();
});

test("the host can add a Hard bot", async ({ browser }) => {
  const host = await newPlayer(browser);
  await createLobby(host);
  await host.getByRole("button", { name: "Add a bot at another difficulty" }).click();
  await host.getByRole("menuitem", { name: /Hard bot/ }).click();
  await expect(host.getByText("Bot · Hard")).toBeVisible();
});

test("the host can close the lobby for everyone", async ({ browser }) => {
  const host = await newPlayer(browser);
  const url = await createLobby(host, "Closer");
  const guest = await newPlayer(browser);
  await guest.goto(url);
  await guest.getByLabel("Your name").fill("Guest");
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(host.getByText("Guest")).toBeVisible();
  // Connected, so the guest is told who closed it rather than just that it's gone.
  await expect(guest.getByRole("heading", { name: /^Players \(/ })).toBeVisible();

  await host.getByRole("button", { name: "Close lobby" }).click();
  await host.getByRole("button", { name: "Close for everyone" }).click();
  await expect(guest.getByRole("heading", { name: "The host closed this lobby" })).toBeVisible();
  await expect(host.getByRole("heading", { name: "You closed this lobby" })).toBeVisible();
  // The old lobby is replaced, not left on screen behind a banner.
  await expect(guest.getByRole("heading", { name: /^Players \(/ })).toHaveCount(0);

  await host.goto("/");
  await expect(host.getByText(url.slice(-6))).toHaveCount(0);

  // The old link now says so before anyone types a name.
  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: "This lobby no longer exists" })).toBeVisible();
});
