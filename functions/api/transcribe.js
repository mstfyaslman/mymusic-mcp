const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "Allow": "POST, OPTIONS" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "مفتاح Gemini غير مضبوط كـ Secret في Cloudflare." }, 503);
  let form;
  try { form = await request.formData(); } catch { return json({ error: "تعذر قراءة الملف المرفوع." }, 400); }
  const file = form.get("audio") || form.get("video") || form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "اختر ملف صوت أو فيديو أولاً." }, 400);
  if (!file.size) return json({ error: "الملف فارغ." }, 400);
  if (file.size > 90 * 1024 * 1024) return json({ error: "الحد الحالي 90 ميجابايت للملف. للملفات الأكبر استخرج الصوت بجودة مضغوطة أو قسّمه إلى أجزاء." }, 413);
  const mime = (file.type || "").toLowerCase();
  const supported = /^(audio\/(mpeg|mp3|wav|x-wav|ogg|flac|mp4|webm|aac|3gpp|x-m4a)|video\/(mp4|mpeg|quicktime|webm|x-msvideo|x-ms-wmv|x-flv|3gpp|x-m4v))$/;
  if (!supported.test(mime)) return json({ error: "صيغة غير مدعومة. استخدم MP4 أو MOV أو WebM أو MP3 أو WAV." }, 415);
  let uploadedName = "";
  let keepUploaded = false;
  try {
    const bytes = await file.arrayBuffer();
    const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: { "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(file.size), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" },
      body: JSON.stringify({ file: { displayName: String(file.name || "MyMusic upload").slice(0, 120) } })
    });
    if (!start.ok) throw new Error("Gemini رفض بدء رفع الملف: " + (await start.text()).slice(0, 400));
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) throw new Error("لم يُرجع Gemini رابط رفع الملف.");
    const uploaded = await fetch(uploadUrl, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: bytes });
    const uploadData = await uploaded.json().catch(() => ({}));
    if (!uploaded.ok || !uploadData.file?.name || !uploadData.file?.uri) throw new Error(uploadData.error?.message || "فشل رفع الملف إلى Gemini.");
    uploadedName = uploadData.file.name;
    let metadata = uploadData.file, state = metadata.state;
    for (let attempt = 0; state !== "ACTIVE" && attempt < 30; attempt++) {
      if (state === "FAILED") throw new Error("فشل Gemini في تجهيز ملف الفيديو أو الصوت.");
      await sleep(2000);
      const statusResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/" + uploadedName + "?key=" + encodeURIComponent(apiKey));
      const statusData = await statusResponse.json().catch(() => ({}));
      if (!statusResponse.ok) throw new Error(statusData.error?.message || "تعذر التحقق من تجهيز الملف.");
      metadata = statusData; state = metadata.state;
    }
    if (state !== "ACTIVE") throw new Error("استغرق تجهيز الملف وقتًا أطول من المتوقع. جرّب فيديو أقصر.");
    if (form.get("uploadOnly") === "1") {
      keepUploaded = true;
      return json({ fileUri: metadata.uri || uploadData.file.uri, fileName: uploadedName, mimeType: mime, fileSize: file.size, provider: "Gemini Files API" });
    }

    const prompt = mime.startsWith("video/")
      ? "Transcribe all audible speech and sung lyrics in the original language. Return valid SubRip SRT subtitles with timestamps for every cue (HH:MM:SS,mmm --> HH:MM:SS,mmm). Preserve speaker labels when clear. Include clearly readable on-screen text only when relevant, marked [ON-SCREEN]. Do not translate, summarize, or invent words. If no speech is audible, say so clearly."
      : "Transcribe all audible speech and sung lyrics in the original language. Return valid SubRip SRT subtitles with timestamps for every cue (HH:MM:SS,mmm --> HH:MM:SS,mmm). Preserve speaker labels when clear. Do not translate, summarize, or invent words. If no speech is audible, say so clearly.";
    let generated, result = {};
    for (const model of ["gemini-3.5-flash-lite", "gemini-3.8-flash"]) {
      for (let attempt = 0; attempt < 2; attempt++) {
        generated = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ fileData: { mimeType: mime, fileUri: metadata.uri || uploadData.file.uri } }, { text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 8192 } })
        });
        result = await generated.json().catch(() => ({}));
        if (generated.ok) break;
        if (![429, 500, 502, 503, 504].includes(generated.status)) break;
        if (attempt === 0) await sleep(900);
      }
      if (generated.ok) break;
      if ([400, 404].includes(generated.status)) continue;
      if (![429, 500, 502, 503, 504].includes(generated.status)) break;
    }
    const text = (result.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("").trim();
    if (!text) throw new Error("لم يُرجع Gemini نصًا من الملف.");
    const cleaned = text.replace(/```(?:srt)?/gi, "").trim().replace(/\r/g, "");
    const blocks = cleaned.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
    const cues = [];
    const stampMs = value => {
      const match = /^(\d{2,}):(\d{2}):(\d{2})[,\.](\d{3})$/.exec(value);
      if (!match) return null;
      const h=Number(match[1]), m=Number(match[2]), s=Number(match[3]), ms=Number(match[4]);
      if (m>59 || s>59) return null;
      return (((h*60)+m)*60+s)*1000+ms;
    };
    for (const block of blocks) {
      const lines = block.split("\n");
      const timeIndex = lines.findIndex(line => /\d{2,}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2,}:\d{2}:\d{2}[,\.]\d{3}/.test(line));
      if (timeIndex < 0) continue;
      const match = /^(\d{2,}:\d{2}:\d{2})[,\.](\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2})[,\.](\d{3})/.exec(lines[timeIndex].trim());
      if (!match) continue;
      const start=match[1]+","+match[2], end=match[3]+","+match[4];
      const startMs=stampMs(start), endMs=stampMs(end);
      const subtitle=lines.slice(timeIndex+1).join("\n").trim();
      if (startMs===null || endMs===null || endMs<=startMs || !subtitle) continue;
      cues.push({start,end,startMs,endMs,subtitle});
    }
    if (!cues.length) throw new Error("لم يُرجع Gemini مقاطع SRT بتوقيتات صالحة. لم يتم إنشاء ملف ترجمة.");
    cues.sort((a,b)=>a.startMs-b.startMs);
    for (let i=1;i<cues.length;i++) if (cues[i].startMs<cues[i-1].startMs) throw new Error("توقيتات SRT غير مرتبة.");
    const normalizedSrt = cues.map((cue,i)=>(i+1)+"\n"+cue.start+" --> "+cue.end+"\n"+cue.subtitle).join("\n\n");
    return json({ text: normalizedSrt, cueCount: cues.length, mimeType: mime, fileName: file.name || "", provider: "Gemini" });
  } catch (error) {
    return json({ error: String(error?.message || "حدث خطأ أثناء معالجة الملف.").slice(0, 700) }, 502);
  } finally {
    if (uploadedName && !keepUploaded) await fetch("https://generativelanguage.googleapis.com/v1beta/" + uploadedName + "?key=" + encodeURIComponent(apiKey), { method: "DELETE" }).catch(() => {});
  }
}
