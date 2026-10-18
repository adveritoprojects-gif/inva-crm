import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, readJsonBody, requireSession } from "@/lib/http";
import { updateProject } from "@/lib/projects-store";
import { validateProject } from "@/lib/project";
import { BadRequestError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/projects/:id — updates a project and its revision requests
 * atomically. The submitted record version must match the stored one;
 * a stale update returns 409 and never overwrites another tab's changes.
 */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    await requireSession(req);
    const { id } = await ctx.params;
    if (!id) throw new BadRequestError("Project id is required.");

    const body = await readJsonBody<Record<string, unknown>>(req);
    const input = validateProject({ ...body, id });
    const project = await updateProject(id, input);
    return NextResponse.json({ project }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
