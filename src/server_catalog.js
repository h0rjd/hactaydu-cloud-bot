const https=require("https");
function parseServers(data){
  let json=data;
  if(typeof data==="string"){
    const startIdx=data.indexOf("[");
    const endIdx=data.lastIndexOf("]");
    if(startIdx!==-1&&endIdx>startIdx){
      json=JSON.parse(data.slice(startIdx,endIdx+1));
    }else{
      json=JSON.parse(data);
    }
  }
  const all=Array.isArray(json)&&json[0]?.sid?json:(json?.[0]?.all||json?.all||[]);
  if(!Array.isArray(all))throw Error("SERVER_LIST_INVALID");
  const seen=new Set();
  return all.filter(s=>s&&/^\d+$/.test(String(s.sid))&&typeof s.server==="string").map(s=>{
    const sidNum=Number(s.sid);
    const sNum=s.id||(sidNum>=600000?sidNum-610000:sidNum);
    const rawName=String(s.name||s.sid).replace(/^\[S\d+[^\]]*\]\s*/i,"").trim();
    const formattedName=`[S${sNum}] ${rawName}`;
    return {
      sid:String(s.sid),
      id:sNum,
      name:formattedName,
      rawName,
      wsUrl:s.server.replace(/\\\//g,"/"),
      status:String(s.status??"")
    };
  }).filter(s=>{
    if(!s.wsUrl.startsWith("wss://")||seen.has(s.sid))return false;
    seen.add(s.sid);
    return true;
  }).sort((a,b)=>Number(b.sid)-Number(a.sid));
}
async function requestServerList(host,accountId){
  const url=new URL(`https://${host}/game/getServerList.php`);
  url.search=new URLSearchParams({lst:"all",ac:String(accountId),plt:"ios",v:"1",platform:"funtap",appid:"ios"});
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{timeout:12000},res=>{
      if(res.statusCode!==200){res.resume();return reject(Error(`SERVER_LIST_HTTP_${res.statusCode}`));}
      let body="";
      res.on("data",c=>{body+=c;if(body.length>2000000)req.destroy(Error("SERVER_LIST_TOO_LARGE"));});
      res.on("end",()=>{
        try{
          const rows=parseServers(body);
          if(!rows.length)throw Error("SERVER_LIST_EMPTY");
          resolve(rows);
        }catch(e){reject(e);}
      });
      res.on("error",reject);
    });
    req.on("timeout",()=>req.destroy(Error("SERVER_LIST_TIMEOUT")));
    req.on("error",reject);
  });
}
async function getServers(accountId){
  if(!/^\d+$/.test(String(accountId)))throw Error("SERVER_ACCOUNT_ID_REQUIRED");
  const hosts=["funtap-xy.xinliugame.net","funtap-xy.ridvqqxa.com"];
  let lastErr=null;
  for(const host of hosts){
    try{return await requestServerList(host,accountId);}catch(err){lastErr=err;}
  }
  throw lastErr||Error("SERVER_LIST_UNAVAILABLE");
}
async function latestServer(accountId){
  const rows=await getServers(accountId);
  const s=rows.find(x=>x.status!=="0");
  if(!s)throw Error("NO_OPEN_SERVER");
  return s;
}
module.exports={parseServers,getServers,latestServer};
