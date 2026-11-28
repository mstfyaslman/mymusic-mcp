const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
function cookie(req,name){return (req.headers.get("Cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)||"";}
async function sign(value,secret){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
async function graph(path,token){const u=new URL("https://graph.facebook.com/v27.0/"+path);u.searchParams.set("access_token",token);const r=await fetch(u);const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||"Meta API error");return d;}
export async function onRequest({request,env}) {
 if(request.method!=="GET")return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:H});
 if(!env.SOCIAL_KV||!env.META_APP_SECRET)return new Response(JSON.stringify({error:"ربط الحسابات غير مهيأ بعد."}),{status:503,headers:H});
 const raw=cookie(request,"mymusic_meta_session");const parts=raw.split(".");if(parts.length!==3)return new Response(JSON.stringify({connected:false}),{status:200,headers:H});
 const [id,exp,sig]=parts;const payload=id+"."+exp;if(!/^\d+$/.test(id)||Number(exp)<Date.now()/1000||await sign(payload,env.META_APP_SECRET)!==sig)return new Response(JSON.stringify({connected:false}),{status:200,headers:H});
 try{
  const saved=await env.SOCIAL_KV.get("meta-user:"+id);if(!saved)return new Response(JSON.stringify({connected:false}),{status:200,headers:H});
  const account=JSON.parse(saved);if(account.expires_at<Date.now())return new Response(JSON.stringify({connected:false,expired:true}),{status:200,headers:H});
  const pages=await graph("me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=20",account.access_token);
  const results=[];
  for(const page of (pages.data||[]).slice(0,10)){
   const pageToken=page.access_token||account.access_token;
   try{const feed=await graph(page.id+"/feed?fields=id,message,created_time,permalink_url,full_picture,attachments{media_type,media_url,target,url}&limit=8",pageToken);
    for(const p of feed.data||[])results.push({source:"Facebook",account:page.name,caption:p.message||"",timestamp:p.created_time||"",permalink:p.permalink_url||"",mediaUrl:p.full_picture||p.attachments?.data?.[0]?.media_url||"",mediaType:p.attachments?.data?.[0]?.media_type||"IMAGE"});
   }catch(e){}
   if(page.instagram_business_account?.id){const ig=page.instagram_business_account;try{const media=await graph(ig.id+"/media?fields=id,caption,media_type,media_url,permalink,timestamp,thumbnail_url&limit=8",pageToken);
    for(const p of media.data||[])results.push({source:"Instagram",account:ig.username||page.name,caption:p.caption||"",timestamp:p.timestamp||"",permalink:p.permalink||"",mediaUrl:p.media_url||p.thumbnail_url||"",mediaType:p.media_type||"IMAGE"});
   }catch(e){}}
  }
  return new Response(JSON.stringify({connected:true,name:account.name,items:results.slice(0,30)}),{status:200,headers:H});
 }catch(e){return new Response(JSON.stringify({error:String(e.message||"تعذر جلب محتوى الحساب").slice(0,300)}),{status:502,headers:H});}
}