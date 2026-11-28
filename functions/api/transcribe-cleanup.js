const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "Allow": "POST, OPTIONS" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.GEMINI_API_KEY) return json({ error: "مفتاح Gemini غير مضبوط في Cloudflare." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "صيغة الطلب غير صحيحة." }, 400); }
  const fileName = String(body?.fileName || "");
  if (!/^files\/[A-Za-z0-9_-]+$/.test(fileName)) return json({ error: "اسم ملف Gemini غير صالح." }, 400);
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/" + fileName + "?key=" + encodeURIComponent(env.GEMINI_API_KEY), { method: "DELETE" });
  if (!response.ok && response.status !== 404) return json({ error: "تعذر حذف الملف المؤقت من Gemini." }, 502);
  return json({ deleted: true });
}
