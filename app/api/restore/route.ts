import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, readJsonBody, requireSession } from "@/lib/http";
import { parseBackup, restoreProjects } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/restore
 * Imports a v1 JSON backup (from the SQLite edition or the earlier hosted CRM)
 * into an empty register. All records are inserted in one transaction or none.
 * A nonempty register is refused without modifying existing records.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await requireSession(req);
    const body = await readJsonBody<unknown>(req);
    const { projects, warnings } = parseBackup(body);
    const outcome = await restoreProjects(projects);
    return NextResponse.json(
      {
        imported: outcome.imported,
        projects: outcome.imported,
        revisions: outcome.revisions,
        warnings,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
