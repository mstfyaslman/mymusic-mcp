const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

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
    const upstream = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "أنت مساعد MyMusic الذكي. أجب باللغة العربية الواضحة ما لم يطلب المستخدم لغة أخرى. كن دقيقًا ومفيدًا، وصرّح عندما لا تعرف الإجابة. لا تدّعِ تنفيذ إجراءات خارجية."
            }]
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 1200
          }
        })
      }
    );

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = result?.error?.message || "تعذر على Gemini معالجة الطلب.";
      return new Response(JSON.stringify({ error: message }), {
        status: upstream.status === 429 ? 429 : 502,
        headers: JSON_HEADERS
      });
    }

    const text = (result?.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("")
      .trim();

    if (!text) {
      return new Response(JSON.stringify({ error: "لم يُرجع Gemini إجابة نصية." }), {
        status: 502,
        headers: JSON_HEADERS
      });
    }

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: JSON_HEADERS
    });
  } catch {
    return new Response(JSON.stringify({ error: "تعذر الاتصال بخدمة Gemini. حاول مرة أخرى." }), {
      status: 502,
      headers: JSON_HEADERS
    });
  }
}
