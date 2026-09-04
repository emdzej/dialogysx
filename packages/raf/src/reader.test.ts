import { describe, expect, it } from "vitest";
import { HttpRangeReader, NotDataError } from "./reader.js";

/** A `fetch` that answers every request with one canned response. */
function fakeFetch(status: number, headers: Record<string, string>, body = new Uint8Array(0)) {
  const calls: { url: string; init?: { method?: string } }[] = [];
  // `RequestInfo` is a DOM type and this package builds against Node libs
  // only, so the parameter is typed by what it is actually given.
  const impl = (async (input: unknown, init?: { method?: string }) => {
    calls.push({ url: String(input), init });
    return new Response(status === 204 ? null : body, { status, headers });
  }) as typeof fetch;
  return { impl, calls };
}

describe("HttpRangeReader", () => {
  it("reads its size from content-length", async () => {
    const { impl, calls } = fakeFetch(200, {
      "content-type": "application/octet-stream",
      "content-length": "4096",
    });
    const reader = new HttpRangeReader("https://example.test/pr/PlancheN.idx", impl);
    expect(await reader.size()).toBe(4096);
    // Cached: a second call must not cost another round trip.
    expect(await reader.size()).toBe(4096);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.method).toBe("HEAD");
  });

  it("rejects a web page served where data was expected", async () => {
    // A single-page app answers *any* unknown path with its own HTML and a 200,
    // so a mistyped base URL looks like a file that exists. Parsed as an index
    // that produced "Offset is outside the bounds of the DataView" instead of
    // "that is not a data tree".
    const { impl } = fakeFetch(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": "365",
    });
    const reader = new HttpRangeReader("https://example.test/nope/pr/PlancheN.idx", impl);
    await expect(reader.size()).rejects.toThrow(NotDataError);
    // The URL has to be in the message; "not a data tree" without saying which
    // tree is not actionable.
    await expect(reader.size()).rejects.toThrow(/nope/);
  });

  it("refuses a host that ignores Range instead of reading the wrong bytes", async () => {
    const { impl } = fakeFetch(
      200,
      { "content-type": "application/octet-stream" },
      new Uint8Array([1, 2, 3]),
    );
    const reader = new HttpRangeReader("https://example.test/pr/PlancheN", impl);
    await expect(reader.read(10, 3)).rejects.toThrow(/ignoring Range/);
  });

  it("treats a missing file as an error, not as an empty one", async () => {
    const { impl } = fakeFetch(404, {});
    const reader = new HttpRangeReader("https://example.test/pr/Absent", impl);
    await expect(reader.size()).rejects.toThrow(/404/);
  });
});
