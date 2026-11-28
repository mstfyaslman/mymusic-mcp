const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const LANGUAGE_CODES = {
  "العربية":"ar-EG", "English":"en-US", "Français":"fr-FR", "Español":"es-ES",
  "Deutsch":"de-DE", "Türkçe":"tr-TR", "Italiano":"it-IT", "Português":"pt-BR",
  "Русский":"ru-RU", "日本語":"ja-JP", "한국어":"ko-KR", "中文":"zh-CN",
  "हिन्दी":"hi-IN", "فارسی":"fa-IR"
};
const VOICES = new Set(["Kore","Puck","Charon","Fenrir","Aoede","Leda","Orus","Zephyr"]);

async function synthesize(apiKey, cue, languageCode, voiceName) {
  let lastError = null;
  for (const model of ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response, data = {};
      try {
        response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [{
                text: cue.text,
                speechMetadata: { style: "Natural, clear, expressive dubbed dialogue. Speak the supplied words verbatim; use conversational pacing and emotion appropriate to a movie scene." }
              }]
            }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                languageCode,
                voiceConfig: { prebuiltVoiceConfig: { voiceName } }
              }
            }
          })
        });
        data = await response.json().catch(() => ({}));
      } catch (error) {
        lastError = error;
        if (attempt === 0) { await sleep(700); continue; }
        break;
      }
      if (response.ok) {
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const audio = parts.find(part => part?.inlineData?.data);
        if (audio) return { audioBase64: audio.inlineData.data, mimeType: audio.inlineData.mimeType || "audio/wav" };
        lastError = new Error("أعاد نموذج الصوت نتيجة بلا ملف صوتي.");
        break;
      }
      lastError = Object.assign(new Error(data?.error?.message || "تعذر إنشاء الصوت بالدبلجة."), { status: response.status });
      if ([400, 404].includes(response.status)) break;
      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
      if (attempt === 0) await sleep(900);
    }
  }
  throw lastError || new Error("نموذج الدبلجة غير متاح لهذا المشروع.");
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "Allow": "POST, OPTIONS" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "مفتاح GEMINI_API_KEY غير مضبوط كـ Secret في Cloudflare Pages Production." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "بيانات طلب الدبلجة غير صحيحة." }, 400); }
  const cues = Array.isArray(body?.cues) ? body.cues : [];
  const language = String(body?.targetLanguage || "العربية").slice(0, 40);
  const voiceName = String(body?.voiceName || "Kore");
  const languageCode = LANGUAGE_CODES[language];
  if (!cues.length || cues.length > 4) return json({ error: "أرسل من مقطع إلى أربعة مقاطع ترجمة في كل دفعة." }, 400);
  if (!languageCode) return json({ error: "اللغة المطلوبة غير مدعومة حالياً للدبلجة." }, 400);
  if (!VOICES.has(voiceName)) return json({ error: "الصوت المختار غير صالح." }, 400);
  const clean = [];
  for (const cue of cues) {
    const text = String(cue?.text || "").trim();
    const startMs = Number(cue?.startMs), endMs = Number(cue?.endMs);
    if (!text || text.length > 900 || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
      return json({ error: "يوجد مقطع ترجمة فارغ أو بتوقيت غير صالح أو طويل جداً." }, 400);
    }
    clean.push({ text, startMs: Math.round(startMs), endMs: Math.round(endMs) });
  }
  try {
    const audio = [];
    for (const cue of clean) {
      const result = await synthesize(apiKey, cue, languageCode, voiceName);
      audio.push({ startMs: cue.startMs, endMs: cue.endMs, audioBase64: result.audioBase64, mimeType: result.mimeType });
    }
    return json({ audio, provider: "Google Gemini TTS", voiceName, languageCode });
  } catch (error) {
    return json({ error: String(error?.message || "تعذرت معالجة الدبلجة الصوتية.").slice(0, 600) }, error?.status === 429 ? 429 : 502);
  }
}
