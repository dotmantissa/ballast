import { test, expect } from "@playwright/test";

test("desktop navigation, live data and persisted theme", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Ballast | Room for the unexpected");
  await expect(page.locator("h1")).toContainText("Good agents.");
  await expect(page.getByText("Studio connected", { exact: true })).toBeVisible(
    { timeout: 60000 },
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "/tmp/ballast-desktop-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Capital pool", exact: true }).click();
  await expect(page.locator("h1")).toHaveText(
    "Be the weight that steadies it.",
  );
  await expect(
    page.getByRole("heading", { name: "Junior capital", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Claims court", exact: true }).click();
  await expect(
    page.getByText("Nothing before the court. A good day."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Agents & cover", exact: true })
    .click();
  await expect(
    page.getByText("The registry is ready for its first promise."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Field guide", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Four findings, not a shrug." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("email is the only login method and the dialog can close", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in with email" })
    .click({ timeout: 60000 });
  const dialog = page.getByRole("dialog", { name: "log in or sign up" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("input[type=email]")).toBeVisible();
  await expect(
    dialog.getByText(/connect.*wallet|google|apple|twitter/i),
  ).toHaveCount(0);
  await page.screenshot({ path: "/tmp/ballast-email.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("mobile layout and menu have no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Capital pool", exact: true }).click();
  await expect(page.locator("h1")).toHaveText(
    "Be the weight that steadies it.",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/ballast-mobile-capital.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({ path: "/tmp/ballast-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("private endpoints reject unauthenticated requests and foreign origins", async ({
  request,
}) => {
  const account = await request.get("/api/account");
  expect(account.status()).toBe(401);
  const action = await request.post("/api/actions", {
    data: { kind: "withdraw" },
  });
  expect(action.status()).toBe(401);
  const foreign = await request.post("/api/actions", {
    headers: { Origin: "https://attacker.example" },
    data: { kind: "withdraw" },
  });
  expect(foreign.status()).toBe(403);
  expect(JSON.stringify(await account.json())).not.toMatch(
    /privy_app_secret|postgresql|encrypted_key/,
  );
});

test("public terms and privacy pages are available", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.locator("h1")).toHaveText(
    "A small promise, written clearly.",
  );
  await page.goto("/privacy");
  await expect(page.locator("h1")).toHaveText(
    "Keep the private things private.",
  );
});
