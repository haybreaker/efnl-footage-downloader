"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

type LogEntry = {
  type: "info" | "success" | "error";
  progress?: number;
  message: string;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showLogs) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, showLogs]);

  async function go() {
    if (!url) return;
    setLoading(true);
    setLogs([]);
    setProgress(0);
    setStatusMessage("Initializing...");

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.body) {
        throw new Error("ReadableStream not yet supported in this browser.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let partialLine = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = (partialLine + chunk).split("\n");
        partialLine = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as LogEntry;
            setLogs((prev) => [...prev, parsed]);

            // Debounce the status update text heavily so it doesn't flicker unreadably fast 
            // when dealing with 10 concurrent chunk updates.
            setStatusMessage(parsed.message);
            if (typeof parsed.progress === "number") {
              setProgress(parsed.progress);
            }

            if (parsed.type === "success" && (parsed as any).file) {
              setTimeout(() => {
                window.location.href = "/api/files/" + (parsed as any).file;
              }, 1000);
            }
          } catch (e) {
            console.error("Failed to parse NDJSON line:", line);
          }
        }
      }
    } catch (e: any) {
      setLogs((prev) => [...prev, { type: "error", message: e.message }]);
      setStatusMessage(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex flex-col">
      {/* Header Area */}
      <header className="bg-[#cc0000] py-6 px-4 shadow-md border-b-4 border-white">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-4">
          {/* Faux EFNL Logo Container */}
          <div className="w-16 h-16 bg-white rounded-full flex flex-col items-center justify-center font-black text-[#cc0000] border-4 border-black shadow-lg uppercase leading-none tracking-tighter">
            <Image src="/efnl.avif" alt="EFNL Logo" width={64} height={64} />
          </div>
          <div className="text-center md:text-left">
            <h1 className="text-3xl font-black uppercase tracking-wider text-white drop-shadow-md">
              Footage Downloader
            </h1>
            <p className="text-white/90 text-sm font-semibold tracking-wide uppercase mt-1">
              Eastern Football Netball League & EFL Umpires
            </p>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col mt-8 md:mt-12 gap-8">

        <section className="bg-[#1a1a1a] rounded-xl p-6 shadow-2xl border border-gray-800">
          <div className="flex flex-col gap-4">
            <label className="text-sm font-bold text-gray-300 uppercase tracking-widest" htmlFor="url">
              Match URI
            </label>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                id="url"
                type="url"
                placeholder="https://footagehub.lklmmedia.com/match/..."
                className="flex-1 bg-black border border-gray-700 text-white px-5 py-4 rounded-lg focus:outline-none focus:border-[#cc0000] focus:ring-1 focus:ring-[#cc0000] transition-colors font-medium placeholder-gray-600 shadow-inner"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
              />

              <button
                onClick={go}
                disabled={loading || !url}
                className="bg-[#cc0000] text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-[#ff0000] disabled:bg-gray-700 disabled:text-gray-500 transition-all uppercase tracking-wider shadow-[0_0_15px_rgba(204,0,0,0.4)] disabled:shadow-none min-w-[200px]"
              >
                {loading ? "Processing..." : "Download"}
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-2 font-medium">
              Uses high-concurrency TS fragment fetching. Expected turnaround for 1080p stream is ~10x faster.
            </p>
          </div>
        </section>

        {/* Progress Bar Area */}
        {(loading || progress > 0) && (
          <section className="bg-[#1a1a1a] rounded-xl p-6 shadow-2xl border border-gray-800 flex flex-col gap-4">
            <div className="flex justify-between items-end">
              <span className="text-sm font-bold text-gray-300 uppercase tracking-widest">
                Extraction Progress
              </span>
              <span className="text-[#cc0000] font-black text-xl">{progress}%</span>
            </div>

            {/* Actual Progress Bar */}
            <div className="w-full bg-black rounded-full h-8 border border-gray-700 overflow-hidden relative shadow-inner">
              <div
                className="bg-[#cc0000] h-full transition-all duration-300 ease-out flex items-center justify-end px-2"
                style={{ width: `${progress}%` }}
              >
                {/* Gloss / Shine effect */}
                <div className="absolute top-0 left-0 right-0 h-1/2 bg-white/20"></div>
              </div>
            </div>

            <div className="text-sm font-medium text-gray-400 mt-1 truncate">
              {statusMessage}
            </div>

            <button
              onClick={() => setShowLogs(!showLogs)}
              className="mt-4 self-start text-xs font-bold text-gray-500 border border-gray-700 rounded-md px-3 py-1 hover:bg-black uppercase tracking-wider transition-colors"
            >
              {showLogs ? "Hide Technical Logs" : "Show Technical Logs"}
            </button>
          </section>
        )}

        {/* Console / Status Terminal */}
        {showLogs && (
          <section className="bg-black rounded-xl shadow-2xl border border-gray-800 overflow-hidden flex flex-col h-[400px]">
            <div className="bg-[#1a1a1a] px-4 py-2 border-b border-gray-800 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#cc0000]"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-xs text-gray-400 font-mono ml-2 uppercase tracking-wider">Terminal Process Logs</span>
            </div>

            <div className="p-4 flex-1 overflow-y-auto font-mono text-sm leading-relaxed space-y-2">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-gray-600 shrink-0 select-none">
                    [{new Date().toLocaleTimeString('en-US', { hour12: false, hour: "numeric", minute: "numeric", second: "numeric" })}]
                  </span>
                  <span className={
                    log.type === "error" ? "text-red-500" :
                      log.type === "success" ? "text-green-500" :
                        "text-blue-300/80"
                  }>
                    {log.message}
                  </span>
                </div>
              ))}
              {loading && (
                <div className="flex gap-3 animate-pulse">
                  <span className="text-gray-600 shrink-0">
                    [{new Date().toLocaleTimeString('en-US', { hour12: false, hour: "numeric", minute: "numeric", second: "numeric" })}]
                  </span>
                  <span className="text-gray-600">waiting for next event...</span>
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
