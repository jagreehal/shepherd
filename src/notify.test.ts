import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileLedger, notify, notifyOn, payload, type Ledger, type NotifyEvent } from "./notify.ts";

const EVENT: NotifyEvent = {
  event: "shepherd.state",
  repo: "acme/api",
  pr: 7,
  url: "https://github.com/acme/api/pull/7",
  head_sha: "a".repeat(40),
  state: "failure",
  description: "stamp refused: <!channel> retry loop never ends",
};

const HOOK = "https://example.com/hook";

/** A ledger in memory: stands in for the `shepherd/notify` status that every CI runner shares. */
function memory(): Ledger & { value: () => string | null } {
  let stored: string | null = null;

  return {
    read: () => stored,
    write: (t) => {
      stored = t;
    },
    value: () => stored,
  };
}

function capture(status = 200) {
  const bodies: string[] = [];

  const post = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));

    return new Response("x", { status });
  };

  return { bodies, post: Object.assign(post, { preconnect: fetch.preconnect }) };
}

describe("notify", () => {
  test("a Slack webhook gets escaped text; any other webhook gets the event as JSON", () => {
    expect(JSON.parse(payload("https://hooks.slack.com/services/T/B/x", EVENT))).toEqual({ text: "*shepherd needs you* <https://github.com/acme/api/pull/7|acme/api#7>\nstamp refused: &lt;!channel&gt; retry loop never ends" });
    expect(JSON.parse(payload(HOOK, EVENT))).toEqual(EVENT);
  });

  test("a /loop tells people once per change of state, and again after it changes back", async () => {
    const ledger = memory();
    const { bodies, post } = capture();
    const on = notifyOn(undefined);

    expect(await notify(HOOK, EVENT, on, [ledger], post)).toBe("sent");
    expect(await notify(HOOK, EVENT, on, [ledger], post)).toBe("unchanged");
    expect(await notify(HOOK, { ...EVENT, state: "pending", description: "round 2" }, on, [ledger], post)).toBe("off");
    expect(await notify(HOOK, EVENT, on, [ledger], post)).toBe("sent");
    expect(bodies).toHaveLength(2);
  });

  test("a failed post is retried by the next runner, which shares only the CI ledger", async () => {
    const shared = memory();
    const down = capture(503);
    const up = capture();

    expect(await notify(HOOK, EVENT, notifyOn(undefined), [memory(), shared], down.post)).toBe("failed");
    expect(shared.value()).toBeNull();
    expect(await notify(HOOK, EVENT, notifyOn(undefined), [memory(), shared], up.post)).toBe("sent");
    expect(up.bodies).toHaveLength(1);
  });

  test("a ledger that cannot be read or written never stops the call, and no webhook sends nothing", async () => {
    const { bodies, post } = capture();

    const unreachable: Ledger = {
      read: () => {
        throw new Error("gh down");
      },
      write: () => {
        throw new Error("gh down");
      },
    };

    expect(await notify(undefined, EVENT, notifyOn(undefined), [unreachable], post)).toBe("off");
    expect(await notify(HOOK, EVENT, notifyOn(undefined), [unreachable], post)).toBe("sent");
    expect(bodies).toHaveLength(1);
  });

  test("the file ledger keeps its record under the git directory; outside a repository it only fails softly", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "shepherd-notify-"));

    execFileSync("git", ["init", "-q", dir]);
    const { post } = capture();

    expect(await notify(HOOK, EVENT, notifyOn(undefined), [fileLedger(dir, 7)], post)).toBe("sent");
    expect(await notify(HOOK, EVENT, notifyOn(undefined), [fileLedger(dir, 7)], post)).toBe("unchanged");
    const notRepo = mkdtempSync(path.join(tmpdir(), "shepherd-norepo-"));

    expect(await notify(HOOK, EVENT, notifyOn(undefined), [fileLedger(notRepo, 7)], post)).toBe("sent");
  });

  test("SHEPHERD_NOTIFY_ON narrows or widens the states; an errored iteration notifies by default", () => {
    expect(notifyOn("Failure, bogus")).toEqual(["failure"]);
    expect(notifyOn("")).toEqual(["success", "failure", "error"]);
  });
});
