const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const SYSTEM_PROMPT = "أنت مساعد MyMusic الذكي. أجب باللغة العربية الواضحة ما لم يطلب المستخدم لغة أخرى. كن دقيقًا ومفيدًا، وصرّح عندما لا تعرف الإجابة. لا تدّعِ تنفيذ إجراءات خارجية.";

async function generateWithFallback(apiKey, prompt) {
  // Flash-Lite is optimized for translation and low-latency text tasks.
  // Fall back to Flash if the primary model is temporarily overloaded.
  const models = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.5-flash"];
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
              generationConfig: { temperature: 0.6, maxOutputTokens: 1200 }
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
      lastError = Object.assign(new Error(message), { status });

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
  if (!prompt || prompt.length > 5000) {
    return new Response(JSON.stringify({ error: "اكتب سؤالًا لا يتجاوز 5000 حرف." }), {
      status: 400,
      headers: JSON_HEADERS
    });
  }

  try {
    const text = await generateWithFallback(apiKey, prompt);
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: JSON_HEADERS
    });
  } catch (error) {
    const status = error?.status === 429 ? 429 : 502;
    const message = error?.status === 503 || /high demand|overload|temporarily unavailable/i.test(error?.message || "")
      ? "خدمة Gemini مزدحمة حاليًا. جرّب مرة أخرى بعد قليل؛ حاول MyMusic تلقائيًا استخدام نموذج بديل."
      : String(error?.message || "تعذر الاتصال بخدمة Gemini. حاول مرة أخرى.").slice(0, 500);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: JSON_HEADERS
    });
  }
}
