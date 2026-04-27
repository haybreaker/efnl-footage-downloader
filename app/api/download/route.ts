import { NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { promisify } from "util";
import crypto from "crypto";

const execAsync = promisify(exec);
const BASE = "https://footagehub.lklmmedia.com";
const tmpDir = os.tmpdir();

function parseM3u8ForSegments(m3u8Text: string, baseUrl: string) {
  const lines = m3u8Text.split("\n");
  const segments: string[] = [];
  for (let line of lines) {
    line = line.trim();
    if (line && !line.startsWith("#")) {
      const segmentUrl = line.startsWith("http")
        ? line
        : new URL(line, baseUrl).href;
      segments.push(segmentUrl);
    }
  }
  return segments;
}

function getMediaPlaylistUrl(m3u8Text: string, baseUrl: string) {
  if (m3u8Text.includes("#EXT-X-STREAM-INF")) {
    const lines = m3u8Text.split("\n");
    let nextLineIsMedia = false;
    for (let line of lines) {
      line = line.trim();
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        nextLineIsMedia = true;
      } else if (nextLineIsMedia && line && !line.startsWith("#")) {
        return line.startsWith("http") ? line : new URL(line, baseUrl).href;
      }
    }
  }
  return baseUrl;
}

export async function POST(req: Request) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url } = body;
  if (!url) {
    return NextResponse.json({ error: "Missing URL" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const customReadable = new ReadableStream({
    async start(controller) {
      const sendUpdate = (msg: any) => {
        controller.enqueue(encoder.encode(JSON.stringify(msg) + "\n"));
      };

      try {
        sendUpdate({ type: "info", progress: 1, message: "Fetching footage page..." });

        const headers = {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-AU,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
          "X-Forwarded-For": "1.128.0.1",
          "X-Real-IP": "1.128.0.1"
        };
        const matchHtmlResponse = await fetch(url, { headers });
        if (!matchHtmlResponse.ok) {
          throw new Error(`Failed to fetch match page: ${matchHtmlResponse.status} ${matchHtmlResponse.statusText}`);
        }
        const matchHtml = await matchHtmlResponse.text();

        const titleMatch = matchHtml.match(/<h1>(.*?)<\/h1>/);
        const title = titleMatch
          ? titleMatch[1].replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "")
          : "match_" + crypto.randomBytes(4).toString("hex");

        const links = [...matchHtml.matchAll(/\/play\/[a-z0-9\-]+/g)]
          .map((m) => m[0])
          .filter((v, i, a) => a.indexOf(v) === i);

        if (links.length === 0) {
          throw new Error("No play links found on the page");
        }

        sendUpdate({
          type: "info",
          progress: 5,
          message: `Found ${links.length} quarters/streams.`,
        });

        const jobDir = path.join(tmpDir, `job_${crypto.randomUUID()}`);
        fs.mkdirSync(jobDir, { recursive: true });

        sendUpdate({ type: "info", progress: 8, message: "Extracting M3U8 Playlists..." });
        
        let allSegments: { url: string; dest: string }[] = [];
        
        // Ensure quarters are kept in order via their segment lists
        const quarterSegmentsLists: { url: string; dest: string }[][] = [];

        for (let q = 0; q < links.length; q++) {
          const playRelLink = links[q];
          const playUrl = BASE + playRelLink;
          const htmlResponse = await fetch(playUrl, { headers });
          const html = await htmlResponse.text();

          const rel = html.match(/src="([^"]+\.m3u8[^"]*)"/)?.[1];
          if (!rel) throw new Error(`Missing m3u8 in ${playUrl}`);

          const m3u8Url = rel.startsWith("//")
            ? "https:" + rel
            : rel.startsWith("http")
            ? rel
            : BASE + rel;

          sendUpdate({ type: "info", progress: 10 + q, message: `Parsing Media Playlist Q${q + 1}...` });
          const m3u8Res = await fetch(m3u8Url, { headers });
          let m3u8Text = await m3u8Res.text();

          let mediaPlaylistUrl = m3u8Url;
          if (m3u8Text.includes("#EXT-X-STREAM-INF")) {
            mediaPlaylistUrl = getMediaPlaylistUrl(m3u8Text, m3u8Url);
            const mediaRes = await fetch(mediaPlaylistUrl, { headers });
            m3u8Text = await mediaRes.text();
          }

          const segments = parseM3u8ForSegments(m3u8Text, mediaPlaylistUrl);
          if (segments.length === 0) {
            throw new Error(`No TS segments found in Q${q + 1}`);
          }

          const qSegments = segments.map((segUrl, i) => ({
            url: segUrl,
            dest: path.join(jobDir, `q${q + 1}_${i}.ts`),
          }));

          quarterSegmentsLists.push(qSegments);
          allSegments.push(...qSegments);
        }

        const totalSegments = allSegments.length;
        let downloadedSegments = 0;

        sendUpdate({
          type: "info",
          progress: 15,
          message: `Starting deep parallel segment fetch (${totalSegments} chunks)...`,
        });

        // Concurrency Limiter
        const maxConcurrency = 10;
        const executing = new Set<Promise<void>>();

        for (const segment of allSegments) {
          const task = async () => {
            let retries = 3;
            while (retries > 0) {
              try {
                const res = await fetch(segment.url, { headers });
                if (!res.ok) throw new Error(`Status ${res.status}`);
                const buffer = await res.arrayBuffer();
                fs.writeFileSync(segment.dest, Buffer.from(buffer));
                break;
              } catch (e: any) {
                retries--;
                if (retries === 0) {
                  throw new Error(`Failed to download TS chunk: ${segment.url}. Error: ${e.message}`);
                }
                await new Promise((r) => setTimeout(r, 1000));
              }
            }
            
            downloadedSegments++;
            
            // Re-calculate progress (scaling between 15% to 90% for pure downloading phase)
            const chunkProgress = (downloadedSegments / totalSegments) * 75;
            const currentTotalProgress = Math.floor(15 + chunkProgress);
            
            sendUpdate({
              type: "info",
              progress: currentTotalProgress,
              message: `Downloading video fragments... [${downloadedSegments}/${totalSegments}]`,
            });
          };

          const p = Promise.resolve().then(() => task());
          executing.add(p);
          const clean = () => executing.delete(p);
          p.then(clean).catch(clean);

          if (executing.size >= maxConcurrency) {
            await Promise.race(executing);
          }
        }

        await Promise.all(executing);

        sendUpdate({
          type: "info",
          progress: 92,
          message: "Segments complete. Offloading offline merge to FFmpeg...",
        });

        // Now orchestrate offline concat
        const concatPath = path.join(jobDir, "concat.txt");
        const concatContent = quarterSegmentsLists
          .flat()
          .map((seg) => `file '${path.basename(seg.dest)}'`)
          .join("\n");
        fs.writeFileSync(concatPath, concatContent);

        const finalFilename = `${title}.mp4`;
        const finalFilePath = path.join(jobDir, finalFilename);

        await execAsync(
          `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -c copy "${finalFilePath}"`
        );

        sendUpdate({
          type: "success",
          progress: 100,
          message: "Video compiled successfully!",
          file: `${path.basename(jobDir)}/${finalFilename}`,
        });
        
        controller.close();
      } catch (error: any) {
        console.error("Error:", error);
        sendUpdate({
          type: "error",
          progress: 0,
          message: error.message || String(error),
        });
        controller.close();
      }
    },
  });

  return new Response(customReadable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
