'use strict';
const {createHash}=require('node:crypto');
const {getProvider}=require('./provider-registry.cjs');
const {buildPublicPlan}=require('./public-provider-plan.cjs');
const {BOUNDARY}=require('./psaksiconcepts.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
function requestFingerprint(request){return hash(JSON.stringify(Object.fromEntries(Object.keys(request).sort().map(k=>[k,request[k]]))));}
function clockCheck(start,end,httpDate,httpAge=null){
 const http=Date.parse(httpDate);
 // RFC 9111: Date belongs to response generation; Age accounts for cache
 // residence. This checks transport time only, never freshness of source data.
 const hasAge=httpAge!==null&&httpAge!==undefined;
 const ageValid=!hasAge||typeof httpAge==='string'&&/^\d{1,10}$/.test(httpAge)&&Number(httpAge)<=2147483648;
 const ageMs=hasAge&&ageValid?Number(httpAge)*1000:0,effective=http+ageMs;
 const issues=[];
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)issues.push('LOCAL_CLOCK_INCONSISTENT');
 if(!ageValid||!Number.isFinite(http)||effective<start-120000||effective>end+30000||http>end+30000)issues.push('HTTP_CLOCK_MISSING_OR_INCONSISTENT');
 return {status:issues.length?'UNVERIFIED':'CONSISTENT',issues,basis:hasAge?'HTTP_DATE_AND_AGE':'HTTP_DATE',responseAgeMs:ageValid?ageMs:null,...(issues.length?{diagnostic:{localStartedAtMs:Number.isFinite(start)?start:null,localReceivedAtMs:Number.isFinite(end)?end:null,httpDate:typeof httpDate==='string'?httpDate:null,httpDateMs:Number.isFinite(http)?http:null,httpOffsetFromStartMs:Number.isFinite(http)&&Number.isFinite(start)?http-start:null,httpOffsetFromEndMs:Number.isFinite(http)&&Number.isFinite(end)?http-end:null,httpFailure:!ageValid?'INVALID_HTTP_AGE':!Number.isFinite(http)?'MISSING_OR_INVALID_DATE':effective<start-120000?'HTTP_DATE_TOO_OLD':effective>end+30000?'HTTP_DATE_IN_FUTURE':null}}:{})};
}
// A shared transport per process. Production multi-worker use requires a shared limiter.
function createPublicTransport({fetchImpl=globalThis.fetch,now=Date.now,monotonic=()=>performance.now(),timeoutMs=15000}={}){
 const state=new Map();
 return async function read(request){
  const plan=buildPublicPlan(request),fail=(code,extra={})=>({...BOUNDARY,status:'failed',code,...extra});
  if(plan.status!=='planned')return fail(plan.code);
  const provider=getProvider(plan.providerId),tick=monotonic(),startedAt=now();
  if(!Number.isFinite(tick)||!Number.isFinite(startedAt))return fail('INVALID_CLOCK');
  const url=new URL(plan.path,provider.baseUrl);for(const [key,value] of Object.entries(plan.params))url.searchParams.set(key,value);
  const key=url.toString();
  let s=state.get(provider.id);if(!s){s={next:-Infinity,count:0,cache:new Map()};state.set(provider.id,s);}
  const cached=s.cache.get(key);
  if(cached&&tick>=cached.at&&tick-cached.at<provider.usage.cacheTtlMs)return {...structuredClone(cached.result),fromCache:true};
  if(s.inFlight||tick<s.next)return fail('RATE_LIMITED',{retryAfterMs:Math.max(0,s.next-tick)});
  if(s.count>=provider.usage.maxRequestsPerProcess)return fail('SESSION_REQUEST_LIMIT');
  s.inFlight=true;s.count++;s.next=tick+provider.usage.minimumIntervalMs;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const res=await fetchImpl(key,{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json','User-Agent':'PSAKSI-ReadOnly-Research/1.0 (+https://monirmadi.github.io)'}});
   if(res.status===429||res.status===503){
    const raw=res.headers.get('retry-after');const delay=/^\d+$/.test(raw||'')?Number(raw)*1000:Date.parse(raw)-now();
    s.next=Math.max(s.next,monotonic()+Math.max(60000,Number.isFinite(delay)?delay:60000));
   }
   if(!res.ok)return fail('HTTP_ERROR',{httpStatus:res.status});
   if(!/application\/(?:[\w.+-]*\+)?json/i.test(res.headers.get('content-type')||''))return fail('INVALID_CONTENT_TYPE');
   if(!res.body)return fail('EMPTY_BODY');
   const reader=res.body.getReader();let size=0;const chunks=[];
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1000000){await reader.cancel();return fail('RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(value));}
   const raw=Buffer.concat(chunks),receivedAt=now();const clocks=clockCheck(startedAt,receivedAt,res.headers.get('date'),res.headers.get('age'));
   if(clocks.status!=='CONSISTENT')return fail('CLOCK_UNVERIFIED',{clock:clocks,provenance:{providerId:provider.id,url:key,method:'GET',httpStatus:res.status,requestedAt:new Date(startedAt).toISOString(),retrievedAt:Number.isFinite(receivedAt)?new Date(receivedAt).toISOString():null,httpDate:res.headers.get('date'),httpAge:res.headers.get('age'),responseSha256:hash(raw),clockStatus:'UNVERIFIED'}});
   let data;try{data=JSON.parse(raw.toString('utf8'));}catch{return fail('INVALID_JSON');}
   const result={...BOUNDARY,status:'received',fromCache:false,data,clock:clocks,provenance:{providerId:provider.id,url:key,method:'GET',httpStatus:res.status,requestedAt:new Date(startedAt).toISOString(),retrievedAt:new Date(receivedAt).toISOString(),httpDate:res.headers.get('date'),httpAge:res.headers.get('age'),responseSha256:hash(raw),attribution:provider.provenance.attribution,license:provider.provenance.license}};
   s.cache.set(key,{at:monotonic(),result:structuredClone(result)});
   return result;
  }catch{return fail(controller.signal.aborted?'TIMEOUT':'TRANSPORT_ERROR');}
  finally{clearTimeout(timer);s.inFlight=false;}
 };
}
const readPublic=createPublicTransport();
module.exports={createPublicTransport,readPublic,requestFingerprint,clockCheck};
