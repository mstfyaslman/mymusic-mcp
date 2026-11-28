const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function timestampMs(value) {
  const m = /^(\d{2,}):(\d{2}):(\d{2})[,\.](\d{3})$/.exec(value);
  if (!m || +m[2] > 59 || +m[3] > 59) return null;
  return (((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000) + +m[4];
}
function timestampText(ms) {
  const n = Math.max(0, Math.round(ms));
  const h = Math.floor(n / 3600000), m = Math.floor(n / 60000) % 60;
  const s = Math.floor(n / 1000) % 60, milli = n % 1000;
  return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+","+String(milli).padStart(3,"0");
}
function normalizeSrt(raw, offsetMs, endMs) {
  const cleaned = String(raw || "").replace(/```(?:srt)?/gi, "").replace(/\r/g,"").trim();
  const blocks = cleaned.split(/\n\s*\n/).filter(Boolean), out = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const ti = lines.findIndex(line => /\d{2,}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2,}:\d{2}:\d{2}[,\.]\d{3}/.test(line));
    if (ti < 0) continue;
    const m = /(\d{2,}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,\.]\d{3})/.exec(lines[ti]);
    if (!m) continue;
    let start = timestampMs(m[1].replace(".",",")), end = timestampMs(m[2].replace(".",","));
    if (start === null || end === null || end <= start) continue;
    // If Gemini returned segment-relative timestamps, shift them to the original media timeline.
    if (offsetMs > 0 && start < offsetMs - 30000) { start += offsetMs; end += offsetMs; }
    if (start >= endMs + 30000 || end <= offsetMs - 30000) continue;
    const text = lines.slice(ti+1).join("\n").trim();
    if (!text) continue;
    out.push({ start, end, text });
  }
  out.sort((a,b)=>a.start-b.start);
  return out.map((cue,i)=>(i+1)+"\n"+timestampText(cue.start)+" --> "+timestampText(cue.end)+"\n"+cue.text).join("\n\n");
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "Allow": "POST, OPTIONS" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "مفتاح Gemini غير مضبوط كـ Secret في Cloudflare." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "صيغة الطلب غير صحيحة." }, 400); }
  const fileUri = String(body?.fileUri || "");
  const mimeType = String(body?.mimeType || "");
  const startSeconds = Number(body?.startSeconds), endSeconds = Number(body?.endSeconds);
  if (!/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/files\/[A-Za-z0-9_-]+$/.test(fileUri)) return json({ error: "مرجع ملف Gemini غير صالح." }, 400);
  if (!/^(audio|video)\//.test(mimeType)) return json({ error: "نوع الملف غير صالح." }, 400);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds > 900) return json({ error: "يجب أن يكون الجزء بين ثانية واحدة و15 دقيقة." }, 400);
  const startLabel = timestampText(startSeconds * 1000), endLabel = timestampText(endSeconds * 1000);
  const prompt = [
    "Transcribe every audible spoken word and sung lyric in the original language from the supplied media.",
    "IMPORTANT: Only transcribe the interval from " + startLabel + " through " + endLabel + " on the ORIGINAL FULL FILE timeline. Ignore all speech outside this exact interval.",
    "Return valid SubRip SRT only. Timestamps MUST be absolute timestamps on the original full-file timeline, not timestamps relative to this segment.",
    "Use HH:MM:SS,mmm --> HH:MM:SS,mmm timestamps, preserve the original spoken language, do not translate, summarize, omit audible words, or invent dialogue.",
    "Keep cues short and preserve speaker labels when clearly distinguishable. If no words are audible in this interval, return exactly NO_SPEECH."
  ].join(" ");
  let lastError = null;
  for (const model of ["gemini-3.5-transcribe", "gemini-3.6-flash", "gemini-3.5-flash-lite"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response, data = {};
      try {
        response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ fileData: { mimeType, fileUri } }, { text: prompt }] }],
            generationConfig: { maxOutputTokens: 8192 }
          })
        });
        data = await response.json().catch(() => ({}));
      } catch (error) {
        lastError = error;
        if (attempt === 0) { await sleep(900); continue; }
        break;
      }
      if (response.ok) {
        const raw = (data?.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("").trim();
        if (!raw) {
          lastError = new Error("أعاد Gemini نتيجة فارغة للجزء " + startLabel + "–" + endLabel + ". أعد المحاولة.");
          break;
        }
        if (raw === "NO_SPEECH") return json({ text: "", startSeconds, endSeconds, noSpeech: true, model });
        const text = normalizeSrt(raw, startSeconds * 1000, endSeconds * 1000);
        if (!text) {
          lastError = new Error("لم يُرجع Gemini توقيتات SRT صالحة للجزء " + startLabel + "–" + endLabel + ".");
          break;
        }
        return json({ text, startSeconds, endSeconds, cueCount: text.split(/\n\s*\n/).length, model });
      }
      const message = data?.error?.message || "تعذر تحليل هذا الجزء من الملف.";
      lastError = Object.assign(new Error(message), { status: response.status });
      if ([400,404].includes(response.status)) break;
      if (![429,500,502,503,504].includes(response.status)) return json({ error: message.slice(0,500) }, 502);
      if (attempt === 0) await sleep(1000);
    }
    if (lastError?.status && ![400,404,429,500,502,503,504].includes(lastError.status)) break;
  }
  return json({ error: String(lastError?.message || "تعذر استخراج الترجمة لهذا الجزء.").slice(0,600) }, lastError?.status === 429 ? 429 : 502);
}
