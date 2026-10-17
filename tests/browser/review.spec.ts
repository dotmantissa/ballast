import { test, expect } from "@playwright/test";
// Deliberately hostile public record fixtures exercise rendering only, not validator judgments.
const latest = "a".repeat(24),
  older = "b".repeat(24),
  lookedUp = "c".repeat(24);
const claim = (id: string, statement: string) => ({
  id,
  policy_id: "d".repeat(24),
  agent_id: "e".repeat(24),
  operator: "0x" + "1".repeat(40),
  claimant: "0x" + "2".repeat(40),
  incident_ref: "0x" + "f".repeat(64),
  incident_at: 1,
  event_key: "f".repeat(64),
  amount: "1000000000000000000",
  statement,
  evidence_urls: ["https://[invalid", "https://records.example.org/receipt"],
  effective_evidence_urls: [
    "https://[invalid",
    "https://records.example.org/receipt",
  ],
  created_at: 1,
  review_deadline: Math.floor(Date.now() / 1000) + 604800,
  status: "filed",
  findings: {},
  reasons: {},
  verified_loss: "0",
  verified_incident_at: 0,
  eligibility_revision: 0,
  acceptances: [],
  challenge_until: 0,
  appeals: [],
  claim_bond: "10000000000000000",
  payout: "0",
});
const overview = {
  dashboard: {
    registry: "0x" + "3".repeat(40),
    court: "0x" + "4".repeat(40),
    junior: "0",
    senior: "0",
    junior_supply: "0",
    senior_supply: "0",
    junior_locked: "0",
    senior_locked: "0",
    junior_generation: 0,
    senior_generation: 0,
    reserved: "0",
    available: "0",
    premiums: "0",
    paid: "0",
    credits: "0",
    tvg: "0",
    policy_count: 0,
    quote_count: 0,
  },
  agents: [],
  policies: [],
  quotes: [],
  claims: [
    claim(
      latest,
      "The latest public record contains a malformed source address.",
    ),
  ],
  agentCount: 0,
  claimCount: 51,
  cursors: { agents: null, policies: null, claims: 1, quotes: null },
  updatedAt: new Date().toISOString(),
  deployment: {
    registry: "0x" + "3".repeat(40),
    underwriting: "0x" + "5".repeat(40),
    court: "0x" + "4".repeat(40),
    network: "studionet",
    chainId: 61999,
  },
};
test("hostile public URLs stay inert and older claims remain reachable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/overview", (r) => r.fulfill({ json: overview }));
  await page.route("**/api/records?*", (r) => {
    const query = new URL(r.request().url()).searchParams;
    return r.fulfill({
      json: query.has("id")
        ? {
            record: claim(
              lookedUp,
              "A case recovered directly by its full record ID.",
            ),
          }
        : {
            items: [
              claim(
                older,
                "An older unresolved case outside the latest fifty records.",
              ),
            ],
            total: 51,
            next_cursor: null,
          },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Claims court/ }).click();
  await expect(page.getByText("This source address is invalid.")).toBeVisible();
  await expect(page.locator('a[href="https://[invalid"]')).toHaveCount(0);
  await page
    .getByRole("button", { name: "Load earlier claims", exact: true })
    .click();
  await expect(
    page
      .locator(".claim-list")
      .getByText("An older unresolved case outside the latest fifty records.", {
        exact: true,
      }),
  ).toBeVisible();
  await page.getByLabel("Full record ID").fill(lookedUp);
  await page.getByRole("button", { name: "Find record", exact: true }).click();
  await expect(page.locator(".claim-detail .claim-statement")).toHaveText(
    "A case recovered directly by its full record ID.",
  );
  expect(errors).toEqual([]);
});
test("mobile record lookup stays within the viewport and the header remains visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/overview", (r) => r.fulfill({ json: overview }));
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: /^Claims court/ }).click();
  await page
    .getByRole("region", { name: "Find older records" })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page.locator(".topbar").evaluate((el) => el.getBoundingClientRect().top),
    )
    .toBe(0);
  await expect(
    page.getByRole("button", { name: "Back to top", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/ballast-review-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("final cases expose confirmation recovery without losing mobile layout",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const finalCase={...claim(latest,"A final case awaiting confirmed pool settlement remains recoverable."),status:"final",outcome:"adjudicated",payout:"1000000000000000000",findings:{harm:true,causation:true,scope:false,payout:100}};
  await page.route("**/api/overview",r=>r.fulfill({json:{...overview,claims:[finalCase]}}));
  await page.goto("/");
  await page.getByRole("button",{name:"Open navigation"}).click();
  await page.getByRole("button",{name:/^Claims court/}).click();
  await page.getByText("Waiting on a confirmation?",{exact:true}).click();
  await expect(page.getByRole("button",{name:"Refresh the final decision",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Refresh the pool settlement",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('mutual acceptance opens finalization even with a future device deadline',async({page})=>{
 const base=claim(latest,'Both parties accepted this decision before the ordinary challenge deadline.');
 const accepted={...base,status:'challenge',challenge_until:Math.floor(Date.now()/1000)+3600,acceptances:[base.claimant,base.operator],findings:{harm:true,causation:true,scope:false,payout:100}};
 await page.route('**/api/overview',r=>r.fulfill({json:{...overview,claims:[accepted]}}));
 await page.goto('/');await page.getByRole('button',{name:/^Claims court/}).click();
 await expect(page.getByRole('button',{name:'Finalize decision',exact:true})).toBeVisible();
 await expect(page.getByText('Both parties accepted. The remaining challenge time is waived.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Appeal this finding',exact:true})).toHaveCount(0);
});
