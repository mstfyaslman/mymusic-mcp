const H={"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"};
function cookie(req,name){return (req.headers.get("Cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)||"";}
async function sign(value,secret){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
export async function onRequest({request,env}) {
 const u=new URL(request.url),code=u.searchParams.get("code"),state=u.searchParams.get("state"),expected=cookie(request,"mymusic_meta_state");
 const clear="mymusic_meta_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/meta-callback; Max-Age=0";
 const fail=(msg)=>new Response(msg,{status:400,headers:{...H,"Set-Cookie":clear,"Location":"/?social=error"}});
 if(u.searchParams.has("error"))return new Response("لم توافق على ربط الحساب أو ألغيت العملية. ارجع إلى MyMusic وحاول مرة أخرى.",{status:302,headers:{"Location":"/?social=cancelled","Set-Cookie":clear}});
 if(!code||!state||!expected||state!==expected)return fail("فشل التحقق الأمني من عملية تسجيل الدخول. أعد المحاولة من MyMusic.");
 if(!env.META_APP_ID||!env.META_APP_SECRET||!env.META_REDIRECT_URI||!env.SOCIAL_KV)return fail("إعدادات Meta أو KV غير مكتملة في Cloudflare.");
 try{
  const tokenUrl=new URL("https://graph.facebook.com/v27.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id",env.META_APP_ID);tokenUrl.searchParams.set("client_secret",env.META_APP_SECRET);tokenUrl.searchParams.set("redirect_uri",env.META_REDIRECT_URI);tokenUrl.searchParams.set("code",code);
  const tr=await fetch(tokenUrl);const td=await tr.json();if(!tr.ok||!td.access_token)throw new Error(td?.error?.message||"تعذر استبدال رمز OAuth.");
  let accessToken=td.access_token,expiresIn=Number(td.expires_in)||3600;
  // Exchange the short-lived login token for a longer-lived token when Meta allows it.
  try{
   const exchangeUrl=new URL("https://graph.facebook.com/v27.0/oauth/access_token");
   exchangeUrl.searchParams.set("grant_type","fb_exchange_token");exchangeUrl.searchParams.set("client_id",env.META_APP_ID);
   exchangeUrl.searchParams.set("client_secret",env.META_APP_SECRET);exchangeUrl.searchParams.set("fb_exchange_token",accessToken);
   const er=await fetch(exchangeUrl);const ed=await er.json();
   if(er.ok&&ed.access_token){accessToken=ed.access_token;expiresIn=Number(ed.expires_in)||expiresIn;}
  }catch(e){}
  const meUrl=new URL("https://graph.facebook.com/v27.0/me");meUrl.searchParams.set("fields","id,name");meUrl.searchParams.set("access_token",accessToken);
  const mr=await fetch(meUrl);const me=await mr.json();if(!mr.ok||!me.id)throw new Error(me?.error?.message||"تعذر تحديد الحساب.");
  const sessionTtl=Math.max(3600,Math.min(60*60*24*30,expiresIn));
  const expiresAt=Date.now()+expiresIn*1000;
  await env.SOCIAL_KV.put("meta-user:"+me.id,JSON.stringify({access_token:accessToken,expires_at:expiresAt,name:me.name||"Meta account"}),{expirationTtl:Math.max(3600,expiresIn)});
  const payload=me.id+"."+Math.floor(Date.now()/1000+sessionTtl);
  const signature=await sign(payload,env.META_APP_SECRET);
  const headers=new Headers({"Location":"/?social=connected","Cache-Control":"no-store"});
  headers.append("Set-Cookie","mymusic_meta_session="+payload+"."+signature+"; HttpOnly; Secure; SameSite=Lax; Path=/api/social-account; Max-Age="+sessionTtl);
  headers.append("Set-Cookie",clear);
  return new Response(null,{status:302,headers});
 }catch(e){return new Response("تعذر إكمال ربط Meta: "+String(e.message||"خطأ غير معروف").slice(0,240),{status:502,headers:{...H,"Set-Cookie":clear}});}
}