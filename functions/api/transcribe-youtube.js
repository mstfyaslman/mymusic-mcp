const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeYouTubeUrl(raw) {
  let url;
  try { url = new URL(String(raw || "").trim()); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  let id = "";
  if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
    else {
      const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
      if (match) id = match[1];
    }
  } else return null;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return "https://www.youtube.com/watch?v=" + id;
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "Allow": "POST, OPTIONS" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "مفتاح Gemini غير مضبوط كـ Secret مشفّر في Cloudflare." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "صيغة الطلب غير صحيحة." }, 400); }
  const videoUrl = normalizeYouTubeUrl(body?.url);
  if (!videoUrl) return json({ error: "أدخل رابط YouTube صحيحًا لفيديو عام أو غير مدرج." }, 400);

  const prompt = [
    "Analyze the supplied YouTube video, listening to its audio and using the visual stream only when needed for context.",
    "Transcribe all audible spoken dialogue and sung lyrics in the original language.",
    "Return valid SubRip SRT subtitles with accurate timestamps in HH:MM:SS,mmm --> HH:MM:SS,mmm format.",
    "Keep each cue concise, preserve speaker labels when clear, and do not invent or summarize words.",
    "Do not translate. Return only SRT content. If no audible words exist, return exactly: NO_SPEECH"
  ].join(" ");

  let lastError = null;
  for (const model of ["gemini-3.5-flash-lite", "gemini-3.8-flash"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response, data = {};
      try {
        response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { fileData: { mimeType: "video/*", fileUri: videoUrl } },
                { text: prompt }
              ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
          })
        });
        data = await response.json().catch(() => ({}));
      } catch (error) {
        lastError = error;
        if (attempt === 0) { await sleep(900); continue; }
        break;
      }

      if (response.ok) {
        const text = (data?.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("").trim();
        if (!text) return json({ error: "لم يُرجع Gemini نصًا من الفيديو. قد يكون الفيديو غير متاح أو بلا كلام." }, 502);
        return json({ text, videoUrl, provider: "Gemini" });
      }

      lastError = new Error(data?.error?.message || "تعذر تحليل فيديو YouTube.");
      lastError.status = response.status;
      if ([400, 404].includes(response.status)) break;
      if (![429, 500, 502, 503, 504].includes(response.status)) {
        return json({ error: lastError.message }, 502);
      }
      if (attempt === 0) await sleep(1000);
    }
  }

  const overloaded = lastError?.status === 429 || lastError?.status === 503;
  return json({
    error: overloaded
      ? "Gemini مزدحم حاليًا ولم يتمكن من تحليل الفيديو. حاول مرة أخرى لاحقًا."
      : String(lastError?.message || "تعذر الاتصال بـ Gemini لتحليل الفيديو.").slice(0, 500)
  }, overloaded ? 429 : 502);
}
