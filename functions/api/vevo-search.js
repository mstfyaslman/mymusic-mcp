const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "Allow": "GET, OPTIONS" } });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const apiKey = env.YOUTUBE_API_KEY;
  if (!apiKey) return json({ error: "ميزة البحث عن فيديوهات VEVO تحتاج إضافة YOUTUBE_API_KEY كـ Secret في Cloudflare Pages → Settings → Variables and Secrets. تشغيل الفيديوهات المضمّنة والترجمة الحالية لا يحتاجان وضع المفتاح في المتصفح." }, 503);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
  if (!q) return json({ error: "اكتب اسم أغنية أو فنان للبحث." }, 400);
  try {
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
    endpoint.search = new URLSearchParams({
      part: "snippet", type: "video", videoEmbeddable: "true",
      safeSearch: "moderate", maxResults: "25",
      q: q + " VEVO", key: apiKey
    }).toString();
    const response = await fetch(endpoint.toString(), { headers: { "Accept": "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: data?.error?.message || "تعذر البحث في YouTube. تحقق من تفعيل YouTube Data API v3 والمفتاح." }, response.status === 403 ? 503 : 502);
    const items = (data.items || [])
      .filter(item => {
        const channel = String(item?.snippet?.channelTitle || "");
        return /vevo/i.test(channel) && /^[A-Za-z0-9_-]{11}$/.test(item?.id?.videoId || "");
      })
      .slice(0, 12)
      .map(item => ({
        id: item.id.videoId,
        title: String(item.snippet?.title || "").slice(0, 250),
        channel: String(item.snippet?.channelTitle || "VEVO").slice(0, 100),
        thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ""
      }));
    return json({
      items,
      message: items.length ? undefined : "لم تظهر نتائج من قنوات VEVO الرسمية لهذا البحث. جرّب اسم الفنان باللغة الإنجليزية."
    });
  } catch (error) {
    return json({ error: String(error?.message || "حدث خطأ أثناء البحث.").slice(0, 300) }, 502);
  }
}
