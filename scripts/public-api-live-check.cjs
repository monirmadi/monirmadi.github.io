'use strict';
// Explicit read-only public queries through the exact API handler; no auth, fixtures or writes.
const {createPublicApi}=require('../server/public-api.cjs');
(async()=>{
 const server=createPublicApi();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  async function ask(message,conversationId,locale='en'){
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/ask`,{method:'POST',headers:{Origin:'https://preview.psaksi.de','Content-Type':'application/json'},body:JSON.stringify({message,...(conversationId?{conversationId}:{}),locale,publicSearchConsent:true})});
   const data=await response.json();console.log(JSON.stringify({query:message,http:response.status,status:data.status,count:data.results.length,sources:[...new Set(data.results.map(r=>r.source.name))],continued:conversationId?data.conversationId===conversationId:undefined,error:data.error?.code}));return data;
  }
  const first=await ask('قهوة',null,'ar');const next=await ask('Berlin',first.conversationId,'ar');
  const cafe=await ask('Café in Berlin');const transport=await ask('How do I get from Alexanderplatz to Potsdam?');
  const info=await ask('Find public information about bicycle infrastructure in Berlin.');const unsupported=await ask('Buy a helicopter');
  if(first.status!=='clarification'||next.conversationId!==first.conversationId||![next,cafe].every(r=>['results','no_result','provider_unavailable'].includes(r.status))||!['results','provider_unavailable','no_result'].includes(transport.status)||!['results','no_result','provider_unavailable'].includes(info.status)||unsupported.status!=='unsupported')process.exitCode=1;
 }finally{await new Promise(r=>server.close(r));}
})().catch(()=>{console.error('PUBLIC_API_LIVE_CHECK_FAILED');process.exitCode=1;});
