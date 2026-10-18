import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { assertSameOrigin, errorResponse, readJsonBody, requireSession } from "@/lib/http";
import { createProject, listProjects } from "@/lib/projects-store";
import { validateProject } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects — the full saved register, ordered by submission date. */
export async function GET(req: NextRequest) {
  try {
    await requireSession(req);
    const projects = await listProjects();
    return NextResponse.json({ projects }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/projects — creates a project. Body: full project record.
 * The client supplies the UUID; a missing id is generated server-side.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await requireSession(req);
    const body = await readJsonBody<Record<string, unknown>>(req);
    const id = typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();
    const input = validateProject({ ...body, id, revision: 1 });
    const project = await createProject(input);
    return NextResponse.json({ project }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
