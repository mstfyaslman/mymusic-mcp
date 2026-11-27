const MODEL = "@cf/openai/whisper-large-v3-turbo";
const MAX_BYTES = 25 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "طلب غير مسموح." }, 403);
  }

  if (!env.AI || typeof env.AI.run !== "function") {
    return json({
      error: "خدمة تحويل الصوت غير مفعّلة بعد. أضف Workers AI binding باسم AI إلى مشروع MyMusic في Cloudflare ثم أعد النشر."
    }, 503);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "تعذر قراءة الملف المرفوع. أعد اختيار الملف وحاول مرة أخرى." }, 400);
  }

  const file = form.get("audio");
  if (!file || typeof file.arrayBuffer !== "function") {
    return json({ error: "لم يتم إرفاق ملف صوت أو فيديو." }, 400);
  }

  if (file.size === 0) {
    return json({ error: "الملف فارغ." }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: "الحد الأقصى لحجم الملف 25 ميجابايت." }, 413);
  }

  const contentType = String(file.type || "").toLowerCase();
  if (!contentType.startsWith("audio/") && !contentType.startsWith("video/")) {
    return json({ error: "نوع الملف غير مدعوم. اختر ملف صوت أو فيديو." }, 415);
  }

  const language = String(form.get("language") || "").trim().slice(0, 12);
  const validLanguage = /^[a-z]{2,3}$/i.test(language) ? language : undefined;

  try {
    const audio = new Uint8Array(await file.arrayBuffer());
    const result = await env.AI.run(MODEL, {
      audio,
      task: "transcribe",
      ...(validLanguage ? { language: validLanguage } : {})
    });

    const text = String(result?.text || result?.transcription_info?.text || "").trim();
    if (!text) {
      return json({ error: "لم يتم التعرف على كلام واضح. جرّب ملفاً أوضح أو مقطعاً أقصر." }, 422);
    }

    return json({
      text,
      vtt: typeof result?.vtt === "string" ? result.vtt : "",
      word_count: Number(result?.word_count || 0)
    }, 200);
  } catch (error) {
    console.error("MyMusic transcription failed:", error);
    return json({
      error: "فشل تحويل الصوت. قد يكون تنسيق الملف أو مدته غير مدعوم حالياً؛ جرّب MP3 أو WAV أو MP4 أو مقطعاً أقصر."
    }, 502);
  }
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Allow": "POST, OPTIONS" } });
  }
  return json({ error: "استخدم POST لإرسال ملف صوت أو فيديو." }, 405, { Allow: "POST, OPTIONS" });
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}
