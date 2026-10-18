import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { errorResponse, requireSession } from "@/lib/http";
import { listProjects } from "@/lib/projects-store";
import { backupFilename, buildBackup } from "@/lib/backup";
import { buildWorkbook, excelFilename } from "@/lib/excel";
import { BadRequestError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/export?format=xlsx|json
 * Exports every saved project (regardless of search/filter selection) using
 * current PostgreSQL data. Responses are never cached.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSession(req);
    const format = (new URL(req.url).searchParams.get("format") ?? "json").toLowerCase();
    const projects = await listProjects();

    if (format === "xlsx") {
      const buffer = await buildWorkbook(projects);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${excelFilename()}"`,
          "Content-Length": String(buffer.byteLength),
          "Cache-Control": "no-store",
        },
      });
    }

    if (format === "json") {
      const backup = buildBackup(projects);
      const body = JSON.stringify(backup, null, 2);
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${backupFilename()}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    throw new BadRequestError(
      `Unsupported export format “${format}”. Use one of: xlsx, json.`
    );
  } catch (err) {
    return errorResponse(err);
  }
}
