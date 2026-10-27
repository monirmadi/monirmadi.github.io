'use strict';
// Explicit read-only public queries through the exact API handler; no auth, fixtures or writes.
const {createPublicApi}=require('../server/public-api.cjs');
function realResults(data){
 return data?.version===1&&data.status==='results'&&!data.error&&Array.isArray(data.results)&&data.results.length>0&&data.results.every(r=>r.source?.classification==='SOURCE_DERIVED'&&r.independentlyVerified===false);
}
function samplesPassed(first,next,cafe,transport,info,unsupported){
 return first?.status==='clarification'&&typeof first.conversationId==='string'&&next?.conversationId===first.conversationId&&[next,cafe,transport,info].every(realResults)&&unsupported?.status==='unsupported';
}
async function main({production=false}={}){
 const server=production?null:createPublicApi();if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=production?'https://monirmadi-github-io.onrender.com':`http://127.0.0.1:${server.address().port}`;
 try{
  async function ask(message,conversationId,locale='en'){
   const response=await fetch(base+'/api/ask',{method:'POST',headers:{Origin:production?'https://psaksi.de':'https://preview.psaksi.de','Content-Type':'application/json'},body:JSON.stringify({message,...(conversationId?{conversationId}:{}),locale,publicSearchConsent:true}),signal:AbortSignal.timeout(55000)});
   const data=await response.json();console.log(JSON.stringify({query:message,http:response.status,status:data.status,count:data.results.length,sources:[...new Set(data.results.map(r=>r.source.name))],continued:conversationId?data.conversationId===conversationId:undefined,error:data.error?.code}));return data;
  }
  const first=await ask('قهوة',null,'ar');const next=await ask('Berlin',first.conversationId,'ar');
  const cafe=await ask('Café in Berlin');const transport=await ask('How do I get from Alexanderplatz to Potsdam?');
  const info=await ask('Find public information about bicycle infrastructure in Berlin.');const unsupported=await ask('Buy a helicopter');
  if(!samplesPassed(first,next,cafe,transport,info,unsupported)){console.error('PUBLIC_API_LIVE_RESULTS_NOT_CONFIRMED');process.exitCode=1;}
 }finally{if(server)await new Promise(r=>server.close(r));}
}
if(require.main===module){
 const args=process.argv.slice(2);
 if(args.some(a=>a!=='--production')){console.error('Usage: node scripts/public-api-live-check.cjs [--production]');process.exitCode=1;}
 else main({production:args.includes('--production')}).catch(()=>{console.error('PUBLIC_API_LIVE_CHECK_FAILED');process.exitCode=1;});
}
module.exports={realResults,samplesPassed};
