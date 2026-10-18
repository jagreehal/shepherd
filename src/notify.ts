// Outbound notifications. Off until SHEPHERD_NOTIFY_WEBHOOK is set. A Slack Incoming Webhook URL gets a
// Slack message; any other URL gets the event as JSON, for Discord relays, Teams, n8n, Zapier or an agent
// platform's trigger. The caller runs `shepherd notify` right after setting the commit status; this
// module drops repeats (a local record across heads, a `shepherd/notify` status on the head for fresh CI
// runners), so a /loop or a rerun tells people once per change of state, not every iteration. People answer
// on the PR, where the next iteration's triage reads them.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stateDir } from "./local.ts";

export const STATES = ["success", "failure", "pending", "error"] as const;

export type State = (typeof STATES)[number];

export type NotifyEvent = {
  event: "shepherd.state";
  repo: string;
  pr: number;
  url: string;
  head_sha: string;
  state: State;
  description: string;
};

/** States that notify unless SHEPHERD_NOTIFY_ON says otherwise: done, needs a person, and stopped by an error. */
export const NOTIFY_DEFAULT: State[] = ["success", "failure", "error"];

export function notifyOn(raw: string | undefined): State[] {
  const asked = new Set((raw ?? "").split(",").map((s) => s.trim().toLowerCase()));
  const list = STATES.filter((s) => asked.has(s));

  return list.length ? list : NOTIFY_DEFAULT;
}

const LABEL: Record<State, string> = { success: "ready to merge", failure: "needs you", pending: "working", error: "stopped" };

// Descriptions can quote PR titles, reviewers and bot output; Slack reads <...> as links and mentions (<!channel>).
export const slackEscape = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const isSlack = (url: string) => url.startsWith("https://hooks.slack.com/services/");

export function payload(url: string, e: NotifyEvent): string {
  return JSON.stringify(isSlack(url) ? { text: `*shepherd ${LABEL[e.state]}* <${e.url}|${e.repo}#${e.pr}>\n${slackEscape(e.description)}` } : e);
}

export type Sent = "sent" | "unchanged" | "off" | "failed";

/** Where the last delivered (or deliberately skipped) state is kept. Written only after it is settled. */
export type Ledger = { read(): string | null; write(token: string): void };

const token = (e: NotifyEvent) => createHash("sha256").update(`${e.state}\n${e.description}`).digest("hex").slice(0, 16);

/** A file under the git directory: survives a local /loop across heads. */
export function fileLedger(repoRoot: string, pr: number): Ledger {
  // Resolved on use: outside a repository, read and write throw and notify treats that as no record.
  const file = () => path.join(stateDir(repoRoot), `notified-${pr}`);

  return {
    read: () => (existsSync(file()) ? readFileSync(file(), "utf8").trim() : null),
    write: (t) => {
      mkdirSync(path.dirname(file()), { recursive: true });
      writeFileSync(file(), t);
    },
  };
}

const Statuses = z.array(z.object({ context: z.string(), description: z.string().nullable() }));

export const LEDGER_CONTEXT = "shepherd/notify";

/**
 * A `shepherd/notify` commit status on the head: survives fresh CI runners, and is separate from the `shepherd`
 * status, so a status that was set but never delivered is retried. GitHub lists statuses newest first.
 */
export function statusLedger(repo: string, head: string, cwd: string): Ledger {
  const gh = (args: string[]) => execFileSync("gh", args, { cwd, encoding: "utf8", timeout: 15_000 });

  return {
    read: () => {
      const latest = Statuses.parse(JSON.parse(gh(["api", `repos/${repo}/commits/${head}/statuses?per_page=100`]))).find((st) => st.context === LEDGER_CONTEXT);

      return /([0-9a-f]{16})$/.exec(latest?.description ?? "")?.[1] ?? null;
    },
    write: (t) => {
      gh(["api", `repos/${repo}/statuses/${head}`, "-f", `context=${LEDGER_CONTEXT}`, "-f", "state=success", "-f", `description=last notified ${t}`]);
    },
  };
}

/**
 * Posts the event when its state is wanted and differs from the last one settled for this PR. A state that is
 * not wanted is settled without a post, so failure → pending → failure tells people twice. A failed post is
 * not settled, so the next call retries it. A ledger that cannot be read or written never stops the call.
 * Never throws.
 */
export async function notify(url: string | undefined, e: NotifyEvent, on: State[], ledgers: Ledger[], post: typeof fetch = fetch): Promise<Sent> {
  if (!url) return "off";
  const t = token(e);

  for (const l of ledgers) {
    try {
      if (l.read() === t) return "unchanged";
    } catch {
      // unreadable: treat as not sent
    }
  }

  const settle = () => {
    for (const l of ledgers) {
      try {
        l.write(t);
      } catch {
        // a repeat next time is better than failing this iteration
      }
    }
  };

  if (!on.includes(e.state)) {
    settle();

    return "off";
  }

  try {
    const res = await post(url, { method: "POST", headers: { "content-type": "application/json" }, body: payload(url, e), signal: AbortSignal.timeout(10_000) });

    if (!res.ok) return "failed";
  } catch {
    return "failed";
  }

  settle();

  return "sent";
}
