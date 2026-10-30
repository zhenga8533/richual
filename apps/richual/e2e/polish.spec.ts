import AxeBuilder from "@axe-core/playwright";
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

async function startTwoPlayerGame(
  browser: Browser,
  hostOptions = {},
  { quick = false }: { quick?: boolean } = {},
) {
  const host = await newPlayer(browser, hostOptions);
  const guest = await newPlayer(browser);
  await host.goto("/");
  await host.getByLabel("Your name").fill("Host");
  await host.getByRole("button", { name: "Create lobby" }).click();
  await expect(host).toHaveURL(/\/l\/[0-9A-Z]{6}$/, { timeout: 30_000 });
  await guest.goto(host.url());
  await guest.getByLabel("Your name").fill("Guest");
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(host.getByRole("heading", { name: "Players (2/6)" })).toBeVisible({
    timeout: 30_000,
  });
  if (quick) {
    await host.getByLabel(/^Mode/).selectOption("quick");
    await expect(host.getByText(/Two random properties each/)).toBeVisible();
  }
  await host.getByRole("button", { name: "Begin the ritual" }).click();
  await expect(host.getByRole("tablist", { name: "Game details" })).toBeVisible();
  await expect(guest.getByRole("tablist", { name: "Game details" })).toBeVisible();
  return { host, guest };
}

const openTab = (page: Page, name: string) => page.getByRole("tab", { name }).click();

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(" ")}`,
  );
  expect(summary).toEqual([]);
}

test("the landing page, lobby and game meet WCAG A/AA checks", async ({ browser }) => {
  const page = await newPlayer(browser);
  await page.goto("/");
  await expectAccessible(page);

  const { host } = await startTwoPlayerGame(browser);
  await expectAccessible(host);
});

test("the game fits a phone screen without sideways scrolling", async ({ browser }) => {
  const { host } = await startTwoPlayerGame(browser, devices["Pixel 7"]);
  const overflow = await host.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Space names are hidden on phones, but every space stays reachable and labelled.
  await host.getByRole("button", { name: /^Astral Gate/ }).click();
  await expect(host.getByRole("heading", { name: "Astral Gate" })).toBeVisible();
});

test("a trade offered by one player can be accepted by the other", async ({ browser }) => {
  const { host, guest } = await startTwoPlayerGame(browser);
  await openTab(host, "Trades");
  await host.getByRole("button", { name: "New offer" }).click();
  const builder = host.getByRole("tabpanel");
  await builder.getByRole("spinbutton").first().fill("50");
  await builder.getByRole("button", { name: "Send offer" }).click();

  // The guest sees the incoming offer counted on the Trades tab.
  await expect(guest.getByRole("tab", { name: /Trades\s*1/ })).toBeVisible();
  await openTab(guest, "Trades");
  await expect(guest.getByText("Host offers 50 ◈")).toBeVisible();
  await guest.getByRole("button", { name: "Accept" }).click();
  for (const page of [guest, host]) {
    await openTab(page, "Log");
    await expect(page.getByText("Guest accepted Host's trade")).toBeVisible();
  }
});

test("the log survives a reload", async ({ browser }) => {
  const { host, guest } = await startTwoPlayerGame(browser);
  const page = (await host.getByRole("button", { name: "Roll dice" }).isVisible()) ? host : guest;
  await page.getByRole("button", { name: "Roll dice" }).click();
  await openTab(page, "Log");
  await expect(page.getByText(/ rolled \d \+ \d/)).toBeVisible();
  await page.reload();
  await openTab(page, "Log");
  await expect(page.getByText(/ rolled \d \+ \d/)).toBeVisible();
});

test("both themes pass WCAG A/AA checks and the choice is remembered", async ({ browser }) => {
  const { host } = await startTwoPlayerGame(browser);
  for (const theme of ["Light", "Dark"]) {
    await host.getByRole("button", { name: /^Theme:/ }).click();
    await host.getByRole("menuitemradio", { name: theme }).click();
    await expect(host.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase());
    await expectAccessible(host);
  }
  await host.reload();
  await expect(host.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("selecting a space opens its details", async ({ browser }) => {
  const { host } = await startTwoPlayerGame(browser);
  await host.getByRole("button", { name: /^Archmother's Sanctum/ }).click();
  const details = host.getByRole("dialog", { name: "Archmother's Sanctum" });
  await expect(details).toBeVisible();
  await expect(details.getByText("Walker")).toBeVisible();
  await host.keyboard.press("Escape");
  await expect(details).toBeHidden();
});

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`board names fit their spaces at ${viewport.width}×${viewport.height}`, async ({
    browser,
  }) => {
    // Quick mode deals properties, so owned spaces (with their owner chips) are covered too.
    const { host } = await startTwoPlayerGame(browser, { viewport }, { quick: true });
    const clipped = await host.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".space-name")]
        .filter((el) => el.offsetParent !== null)
        .filter(
          (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
        )
        .map((el) => el.textContent),
    );
    expect(clipped).toEqual([]);
  });
}

test("space bar plays the main action and toasts reach the other player", async ({ browser }) => {
  const { host, guest } = await startTwoPlayerGame(browser);
  const roll = (p: Page) => p.getByRole("button", { name: /^Roll dice/ });
  await expect
    .poll(async () => (await roll(host).isVisible()) || (await roll(guest).isVisible()))
    .toBe(true);
  const [current, other] = (await roll(host).isVisible()) ? [host, guest] : [guest, host];

  await current.locator("body").press("Space");
  await openTab(current, "Log");
  await expect(current.getByText(/ rolled \d \+ \d/)).toBeVisible();

  // An offer shows up as a toast for the player it's made to.
  await openTab(other, "Trades");
  await other.getByRole("button", { name: "New offer" }).click();
  await other.getByRole("tabpanel").getByRole("spinbutton").first().fill("10");
  await other.getByRole("button", { name: "Send offer" }).click();
  await expect(
    current.getByRole("list", { name: "Notifications" }).getByText(/offered you a trade/),
  ).toBeVisible();
});

test("selecting a player highlights their holdings", async ({ browser }) => {
  const { host } = await startTwoPlayerGame(browser);
  const row = host.getByRole("button", { name: /^Host: show their holdings/ });
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  // Host owns nothing yet, so every space is dimmed.
  await expect(host.getByRole("button", { name: /^Astral Gate/ })).toHaveClass(/opacity-30/);
  await row.click();
  // Hovering previews too, so move away before checking the highlight is gone.
  await host.mouse.move(0, 0);
  await expect(host.getByRole("button", { name: /^Astral Gate/ })).not.toHaveClass(/opacity-30/);
});
