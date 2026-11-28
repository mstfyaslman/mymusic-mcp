const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const meta = Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_REDIRECT_URI && env.SOCIAL_KV);
  return json({
    checkedAt: new Date().toISOString(),
    gemini: Boolean(env.GEMINI_API_KEY),
    youtube: Boolean(env.YOUTUBE_API_KEY),
    meta,
    memberProfile: "local",
    authentication: false,
    payments: false
  });
}
