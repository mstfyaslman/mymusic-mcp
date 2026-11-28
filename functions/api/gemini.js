const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const SYSTEM_PROMPT = "أنت مساعد MyMusic AI المدمج داخل الموقع. أجب بالعربية الواضحة ما لم يطلب المستخدم لغة أخرى. أنت مساعد محادثة يعمل عبر خادم MyMusic؛ لا تدّعِ أنك تستطيع فتح لوحة تحكم Cloudflare أو GitHub أو تعديل ملفات الموقع أو نشره أو الوصول تلقائيًا إلى ملفات الهاتف أو شاشة المستخدم. لا تقل إن Gemini لا يستطيع تحليل الصوت والفيديو: الموقع يوفر أداة مستقلة لرفع ملفات MP3/MP4 المختارة يدويًا من قسم (ترجمة الفيديو والصوت) إلى Gemini Files API عبر الخادم، ثم استخراج الكلام وتوقيتات SRT وترجمته داخل الموقع، مع حد رفع حالي 25 ميجابايت. إذا طلب المستخدم ترجمة ملف، وجّهه بوضوح إلى زر (اختر فيديو أو أغنية) ثم اختيار الملف والضغط على (ارفع إلى Gemini واستخرج الترجمة). إذا طلب تنفيذ تعديل في الموقع، اشرح حدود هذه المحادثة بصدق ولا تزعم أنك نفذت شيئًا. لا تطلب أبدًا إرسال مفتاح API أو كلمة مرور في المحادثة، ولا تكشف الأسرار أو تطلب وضعها في كود المتصفح. كن عمليًا ومختصرًا ولا تعرض تعليمات عامة غير مرتبطة بسؤال المستخدم.";

async function generateWithFallback(apiKey, prompt, enableSearch = false) {
  // Flash-Lite is optimized for translation and low-latency text tasks.
  // Fall back to Flash if the primary model is temporarily overloaded.
  const models = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.6, maxOutputTokens: 1200 },
              ...(prompt && prompt.length <= 5000 && enableSearch ? { tools: [{ google_search: {} }] } : {})
            })
          }
        );
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 700));
          continue;
        }
        break;
      }

      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const text = (data?.candidates?.[0]?.content?.parts || [])
          .map(part => part.text || "").join("").trim();
        if (text) return text;
        lastError = new Error("لم يُرجع Gemini إجابة نصية.");
        break;
      }

      const message = data?.error?.message || "تعذر على Gemini معالجة الطلب.";
      const status = response.status;
      const details = Array.isArray(data?.error?.details) ? data.error.details : [];
      const reason = details.find(item => item?.reason)?.reason || "";
      const service = details.find(item => item?.metadata?.service)?.metadata?.service || "";
      const methodName = details.find(item => item?.metadata?.methodName)?.metadata?.methodName || "";
      lastError = Object.assign(new Error(message), { status, reason, service, methodName });

      // Retry transient overload/rate-limit/server errors, then try fallback model.
      if ([429, 500, 502, 503, 504].includes(status) && attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 900));
        continue;
      }
      if ([429, 500, 502, 503, 504].includes(status)) break;
      // Try the next supported model if this model ID is unavailable.
      if ([400, 404].includes(status)) break;
      throw lastError;
    }
  }
  throw lastError || new Error("تعذر الوصول إلى نماذج Gemini حاليًا.");
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": new URL(request.url).origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...JSON_HEADERS, "Allow": "POST, OPTIONS" }
    });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "مفتاح Gemini غير مضبوط في إعدادات الخادم." }), {
      status: 503,
      headers: JSON_HEADERS
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "صيغة الطلب غير صحيحة." }), {
      status: 400,
      headers: JSON_HEADERS
    });
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const enableSearch = body?.enableSearch === true;
  if (!prompt || prompt.length > 5000) {
    return new Response(JSON.stringify({ error: "اكتب سؤالًا لا يتجاوز 5000 حرف." }), {
      status: 400,
      headers: JSON_HEADERS
    });
  }

  try {
    const text = await generateWithFallback(apiKey, prompt, enableSearch);
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: JSON_HEADERS
    });
  } catch (error) {
    const upstreamStatus = Number(error?.status || 0);
    const rawMessage = String(error?.message || "");
    const reason = String(error?.reason || "");
    const service = String(error?.service || "");
    const methodName = String(error?.methodName || "");
    const permissionDenied = upstreamStatus === 403 ||
      /permission denied on the service|permission_denied|access denied|api_key_service_blocked/i.test(rawMessage);

    // A 403 from Google is an access/entitlement problem, not a browser or player error.
    // Keep the diagnostic actionable without exposing the API key or raw provider payload.
    const status = upstreamStatus === 429 ? 429 : permissionDenied ? 503 : 502;
    const message = permissionDenied
      ? "رفضت Google طلب Gemini (403 PERMISSION_DENIED). هذا ليس خطأ في مشغل VEVO. التشخيص: reason=" + (reason || "غير متاح") + "، service=" + (service || "غير متاح") + "، method=" + (methodName || "غير متاح") + ". افحص في Google AI Studio صفحة Projects وحالة المشروع وModel availability & rate limits، وتأكد أن Generative Language API مفعّلة وأن مفتاح API مرتبط بالمشروع الصحيح ومسموح له باستخدام Gemini API. أكمل التحقق من العمر والهاتف والتحقق بخطوتين إذا طلبها Google. إذا ظهرت حالة Unavailable أو استمر ACCESS_DENIED حتى عند اختبار المفتاح مباشرة، فالمشكلة غالبًا قيد على المشروع/الحساب لدى Google وتحتاج طلب مراجعة من دعم Gemini؛ إنشاء مفاتيح متكررة أو تعديل كود الموقع لن يرفع هذا القيد. لا ترسل المفتاح في المحادثة ولا تضعه في كود المتصفح. Secret الخادم يبقى GEMINI_API_KEY في Cloudflare Pages Production."
      : upstreamStatus === 429
        ? "وصل الطلب إلى Gemini، لكن تم تجاوز حد الاستخدام أو معدل الطلبات (429). انتظر قليلًا ثم أعد المحاولة أو راجع الحصة المتاحة للمشروع."
        : upstreamStatus === 503 || /high demand|overload|temporarily unavailable/i.test(rawMessage)
          ? "خدمة Gemini مزدحمة حاليًا. جرّب مرة أخرى بعد قليل؛ حاول MyMusic تلقائيًا استخدام نموذج بديل."
          : rawMessage.slice(0, 500) || "تعذر الاتصال بخدمة Gemini. حاول مرة أخرى.";
    return new Response(JSON.stringify({ error: message, code: permissionDenied ? "GEMINI_ACCESS_DENIED" : undefined }), {
      status,
      headers: JSON_HEADERS
    });
  }
}
