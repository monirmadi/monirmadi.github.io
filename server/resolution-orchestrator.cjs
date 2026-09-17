'use strict';
const {validateResolutionNeed,validateOffer,BOUNDARY}=require('../contracts/need-resolution.cjs');
const {gateSubject,proceed}=require('./trust-safety-gate.cjs');
const {getProvider}=require('./provider-registry.cjs');
const {fingerprint}=require('../contracts/saved-search-request.cjs');
const {requestFingerprint}=require('./public-provider-http.cjs');
const {copyPlain}=require('./matching-foundation.cjs');
// Only trusted server code supplies adapters. There is no client registration API.
// A new source still needs registry policy, normalized evidence and independent gates.
async function searchMissingPieces(need,state,{adapters=createConnectedResolutionAdapters(),authorization,safety,privacy,now=Date.now(),maxReads=4,timeoutMs=5000}={}){
 const start=performance.now(),v=validateResolutionNeed(need),offers=[],observations=[],requests=[];
 const finish=(status,code)=>({...BOUNDARY,status,code,offers,observations,requests,executionAllowed:false,monitoringEnabled:false,timings:{providerMs:performance.now()-start}});
 if(!v.valid||state?.binding!==v.binding||!Array.isArray(state.missingPieces))return finish('BLOCKED','CURRENT_RESOLUTION_REQUIRED');
 if(!Number.isInteger(maxReads)||maxReads<1||maxReads>8||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)return finish('BLOCKED','READ_BUDGET_INVALID');
 const bounded=async fn=>{const controller=new AbortController();let timer;try{return await Promise.race([Promise.resolve().then(()=>fn(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('PROVIDER_TIMEOUT'));},timeoutMs);})]);}finally{clearTimeout(timer);}};
 const ids=[...new Set(state.missingPieces.filter(m=>m.remainingQuantity>0).map(m=>m.componentId))];
 const binding=fingerprint({needBinding:v.binding,componentIds:ids});
 if(authorization?.mode!=='EXPLICIT_READ_ONLY'||authorization.binding!==binding||authorization.publicSearchDisclosure!==true)return finish('BLOCKED','EXACT_MISSING_PIECE_CONSENT_REQUIRED');
 if(!proceed(gateSubject(v.need,'EXTERNAL_RESEARCH',{now,safety,permissions:{EXTERNAL_RESEARCH:true}})))return finish('BLOCKED','SAFETY_BLOCKED');
 for(const id of ids){const component=v.need.components.find(c=>c.id===id);if(!component)return finish('BLOCKED','UNKNOWN_COMPONENT');
  const connected=Object.entries(adapters).filter(([providerId,a])=>{const p=getProvider(providerId);return p?.readOnly&&component.strategies.some(s=>p.strategies.includes(s))&&typeof a?.buildRequest==='function'&&typeof a?.read==='function'&&typeof a?.normalize==='function'&&(!a.supports||a.supports(component,v.need.constraints));});
  if(!connected.length){observations.push({componentId:id,reason:'NO_PROVIDER_COVERAGE'});continue;}
  for(const [providerId,adapter]of connected){if(requests.length>=maxReads){observations.push({componentId:id,reason:'READ_BUDGET_EXHAUSTED'});break;}
   // No original need text or other components cross this adapter boundary.
   let request;try{request=copyPlain(adapter.buildRequest({component:structuredClone(component),constraints:v.need.constraints.filter(q=>q.componentIds.includes(id)).map(q=>({dimension:q.dimension,operator:q.operator,value:q.value,unit:q.unit,strength:q.strength}))}));}catch{observations.push({componentId:id,reason:'MISSING_REQUIRED_INFORMATION'});continue;}
   const p=getProvider(providerId);if(request?.providerId!==providerId||!p.operations.includes(request.operation))return finish('BLOCKED','INVALID_COMPONENT_REQUEST');
   if(!proceed(gateSubject(request,'EXTERNAL_RESEARCH',{now,safety,permissions:{EXTERNAL_RESEARCH:true}})))return finish('BLOCKED','SAFETY_BLOCKED');
   let review;try{review=await bounded(signal=>privacy?.({request:structuredClone(request),needBinding:v.binding,componentId:id,signal}));}catch{}
   if(review?.decision!=='PUBLIC_NON_PERSONAL'||review.requestFingerprint!==requestFingerprint(request))return finish('BLOCKED','PRIVACY_REVIEW_REQUIRED');
   const requestHash=requestFingerprint(request);requests.push({componentId:id,providerId,requestFingerprint:requestHash});
   try{const response=await bounded(signal=>adapter.read(request,{mode:'EXPLICIT_READ_ONLY',providerId,operation:request.operation,disclosureApproved:true,queryClass:'PUBLIC_NON_PERSONAL',requestFingerprint:requestHash},{signal}));
    const normalized=await bounded(signal=>adapter.normalize(response,{componentId:id,signal}));if(!Array.isArray(normalized)||normalized.length>40||normalized.some(o=>!validateOffer(o).valid||o.sourceType!=='SOURCE_DERIVED'||o.provenance.some(p=>p.providerId!==providerId)))throw Error('INVALID_NORMALIZED_COMPONENTS');offers.push(...normalized);observations.push({componentId:id,reason:normalized.length?'CANDIDATES_FOUND':response?.status==='failed'||response?.status==='blocked'?'PROVIDER_UNAVAILABLE':'NO_CANDIDATES'});
   }catch(error){observations.push({componentId:id,reason:'PROVIDER_UNAVAILABLE',failure:error?.message==='PROVIDER_TIMEOUT'?'TIMEOUT':'READ_OR_NORMALIZATION_FAILED'});}
  }
 }
 return finish('READ_COMPLETED','REQUIRES_EVIDENCE_AND_COMPOSITION_REASSESSMENT');
}
function createConnectedResolutionAdapters({search=require('./controlled-real-search.cjs').controlledRealSearch}={}){
 const {offersFromProviderEnvelope}=require('./resolution-bridge.cjs');
 const value=(constraints,dimension)=>{const qs=constraints.filter(q=>q.dimension===dimension&&q.operator==='equals');return qs.length===1?qs[0].value:null;};
 const countrySupported=(c,qs)=>!qs.some(q=>q.componentIds?.includes(c.id)&&q.dimension==='COUNTRY'&&q.operator==='equals'&&q.value!=='DE');
 const adapter=(supports,buildRequest)=>({supports,buildRequest,read:(request,authorization,options)=>search(request,authorization,{...options,timeoutMs:5000}),normalize:offersFromProviderEnvelope});
 return {
  'photon-places':adapter((c,qs)=>c.capability==='PLACE'&&countrySupported(c,qs),({component,constraints})=>{
   const location=value(constraints,'LOCATION');if(typeof location!=='string'||constraints.some(q=>q.dimension==='NEAR'))throw Error('PUBLIC_LOCATION_RESOLUTION_REQUIRED');
   return {providerId:'photon-places',operation:'places',query:[component.target,value(constraints,'AREA'),location].filter(Boolean).join(' '),results:5};
  }),
  'govdata-catalog':adapter((c,qs)=>countrySupported(c,qs)&&['INFORMATION_RESOURCE','GOVERNMENT_SERVICE_INFORMATION','HOUSING_INFORMATION'].includes(c.capability)&&(c.capability==='INFORMATION_RESOURCE'||qs.some(q=>q.dimension==='INFORMATION_FORM'&&q.value==='CATALOG_DISCOVERY')&&qs.some(q=>q.dimension==='LOCATION'&&q.value==='Berlin'||q.dimension==='COUNTRY'&&q.value==='DE'))&&!qs.some(q=>q.dimension==='INFORMATION_FORM'&&q.value!=='CATALOG_DISCOVERY'),({component,constraints})=>({providerId:'govdata-catalog',operation:'datasets',query:[component.target,value(constraints,'LOCATION')].filter(Boolean).join(' '),queryMode:'all-terms',results:5})),
  'bvg-transport-v6':adapter((c,qs)=>c.capability==='TRANSPORT_SERVICE'&&countrySupported(c,qs),({constraints})=>{
   const fromId=value(constraints,'ORIGIN_ID'),toId=value(constraints,'DESTINATION_ID');if(!/^\d+$/.test(fromId??'')||!/^\d+$/.test(toId??'')||constraints.some(q=>['TIME','DATE','TIME_WINDOW'].includes(q.dimension)))throw Error('STATION_OR_TIME_RESOLUTION_REQUIRED');
   return {providerId:'bvg-transport-v6',operation:'journeys',fromId,toId,results:3};
  })
 };
}
module.exports={searchMissingPieces,createConnectedResolutionAdapters};
