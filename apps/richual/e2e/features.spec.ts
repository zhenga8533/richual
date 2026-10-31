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
  await host.getByRole("button", { name: "Add a bot" }).click();
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
  await expect(oldDevice.getByText("Your seat moved to another device.")).toBeVisible();
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
