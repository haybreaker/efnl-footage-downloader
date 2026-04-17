import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string; filename: string }> }
) {
  try {
    const resolvedParams = await params;
    const { jobId, filename } = resolvedParams;

    // Validate that someone isn't trying to traverse directories
    if (jobId.includes("..") || filename.includes("..")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, jobId, filename);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileStream = fs.createReadStream(filePath);

    // Using `as any` because the TS types for Response body expect a Web ReadableStream,
    // but Next.js/Node accepts generic Node readable streams as well in practice.
    return new Response(fileStream as any, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": stat.size.toString(),
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("Download Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
