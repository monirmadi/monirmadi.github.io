'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPublicApi,createPublicSearch,publicConfiguration,DEFAULT_ORIGINS}=require('../server/public-api.cjs');
const {inputFingerprint}=require('../server/universal-real-search.cjs');
const auth=input=>({mode:'EXPLICIT_READ_ONLY',inputSha256:inputFingerprint(input),publicSearchDisclosure:true,contextTurns:[input]});
async function open(t,options={}){const server=createPublicApi(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}`;}
async function ask(base,message){const r=await fetch(base+'/api/ask',{method:'POST',headers:{Origin:DEFAULT_ORIGINS[0],'Content-Type':'application/json'},body:JSON.stringify({message,publicSearchConsent:true})});return {status:r.status,body:await r.json()};}
test('Render PORT wins, public bind is default, no credentials are required',()=>{
 const c=publicConfiguration({PORT:'10000',PSAKSI_PUBLIC_PORT:'8787'});assert.equal(c.port,10000);assert.equal(c.host,'0.0.0.0');assert.equal(c.ollamaEnabled,false);assert.deepEqual(c.allowedOrigins,DEFAULT_ORIGINS);
 assert.equal(publicConfiguration({PSAKSI_PUBLIC_PORT:'9000'}).port,9000);assert.equal(publicConfiguration({PSAKSI_OLLAMA_ENABLED:'true'}).ollamaEnabled,true);
 for(const env of [{PORT:'bad'},{PORT:'0'},{PSAKSI_PUBLIC_HOST:'example.org'},{PSAKSI_OLLAMA_ENABLED:'yes'},{PSAKSI_PUBLIC_ALLOWED_ORIGINS:'*'}])assert.throws(()=>publicConfiguration(env));
});
test('health check needs no origin, invokes no brain and leaves CORS/search limits intact',async t=>{
 let calls=0;const base=await open(t,{rateLimit:1,runSearch:async()=>{calls++;return {status:'blocked',stage:'provider-selection',code:'CAPABILITY_NOT_AVAILABLE'};}});
 for(let i=0;i<3;i++){const r=await fetch(base+'/healthz');assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'ok'});assert.equal(r.headers.get('access-control-allow-origin'),null);}
 assert.equal(calls,0);assert.equal((await ask(base,'Buy a car')).status,200);assert.equal(calls,1);
 assert.equal((await fetch(base+'/api/ask')).status,403);assert.equal((await ask(base,'Buy a car')).status,429);
});
test('default-disabled Ollama fails safely and a subsequent Fast Path request still works',async t=>{
 const base=await open(t);const unavailable=await ask(base,'I need an unusual quiet workshop with a kiln');assert.equal(unavailable.status,503);assert.equal(unavailable.body.error.code,'temporarily_unavailable');
 const fast=await ask(base,'قهوة');assert.equal(fast.status,200);assert.equal(fast.body.status,'clarification');
});
test('enabled but unreachable Ollama fails safely without poisoning the next request',async t=>{
 let modelCalls=0;const base=await open(t,{runSearch:createPublicSearch({ollamaEnabled:true,modelFetch:async()=>{modelCalls++;throw Error('private connection diagnostic');}})});
 const unavailable=await ask(base,'I need an unusual quiet workshop with a kiln');assert.equal(unavailable.status,503);assert(!JSON.stringify(unavailable.body).includes('private'));assert.equal(modelCalls,1);
 const fast=await ask(base,'قهوة');assert.equal(fast.body.status,'clarification');assert.equal(modelCalls,1);
});
test('all three Fast Path provider families route through the existing brain with zero model calls',async()=>{
 const routed=[];let modelCalls=0;const run=createPublicSearch({ollamaEnabled:true,modelFetch:async()=>{modelCalls++;throw Error('MODEL_MUST_NOT_RUN');},providerSearch:async r=>{routed.push(r.providerId);return {results:[]};}});
 for(const input of ['Café in Berlin','How do I get from Alexanderplatz to Potsdam?','Find public information about bicycle infrastructure in Berlin.'])await run(input,auth(input));
 assert.equal(modelCalls,0);for(const provider of ['photon-places','bvg-transport-v6','govdata-catalog'])assert(routed.includes(provider),provider);
});
