const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function onRequest({request,env}){
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 const key=env.GEMINI_API_KEY;if(!key)return json({error:"مفتاح Gemini غير مضبوط في Cloudflare Pages."},503);
 let form;try{form=await request.formData();}catch{return json({error:"تعذر قراءة الصوت المرسل."},400);}
 const file=form.get("audio"),lang=String(form.get("language")||"ar").slice(0,12),offset=Number(form.get("offsetMs")||0);
 if(!file||typeof file.arrayBuffer!=="function"||!file.size)return json({error:"لم يصل صوت من تبويب Facebook. تأكد من مشاركة صوت التبويب."},400);
 if(file.size>12*1024*1024)return json({error:"مقطع الصوت أكبر من 12 ميجابايت. قلل مدة المقطع أو جودة التسجيل."},413);
 const mime=(file.type||"audio/webm").split(";")[0].toLowerCase();
 if(!/^(audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|3gpp)|video\/webm)$/.test(mime))return json({error:"صيغة صوت المتصفح غير مدعومة: "+mime},415);
 let fileName="";
 try{
  const bytes=await file.arrayBuffer();
  const start=await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files?key="+encodeURIComponent(key),{method:"POST",headers:{"X-Goog-Upload-Protocol":"resumable","X-Goog-Upload-Command":"start","X-Goog-Upload-Header-Content-Length":String(file.size),"X-Goog-Upload-Header-Content-Type":mime,"Content-Type":"application/json"},body:JSON.stringify({file:{displayName:"MyMusic-Facebook-audio-"+Date.now()}})});
  if(!start.ok)throw new Error("تعذر بدء رفع الصوت إلى Gemini: "+(await start.text()).slice(0,300));
  const uploadUrl=start.headers.get("x-goog-upload-url");if(!uploadUrl)throw new Error("لم يُرجع Gemini رابط رفع الصوت.");
  const uploaded=await fetch(uploadUrl,{method:"POST",headers:{"X-Goog-Upload-Offset":"0","X-Goog-Upload-Command":"upload, finalize"},body:bytes});
  const ud=await uploaded.json().catch(()=>({}));if(!uploaded.ok||!ud.file?.uri||!ud.file?.name)throw new Error(ud.error?.message||"فشل رفع الصوت إلى Gemini.");
  fileName=ud.file.name;let meta=ud.file,state=meta.state;
  for(let i=0;state!=="ACTIVE"&&i<20;i++){if(state==="FAILED")throw new Error("فشل تجهيز مقطع الصوت.");await sleep(1000);const sr=await fetch("https://generativelanguage.googleapis.com/v1beta/"+fileName+"?key="+encodeURIComponent(key));meta=await sr.json();if(!sr.ok)throw new Error(meta.error?.message||"تعذر تجهيز الصوت.");state=meta.state;}
  if(state!=="ACTIVE")throw new Error("تأخر تجهيز مقطع الصوت. أعد المحاولة.");
  const prompt="You are a professional, accurate live subtitle translator. Listen ONLY to the attached audio segment. Transcribe all clearly audible speech and sung words, then translate them into language code "+lang+". Return only valid SRT with timestamps relative to the beginning of this short audio segment, format HH:MM:SS,mmm --> HH:MM:SS,mmm. Keep each cue concise and preserve meaning. Do not invent inaudible words. If there is no intelligible speech, return exactly NO_SPEECH.";
  let last=null;
  for(const model of ["gemini-3.5-flash-lite","gemini-3.8-flash"]){
   for(let attempt=0;attempt<2;attempt++){
    const res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{role:"user",parts:[{fileData:{mimeType:mime,fileUri:meta.uri||ud.file.uri}},{text:prompt}]}],generationConfig:{temperature:0.1,maxOutputTokens:2048}})});
    const data=await res.json().catch(()=>({}));
    if(res.ok){const text=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("").trim();if(!text)throw new Error("لم يتعرف Gemini على كلام واضح في هذا المقطع.");return json({text,offsetMs:Number.isFinite(offset)?Math.max(0,offset):0,provider:"Google Gemini"});}
    last=new Error(data.error?.message||"تعذر تحليل الصوت.");last.status=res.status;
    if([400,404].includes(res.status))break;
    if(![429,500,502,503,504].includes(res.status))throw last;
    if(attempt===0)await sleep(700);
   }
  }
  throw last||new Error("تعذر تحليل الصوت في الوقت الحالي.");
 }catch(e){return json({error:String(e.message||"حدث خطأ أثناء تحليل الصوت.").slice(0,600)},e.status===429?429:502);}
 finally{if(fileName)await fetch("https://generativelanguage.googleapis.com/v1beta/"+fileName+"?key="+encodeURIComponent(key),{method:"DELETE"}).catch(()=>{});}
}