const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const LANGUAGE_CODES = {
  "العربية":"ar-EG", "English":"en-US", "Français":"fr-FR", "Español":"es-ES",
  "Deutsch":"de-DE", "Türkçe":"tr-TR", "Italiano":"it-IT", "Português":"pt-BR",
  "Русский":"ru-RU", "日本語":"ja-JP", "한국어":"ko-KR", "中文":"cmn-CN",
  "हिन्दी":"hi-IN", "فارسی":"fa-IR"
};
const VOICES = new Set(["Kore","Puck","Charon","Fenrir","Aoede","Leda","Orus","Zephyr"]);

async function synthesize(apiKey, text, language, voice) {
  const models = ["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"];
  let lastMessage = "لم يُرجع نموذج الصوت ملفاً صوتياً.";
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Speak the following translated movie dialogue naturally and clearly in " + language + ". Use a consistent dubbing voice, natural conversational pacing, and expressive delivery appropriate to the scene. Speak only the supplied dialogue, without adding explanations or introductions:\n" + text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              languageCode: LANGUAGE_CODES[language] || "ar-EG",
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
            }
          }
        })
      });
      const data = await response.json().catch(() => ({}));
      const audio = (data.candidates?.[0]?.content?.parts || []).find(part => part.inlineData?.data);
      if (response.ok && audio?.inlineData?.data) {
        return { data: audio.inlineData.data, mimeType: audio.inlineData.mimeType || "audio/wav" };
      }
      lastMessage = data.error?.message || "فشل توليد الصوت من Gemini (" + response.status + ").";
      if ([429,500,502,503,504].includes(response.status) && attempt === 0) {
        await sleep(900);
        continue;
      }
      if ([400,404].includes(response.status)) break;
      if (![429,500,502,503,504].includes(response.status)) throw new Error(lastMessage);
    }
  }
  throw new Error(lastMessage);
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "Allow": "POST, OPTIONS" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "مفتاح Gemini غير مضبوط كـ Secret في Cloudflare." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "صيغة الطلب غير صحيحة." }, 400); }
  const cues = Array.isArray(body?.cues) ? body.cues : [];
  const language = String(body?.targetLanguage || "العربية").slice(0, 40);
  const voice = VOICES.has(body?.voiceName) ? body.voiceName : "Kore";
  if (!cues.length || cues.length > 4) return json({ error: "أرسل من مقطع إلى 4 مقاطع ترجمة في كل دفعة." }, 400);
  if (!LANGUAGE_CODES[language]) return json({ error: "اللغة المطلوبة غير مدعومة حالياً للدبلجة." }, 400);
  for (const cue of cues) {
    if (!Number.isFinite(cue?.startMs) || !Number.isFinite(cue?.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs ||
        typeof cue?.text !== "string" || !cue.text.trim() || cue.text.length > 900) {
      return json({ error: "بيانات أحد مقاطع الترجمة غير صحيحة أو طويلة جداً." }, 400);
    }
  }
  try {
    const audio = [];
    for (const cue of cues) {
      const result = await synthesize(apiKey, cue.text.trim(), language, voice);
      audio.push({ startMs: cue.startMs, endMs: cue.endMs, text: cue.text, mimeType: result.mimeType, audioBase64: result.data });
    }
    return json({ audio, voice, targetLanguage: language, provider: "Gemini TTS" });
  } catch (error) {
    return json({ error: String(error?.message || "تعذر إنشاء الدبلجة الصوتية.").slice(0, 600) }, 502);
  }
}
