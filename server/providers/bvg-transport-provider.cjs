'use strict';
const {createHash}=require('node:crypto');
const {getProvider}=require('../provider-registry.cjs');
const {buildProviderPlan}=require('../provider-plan.cjs');
const {BOUNDARY,sourceKnowledge}=require('../psaksiconcepts.cjs');
const PROVIDER=getProvider('bvg-transport-v6');
const parseTime=v=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
function freshness({startedAt,receivedAt,httpDate,sourceTimestamp,age}){
 const http=Date.parse(httpDate),source=typeof sourceTimestamp==='number'?sourceTimestamp*1000:NaN;
 const issues=[];
 if(!Number.isFinite(startedAt)||!Number.isFinite(receivedAt)||receivedAt<startedAt)issues.push('LOCAL_CLOCK_INCONSISTENT');
 if(!Number.isFinite(http)||http<startedAt-120000||http>receivedAt+30000)issues.push('HTTP_CLOCK_MISSING_OR_INCONSISTENT');
 if(age!==null&&age!==undefined&&(!/^\d+$/.test(age)||Number(age)>120))issues.push('CACHE_STALE_OR_INVALID');
 if(!Number.isFinite(source))issues.push('SOURCE_TIMESTAMP_MISSING');
 else if(source>receivedAt+30000)issues.push('SOURCE_TIMESTAMP_IN_FUTURE');
 else if(receivedAt-source>PROVIDER.freshnessMaxAgeMs)issues.push('SOURCE_DATA_STALE');
 return {status:issues.length?'UNVERIFIED':'FRESH',issues,sourceUpdatedAt:Number.isFinite(source)?new Date(source).toISOString():null,httpDate:httpDate||null,ageMs:Number.isFinite(source)?receivedAt-source:null,maxAgeMs:PROVIDER.freshnessMaxAgeMs};
}
async function searchBvg(request,{fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=15000}={}){
 const plan=buildProviderPlan(request);
 const fail=(code,extra={})=>({...BOUNDARY,status:'failed',code,...extra});
 if(plan.status!=='planned'||plan.providerId!==PROVIDER.id)return fail(plan.code||'INVALID_PROVIDER');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)return fail('INVALID_TIMEOUT');
 const startedAt=now();if(!Number.isFinite(startedAt))return fail('INVALID_CLOCK');
 const url=new URL(plan.path,PROVIDER.baseUrl);
 for(const [k,v] of Object.entries(plan.params))url.searchParams.set(k,v);
 if(plan.operation==='departures')url.searchParams.set('when',new Date(startedAt).toISOString());
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetchImpl(url.toString(),{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json','Cache-Control':'no-cache'}});
  if(!response.ok)return fail('HTTP_ERROR',{httpStatus:response.status});
  if(!/application\/json/i.test(response.headers.get('content-type')||''))return fail('INVALID_CONTENT_TYPE');
  if(!response.body)return fail('EMPTY_BODY');
  const reader=response.body.getReader();let length=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1000000){await reader.cancel();return fail('RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(value));}
  const raw=Buffer.concat(chunks),receivedAt=now();
  if(receivedAt<startedAt||!Number.isFinite(receivedAt))return fail('LOCAL_CLOCK_INCONSISTENT');
  let data;try{data=JSON.parse(raw.toString('utf8'));}catch{return fail('INVALID_JSON');}
  const provenance={providerId:PROVIDER.id,url:url.toString(),method:'GET',requestedAt:new Date(startedAt).toISOString(),retrievedAt:new Date(receivedAt).toISOString(),httpStatus:response.status,responseSha256:createHash('sha256').update(raw).digest('hex'),httpDate:response.headers.get('date')};
  if(plan.operation==='locations'){
   if(!Array.isArray(data)||data.length>100||data.some(s=>!['stop','station'].includes(s?.type)||typeof s.id!=='string'||!/^\d{6,12}$/.test(s.id)||typeof s.name!=='string'))return fail('INVALID_LOCATIONS');
   return {...BOUNDARY,status:data.length?'source-results':'no-results',epistemicStatus:'SOURCE_DERIVED',freshness:{status:'UNVERIFIED',issues:['STATIC_LOCATION_DATA_NOT_REALTIME']},provenance,results:data.map((s,index)=>sourceKnowledge({id:s.id,name:s.name,type:s.type},{...provenance,jsonPointer:`/${index}`}))};
  }
  if(plan.operation==='journeys')return require('./bvg-journey-results.cjs').normalizeJourneys(data,provenance,request,freshness({startedAt,receivedAt,httpDate:provenance.httpDate,sourceTimestamp:data.realtimeDataUpdatedAt,age:response.headers.get('age')}));
  if(!data||!Array.isArray(data.departures)||data.departures.length>1000)return fail('INVALID_DEPARTURES');
  const fresh=freshness({startedAt,receivedAt,httpDate:provenance.httpDate,sourceTimestamp:data.realtimeDataUpdatedAt,age:response.headers.get('age')});
  const results=[];
  for(const [index,d] of data.departures.entries()){
   const event=parseTime(d?.when??d?.plannedWhen);
   const planned=parseTime(d?.plannedWhen);
   if(!d||typeof d.tripId!=='string'||typeof d.line?.name!=='string'||typeof d.stop?.id!=='string'||!Number.isFinite(event)||!Number.isFinite(planned)|| (d.delay!=null&&!Number.isFinite(d.delay)))return fail('INVALID_DEPARTURE');
   if(event<startedAt-120000||event>startedAt+Number(plan.params.duration)*60000+120000){fresh.issues.push('EVENT_OUTSIDE_REQUEST_WINDOW');fresh.status='UNVERIFIED';}
   if(d.when!=null&&d.delay!=null&&Math.abs(event-planned-d.delay*1000)>1000){fresh.issues.push('DELAY_TIME_INCONSISTENT');fresh.status='UNVERIFIED';}
   results.push(sourceKnowledge({tripId:d.tripId,stopId:d.stop.id,stopName:d.stop.name??null,line:d.line.name,direction:d.direction??null,when:d.when??null,plannedWhen:d.plannedWhen,delaySeconds:d.delay??null,cancelled:d.cancelled===true,realtimeReported:d.when!=null&&d.delay!=null},{...provenance,jsonPointer:`/departures/${index}`,sourceUpdatedAt:fresh.sourceUpdatedAt}));
  }
  fresh.issues=[...new Set(fresh.issues)];
  return {...BOUNDARY,status:!results.length?'no-results':fresh.status==='FRESH'?'source-results':'unverified-results',epistemicStatus:'SOURCE_DERIVED',freshness:fresh,provenance,results};
 }catch(error){return fail(controller.signal.aborted?'TIMEOUT':'TRANSPORT_OR_PARSE_ERROR');}
 finally{clearTimeout(timer);}
}
module.exports={searchBvg,freshness};
