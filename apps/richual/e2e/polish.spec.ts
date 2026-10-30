import AxeBuilder from "@axe-core/playwright";
import { type Browser, devices, expect, type Page, test } from "@playwright/test";

async function newPlayer(browser: Browser, options = {}): Promise<Page> {
  const context = await browser.newContext(options);
  return context.newPage();
}

async function startTwoPlayerGame(browser: Browser, hostOptions = {}) {
  const host = await newPlayer(browser, hostOptions);
  const guest = await newPlayer(browser);
  await host.goto("/");
  await host.getByLabel("Your name").fill("Host");
  await host.getByRole("button", { name: "Create lobby" }).click();
  await expect(host).toHaveURL(/\/l\/[0-9A-Z]{6}$/);
  await guest.goto(host.url());
  await guest.getByLabel("Your name").fill("Guest");
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(host.getByRole("heading", { name: "Players (2/6)" })).toBeVisible();
  await host.getByRole("button", { name: "Begin the ritual" }).click();
  await expect(host.getByRole("heading", { name: "Ritual log" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Ritual log" })).toBeVisible();
  return { host, guest };
}

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
  await host.getByRole("button", { name: "New offer" }).click();
  const builder = host.locator("section", { has: host.getByRole("heading", { name: "Trades" }) });
  await builder.getByRole("spinbutton").first().fill("50");
  await builder.getByRole("button", { name: "Send offer" }).click();

  await expect(guest.getByText("Host offers 50 ◈")).toBeVisible();
  await guest.getByRole("button", { name: "Accept" }).click();
  await expect(guest.getByText("Guest accepted Host's trade")).toBeVisible();
  await expect(host.getByText("Guest accepted Host's trade")).toBeVisible();
});

test("the log survives a reload", async ({ browser }) => {
  const { host, guest } = await startTwoPlayerGame(browser);
  const page = (await host.getByRole("button", { name: "Roll dice" }).isVisible()) ? host : guest;
  await page.getByRole("button", { name: "Roll dice" }).click();
  await expect(page.getByText(/ rolled \d \+ \d/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/ rolled \d \+ \d/)).toBeVisible();
});
