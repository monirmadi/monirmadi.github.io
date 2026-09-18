'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createPublicApi,validateBody}=require('../server/public-api.cjs');
const {publicResponse}=require('../server/public-ask-contract.cjs');
const {createBetaSearch}=require('../server/beta-search.cjs');
const {parsePublicIntent}=require('../server/public-intent-fast-path.cjs');
const ORIGIN='https://preview.psaksi.de',OTHER='https://relaxing-bird.10web.cloud';
const empty=()=>({status:'end-to-end-read-and-match',stage:'matching',PROVIDER_SELECTED:'photon-places',MATCHING_RESULT:[],CONSTRAINTS:[],REFINEMENT_ALLOWED:true});
async function open(t,options={}){
 const server=createPublicApi({runSearch:async()=>empty(),...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 return (body,opts={})=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:opts.path??'/api/ask',method:opts.method??'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...opts.headers}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:text?JSON.parse(text):null}));});req.on('error',reject);req.end(opts.raw??(body===undefined?undefined:JSON.stringify(body)));
 });
}
const body=(message='Café in Berlin',extra={})=>({message,publicSearchConsent:true,...extra});
test('restrictive CORS, preflight, method and API-only surface',async t=>{
 const call=await open(t);
 const pre=await call(undefined,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
 assert.equal(pre.status,204);assert.equal(pre.headers['access-control-allow-origin'],ORIGIN);assert.equal(pre.headers['access-control-allow-credentials'],undefined);
 for(const origin of ['https://preview.psaksi.de.evil.invalid','null','']){const r=await call(body(),{headers:{Origin:origin}});assert.equal(r.status,403);assert.equal(r.headers['access-control-allow-origin'],undefined);}
 assert.equal((await call(body(),{headers:{Origin:OTHER}})).status,200);
 assert.equal((await call(undefined,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization'}})).status,400);
 assert.equal((await call(undefined,{method:'GET'})).status,405);
 for(const path of ['/.env.local','/api/auth/configure','/preview-panel'])assert.equal((await call(body(),{path})).status,404);
 assert.throws(()=>createPublicApi({allowedOrigins:['*']}));assert.throws(()=>createPublicApi({allowedOrigins:['https://preview.psaksi.de/']}));
});
test('input validation blocks malformed, oversized and privileged fields before the brain',async t=>{
 let calls=0;const call=await open(t,{runSearch:()=>{calls++;return empty();},rateLimit:100});
 for(const b of [null,[],{},body(''),body(4),body('x',{conversationId:'bad'}),body('x',{locale:'en_US'}),body('x',{provider:'photon'}),body('x',{previousResolution:{}}),{message:'x'},body('x'.repeat(2001)),body('a\u0000b')])assert.equal((await call(b)).status,400);
 assert.equal((await call(null,{raw:'{bad'})).status,400);
 assert.equal((await call(null,{raw:Buffer.from([0xff])})).status,400);
 assert.equal((await call(body(),{headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal((await call(body(),{headers:{'Content-Encoding':'gzip'}})).status,415);
 assert.equal((await call(null,{raw:'x'.repeat(17000)})).status,413);
 assert.equal((await call(null,{raw:'x'.repeat(17000),headers:{'Transfer-Encoding':'chunked'}})).status,413);
 assert.equal(calls,0);assert.equal(validateBody(body('x',{locale:'ar-DE'})).locale,'ar-de');
});
test('Arabic clarification continues through the existing brain, not frontend routing',async t=>{
 let query;const call=await open(t,{runSearch:createBetaSearch({search:async request=>{query=request.query;return {results:[]};}})});
 const first=await call(body('قهوة',{locale:'ar'}));assert.equal(first.body.status,'clarification');assert.match(first.body.message,/مدينة/);assert.match(first.body.conversationId,/^[a-f0-9]{64}$/);
 const next=await call(body('Berlin',{conversationId:first.body.conversationId,locale:'ar'}));assert.equal(next.status,200);assert.equal(next.body.conversationId,first.body.conversationId);assert.equal(query,'cafe Berlin');assert.equal(next.body.status,'no_result');
});
test('continuity is origin-bound, expires, preserves rejected refinements and caps total input',async t=>{
 let now=0,seen=[];const call=await open(t,{clock:()=>now,runSearch:async(input,a)=>{seen.push(a);return {...empty(),...(input.endsWith('closer')?{CONTEXT_KEEP_PRIOR:true}:{} )};},rateLimit:100});
 const first=await call(body('cafe in Berlin'));const id=first.body.conversationId;
 assert.equal((await call(body('Mitte',{conversationId:id}),{headers:{Origin:OTHER}})).status,404);
 await call(body('closer',{conversationId:id}));await call(body('only in Mitte',{conversationId:id}));assert.deepEqual(seen.at(-1).contextTurns,['cafe in Berlin','only in Mitte']);
 assert.equal((await call(body('x'.repeat(1990),{conversationId:id}))).status,409);
 now=600001;assert.equal((await call(body('Berlin',{conversationId:id}))).status,404);
});
test('allowlisted response retains real provenance and refuses demo, debug and unsafe links',()=>{
 const report=empty();report.PROVIDER_SELECTED='govdata-catalog';report.CONSTRAINTS=[{dimension:'TOPIC',operator:'equals',value:{state:'known',value:'Bicycles'}}];
 const item=status=>({result:{epistemicStatus:status,value:{name:'Bicycles',entityType:'INFORMATION',sourceUrl:'https://example.org/dataset',description:'Public source description'},provenance:{attribution:'Public catalogue',retrievedAt:'2026-09-17T10:00:00Z'}},match:{status:'compatible',conflictReasons:[]}});
 report.MATCHING_RESULT=[item('SOURCE_DERIVED'),item('DEMO')];report.SECRET='must-not-leak';report.MODEL_TRACE={secret:'must-not-leak'};
 const r=publicResponse(report,{conversationId:'a'.repeat(64),locale:'en',canRefine:true,expiresAt:null});assert.equal(r.results.length,1);assert.equal(r.results[0].source.classification,'SOURCE_DERIVED');assert.equal(r.results[0].catalogOnly,true);assert(!JSON.stringify(r).includes('must-not-leak'));assert(!JSON.stringify(r).includes('MODEL_TRACE'));
 report.MATCHING_RESULT[0].result.value.sourceUrl='https://user:secret@example.org';assert.equal(publicResponse(report,{locale:'en'}).results[0].actions.length,0);
 report.PROVIDER_SELECTED='demo';assert.equal(publicResponse(report,{locale:'en'}).results.length,0);
});
test('business states are normalized; unknown exceptions are redacted',async t=>{
 const call=await open(t,{runSearch:async input=>{if(input==='throw')throw Error('private credential / stack');return {status:'blocked',stage:input==='provider'?'real-search':input==='unsupported'?'provider-selection':'privacy',code:input==='provider'?'HTTP_ERROR':'CAPABILITY_NOT_AVAILABLE'};}});
 assert.equal((await call(body('provider'))).body.status,'provider_unavailable');assert.equal((await call(body('unsupported'))).body.status,'unsupported');assert.equal((await call(body('private'))).body.error.code,'privacy_blocked');
 const r=await call(body('throw'));assert.equal(r.status,500);assert.equal(r.body.error.code,'internal_error');assert(!JSON.stringify(r).includes('credential'));
});
test('rate limits ignore spoofed forwarded IPs and have bounded global capacity',async t=>{
 const call=await open(t,{rateLimit:1});await call(body());const r=await call(body(),{headers:{'X-Forwarded-For':'203.0.113.9'}});assert.equal(r.status,429);assert.equal(r.body.error.code,'rate_limited');assert(r.headers['retry-after']);
 const capped=await open(t,{maxConversations:1});await capped(body());assert.equal((await capped(body())).status,503);
});
test('timeout holds execution capacity and prevents late context commits',async t=>{
 let release,seen,count=0;const call=await open(t,{maxConcurrent:1,searchTimeoutMs:20,runSearch:(input,a)=>{seen=a.contextTurns;return ++count===1?new Promise(r=>{release=r;}):empty();}});
 const first=await call(body('cafe'));assert.equal(first.status,503);assert.equal((await call(body('Berlin',{conversationId:first.body.conversationId}))).status,409);assert.equal((await call(body())).status,503);
 release(empty());await new Promise(r=>setImmediate(r));
 const retry=await call(body('Berlin',{conversationId:first.body.conversationId}));assert.equal(retry.status,200);assert.deepEqual(seen,['Berlin']);
});
test('parallel follow-up cannot mutate another in-flight turn',async t=>{
 let release,started;const ready=new Promise(r=>{started=r;});let count=0;
 const call=await open(t,{runSearch:async()=>{if(++count===2){started();return new Promise(r=>{release=r;});}return empty();}});
 const first=await call(body());const id=first.body.conversationId;const pending=call(body('Mitte',{conversationId:id}));await ready;assert.equal((await call(body('Potsdam',{conversationId:id}))).status,409);release(empty());assert.equal((await pending).status,200);
});

test('Arabic coffee alias remains a closed grammar, never a private-query shortcut',()=>{assert.equal(parsePublicIntent('قهوة').category,'cafe');for(const input of ['قهوة لشخص عنوانه الخاص','قهوة private@example.org','قهوة في برلين ورقم هاتفي'])assert.equal(parsePublicIntent(input),null);});

test('model infrastructure failure is not mislabeled as a user clarification',async t=>{const call=await open(t,{runSearch:async()=>({stage:'extraction',code:'LOCAL_EXTRACTION_FAILED'})});const r=await call(body('unusual need'));assert.equal(r.status,503);assert.equal(r.body.error.code,'temporarily_unavailable');});

test('companion requests preserve the person target in Arabic, English and German without public lookup',async t=>{
 let lookups=0;const call=await open(t,{rateLimit:100,runSearch:createBetaSearch({search:async()=>{lookups++;throw Error('unexpected public lookup');}})});
 for(const [message,locale] of [['بدي اشرب قهوة مع شخص','ar'],['بدي أشرب قهوة مع حدا في برلين','ar'],['I want to have coffee with someone in Berlin','en'],['Ich möchte mit jemandem Kaffee trinken in Berlin','de']]){
  const r=await call(body(message,{locale}));assert.equal(r.status,200);assert.equal(r.body.status,'unsupported');assert.equal(r.body.resultType,'PERSON');assert.equal(r.body.nextAction,'open_account');assert.deepEqual(r.body.results,[]);assert.equal(r.body.canRefine,false);assert.equal(r.body.error,null);
 }
 assert.equal(lookups,0);
});
test('companion grammar consumes the whole request and never erases negation, private details or criteria',()=>{
 for(const query of ['I do not want to have coffee with someone','بدي اشرب قهوة مع شخص لا يحب الموسيقى','I want to have coffee with someone at my home','I want to have coffee with someone with shared interests','I want to have coffee with someone in Berlin private@example.org'])assert.equal(parsePublicIntent(query),null);
 for(const query of ['Café in Berlin','قهوة في برلين'])assert.equal(parsePublicIntent(query).kind,'PLACE');
});
