const JSON_HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const allowedHosts=new Set(["facebook.com","www.facebook.com","m.facebook.com","fb.watch","instagram.com","www.instagram.com"]);
export async function onRequest({request}) {
  if(request.method!=="POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{...JSON_HEADERS,Allow:"POST"}});
  let body; try{body=await request.json();}catch{return new Response(JSON.stringify({error:"بيانات الرابط غير صحيحة."}),{status:400,headers:JSON_HEADERS});}
  let url; try{url=new URL(String(body?.url||""));}catch{return new Response(JSON.stringify({error:"أدخل رابط Facebook أو Instagram صحيحاً."}),{status:400,headers:JSON_HEADERS});}
  if(url.protocol!=="https:"||!allowedHosts.has(url.hostname.toLowerCase())||url.username||url.password) return new Response(JSON.stringify({error:"يسمح فقط بروابط HTTPS من Facebook وInstagram."}),{status:400,headers:JSON_HEADERS});
  const path=url.pathname.toLowerCase();
  const isInstagram=url.hostname.toLowerCase().includes("instagram.com");
  const isStory=isInstagram&&/^\/(stories|accounts)\//.test(path);
  if(isStory) return new Response(JSON.stringify({error:"قصص Instagram غير متاحة للتضمين عبر واجهة Meta الرسمية. يمكن عرض المنشورات والريلز العامة."}),{status:422,headers:JSON_HEADERS});
  const validInstagram=isInstagram&&/^\/(p|reel|tv)\/[a-zA-Z0-9_-]+/.test(path);
  const validFacebook=!isInstagram&&(url.hostname==="fb.watch"||/^\/(watch|videos|posts|permalink\.php|photo\.php|reel)\b/.test(path)||/^\/[a-zA-Z0-9._-]+\/posts\//.test(path));
  if(!validInstagram&&!validFacebook) return new Response(JSON.stringify({error:"الرابط لا يبدو منشوراً أو Reel عاماً قابلاً للتضمين. الصق رابط المنشور نفسه."}),{status:422,headers:JSON_HEADERS});
  const endpoint=isInstagram?"instagram_oembed":(/watch|videos|reel/.test(path)||url.hostname==="fb.watch"?"oembed_video":"oembed_post");
  const api=new URL("https://graph.facebook.com/v27.0/"+endpoint);
  api.searchParams.set("url",url.toString()); api.searchParams.set("omitscript","true"); api.searchParams.set("maxwidth",isInstagram?"658":"700");
  try{
    const upstream=await fetch(api.toString(),{headers:{"Accept":"application/json"}});
    const data=await upstream.json().catch(()=>({}));
    if(!upstream.ok||!data.html) return new Response(JSON.stringify({error:data?.error?.message||"تعذر جلب التضمين. تأكد أن المنشور عام وأن الرابط صحيح."}),{status:upstream.status===429?429:422,headers:JSON_HEADERS});
    return new Response(JSON.stringify({html:data.html,provider:isInstagram?"Instagram":"Facebook",type:data.type||"rich",url:url.toString()}),{status:200,headers:JSON_HEADERS});
  }catch{return new Response(JSON.stringify({error:"تعذر الاتصال بخدمة Meta حالياً."}),{status:502,headers:JSON_HEADERS});}
}