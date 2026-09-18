'use strict';
// API-only process: no static files, auth endpoints, environment-file reads or remote writes.
const http=require('node:http');
const {randomBytes}=require('node:crypto');
const {inputFingerprint}=require('./universal-real-search.cjs');
const {createBetaSearch}=require('./beta-search.cjs');
const {createLocalLanguageRuntime}=require('./local-language-runtime.cjs');
const {publicResponse,errorResponse}=require('./public-ask-contract.cjs');
const DEFAULT_ORIGINS=['https://preview.psaksi.de','https://relaxing-bird.10web.cloud','https://psaksi.de','https://www.psaksi.de'];
const ID=/^[a-f0-9]{64}$/;
const fail=(code,httpStatus)=>Object.assign(new Error(code),{code,httpStatus});
function validateOrigins(values){
 if(!Array.isArray(values)||!values.length||values.length>10)throw Error('INVALID_ORIGIN_CONFIGURATION');
 return new Set(values.map(value=>{let u;try{u=new URL(value);}catch{throw Error('INVALID_ORIGIN_CONFIGURATION');}if(u.origin!==value||u.protocol!=='https:'||u.username||u.password)throw Error('INVALID_ORIGIN_CONFIGURATION');return value;}));
}
function validateBody(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['message','conversationId','locale','publicSearchConsent'].includes(k)))throw fail('invalid_request',400);
 if(typeof b.message!=='string'||!b.message.trim()||b.message.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(b.message))throw fail('invalid_request',400);
 if(b.conversationId!==undefined&&(typeof b.conversationId!=='string'||!ID.test(b.conversationId)))throw fail('invalid_request',400);
 let locale='en';if(b.locale!==undefined){if(typeof b.locale!=='string'||b.locale.length>35||!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(b.locale))throw fail('invalid_request',400);try{locale=Intl.getCanonicalLocales(b.locale)[0].toLowerCase();}catch{throw fail('invalid_request',400);}}
 if(b.publicSearchConsent!==true)throw fail('privacy_required',400);
 return {...b,message:b.message.trim(),locale};
}
function readBody(req,maxBytes){
 return new Promise((resolve,reject)=>{
  let size=0,done=false;const chunks=[];
  const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);req.removeListener('data',data);req.removeListener('end',end);req.removeListener('aborted',aborted);req.removeListener('error',aborted);if(err){req.resume();reject(err);}else resolve(value);};
  const data=chunk=>{size+=chunk.length;if(size>maxBytes)finish(fail('body_too_large',413));else chunks.push(chunk);};
  const end=()=>{try{finish(null,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));}catch{finish(fail('invalid_request',400));}};
  const aborted=()=>finish(fail('invalid_request',400));
  const timer=setTimeout(()=>finish(fail('request_timeout',408)),10000);
  req.on('data',data);req.on('end',end);req.on('aborted',aborted);req.on('error',aborted);
 });
}
// Optional local model only. Fast Path selection and all safety gates remain in createBetaSearch.
function createOpenAIModelFetch({apiKey,model='gpt-4.1-mini',fetchImpl=globalThis.fetch}={}){
 if(typeof apiKey!=='string'||!apiKey.startsWith('sk-'))throw Error('OPENAI_API_KEY_MISSING');
 return async(_url,init={})=>{
  const request=JSON.parse(init.body);
  const response=await fetchImpl('https://api.openai.com/v1/chat/completions',{method:'POST',redirect:'error',signal:init.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model,messages:[{role:'system',content:request.system},{role:'user',content:request.prompt}],temperature:0,max_tokens:request.options?.num_predict??768,response_format:{type:'json_schema',json_schema:{name:'psaksi_search_stage',strict:true,schema:request.format}}})});
  if(!response.ok)return response;
  const payload=await response.json();
  const choice=payload.choices?.[0];
  const content=choice?.message?.content;
  if(choice?.finish_reason!=='stop'||choice?.message?.refusal||typeof content!=='string')return new Response('',{status:502});
  return new Response(JSON.stringify({done:true,done_reason:'stop',model,created_at:new Date().toISOString(),response:content}),{status:200,headers:{'Content-Type':'application/json'}});
 };
}
function createPublicSearch({ollamaEnabled=false,openaiApiKey,modelFetch=globalThis.fetch,providerSearch}={}){
 const hostedModel=typeof openaiApiKey==='string'&&openaiApiKey.length>0;
 const unavailable=async()=>{throw Error('LOCAL_MODEL_DISABLED');};
 return async(input,authorization)=>{
 const report=await createBetaSearch({
  // Hosted model calls can take longer than the free Render instance wake-up
  // and first-token latency. Keep the request bounded, but avoid treating a
  // normal GPT response as an unreachable public-search network.
  runtime:createLocalLanguageRuntime({model:hostedModel?'gpt-4.1-mini':'qwen2.5-coder:7b-instruct',fetchImpl:hostedModel?createOpenAIModelFetch({apiKey:openaiApiKey,fetchImpl:modelFetch}):ollamaEnabled?modelFetch:unavailable,timeoutMs:hostedModel?30000:3000}),
  ...(providerSearch?{search:providerSearch}:{})
 })(input,authorization);
 // Operational codes only: never log input, model output, credentials or identifiers.
 if(hostedModel&&report.MODEL_FAILURES?.length)console.warn('PSAKSI_MODEL_FAILURE',JSON.stringify(report.MODEL_FAILURES));
 // A deliberately disabled model is a capability limit, not a transient outage.
 if(!hostedModel&&!ollamaEnabled&&report.stage==='extraction'&&['LOCAL_EXTRACTION_FAILED','EXTRACTOR_FAILED'].includes(report.code)){
  return {...report,code:'PUBLIC_LANGUAGE_UNAVAILABLE',REFINEMENT_ALLOWED:false,CONTEXT_KEEP_PRIOR:false};
 }
 return report;
 };
}
function publicConfiguration(env=process.env){
 const port=Number(env.PORT??env.PSAKSI_PUBLIC_PORT??8787),host=env.PSAKSI_PUBLIC_HOST??'0.0.0.0';
 if(!Number.isInteger(port)||port<1||port>65535||!['127.0.0.1','0.0.0.0','::1'].includes(host))throw Error('INVALID_LISTEN_CONFIGURATION');
 if(env.PSAKSI_OLLAMA_ENABLED!==undefined&&!['true','false'].includes(env.PSAKSI_OLLAMA_ENABLED))throw Error('INVALID_MODEL_CONFIGURATION');
 const allowedOrigins=env.PSAKSI_PUBLIC_ALLOWED_ORIGINS?.split(',').map(s=>s.trim())??DEFAULT_ORIGINS;
 validateOrigins(allowedOrigins);
 return {port,host,allowedOrigins,ollamaEnabled:env.PSAKSI_OLLAMA_ENABLED==='true',openaiApiKey:env.OPENAI_API_KEY};
}
function createPublicApi({ollamaEnabled=false,openaiApiKey,allowedOrigins=DEFAULT_ORIGINS,clock=Date.now,runSearch,rateLimit=20,globalRateLimit=120,maxClients=1000,maxConversations=200,maxConcurrent=2,conversationTtlMs=600000,searchTimeoutMs=45000}={}){
 const origins=validateOrigins(allowedOrigins),conversations=new Map(),clients=new Map();let running=0,globalBucket={count:0,until:0};
 for(const n of [rateLimit,globalRateLimit,maxClients,maxConversations,maxConcurrent,conversationTtlMs,searchTimeoutMs])if(!Number.isSafeInteger(n)||n<1)throw Error('INVALID_LIMIT_CONFIGURATION');
 // Fresh runtime receipts per invocation; provider pacing/cache stays in the existing shared transport.
 const search=runSearch??createPublicSearch({ollamaEnabled,openaiApiKey});
 const server=http.createServer({maxHeaderSize:8192},async(req,res)=>{
  let locale='en',conversationId=null;
  req.on('error',()=>{}); // Early rejection/body teardown must not leave an unhandled stream error.
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Vary','Origin');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  const send=(status,body)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status);res.end(JSON.stringify(body));}};
  try{
   // Render probes this route without Origin; it never invokes providers or consumes search capacity.
   if(req.url==='/healthz'&&req.method==='GET'){send(200,{status:'ok'});return;}
   const now=clock();
   for(const [id,c]of conversations)if(c.until<=now&&!c.busy)conversations.delete(id);
   for(const [ip,c]of clients)if(c.until<=now)clients.delete(ip);
   // Never trust client-controlled Forwarded/X-Forwarded-For. A reverse proxy shares this bucket.
   const ip=req.socket.remoteAddress??'unknown';let bucket=clients.get(ip);
   if(!bucket){if(clients.size>=maxClients)throw fail('temporarily_unavailable',503);bucket={count:0,until:now+60000};clients.set(ip,bucket);}
   if(globalBucket.until<=now)globalBucket={count:0,until:now+60000};
   const origin=req.headers.origin;
   if(typeof origin!=='string'||!origins.has(origin))throw fail('origin_not_allowed',403);
   res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Expose-Headers','Retry-After');
   if(++bucket.count>rateLimit||++globalBucket.count>globalRateLimit){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((bucket.until-now)/1000))));throw fail('rate_limited',429);}
   if(req.url!=='/api/ask')throw fail('not_found',404);
   if(req.method==='OPTIONS'){
    const requestedHeaders=(req.headers['access-control-request-headers']??'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
    if(req.headers['access-control-request-method']!=='POST'||requestedHeaders.some(h=>h!=='content-type'))throw fail('invalid_request',400);
    res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Max-Age','600');res.writeHead(204);res.end();return;
   }
   if(req.method!=='POST'){res.setHeader('Allow','POST, OPTIONS');throw fail('method_not_allowed',405);}
   if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw fail('unsupported_media_type',415);
   if(req.headers['content-length']&&Number(req.headers['content-length'])>16384)throw fail('body_too_large',413);
   const b=validateBody(await readBody(req,16384));locale=b.locale;
   let state=b.conversationId?conversations.get(b.conversationId):null;
   if(b.conversationId&&(!state||state.until<=clock()||state.origin!==origin))throw fail('conversation_expired',404);
   if(state?.busy)throw fail('conversation_busy',409);
   if(state&&!state.canRefine)throw fail('conversation_limit',409);
   const turns=[...(state?.turns??[]),b.message],input=turns.join('\n');
   if(turns.length>6||input.length>2000)throw fail('conversation_limit',409);
   if(running>=maxConcurrent||!state&&conversations.size>=maxConversations){res.setHeader('Retry-After','5');throw fail('temporarily_unavailable',503);}
   conversationId=b.conversationId??randomBytes(32).toString('hex');
   if(!state){state={origin,until:clock()+conversationTtlMs,turns:[],resolution:null,canRefine:true,busy:false};conversations.set(conversationId,state);}
   state.busy=true;running++;
   let timer;
   // The timeout ends the HTTP response, not an unabortable model call. Keep its slot
   // and conversation lock until actual settlement; timed-out work never commits context.
   const work=Promise.resolve().then(()=>search(input,{mode:'EXPLICIT_READ_ONLY',inputSha256:inputFingerprint(input),publicSearchDisclosure:true,contextTurns:turns,previousResolution:state.resolution}));
   work.then(()=>{state.busy=false;running--;},()=>{state.busy=false;running--;});
   try{
    const report=await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('temporarily_unavailable',503)),searchTimeoutMs);})]);
    if(res.destroyed)return;
    if(state.until<=clock())throw fail('conversation_expired',404);
    // Reuse the brain's continuation contract, including rejected-refinement rollback.
    const canRefine=Boolean(report.REFINEMENT_ALLOWED||report.code==='PLACE_LOCATION_REQUIRED');
    const nextTurns=report.CONTEXT_KEEP_PRIOR?turns.slice(0,-1):turns;
    const available=canRefine&&nextTurns.length<6&&nextTurns.join('\n').length<2000;
    const response=publicResponse(report,{conversationId,locale,canRefine:available,expiresAt:new Date(state.until).toISOString()});
    if(response.status!=='error'){
     state.turns=nextTurns;state.resolution=report.CONTEXT_KEEP_PRIOR?state.resolution:report.RESOLUTION_INTELLIGENCE?.need??state.resolution;state.canRefine=available;
    }
    if(response.error?.code==='temporarily_unavailable')res.setHeader('Retry-After','5');
    send(response.error?(response.error.code==='privacy_blocked'?403:response.error.code==='temporarily_unavailable'?503:400):200,response);
   }finally{clearTimeout(timer);}
  }catch(err){req.resume();res.setHeader('Connection','close');const known=typeof err.httpStatus==='number';if(err.httpStatus===503)res.setHeader('Retry-After','5');send(known?err.httpStatus:500,errorResponse(known?err.code:'internal_error',locale,conversationId));}
 });
 const cleanup=setInterval(()=>{const now=clock();for(const [id,c]of conversations)if(c.until<=now)conversations.delete(id);for(const [ip,c]of clients)if(c.until<=now)clients.delete(ip);},30000);cleanup.unref();server.on('close',()=>clearInterval(cleanup));
 server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;server.setTimeout(60000,socket=>socket.destroy());
 return server;
}
if(require.main===module){
 try{
  const {port,host,...configuration}=publicConfiguration();
  const server=createPublicApi(configuration);
  server.on('error',()=>{console.error('PUBLIC_API_START_FAILED');process.exitCode=1;});
  server.listen(port,host,()=>console.log('PSAKSI public API listening on port '+port));
 }catch{console.error('PUBLIC_API_CONFIGURATION_INVALID');process.exitCode=1;}
}
module.exports={createPublicApi,createPublicSearch,createOpenAIModelFetch,publicConfiguration,validateBody,DEFAULT_ORIGINS};
