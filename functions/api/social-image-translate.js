const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const LANGS=new Set(["ar","en","fr","es","de","it","tr","hi","ur","pt","ru","ja","zh"]);
function toBase64(bytes){let binary="";const step=0x8000;for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(binary);}
export async function onRequest({request,env}){
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 if(!env.GEMINI_API_KEY)return json({error:"مفتاح Gemini غير مضبوط في Cloudflare Pages."},503);
 let form;try{form=await request.formData();}catch{return json({error:"تعذر قراءة الصورة المرسلة."},400);}
 const file=form.get("image"),language=String(form.get("language")||"ar");
 if(!file||typeof file.arrayBuffer!=="function"||!file.size)return json({error:"اختر صورة أولاً."},400);
 if(file.size>8*1024*1024)return json({error:"حجم الصورة أكبر من 8 ميجابايت."},413);
 const mime=(file.type||"").toLowerCase();
 if(!["image/jpeg","image/png","image/webp","image/gif"].includes(mime))return json({error:"الصيغ المدعومة: JPG وPNG وWEBP وGIF."},415);
 if(!LANGS.has(language))return json({error:"لغة الترجمة غير مدعومة."},400);
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  const prompt="اقرأ النصوص الظاهرة بوضوح داخل الصورة، ثم ترجمها إلى اللغة ذات الرمز "+language+". أخرج النص الأصلي أولاً تحت عنوان (النص المستخرج)، ثم الترجمة تحت عنوان (الترجمة). حافظ على ترتيب الأسطر والأرقام والأسماء، واذكر [غير واضح] فقط عند تعذر قراءة كلمة. لا تخمّن ولا تصف عناصر الصورة غير النصية.";
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts:[{inlineData:{mimeType:mime,data:toBase64(bytes)}},{text:prompt}]}],generationConfig:{temperature:0.1,maxOutputTokens:3000}})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)return json({error:data.error?.message||"تعذر تحليل الصورة عبر Gemini."},response.status===429?429:502);
  const text=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("").trim();
  return json({text,provider:"Google Gemini"});
 }catch(error){return json({error:String(error.message||"حدث خطأ أثناء تحليل الصورة.").slice(0,400)},502);}
}
