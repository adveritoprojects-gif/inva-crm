import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as logoutRoute from "@/app/api/auth/logout/route";
import * as exportRoute from "@/app/api/export/route";
import * as restoreRoute from "@/app/api/restore/route";
import { extractCookie, freshTestDatabase, getTestDatabaseUrl, makeRequest, rawProject } from "../helpers";
import { hashPassword } from "@/lib/auth";
import { query, resetPool } from "@/lib/db";
import { ensureMigrated } from "@/lib/migrate";

/**
 * Integration tests against a dedicated PostgreSQL test database
 * (TEST_DATABASE_URL). The public schema is dropped and recreated before the
 * suite; nothing outside that database is touched.
 */

const TEST_DB = getTestDatabaseUrl();
const APP_ORIGIN = "http://localhost:3000";
const PASSWORD = "integration-pass-9271";

describe.skipIf(!TEST_DB)("API integration (PostgreSQL)", () => {
  let cookie = "";

  const createReq = (overrides: Record<string, unknown> = {}, c: string = cookie) =>
    makeRequest("/api/projects", {
      method: "POST",
      body: rawProject(overrides),
      cookie: c,
      origin: APP_ORIGIN,
      ip: "10.0.0.5",
    });

  const getReq = (c: string = cookie) => makeRequest("/api/projects", { cookie: c });

  const putReq = (id: string, body: unknown, c: string = cookie) =>
    makeRequest(`/api/projects/${id}`, {
      method: "PUT",
      body,
      cookie: c,
      origin: APP_ORIGIN,
      ip: "10.0.0.6",
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB as string;
    process.env.APP_ORIGIN = APP_ORIGIN;
    process.env.ADMIN_PASSWORD_HASH = await hashPassword(PASSWORD);
    await freshTestDatabase(TEST_DB as string);
    resetPool();
    await ensureMigrated();

    const login = await loginRoute.POST(
      makeRequest("/api/auth/login", {
        method: "POST",
        body: { password: PASSWORD },
        origin: APP_ORIGIN,
        ip: "10.0.0.1",
      })
    );
    expect(login.status).toBe(200);
    cookie = extractCookie(login);
  });

  afterAll(async () => {
    await resetPool();
    delete process.env.DATABASE_URL;
  });

  // ---------------------------------------------------------------- auth ---

  it("rejects unauthenticated project access", async () => {
    const res = await projectsRoute.GET(makeRequest("/api/projects"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("rejects cross-site sign-in and write requests", async () => {
    const login = await loginRoute.POST(
      makeRequest("/api/auth/login", {
        method: "POST",
        body: { password: PASSWORD },
        origin: "https://evil.example",
      })
    );
    expect(login.status).toBe(403);

    const write = await projectsRoute.POST(
      makeRequest("/api/projects", {
        method: "POST",
        body: {},
        cookie,
        origin: "https://evil.example",
      })
    );
    expect(write.status).toBe(403);
  });

  it("rejects wrong passwords and throttles after 10 attempts", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await loginRoute.POST(
        makeRequest("/api/auth/login", {
          method: "POST",
          body: { password: "wrong-password" },
          origin: APP_ORIGIN,
          ip: "10.9.9.9",
        })
      );
      expect(res.status).toBe(401);
    }
    // Even the correct password is blocked while throttled.
    const blocked = await loginRoute.POST(
      makeRequest("/api/auth/login", {
        method: "POST",
        body: { password: PASSWORD },
        origin: APP_ORIGIN,
        ip: "10.9.9.9",
      })
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("expires sessions and reissues cookies after re-login", async () => {
    await query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
    const res = await projectsRoute.GET(getReq(cookie));
    expect(res.status).toBe(401);

    const login = await loginRoute.POST(
      makeRequest("/api/auth/login", {
        method: "POST",
        body: { password: PASSWORD },
        origin: APP_ORIGIN,
        ip: "10.0.0.3",
      })
    );
    cookie = extractCookie(login);
    const ok = await projectsRoute.GET(getReq(cookie));
    expect(ok.status).toBe(200);
  });

  it("invalidates sessions after a password change", async () => {
    const original = process.env.ADMIN_PASSWORD_HASH;
    process.env.ADMIN_PASSWORD_HASH = await hashPassword("another-password-2");
    try {
      const res = await projectsRoute.GET(getReq(cookie));
      expect(res.status).toBe(401);
    } finally {
      process.env.ADMIN_PASSWORD_HASH = original;
    }
  });

  it("logs out server-side", async () => {
    const logout = await logoutRoute.POST(
      makeRequest("/api/auth/logout", { method: "POST", body: {}, cookie, origin: APP_ORIGIN })
    );
    expect(logout.status).toBe(200);
    expect((await projectsRoute.GET(getReq(cookie))).status).toBe(401);

    const login = await loginRoute.POST(
      makeRequest("/api/auth/login", {
        method: "POST",
        body: { password: PASSWORD },
        origin: APP_ORIGIN,
        ip: "10.0.0.4",
      })
    );
    cookie = extractCookie(login);
    expect((await projectsRoute.GET(getReq(cookie))).status).toBe(200);
  });

  // ------------------------------------------------------------- projects ---

  it("creates, lists and normalizes projects", async () => {
    const res = await projectsRoute.POST(createReq({ number: "  pct-5001 " }));
    expect(res.status).toBe(201);
    const { project } = await res.json();
    expect(project.number).toBe("PCT-5001");
    expect(project.phone).toBe("00441234567890");
    expect(project.total).toBe(15000.5);
    expect(project.paid).toBe(5000);

    const list = await projectsRoute.GET(getReq());
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.projects.some((p: { number: string }) => p.number === "PCT-5001")).toBe(true);
  });

  it("rejects duplicate PCT numbers (case/space variants)", async () => {
    const res = await projectsRoute.POST(createReq({ number: "PCT-5001" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("duplicate_number");
    expect(body.message).toMatch(/already exists/);
  });

  it("validates on the server (overpayment, percent, dates)", async () => {
    const overpaid = await projectsRoute.POST(
      createReq({ number: "PCT-6001", total: 1000, paid: 1000.01 })
    );
    expect(overpaid.status).toBe(400);
    expect((await overpaid.json()).message).toMatch(/cannot exceed/i);

    const halfDone = await projectsRoute.POST(
      createReq({ number: "PCT-6002", status: "Completed", percent: 50 })
    );
    expect(halfDone.status).toBe(400);

    const badDate = await projectsRoute.POST(
      createReq({ number: "PCT-6003", received: "2026-02-30" })
    );
    expect(badDate.status).toBe(400);
  });

  it("updates optimistically and rejects stale versions", async () => {
    const created = await projectsRoute.POST(createReq({ number: "PCT-7001" }));
    const { project } = await created.json();

    const first = await projectRoute.PUT(putReq(project.id, { ...project, title: "Updated title" }), {
      params: Promise.resolve({ id: project.id }),
    });
    expect(first.status).toBe(200);
    const updated = (await first.json()).project;
    expect(updated.title).toBe("Updated title");
    expect(updated.revision).toBe(project.revision + 1);

    // A second write with the original version — another tab already saved.
    const stale = await projectRoute.PUT(putReq(project.id, { ...project, title: "Stale write" }), {
      params: Promise.resolve({ id: project.id }),
    });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.error).toBe("stale_revision");
    expect(body.message).toMatch(/another tab/i);
  });

  it("saves project and revisions atomically; open revisions survive delivery", async () => {
    const rid = crypto.randomUUID();
    const created = await projectsRoute.POST(
      createReq({
        number: "PCT-8001",
        revisions: [
          {
            id: rid,
            description: "Rewrite introduction",
            requested: "2026-01-05",
            due: "2026-01-08",
            status: "Requested",
            notes: "urgent",
          },
        ],
      })
    );
    expect(created.status).toBe(201);
    let project = (await created.json()).project;
    expect(project.revisions).toHaveLength(1);
    expect(project.revisions[0].id).toBe(rid);

    // Replace the revision set and deliver the project in one save.
    const rid2 = crypto.randomUUID();
    const next = await projectRoute.PUT(
      putReq(project.id, {
        ...project,
        status: "Delivered",
        percent: 100,
        revisions: [
          {
            id: rid,
            description: "Rewrite introduction",
            requested: "2026-01-05",
            due: "2026-01-08",
            status: "Completed",
            notes: "urgent",
          },
          {
            id: rid2,
            description: "Fix formatting",
            requested: "2026-01-09",
            due: "2026-01-12",
            status: "Requested",
            notes: "",
          },
        ],
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(next.status).toBe(200);
    project = (await next.json()).project;
    expect(project.status).toBe("Delivered");
    expect(project.percent).toBe(100);
    expect(project.revisions).toHaveLength(2);
    expect(project.revisions.map((r: { id: string }) => r.id)).toEqual([rid, rid2]);

    // The open request remains open after delivery.
    const list = await projectsRoute.GET(getReq());
    const body = await list.json();
    const found = body.projects.find((p: { number: string }) => p.number === "PCT-8001");
    expect(found.revisions.filter((r: { status: string }) => r.status !== "Completed")).toHaveLength(1);
  });

  it("allows a second session to write but still blocks cross-site writes", async () => {
    // A separate sign-in (second browser/tab) can write.
    const second = await loginRoute.POST(
      makeRequest("/api/auth/login", {
        method: "POST",
        body: { password: PASSWORD },
        origin: APP_ORIGIN,
        ip: "10.0.0.7",
      })
    );
    const secondCookie = extractCookie(second);
    const created = await projectsRoute.POST(createReq({ number: "PCT-9100" }, secondCookie));
    expect(created.status).toBe(201);
    // But without origin protection bypass: evil origin is rejected even with a valid cookie.
    const evil = await projectsRoute.POST(
      makeRequest("/api/projects", {
        method: "POST",
        body: rawProject({ number: "PCT-9101" }),
        cookie: secondCookie,
        origin: "https://evil.example",
      })
    );
    expect(evil.status).toBe(403);
  });

  // --------------------------------------------------------------- export ---

  it("exports a v1 JSON backup and a real xlsx workbook", async () => {
    const json = await exportRoute.GET(makeRequest("/api/export?format=json", { cookie }));
    expect(json.status).toBe(200);
    expect(json.headers.get("content-disposition")).toMatch(
      /pct-project-desk-backup-\d{4}-\d{2}-\d{2}\.json/
    );
    const backup = await json.json();
    expect(backup.format).toBe("pct-project-desk");
    expect(backup.version).toBe(1);
    expect(backup.currency).toBe("INR");
    expect(backup.timezone).toBe("Asia/Kolkata");
    expect(Array.isArray(backup.projects)).toBe(true);
    const sample = backup.projects.find((p: { number: string }) => p.number === "PCT-5001");
    expect(sample.phone).toBe("00441234567890");
    // No auth material in a business-data backup.
    expect(JSON.stringify(backup)).not.toMatch(/scrypt\$/);
    expect(JSON.stringify(backup)).not.toMatch(/token_hash/);

    const xlsx = await exportRoute.GET(makeRequest("/api/export?format=xlsx", { cookie }));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(xlsx.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await xlsx.arrayBuffer());
    // Real xlsx files are ZIP archives ("PK" magic bytes), not renamed CSV.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  // --------------------------------------------------------------- restore ---

  it("rejects oversized bodies", async () => {
    const tooBig = makeRequest("/api/restore", {
      method: "POST",
      rawBody: "x".repeat(21 * 1024 * 1024),
      cookie,
      origin: APP_ORIGIN,
    });
    const res = await restoreRoute.POST(tooBig);
    expect(res.status).toBe(413);
  });

  it("refuses to import into a nonempty register", async () => {
    const res = await restoreRoute.POST(
      makeRequest("/api/restore", {
        method: "POST",
        body: {
          format: "pct-project-desk",
          version: 1,
          projects: [rawProject({ number: "PCT-9999" })],
        },
        cookie,
        origin: APP_ORIGIN,
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_empty");
  });

  it("round-trips a v1 backup: ids, versions and phone strings preserved", async () => {
    const json = await exportRoute.GET(makeRequest("/api/export?format=json", { cookie }));
    const backup = await json.json();
    await query("DELETE FROM projects");
    expect((await projectsRoute.GET(getReq())).status).toBe(200);

    const restore = await restoreRoute.POST(
      makeRequest("/api/restore", {
        method: "POST",
        body: backup,
        cookie,
        origin: APP_ORIGIN,
      })
    );
    expect(restore.status).toBe(201);
    const outcome = await restore.json();
    expect(outcome.projects).toBe(backup.projects.length);

    const projects = (await (await projectsRoute.GET(getReq())).json()).projects;
    expect(projects).toHaveLength(backup.projects.length);
    const restored = projects.find((p: { number: string }) => p.number === "PCT-5001");
    const original = backup.projects.find((p: { number: string }) => p.number === "PCT-5001");
    expect(restored.id).toBe(original.id);
    expect(restored.revision).toBeGreaterThanOrEqual(1);
    expect(restored.phone).toBe("00441234567890");
    expect(restored.total).toBe(original.total);
    expect(restored.writer).toBe(original.writer);
  });

  it("rejects duplicate ids/PCT numbers inside a backup and imports nothing", async () => {
    await query("DELETE FROM projects");
    const res = await restoreRoute.POST(
      makeRequest("/api/restore", {
        method: "POST",
        body: {
          format: "pct-project-desk",
          version: 1,
          projects: [
            rawProject({ id: crypto.randomUUID(), number: "PCT-9001" }),
            rawProject({ id: crypto.randomUUID(), number: " pct-9001 " }),
          ],
        },
        cookie,
        origin: APP_ORIGIN,
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues?.length ?? 0).toBeGreaterThan(0);
    // Nothing was imported (validation runs before/inside a single transaction).
    const projects = (await (await projectsRoute.GET(getReq())).json()).projects;
    expect(projects).toHaveLength(0);
  });

  it("keeps records intact across a pool restart (server restart simulation)", async () => {
    await projectsRoute.POST(createReq({ number: "PCT-RESTART" }));
    await resetPool(); // tear down every connection; the pool reconnects lazily
    const rows = await query<{ c: number }>("SELECT count(*)::int AS c FROM projects");
    expect(rows[0].c).toBeGreaterThan(0);
    const projects = (await (await projectsRoute.GET(getReq())).json()).projects;
    expect(projects.some((p: { number: string }) => p.number === "PCT-RESTART")).toBe(true);
  });
});
