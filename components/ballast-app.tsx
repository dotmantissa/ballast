"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  Activity,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  FileText,
  Gauge,
  HelpCircle,
  Layers3,
  LifeBuoy,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Shield,
  ShieldCheck,
  Sun,
  Users,
  X,
  AlertCircle,
  Clock3,
  Anchor,
  Mail,
  Coins,
  Command,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "./logo";
import { LegacyCapitalPanel } from "./legacy-capital-panel";
import { EvidenceLink } from "./evidence-link";
import { RecordDesk, type AnyRecord } from "./record-desk";
import {
  mergeRecords,
  type RecordKind,
  type RecordMap,
  type RecordPage,
} from "@/lib/records";
import { canAppeal } from "@/lib/claims";
import { TERMINAL_STATUSES } from "@/lib/operation-recovery";
import { ActionForm, type FormTarget } from "./action-forms";
import type {
  Account,
  Agent,
  Claim,
  Finding,
  Operation,
  Overview,
  Policy,
} from "@/lib/types";
import { FINDINGS, FINDING_LABELS } from "@/lib/types";
import type { Action } from "@/lib/validation";
import { findingRequestKey } from "@/lib/idempotency";
import { gen, short, date, relative, explorer } from "@/lib/format";

type View = "overview" | "agents" | "claims" | "capital" | "guide";
const nav: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "agents", label: "Agents & cover", icon: Shield },
  { id: "claims", label: "Claims court", icon: Scale },
  { id: "capital", label: "Capital pool", icon: Layers3 },
];
const operationNames: Record<string, string> = {
  register: "Register manifest",
  quote: "Request a quote",
  bind: "Bind coverage",
  stake: "Contribute capital",
  redeem: "Redeem shares",
  redeem_legacy: "Redeem earlier pool shares",
  withdraw_legacy: "Withdraw earlier pool credit",
  withdraw: "Withdraw pool credit",
  withdraw_bonds: "Withdraw bond credit",
  claim: "File a claim",
  resolve: "Resolve a finding",
  evidence: "Add case evidence",
  close_unresolved: "Close overdue review",
  withdraw_claim: "Withdraw a case",
  accept_decision: "Accept the decision",
  authorize: "Authorize an operator",
  revise: "Revise agent scope",
  appeal: "Appeal a finding",
  finalize: "Finalize a claim",
  settle: "Settle a claim",
  sync_loss: "Record loss history",
  acknowledge: "Confirm settlement",
  expire: "Release expired cover",
  faucet: "Add test funds",
};

