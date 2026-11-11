/** JSON response with explicit caching. `cdnSeconds` caches on Vercel's CDN only; browsers always revalidate. */
export function json(body: unknown, status: number, cdnSeconds = 0, staleSeconds = 0): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  if (cdnSeconds > 0) {
    headers["Cache-Control"] = "public, max-age=0, must-revalidate";
    headers["Vercel-CDN-Cache-Control"] = `max-age=${cdnSeconds}` + (staleSeconds > 0 ? `, stale-while-revalidate=${staleSeconds}` : "");
  } else {
    headers["Cache-Control"] = "no-store";
  }
  return new Response(JSON.stringify(body), { status, headers });
}
