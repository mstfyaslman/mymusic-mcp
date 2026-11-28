const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
export async function onRequest({request,env}) {
  const missing=["META_APP_ID","META_APP_SECRET","META_REDIRECT_URI"].filter(k=>!env[k]);
  if(missing.length||!env.SOCIAL_KV) return new Response(JSON.stringify({error:"ربط الحسابات يحتاج إعداد تطبيق Meta أولاً وإضافة أسرار META_APP_ID وMETA_APP_SECRET وMETA_REDIRECT_URI وربط KV باسم SOCIAL_KV في Cloudflare Pages.",missing:[...missing,...(!env.SOCIAL_KV?["SOCIAL_KV (KV binding)"]:[])]}),{status:503,headers:H});
  const state=crypto.randomUUID()+crypto.randomUUID();
  const redirect=new URL("https://www.facebook.com/v27.0/dialog/oauth");
  redirect.searchParams.set("client_id",env.META_APP_ID);
  redirect.searchParams.set("redirect_uri",env.META_REDIRECT_URI);
  redirect.searchParams.set("state",state);
  redirect.searchParams.set("response_type","code");
  redirect.searchParams.set("scope","pages_show_list,pages_read_engagement,instagram_basic");
  return new Response(null,{status:302,headers:{"Location":redirect.toString(),"Set-Cookie":"mymusic_meta_state="+state+"; HttpOnly; Secure; SameSite=Lax; Path=/api/meta-callback; Max-Age=600","Cache-Control":"no-store"}});
}