export function BallastApp() {
  const { ready, authenticated, login, logout, getAccessToken, user } =
    usePrivy();
  const [now, setNow] = useState(0);
  const [view, setView] = useState<View>("overview");
  const [mobile, setMobile] = useState(false);
  const [publicOverview, setOverview] = useState<Overview | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [accountError, setAccountError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState<FormTarget | null>(null);
  const [dark, setDark] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [selectedClaim, setSelectedClaim] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [extraRecords, setExtraRecords] = useState<{
    [K in RecordKind]: RecordMap[K][];
  }>({ agents: [], policies: [], claims: [], quotes: [] });
  const [earlierCursors, setEarlierCursors] = useState<
    Record<string, number | null>
  >({});
  const overview = useMemo(
    () =>
      publicOverview
        ? {
            ...publicOverview,
            agents: mergeRecords(
              extraRecords.agents,
              publicOverview.agents,
              account?.records.agents.items ?? [],
            ).sort((a, b) => b.registered_at - a.registered_at),
            policies: mergeRecords(
              extraRecords.policies,
              publicOverview.policies,
              account?.records.policies.items ?? [],
            ).sort((a, b) => b.starts_at - a.starts_at),
            quotes: mergeRecords(
              extraRecords.quotes,
              publicOverview.quotes,
              account?.records.quotes.items ?? [],
            ).sort((a, b) => b.created_at - a.created_at),
            claims: mergeRecords(
              extraRecords.claims,
              publicOverview.claims,
              account?.records.claims.items ?? [],
              account?.unresolvedClaims ?? [],
            ).sort((a, b) => b.created_at - a.created_at),
          }
        : null,
    [publicOverview, account, extraRecords],
  );
  function rememberRecords<K extends RecordKind>(
    kind: K,
    items: RecordMap[K][],
  ) {
    setExtraRecords((current) => ({
      ...current,
      [kind]: mergeRecords(current[kind], items),
    }));
  }
  function cursorFor(kind: RecordKind) {
    const key = filter + ":" + kind;
    return Object.hasOwn(earlierCursors, key)
      ? earlierCursors[key]
      : filter === "mine"
        ? (account?.records[kind].next_cursor ?? null)
        : (publicOverview?.cursors?.[kind] ?? null);
  }
  async function loadEarlier(kind: RecordKind) {
    const cursor = cursorFor(kind);
    if (cursor === null) return;
    const path = `/api/records?kind=${kind}&cursor=${cursor}${filter === "mine" ? "&mine=true" : ""}`;
    const response =
      filter === "mine"
        ? await authFetch(path)
        : await fetch(path).then(async (r) => {
            const data = await r.json();
            if (!r.ok) throw Error(data.error);
            return data;
          });
    const page = response as RecordPage<RecordMap[typeof kind]>;
    rememberRecords(kind, page.items);
    setEarlierCursors((current) => ({
      ...current,
      [filter + ":" + kind]: page.next_cursor,
    }));
  }
  async function lookupRecord(kind: RecordKind, id: string) {
    const response = await fetch(`/api/records?kind=${kind}&id=${id}`);
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    const record = data.record as AnyRecord;
    rememberRecords(kind, [record]);
    setSearch("");
    setFilter("all");
    if (kind === "claims") {
      setView("claims");
      setSelectedClaim(record.id);
    } else if (kind === "agents") {
      setView("agents");
      setForm({ type: "agent", agent: record as Agent });
    } else if (kind === "policies") {
      setView("agents");
      setNotice(
        `Policy ${record.id} is in view. You can use its full ID when filing a claim.`,
      );
    } else {
      setView("agents");
      setNotice(`Quote ${record.id} is in view.`);
    }
  }
  const pollRef = useRef(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/overview");
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      setOverview(data);
      setLoadError(data.stale ? "Studio could not refresh right now." : "");
    } catch {
      setLoadError(
        "The network is taking a breath. We could not load the latest pool state.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);
  const authFetch = useCallback(
    async (path: string, options?: RequestInit) => {
      const token = await getAccessToken();
      if (!token) throw Error("Please sign in again.");
      const response = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          ...options?.headers,
        },
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Please try again.");
      return data;
    },
    [getAccessToken],
  );
  const refreshAccount = useCallback(async () => {
    if (!authenticated) return;
    try {
      setAccount(await authFetch("/api/account"));
      setAccountError("");
    } catch (e) {
      setAccountError(
        e instanceof Error ? e.message : "Your account could not be loaded.",
      );
    }
  }, [authenticated, authFetch]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setNow(Date.now());
      void refresh();
      setDark(document.documentElement.dataset.theme === "dark");
    }, 0);
    const interval = setInterval(() => {
      if (!document.hidden) {
        setNow(Date.now());
        void refresh();
      }
    }, 60000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (authenticated) void refreshAccount();
      else setAccount(null);
    }, 0);
    const interval = setInterval(() => {
      if (!document.hidden) void refreshAccount();
    }, 120000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [authenticated, refreshAccount]);
  useEffect(() => {
    if (!account) return;
    const pending = account.operations
      .filter(
        (o) =>
          (o.tx_hash ||
            o.needsReconciliation ||
            ["preparing", "submitting", "signed", "uncertain"].includes(
              o.status,
            )) &&
          !TERMINAL_STATUSES.includes(o.status) &&
          o.status !== "error",
      )
      .slice(0, 2);
    if (!pending.length) return;
    const timer = setInterval(async () => {
      if (pollRef.current || document.hidden) return;
      pollRef.current = true;
      try {
        const changed = await Promise.all(
          pending.map((o) => authFetch("/api/operations/" + o.id)),
        );
        setAccount((current) =>
          current
            ? {
                ...current,
                operations: current.operations.map(
                  (op) => changed.find((o) => o.id === op.id) ?? op,
                ),
              }
            : current,
        );
        if (changed.some((o) => o.status === "FINALIZED")) {
          void refresh();
          void refreshAccount();
        }
      } catch {
        /* Keep the last verified status until the network is reachable. */
      } finally {
        pollRef.current = false;
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [account, authFetch, refresh, refreshAccount]);
  function go(next: View) {
    setView(next);
    setMobile(false);
    setSearch("");
    setFilter("all");
  }
  function open(target: FormTarget) {
    if (target.type === "agent") {
      setForm(target);
      return;
    }
    if (!authenticated) {
      login();
      return;
    }
    if (!account) {
      setNotice(
        "Your account is still loading. Give it a moment, then try again.",
      );
      return;
    }
    setForm(target);
  }
  async function submit(action: Action) {
    const result = await authFetch("/api/actions", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(action),
    }).catch((error) => {
      void refreshAccount();
      throw error;
    });
    setNotice(
      action.kind === "faucet"
        ? "Test funds added. Your account will update shortly."
        : "Your action is on its way. Follow the network’s decision in your activity.",
    );
    setAccount((current) =>
      current
        ? {
            ...current,
            operations: [
              result,
              ...current.operations.filter((o) => o.id !== result.id),
            ],
          }
        : current,
    );
    void refreshAccount();
    return;
  }
  async function quick(action: Action, key: string) {
    if (!authenticated) {
      login();
      return;
    }
    setBusy(key);
    try {
      await submit(action);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "The action could not be submitted.",
      );
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    if (!authenticated || !account) return;
    const claim = account.unresolvedClaims.find(
      (c) =>
        ["filed", "reviewing"].includes(c.status) &&
        Date.now() / 1000 < c.review_deadline,
    );
    if (
      !claim ||
      account.operations.some(
        (o) =>
          o.kind === "resolve" &&
          ![...TERMINAL_STATUSES, "error"].includes(o.status),
      )
    )
      return;
    const finding = FINDINGS.find((f) => claim.findings[f] === undefined);
    if (!finding) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const requestKey = await findingRequestKey(
          claim.id,
          finding,
          claim.appeals.length + ":" + claim.effective_evidence_urls.join("|"),
          account.deployment.court,
        );
        const operation = await authFetch("/api/actions", {
          method: "POST",
          headers: { "Idempotency-Key": requestKey },
          body: JSON.stringify({ kind: "resolve", claimId: claim.id, finding }),
        });
        if (cancelled) return;
        setAccount((current) =>
          current
            ? {
                ...current,
                operations: [
                  operation,
                  ...current.operations.filter((o) => o.id !== operation.id),
                ],
              }
            : current,
        );
      } catch {
        void refreshAccount();
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authenticated, account, authFetch, refreshAccount]);
  const isMine = (address: string) =>
    !!account && address.toLowerCase() === account.address.toLowerCase();
  const activePolicies =
    overview?.policies.filter(
      (p) => p.status === "active" && p.ends_at > now / 1000,
    ) ?? [];
  const myAgents = overview?.agents.filter((a) => isMine(a.operator)) ?? [];
  const filteredAgents = (overview?.agents ?? []).filter(
    (a) =>
      (filter === "all" || isMine(a.operator)) &&
      [a.name, a.id, a.executor_address].some((v) =>
        v.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const filteredClaims = (overview?.claims ?? []).filter(
    (c) =>
      (filter === "all" || isMine(c.operator) || isMine(c.claimant)) &&
      [c.id, c.incident_ref, c.statement].some((v) =>
        v.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const currentClaim =
    overview?.claims.find((c) => c.id === selectedClaim) ?? filteredClaims[0];
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("ballast-theme", next ? "dark" : "light");
  }
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="nav-scrim"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        className={"sidebar " + (mobile ? "is-open" : "")}
        aria-label="Main navigation"
      >
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Logo />
          </span>
          <span>
            ballast<span className="brand-period">.</span>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-square">
            <Anchor size={15} />
          </span>
          <span>
            The cover pool<small>GenLayer Studio</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              aria-current={view === item.id ? "page" : undefined}
              className={"nav-item " + (view === item.id ? "selected" : "")}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "claims" && overview && overview.claimCount > 0 && (
                <span className="nav-count">{overview.claimCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="small-hull">
            <Logo />
          </div>
          <h3>
            Room for the
            <br />
            unexpected.
          </h3>
          <p>
            Your agent has a job.
            <br />
            Your capital has a backstop.
          </p>
          <button className="text-button" onClick={() => go("guide")}>
            Meet Ballast <ChevronRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={"nav-item " + (view === "guide" ? "selected" : "")}
            onClick={() => go("guide")}
          >
            <HelpCircle size={18} />
            <span>Field guide</span>
          </button>
          <a
            className="nav-item"
            href="https://github.com/dotmantissa/ballast"
            target="_blank"
            rel="noreferrer"
          >
            <FileText size={18} />
            <span>Open source</span>
            <ExternalLink size={13} />
          </a>
          <div className="network-pill">
            <span
              className={
                overview && !loadError ? "status-dot" : "status-dot pending"
              }
            />
            <span>
              {loadError
                ? "Network unavailable"
                : overview
                  ? "Studio connected"
                  : "Connecting to Studio"}
            </span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {view === "guide"
                ? "Field guide"
                : nav.find((n) => n.id === view)?.label}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="studio-tag">Test funds. Real decisions.</span>
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className="topbar-divider" />
            {authenticated ? (
              <>
                <button
                  className="account-button"
                  onClick={() => open({ type: "account" })}
                >
                  <span className="avatar">
                    {user?.email?.address?.charAt(0).toUpperCase() ?? "B"}
                  </span>
                  <span>
                    {account ? gen(account.balance) + " GEN" : "Your account"}
                  </span>
                </button>
                <button
                  className="icon-button"
                  onClick={() => {
                    void logout();
                    setForm(null);
                  }}
                  aria-label="Sign out"
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <button
                className="button small primary"
                disabled={!ready}
                onClick={login}
              >
                <Mail size={15} />
                Sign in with email
              </button>
            )}
          </div>
        </header>
        <main id="main" className="main-content">
          {notice && (
            <div className="notice" role="status">
              <CheckCheck size={18} />
              <span>{notice}</span>
              <button
                onClick={() => setNotice("")}
                className="icon-button"
                aria-label="Dismiss notification"
              >
                <X size={17} />
              </button>
            </div>
          )}
          {loadError && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <span>
                {loadError}
                {overview ? " Showing the last verified state." : ""}
              </span>
              <button className="text-button" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          )}
          {accountError && authenticated && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{accountError}</span>
              <button
                className="text-button"
                onClick={() => void refreshAccount()}
              >
                Reload account
              </button>
            </div>
          )}
          {view === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="greeting">A steadier course starts here.</p>
                  <h1>
                    Good agents.
                    <br />
                    <span>Better backstops.</span>
                  </h1>
                  <p className="page-intro">
                    Give your agent room to act.
                    <br />
                    Keep its mistakes from becoming your whole story.
                  </p>
                  <div className="heading-actions">
                    <button
                      className="button primary"
                      onClick={() => open({ type: "register" })}
                    >
                      <Plus size={17} />
                      Cover your agent
                    </button>
                    <button
                      className="button quiet"
                      onClick={() => go("guide")}
                    >
                      How Ballast works
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="edition-note">
                  <Logo />
                  <p>
                    Built for autonomy.
                    <br />
                    <strong>Grounded in accountability.</strong>
                  </p>
                  <span className="mono">Est. on GenLayer</span>
                </div>
              </div>
              <div className="overview-grid">
                <section className="waterline-panel">
                  <div className="panel-top">
                    <h2>The weight behind the promise</h2>
                    <span className="live-label">
                      <span
                        className={
                          overview ? "status-dot" : "status-dot pending"
                        }
                      />
                      {overview ? "Live pool" : "Awaiting network"}
                    </span>
                  </div>
                  <div className="pool-value">
                    <strong className="mono">
                      {gen(overview?.dashboard.tvg)}
                    </strong>
                    <span>
                      GEN
                      <br />
                      <small>total value governed</small>
                    </span>
                  </div>
                  <Waterline data={overview} />
                  <div className="waterline-legend">
                    <div>
                      <i className="legend-copper" />
                      <span>Reserved for cover</span>
                      <strong className="mono">
                        {gen(overview?.dashboard.reserved)} GEN
                      </strong>
                    </div>
                    <div>
                      <i className="legend-ink" />
                      <span>Available capital</span>
                      <strong className="mono">
                        {gen(overview?.dashboard.available)} GEN
                      </strong>
                    </div>
                  </div>
                  <div className="panel-foot">
                    <span>Capital gives the promise its weight.</span>
                    <button
                      className="text-button"
                      onClick={() => go("capital")}
                    >
                      Explore the pool
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                </section>
                <aside className="overview-stats">
                  <Stat
                    icon={ShieldCheck}
                    label="Active policies"
                    value={overview ? String(activePolicies.length) : "…"}
                    note="Limits reserved in full"
                  />
                  <Stat
                    icon={Users}
                    label="Registered agents"
                    value={overview ? String(overview.agentCount) : "…"}
                    note="A scope that stays on the record"
                  />
                  <Stat
                    icon={Scale}
                    label="Claims on the record"
                    value={overview ? String(overview.claimCount) : "…"}
                    note="Four findings. An open process."
                  />
                </aside>
              </div>
              <div className="lower-grid">
                <section className="recent-panel">
                  <div className="section-heading">
                    <div>
                      <h2>
                        {authenticated
                          ? "Your agents, at a glance"
                          : "A place for your first agent"}
                      </h2>
                      <p>A clear scope. A considered quote. Room to breathe.</p>
                    </div>
                    <button
                      className="icon-button"
                      onClick={() => go("agents")}
                      aria-label="View agents"
                    >
                      <ArrowUpRight size={20} />
                    </button>
                  </div>
                  {!overview ? (
                    <Loading text="Reading the registry" />
                  ) : myAgents.length ? (
                    <div className="compact-agents">
                      {myAgents.slice(0, 3).map((a) => (
                        <AgentRow
                          now={now}
                          key={a.id}
                          agent={a}
                          policies={overview.policies}
                          onClick={() => open({ type: "agent", agent: a })}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-inline">
                      <div className="empty-symbol">
                        <Shield size={26} strokeWidth={1.5} />
                      </div>
                      <div>
                        <h3>
                          {authenticated
                            ? "Your agent’s next chapter starts here."
                            : "Let’s put a promise on the record."}
                        </h3>
                        <p>
                          {authenticated
                            ? "Register its scope before it takes the wheel."
                            : "Start with an email. Bring your agent’s manifest."}
                        </p>
                        <button
                          className="text-button"
                          onClick={() => open({ type: "register" })}
                        >
                          {authenticated
                            ? "Register your first agent"
                            : "Get started"}
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </section>
                <section className="court-teaser">
                  <div className="section-heading">
                    <h2>
                      A fair hearing,
                      <br />
                      one finding at a time.
                    </h2>
                    <Scale size={25} strokeWidth={1.5} />
                  </div>
                  <div className="finding-mini">
                    {FINDINGS.map((f, i) => (
                      <div key={f}>
                        <span className="finding-node">
                          {i === 3 ? <Coins size={13} /> : <Check size={13} />}
                        </span>
                        <span>
                          {
                            [
                              "Harm occurred",
                              "Agent caused it",
                              "Scope was exceeded",
                              "Payout determined",
                            ][i]
                          }
                        </span>
                      </div>
                    ))}
                  </div>
                  <button className="text-button" onClick={() => go("claims")}>
                    Inside the claims court
                    <ArrowUpRight size={15} />
                  </button>
                </section>
              </div>
              <div className="quiet-note">
                <LifeBuoy size={16} />
                <p>
                  Small enough to prove. Meaningful enough to matter. V1 covers
                  unauthorized agent spend, capped at 100 test GEN.
                </p>
              </div>
            </>
          )}
          {view === "agents" && (
            <>
              <PageTitle
                title="Autonomy, with a backstop."
                text="Declare what your agent can do. Put a little weight behind the promise."
                action={
                  <button
                    className="button primary"
                    onClick={() => open({ type: "register" })}
                  >
                    <Plus size={17} />
                    Register an agent
                  </button>
                }
              />
              <div className="tabs-bar">
                <div className="tabs">
                  <button
                    className={filter === "all" ? "active" : ""}
                    onClick={() => setFilter("all")}
                  >
                    All agents <span>{overview?.agentCount ?? "…"}</span>
                  </button>
                  <button
                    className={filter === "mine" ? "active" : ""}
                    onClick={() => {
                      if (!authenticated) login();
                      else setFilter("mine");
                    }}
                  >
                    Your agents <span>{myAgents.length}</span>
                  </button>
                </div>
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder="Find an agent"
                />
              </div>
              {!overview ? (
                <Loading text="Reading registered manifests" />
              ) : filteredAgents.length ? (
                <div className="agents-list">
                  {filteredAgents.map((agent) => (
                    <div className="agent-block" key={agent.id}>
                      <AgentRow
                        now={now}
                        agent={agent}
                        policies={overview.policies}
                        onClick={() => open({ type: "agent", agent })}
                      />
                      <p className="agent-scope">{agent.scope}</p>
                      <div className="agent-block-foot">
                        <span className="mono">
                          Scope {short(agent.manifest_hash, 12)}
                        </span>
                        <button
                          className="button small secondary"
                          onClick={() =>
                            isMine(agent.operator)
                              ? open({ type: "quote", agent })
                              : open({ type: "agent", agent })
                          }
                        >
                          {isMine(agent.operator)
                            ? "Get a quote"
                            : "Read manifest"}
                          <FileText size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={Shield}
                  title={
                    search
                      ? "No agent matches that search."
                      : filter === "mine"
                        ? "Your agent belongs here."
                        : "The registry is ready for its first promise."
                  }
                  text={
                    search
                      ? "Try a name, executor address or agent ID."
                      : "Register a capability manifest and public action history. The scope is fixed before a quote is written."
                  }
                  action={
                    !search ? (
                      <button
                        className="button primary"
                        onClick={() => open({ type: "register" })}
                      >
                        Register an agent
                        <Plus size={16} />
                      </button>
                    ) : undefined
                  }
                />
              )}
              <div className="section-heading coverage-heading">
                <div>
                  <h2>Coverage ledger</h2>
                  <p>
                    The premium is paid. The limit is reserved. The scope stays
                    put.
                  </p>
                </div>
                <span className="mono muted">30 day terms</span>
              </div>
              {overview?.policies.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Policy / Agent</th>
                        <th>Cover remaining</th>
                        <th>Premium</th>
                        <th>Ends</th>
                        <th>Status</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.policies
                        .filter((p) => filter === "all" || isMine(p.operator))
                        .map((p) => (
                          <tr key={p.id}>
                            <td>
                              <strong>
                                {overview.agents.find(
                                  (a) => a.id === p.agent_id,
                                )?.name ?? short(p.agent_id)}
                              </strong>
                              <span className="mono muted table-sub">
                                {short(p.id)}
                              </span>
                            </td>
                            <td className="mono">{gen(p.remaining)} GEN</td>
                            <td className="mono">{gen(p.premium)} GEN</td>
                            <td>{date(p.ends_at)}</td>
                            <td>
                              <Status status={p.status} />
                            </td>
                            <td>
                              {p.status === "active" && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    open({ type: "claim", policy: p })
                                  }
                                >
                                  File claim
                                </button>
                              )}
                              {p.status === "active" &&
                                now / 1000 > p.ends_at + 7 * 86400 && (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      void quick(
                                        { kind: "expire", policyId: p.id },
                                        p.id,
                                      )
                                    }
                                  >
                                    Release reserve
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ledger-empty">
                  <FileCheck2 size={21} />
                  <p>Policies appear here once a quote has been bound.</p>
                </div>
              )}
              {overview &&
                overview.quotes.some((q) => isMine(q.operator) && !q.bound) && (
                  <section className="open-quotes">
                    <h2>Your open quotes</h2>
                    {overview.quotes
                      .filter((q) => isMine(q.operator) && !q.bound)
                      .map((q) => (
                        <div className="quote-row" key={q.id}>
                          <div>
                            <strong>
                              {overview.agents.find((a) => a.id === q.agent_id)
                                ?.name ?? short(q.agent_id)}
                            </strong>
                            <p>{q.reason}</p>
                          </div>
                          <span className="mono">{gen(q.premium)} GEN</span>
                          <button
                            className="button secondary small"
                            disabled={
                              q.band === "declined" || q.expires_at < now / 1000
                            }
                            onClick={() => open({ type: "bind", quote: q })}
                          >
                            {q.band === "declined"
                              ? "Declined"
                              : q.expires_at < now / 1000
                                ? "Expired"
                                : "Review quote"}
                          </button>
                        </div>
                      ))}
                  </section>
                )}
            </>
          )}
          {view === "claims" && (
            <>
              <PageTitle
                title="Evidence gets a fair hearing."
                text="Independent validators. Four clear findings. Nobody decides their own claim."
                action={
                  <button
                    className="button primary"
                    onClick={() => open({ type: "claim" })}
                  >
                    <Plus size={17} />
                    File a claim
                  </button>
                }
              />
              <div className="tabs-bar">
                <div className="tabs">
                  <button
                    className={filter === "all" ? "active" : ""}
                    onClick={() => setFilter("all")}
                  >
                    Public record <span>{overview?.claimCount ?? "…"}</span>
                  </button>
                  <button
                    className={filter === "mine" ? "active" : ""}
                    onClick={() => {
                      if (!authenticated) login();
                      else setFilter("mine");
                    }}
                  >
                    Your cases
                  </button>
                </div>
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder="Find a claim"
                />
              </div>
              {!overview ? (
                <Loading text="Reading the court record" />
              ) : !filteredClaims.length ? (
                <Empty
                  icon={Scale}
                  title={
                    search
                      ? "No matching case."
                      : "Nothing before the court. A good day."
                  }
                  text="If an insured agent caused you a loss, bring the incident reference and public evidence from at least two sources. We will take it from there."
                  action={
                    <button
                      className="button secondary"
                      onClick={() => open({ type: "claim" })}
                    >
                      Bring a claim to court
                      <Plus size={16} />
                    </button>
                  }
                />
              ) : (
                <div className="claims-layout">
                  <div className="claim-list">
                    {filteredClaims.map((c) => (
                      <button
                        className={
                          "claim-list-item " +
                          (currentClaim?.id === c.id ? "active" : "")
                        }
                        key={c.id}
                        onClick={() => setSelectedClaim(c.id)}
                      >
                        <div>
                          <span className="mono">{short(c.id)}</span>
                          <Status status={c.status} />
                        </div>
                        <h3>
                          {overview.agents.find((a) => a.id === c.agent_id)
                            ?.name ?? "Agent claim"}
                        </h3>
                        <p>{c.statement}</p>
                        <div>
                          <span className="mono">{gen(c.amount)} GEN</span>
                          <span>{date(c.created_at)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                  {currentClaim && (
                    <ClaimDetail
                      now={now}
                      claim={currentClaim}
                      mine={
                        isMine(currentClaim.claimant) ||
                        isMine(currentClaim.operator)
                      }
                      busy={busy}
                      accountAddress={account?.address}
                      onAcknowledge={() =>
                        void quick(
                          { kind: "acknowledge", claimId: currentClaim.id },
                          currentClaim.id + "acknowledge",
                        )
                      }
                      onEvidence={() =>
                        open({ type: "evidence", claim: currentClaim })
                      }
                      onWithdraw={() =>
                        void quick(
                          { kind: "withdraw_claim", claimId: currentClaim.id },
                          currentClaim.id + "withdraw",
                        )
                      }
                      onCloseOverdue={() =>
                        void quick(
                          {
                            kind: "close_unresolved",
                            claimId: currentClaim.id,
                          },
                          currentClaim.id + "close",
                        )
                      }
                      onAccept={() =>
                        void quick(
                          { kind: "accept_decision", claimId: currentClaim.id },
                          currentClaim.id + "accept",
                        )
                      }
                      onResolve={(f) =>
                        void quick(
                          {
                            kind: "resolve",
                            claimId: currentClaim.id,
                            finding: f,
                          },
                          currentClaim.id + f,
                        )
                      }
                      onAppeal={(f) =>
                        open({
                          type: "appeal",
                          claim: currentClaim,
                          finding: f,
                        })
                      }
                      onFinalize={() =>
                        void quick(
                          { kind: "finalize", claimId: currentClaim.id },
                          currentClaim.id + "finalize",
                        )
                      }
                      onSettle={() =>
                        void quick(
                          { kind: "settle", claimId: currentClaim.id },
                          currentClaim.id + "settle",
                        )
                      }
                      onSync={() =>
                        void quick(
                          { kind: "sync_loss", claimId: currentClaim.id },
                          currentClaim.id + "sync",
                        )
                      }
                    />
                  )}
                </div>
              )}
              <div className="court-rules">
                <div>
                  <Clock3 size={20} />
                  <strong>Time to reconsider</strong>
                  <p>
                    Both sides have 24 hours to challenge a decision. Only their
                    mutual acceptance can end that window early.
                  </p>
                </div>
                <div>
                  <Scale size={20} />
                  <strong>Appeal what matters</strong>
                  <p>
                    Bond an appeal for one finding. Leave the rest of the record
                    intact.
                  </p>
                </div>
                <div>
                  <FileText size={20} />
                  <strong>A public record</strong>
                  <p>
                    Evidence and reasoning stay visible. Leave private details
                    out of submissions.
                  </p>
                </div>
              </div>
            </>
          )}
          {view === "capital" && (
            <>
              <PageTitle
                title="Be the weight that steadies it."
                text="Capital makes a backstop possible. Choose where you stand in the pool."
                action={
                  <button
                    className="button primary"
                    onClick={() => open({ type: "stake" })}
                  >
                    <Plus size={17} />
                    Contribute capital
                  </button>
                }
              />
              {!account && <p className="field-note">Have capital in the earlier pool? Sign in to access its redemption and withdrawal controls.</p>}
              <LegacyCapitalPanel capital={account?.legacyCapital} busy={busy !== null || !!account?.operations.some(o => ["redeem_legacy", "withdraw_legacy"].includes(o.kind) && ![...TERMINAL_STATUSES, "error"].includes(o.status))} onAction={(action) => quick(action, "legacy")} />
              <div className="capital-summary">
                <div>
                  <span>Total value governed</span>
                  <strong className="mono">
                    {gen(overview?.dashboard.tvg)} <small>GEN</small>
                  </strong>
                </div>
                <div>
                  <span>Premiums collected</span>
                  <strong className="mono">
                    {gen(overview?.dashboard.premiums)} <small>GEN</small>
                  </strong>
                </div>
                <div>
                  <span>Claims paid</span>
                  <strong className="mono">
                    {gen(overview?.dashboard.paid)} <small>GEN</small>
                  </strong>
                </div>
              </div>
              <div className="tranche-grid">
                {(["junior", "senior"] as const).map((t, i) => (
                  <section className={"tranche tranche-" + t} key={t}>
                    <div className="tranche-top">
                      <div className="tranche-symbol">
                        <Layers3 size={28} strokeWidth={1.4} />
                        <span
                          className="tranche-layer"
                          style={{ top: i ? "20px" : "10px" }}
                        />
                      </div>
                      <span className="badge">
                        {i
                          ? "Protected by junior capital"
                          : "First to absorb losses"}
                      </span>
                    </div>
                    <h2>{i ? "Senior" : "Junior"} capital</h2>
                    <p>
                      {i
                        ? "A steadier position behind the first layer of capital. Each policy spends its allocated junior backing before its senior backing."
                        : "Closest to the waterline. Your allocated backing takes the first losses. Its premiums stay beside it until that liability ends."}
                    </p>
                    <div className="tranche-amount mono">
                      {gen(overview?.dashboard[t])}
                      <small> GEN</small>
                    </div>
                    <dl className="detail-list">
                      <div>
                        <dt>Premium share when both tranches are funded</dt>
                        <dd className="mono">{i ? "20" : "80"}%</dd>
                      </div>
                      <div>
                        <dt>Your position</dt>
                        <dd className="mono">
                          {account
                            ? gen(
                                account[
                                  (t + "_value") as
                                    "junior_value" | "senior_value"
                                ],
                              ) + " GEN"
                            : "Sign in to view"}
                        </dd>
                      </div>
                      <div>
                        <dt>Backing and premiums locked</dt>
                        <dd className="mono">
                          {gen(
                            overview?.dashboard[
                              (t + "_locked") as
                                "junior_locked" | "senior_locked"
                            ],
                          )}{" "}
                          GEN
                        </dd>
                      </div>
                      <div>
                        <dt>Share generation</dt>
                        <dd className="mono">
                          {overview?.dashboard[
                            (t + "_generation") as
                              "junior_generation" | "senior_generation"
                          ] ?? "…"}
                        </dd>
                      </div>
                      <div>
                        <dt>Share supply</dt>
                        <dd className="mono">
                          {gen(
                            overview?.dashboard[
                              (t + "_supply") as
                                "junior_supply" | "senior_supply"
                            ],
                          )}
                        </dd>
                      </div>
                    </dl>
                    <div className="tranche-actions">
                      <button
                        className={"button " + (i ? "secondary" : "primary")}
                        onClick={() => open({ type: "stake", tranche: t })}
                      >
                        Add capital
                        <Plus size={16} />
                      </button>
                      <button
                        className="text-button"
                        onClick={() => open({ type: "redeem", tranche: t })}
                      >
                        Redeem
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                  </section>
                ))}
              </div>
              <section className="reserve-panel">
                <div className="section-heading">
                  <div>
                    <h2>Promises have weight.</h2>
                    <p>Every active coverage limit is reserved in full.</p>
                  </div>
                  <span className="mono">
                    {gen(overview?.dashboard.reserved)} GEN reserved
                  </span>
                </div>
                <div className="reserve-bar">
                  <div
                    style={{
                      width: overview
                        ? Math.min(
                            100,
                            (Number(BigInt(overview.dashboard.reserved)) *
                              100) /
                              Math.max(
                                1,
                                Number(
                                  BigInt(overview.dashboard.junior) +
                                    BigInt(overview.dashboard.senior),
                                ),
                              ),
                          ) + "%"
                        : "0%",
                    }}
                  />
                </div>
                <div className="reserve-labels">
                  <span>Committed cover</span>
                  <span>
                    {gen(overview?.dashboard.available)} GEN available
                  </span>
                </div>
                <p className="field-note">
                  Premiums are included in tranche values and remain locked with
                  their policy backing until liability ends. Available capital
                  excludes those locks. Total value governed also includes claim
                  and redemption credits awaiting withdrawal. Reserves are
                  commitments inside the pool and are never counted twice.
                </p>
              </section>
              <div className="quiet-note">
                <AlertCircle size={18} />
                <p>
                  This is a discretionary experimental cover pool. Capital can
                  be lost to claims. There is no promised yield. All balances
                  are Studio test funds with no monetary value.
                </p>
              </div>
            </>
          )}
          {view === "guide" && (
            <Guide onRegister={() => open({ type: "register" })} />
          )}
          {["agents", "claims", "capital"].includes(view) && (
            <RecordDesk
              key={view + filter}
              initialKind={
                view === "claims"
                  ? "claims"
                  : view === "capital"
                    ? "policies"
                    : "agents"
              }
              mine={filter === "mine"}
              cursor={cursorFor}
              onEarlier={loadEarlier}
              onLookup={lookupRecord}
            />
          )}
          <footer className="footer">
            <span className="footer-brand">
              <Logo />A little weight. A steadier course.
            </span>
            <div>
              <Link href="/terms">Pool terms</Link>
              <Link href="/privacy">Privacy</Link>
              <button
                className="text-button"
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                <RefreshCw size={12} />
                {refreshing
                  ? "Checking"
                  : overview
                    ? "Updated " + relative(overview.updatedAt)
                    : "Awaiting network"}
              </button>
            </div>
          </footer>
        </main>
      </div>
      {authenticated && account && account.operations.length > 0 && (
        <ActivityTray operations={account.operations} />
      )}
      {form && (
        <ActionForm
          key={
            form.type +
            ("claim" in form
              ? form.claim.id
              : "agent" in form
                ? form.agent.id
                : "policy" in form
                  ? (form.policy?.id ?? "")
                  : "")
          }
          onNavigate={setForm}
          target={form}
          account={account}
          policies={overview?.policies ?? []}
          onClose={() => setForm(null)}
          onSubmit={submit}
          onQuote={(agent) => setForm({ type: "quote", agent })}
        />
      )}
    </div>
  );
}
function PageTitle({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-box">
      <Search size={16} />
      <span className="sr-only">{placeholder}</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
function Stat({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        <Icon size={17} />
        <span>{label}</span>
      </div>
      <strong className="mono">{value}</strong>
      <p>{note}</p>
    </div>
  );
}
function Waterline({ data }: { data: Overview | null }) {
  const capital = data
    ? BigInt(data.dashboard.junior) + BigInt(data.dashboard.senior)
    : 0n;
  const ratio =
    data && capital > 0n
      ? Number((BigInt(data.dashboard.reserved) * 100n) / capital)
      : 0;
  return (
    <div
      className="waterline-visual"
      role="img"
      aria-label={
        data
          ? `${ratio} percent of capital reserved for cover`
          : "Loading reserve data"
      }
    >
      <div className="waterline-grid" />
      <div className="waterline-rule">
        <span className="mono">Coverage waterline</span>
        <span className="mono">
          {data ? ratio + "% reserved" : "Awaiting data"}
        </span>
      </div>
      <svg
        viewBox="0 0 600 175"
        preserveAspectRatio="none"
        className="hull-diagram"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="ballast-hatch"
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(40)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              stroke="currentColor"
              strokeWidth="1"
              opacity=".2"
            />
          </pattern>
        </defs>
        <path
          d="M70 12H530L462 137H205Q155 137 128 100L70 12Z"
          fill="url(#ballast-hatch)"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M222 73H399L375 136H250L222 73Z"
          fill="var(--copper)"
          fillOpacity=".85"
        />
        <path d="M222 73H399L375 136H250L222 73Z" fill="url(#ballast-hatch)" />
        <path d="M0 42H600" stroke="var(--copper)" strokeWidth="1.6" />
        <circle cx="70" cy="42" r="3" fill="var(--copper)" />
        <circle cx="530" cy="42" r="3" fill="var(--copper)" />
        <path
          d="M310 96v17m-6-6 6 6 6-6"
          stroke="var(--bg)"
          strokeWidth="1.5"
          fill="none"
        />
      </svg>
      <span className="hull-caption mono">Capital, held with purpose.</span>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-symbol">
        <Icon size={33} strokeWidth={1.3} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Loading({ text }: { text: string }) {
  return (
    <div className="loading-state" role="status">
      <div className="loading-lines">
        <span />
        <span />
        <span />
      </div>
      <p>{text}</p>
    </div>
  );
}
function Status({ status }: { status: string }) {
  return (
    <span className={"badge status-" + status.toLowerCase()}>
      {status === "challenge"
        ? "Open to appeal"
        : status === "final"
          ? "Final decision"
          : status === "reviewing"
            ? "In review"
            : status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}
    </span>
  );
}
function AgentRow({
  agent,
  policies,
  onClick,
  now,
}: {
  agent: Agent;
  policies: Policy[];
  onClick: () => void;
  now: number;
}) {
  const covered = policies.some(
    (p) =>
      p.agent_id === agent.id &&
      p.status === "active" &&
      p.ends_at > now / 1000,
  );
  return (
    <button className="agent-row" onClick={onClick}>
      <span className="agent-icon">
        <Command size={20} strokeWidth={1.5} />
      </span>
      <span className="agent-row-title">
        <strong>{agent.name}</strong>
        <span className="mono">{short(agent.executor_address, 8)}</span>
      </span>
      <span className={"badge " + (covered ? "status-active" : "")}>
        {covered ? "Covered" : "Registered"}
      </span>
      <ChevronRight size={16} />
    </button>
  );
}
function ClaimDetail({
  claim,
  mine,
  busy,
  now,
  onResolve,
  onAppeal,
  onFinalize,
  onSettle,
  onSync,
  accountAddress,
  onAcknowledge,
  onEvidence,
  onWithdraw,
  onCloseOverdue,
  onAccept,
}: {
  accountAddress?: string;
  onAcknowledge: () => void;
  onEvidence: () => void;
  onWithdraw: () => void;
  onCloseOverdue: () => void;
  onAccept: () => void;
  claim: Claim;
  mine: boolean;
  busy: string | null;
  now: number;
  onResolve: (f: Finding) => void;
  onAppeal: (f: Finding) => void;
  onFinalize: () => void;
  onSettle: () => void;
  onSync: () => void;
}) {
  const overdue =
    ["filed", "reviewing"].includes(claim.status) &&
    now / 1000 >= claim.review_deadline;
  const appealOpen =
    claim.status === "challenge" && now / 1000 < claim.challenge_until;
  return (
    <section className="claim-detail">
      <div className="section-heading">
        <div>
          <span className="mono muted">Case {short(claim.id, 10)}</span>
          <h2>Four questions. A fair decision.</h2>
        </div>
        <Status status={claim.status} />
      </div>
      <p className="claim-statement">{claim.statement}</p>
      <dl className="detail-list">
        <div>
          <dt>Claimed loss</dt>
          <dd className="mono">{gen(claim.amount)} GEN</dd>
        </div>
        <div>
          <dt>Incident</dt>
          <dd className="mono break">{claim.incident_ref}</dd>
        </div>
        <div>
          <dt>Claimant</dt>
          <dd className="mono">{short(claim.claimant, 10)}</dd>
        </div>
        <div>
          <dt>Operator</dt>
          <dd className="mono">{short(claim.operator, 10)}</dd>
        </div>
      </dl>
      <div className="finding-ledger">
        {FINDINGS.map((f) => {
          const done = claim.findings[f] !== undefined;
          const ready =
            ["filed", "reviewing"].includes(claim.status) &&
            !overdue &&
            !done &&
            (f !== "payout" ||
              FINDINGS.slice(0, 3).every(
                (k) => claim.findings[k] !== undefined,
              ));
          return (
            <div
              className={"finding-entry " + (done ? "resolved" : "")}
              key={f}
            >
              <div className="finding-entry-head">
                <span className="finding-node">
                  {done ? <Check size={15} /> : <span />}
                </span>
                <h3>{FINDING_LABELS[f]}</h3>
                <strong className="mono">
                  {done
                    ? f === "payout"
                      ? claim.findings[f] + "%"
                      : claim.findings[f]
                        ? "Yes"
                        : "No"
                    : "Pending"}
                </strong>
              </div>
              {done ? (
                <>
                  <p>{claim.reasons[f]}</p>
                  {mine &&
                    appealOpen &&
                    canAppeal(claim, f, accountAddress) && (
                      <button
                        className="text-button"
                        onClick={() => onAppeal(f)}
                      >
                        Appeal this finding
                        <Scale size={13} />
                      </button>
                    )}
                </>
              ) : (
                <div className="finding-pending">
                  <p>
                    {ready
                      ? "Ready for independent validator review."
                      : "The three factual findings come first."}
                  </p>
                  {ready && (
                    <button
                      className="button small secondary"
                      disabled={busy !== null}
                      onClick={() => onResolve(f)}
                    >
                      {busy === claim.id + f ? "Submitting" : "Request finding"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {["filed", "reviewing"].includes(claim.status) && (
        <div className="case-recovery">
          <h3>
            {overdue
              ? "This review needs to close."
              : "A missing source need not end the story."}
          </h3>
          <p>
            Unfinished review closes after{" "}
            {new Date(claim.review_deadline * 1000).toLocaleString()}. Adding
            evidence does not move that deadline. A timeout or withdrawal
            returns the filing bond and makes no payout.
          </p>
          <div>
            {mine && !overdue && (
              <button
                className="button secondary small"
                disabled={busy !== null}
                onClick={onEvidence}
              >
                Add replacement evidence
              </button>
            )}
            {overdue && (
              <button
                className="button secondary small"
                disabled={busy !== null}
                onClick={onCloseOverdue}
              >
                Close overdue review
              </button>
            )}
            {accountAddress?.toLowerCase() === claim.claimant.toLowerCase() && (
              <button
                className="text-button"
                disabled={busy !== null}
                onClick={onWithdraw}
              >
                Withdraw this unresolved claim
              </button>
            )}
          </div>
        </div>
      )}
      {claim.status === "challenge" && (
        <div className="form-callout">
          <Clock3 size={20} />
          <div>
            <strong>
              {appealOpen
                ? "Time for a second look."
                : "Ready for a final decision."}
            </strong>
            <p>
              Challenge window closes{" "}
              {new Date(claim.challenge_until * 1000).toLocaleString()}.
            </p>
            {appealOpen && mine && (
              <>
                <p>
                  Accept only if you agree with this decision. If both parties
                  accept, the remaining appeal time is waived. An appeal clears
                  both acceptances.
                </p>
                <button
                  className="button small secondary"
                  disabled={
                    busy !== null ||
                    claim.acceptances.some(
                      (a) => a.toLowerCase() === accountAddress?.toLowerCase(),
                    )
                  }
                  onClick={onAccept}
                >
                  {claim.acceptances.some(
                    (a) => a.toLowerCase() === accountAddress?.toLowerCase(),
                  )
                    ? "You accepted this decision"
                    : "Accept this decision"}
                </button>
              </>
            )}
            {!appealOpen && (
              <button
                className="button small primary"
                disabled={busy !== null}
                onClick={onFinalize}
              >
                Finalize decision
              </button>
            )}
          </div>
        </div>
      )}
      {["final", "settled"].includes(claim.status) && (
        <div className="settlement-box">
          {claim.outcome && claim.outcome !== "adjudicated" && (
            <p>
              {claim.outcome === "evidence_timeout"
                ? "The review deadline passed. No loss decision was made and the filing bond was returned."
                : "The claimant withdrew this case. The filing bond was returned."}{" "}
              {claim.status === "final" ? "Settle this record to close its case commitment." : "The pool settlement has been recorded."}
            </p>
          )}
          <span>{claim.status === "settled" ? "Paid by the pool" : "Assessed award"}</span>
          <strong className="mono">{gen(claim.status === "settled" ? (claim.settled_payout ?? "0") : claim.payout)} GEN</strong>
          <p>
            All claims share the policy’s aggregate limit. Finalized settlements
            use the remaining cover in settlement order, so payment can be less
            than the assessed award.
          </p>
          <div>
            <button
              className="button primary small"
              disabled={busy !== null || claim.status === "settled"}
              onClick={onSettle}
            >
              Settle with the pool
            </button>
            <button
              className="button quiet small"
              disabled={busy !== null}
              onClick={onSync}
            >
              Update loss record
            </button>
          </div>
          {claim.status === "final" && (
            <button
              className="text-button"
              disabled={busy !== null}
              onClick={onAcknowledge}
            >
              Confirm the settled record
            </button>
          )}
          <p>
            Settle first, then update the operator’s loss record. Paid claims
            become pool credits. Withdraw them from your account. Final
            decisions stay in your records until the pool settles them.
            Settlement normally closes the case automatically; you can confirm
            it here if that update is delayed.
          </p>
        </div>
      )}
      <div className="evidence-list">
        <h3>Evidence on the record</h3>
        {(claim.effective_evidence_urls ?? claim.evidence_urls).map((u) => (
          <EvidenceLink key={u} url={u} />
        ))}
      </div>
      {claim.appeals.length > 0 && (
        <div className="appeal-history">
          <h3>Appeal record</h3>
          {claim.appeals.map((a) => (
            <div key={a.field + a.by + String(a.revision)}>
              <span className="badge">{a.field}</span>
              <strong>
                {a.changed ? "Finding changed" : "Finding upheld"}
              </strong>
              <p>{a.reason}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function ActivityTray({ operations }: { operations: Operation[] }) {
  const [open, setOpen] = useState(false);
  const pending = operations.filter(
    (o) => o.execution === "pending" && o.status !== "uncertain",
  );
  return (
    <aside
      className={"activity-tray " + (open ? "expanded" : "")}
      aria-label="Your activity"
    >
      <button
        className="activity-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Activity size={16} />
        <span>Your activity</span>
        {pending.length > 0 && (
          <span className="activity-count">{pending.length} pending</span>
        )}
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="activity-items">
          {operations.map((o) => (
            <div className="activity-item" key={o.id}>
              <span className={"activity-status " + o.execution}>
                {o.execution === "success" ? (
                  <Check size={15} />
                ) : o.execution === "error" ? (
                  <AlertCircle size={15} />
                ) : (
                  <Clock3 size={15} />
                )}
              </span>
              <div>
                <strong>{operationNames[o.kind] ?? o.kind}</strong>
                <p>
                  {o.status === "FINALIZED" && o.execution === "success"
                    ? "Finalized successfully"
                    : o.status === "ACCEPTED" && o.execution === "error"
                      ? "Accepted with an execution error"
                      : o.status.replaceAll("_", " ").toLowerCase()}{" "}
                  <span>{relative(o.created_at)}</span>
                </p>
                {o.error && <p className="activity-error">{o.error}</p>}
                {o.votes.length > 0 && (
                  <div className="validator-votes">
                    {o.votes.map((v) => (
                      <span
                        title={v.validator + ": " + v.vote}
                        key={v.validator}
                        className={
                          v.vote.toLowerCase() === "agree" ? "agree" : ""
                        }
                      >
                        {v.vote.toLowerCase() === "agree" ? (
                          <Check size={11} />
                        ) : (
                          <span />
                        )}
                      </span>
                    ))}
                    <small>
                      {
                        o.votes.filter((v) => v.vote.toLowerCase() === "agree")
                          .length
                      }{" "}
                      validators agree
                    </small>
                  </div>
                )}
              </div>
              {o.tx_hash && (
                <a
                  href={explorer("tx", o.tx_hash)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open transaction receipt"
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
function Guide({ onRegister }: { onRegister: () => void }) {
  return (
    <article className="guide">
      <PageTitle
        title="Let’s keep the vessel upright."
        text="A field guide to promises, evidence and the capital behind them."
      />
      <div className="guide-lead">
        <Logo />
        <p>
          Ballast is the weight a vessel carries to stay upright in weather it
          cannot control. Here, it is capital set aside so an agent’s mistake
          does not capsize the people around it.
        </p>
      </div>
      <section>
        <h2>What’s covered today?</h2>
        <p>
          Unauthorized agent spend. An agent exceeds its registered spending
          authority, a third party suffers a measurable loss, and public
          evidence connects the two. Cover is capped at 100 Studio GEN, lasts 30
          days and has a further 7 day claim filing window. An incident must
          happen while the policy is active.
        </p>
        <p>
          V1 does not cover market movement, missed profits, operator losses or
          an action that the declared scope permits. Future perils need their
          own terms and evidence standards. We start with a promise we can
          actually examine.
        </p>
      </section>
      <section>
        <h2>Your manifest is the promise.</h2>
        <p>
          Before cover exists, register the agent’s name, executor address,
          spending limit and scope. Be specific about approval rules. Ballast
          saves the original text and its hash. A later rewrite cannot quietly
          change an earlier policy.
        </p>
        <pre className="manifest-preview">
          {
            '{\n  "name": "Your agent",\n  "scope": "Describe its actual permissions and approval rules",\n  "executor_address": "The address executing its actions",\n  "spend_limit_gen": 1\n}'
          }
        </pre>
        <p>
          This is a schema example, not a registered agent or operating history.
          Supply your own real records.
        </p>
      </section>
      <section>
        <h2>A quote with a reason.</h2>
        <p>
          GenLayer validators read your manifest, public action history, peer
          evidence and prior Ballast losses. They independently choose a risk
          band. Base premiums are 2% for low risk, 5% for medium risk and 10%
          for high risk. Each recorded claim adds one percentage point, up to
          ten additional points. The total rate cannot exceed 20%. A quote stays
          open for one hour.
        </p>
        <p>
          When you bind, the premium enters the pool and the full coverage limit
          is reserved. Agent identity follows the executor, with explicit
          operator authorization. Spaces do not create a second agent. A revised
          manifest keeps the same identity and can be registered only after
          existing cover closes; policies retain the exact revision they
          insured. If the pool cannot support the promise, it cannot write the
          cover.
        </p>
      </section>
      <section>
        <h2>Four findings, not a shrug.</h2>
        <p>
          A single question like “should we pay?” leaves too much room for
          validators to talk past one another. Ballast asks four smaller
          questions. Each validator fetches the evidence independently and
          compares the answer for that finding alone.
        </p>
        <dl className="guide-findings">
          <div>
            <dt>Did harm occur?</dt>
            <dd>
              A realized debit of the claimant’s own native GEN in the exact
              Studio transaction. Validators establish the actual amount and
              time against the policy dates.
            </dd>
          </div>
          <div>
            <dt>Did the agent cause it?</dt>
            <dd>
              Public execution records must connect the registered executor to
              the exact incident.
            </dd>
          </div>
          <div>
            <dt>Was it within scope?</dt>
            <dd>
              A yes means the action was authorized and is excluded from this
              peril. A no establishes the scope breach.
            </dd>
          </div>
          <div>
            <dt>What payout is supported?</dt>
            <dd>
              A discrete band of 0, 25, 50, 75 or 100 percent of the claimed
              loss, bounded by evidenced harm and remaining cover.
            </dd>
          </div>
        </dl>
        <p>
          The three booleans must match exactly. The payout band must match
          exactly. Positive harm also requires agreement on the independently
          evidenced amount and event time. Reasons remain public but their
          wording can differ. A missing URL does not veto otherwise sufficient
          evidence. If fewer than two public hosts can be reached, either party
          can add corroboration before the fixed review deadline.
        </p>
      </section>
      <section>
        <h2>There’s room to disagree.</h2>
        <p>
          Either side may bond an appeal for a single finding during the 24 hour
          challenge period. The bond is 1% of the claimed amount, with a minimum
          of 0.01 GEN. A changed result returns the appeal bond; an unchanged
          result awards it to the other party. Each party has its own appeal for
          each boolean and for each version of the payout decision. Nobody can
          use the other side’s turn. If eligibility changes, payout is assessed
          again using all accepted appeal evidence. The challenge clock restarts
          after the updated findings are complete. Both parties can explicitly
          accept the current decision to waive the rest of the window; an appeal
          clears those acceptances.
        </p>
        <p>
          After the window closes, anyone can finalize the decision, settle it
          with the pool and update the operator’s loss history. A rejected claim
          leaves cover in place. A payout reduces remaining cover. Funds become
          credits that the recipient withdraws. A final case stays in your
          account’s unresolved records until its pool settlement is finalized.
        </p>
        <p>
          Incomplete review has a seven day deadline. Evidence edits and partial
          findings do not move it. A changed boolean gives the dependent payout
          review its own seven day window, within a finite appeal allowance.
          Anyone can close an overdue review, returning its filing bond without
          a payout. The claimant can also withdraw an unfinished case. After the
          policy filing window, excess reserves can be released while the open
          cases stay backed up to their combined requests and the remaining policy limit.
        </p>
        <p>
          Use the exact transaction hash for the native debit, not an invoice
          alias. One claimant can receive one award for that debit across all
          policies. The independently evidenced loss and the pool’s compensation
          ledger both cap the payment. Distinct losses may be filed together.
          All claims share one aggregate policy limit; finalized settlement
          order determines which awards receive the remaining cover.
        </p>
      </section>
      <section>
        <h2>The people behind the capital.</h2>
        <p>
          Junior capital absorbs claims first and receives 80% of premiums when
          both tranches are funded. Senior capital absorbs losses after junior
          capital and receives 20%. If only one tranche holds capital, it
          receives the whole premium. Shares track the current value of a
          position. Each policy locks its own junior and senior backing,
          including its premiums. Redemptions preserve those tranche allocations
          for the whole liability period. A new deposit cannot make somebody
          else’s reserved backing withdrawable.
        </p>
        <p>
          There is no promised return, and capital can be lost. If a tranche
          loses all its value, the next deposit starts a fresh share generation.
          Old shares remain visible at zero value and have no claim on new
          capital. No absent shareholder can hold recapitalization hostage.
        </p>
      </section>
      <section>
        <h2>One email. No transaction theatre.</h2>
        <p>
          Sign in using an email code. Ballast creates an account with an
          encrypted signing key and submits the actions you explicitly request.
          It is a custodial Studio account. The server holds the key, so do not
          send real assets to it. You can inspect every transaction receipt
          through the public explorer.
        </p>
        <p>
          All balances here are Studio test funds. The app uses the live
          GenLayer Studio network, not simulated application records. Studio
          itself is a development environment, and its state can reset.
        </p>
      </section>
      <div className="guide-end">
        <h2>A small promise, kept carefully.</h2>
        <p>
          Ballast is an experimental discretionary cover pool. It is not a
          regulated insurance product or a guarantee of compensation.
        </p>
        <button className="button primary" onClick={onRegister}>
          Register your agent
          <Plus size={16} />
        </button>
      </div>
    </article>
  );
}
