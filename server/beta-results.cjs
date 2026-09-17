'use strict';
const {searchAcceptance}=require('./beta-accepted-search.cjs');
const clean=s=>typeof s==='string'?s.slice(0,500):null;
function usefulPublicResult(report,result){
 const value=dimension=>report.CONSTRAINTS?.find(q=>q.dimension===dimension&&q.operator==='equals'&&q.value.state==='known')?.value.value;
 const v=result.value??{},fold=s=>(s??'').toLocaleLowerCase().normalize('NFKC');
 if(report.PROVIDER_SELECTED==='photon-places'){
  const city=value('LOCATION')??report.RESOLUTION?.anchor?.value?.city;
  const area=value('AREA');if(city?fold(v.city)!==fold(city):!area)return false;
  if(area&&fold(v.area)!==fold(area))return false;
  const category=value('CATEGORY');if(category&&fold(v.category)!==fold(category))return false;
 }
 if(report.PROVIDER_SELECTED==='govdata-catalog'){
  const topic=value('TOPIC')??report.ENTITIES?.[0]?.description?.value;
  const terms=fold(topic).match(/[\p{L}\p{N}]+/gu)??[];
  const title=fold(v.name).match(/[\p{L}\p{N}]+/gu)??[];
  if(!terms.length||!terms.every(t=>title.includes(t)))return false;
  const city=value('LOCATION');if(city&&!fold([v.name,v.publisher].filter(Boolean).join(' ')).includes(fold(city)))return false;
 }
 return true;
}
function resultView(report){
 const providers={'govdata-catalog':'GovData','photon-places':'Photon / OpenStreetMap','bvg-transport-v6':'BVG'};
 const cards=(report.status==='end-to-end-read-and-match'?report.MATCHING_RESULT??[]:[]).filter(r=>r.result?.epistemicStatus==='SOURCE_DERIVED'&&['compatible','unresolved'].includes(r.match?.status)&&!r.match?.conflictReasons?.length&&usefulPublicResult(report,r.result)).map(r=>{
  const v=r.result.value??{},p=r.result.provenance??{};let url=null;try{const u=new URL(v.sourceUrl??p.url);if(u.protocol==='https:'&&!u.username&&!u.password)url=u.href;}catch{}
  return {title:clean(v.name)??([v.legs?.[0]?.originName,v.legs?.at(-1)?.destinationName].filter(Boolean).join(' → ')||'Source result'),description:clean(v.description),type:v.entityType==='PLACE'?'place':v.entityType==='TRANSPORT_SERVICE'?'transport':'information',area:clean(v.area),address:v.address&&typeof v.address.street==='string'?{street:clean(v.address.street),...(typeof v.address.houseNumber==='string'?{houseNumber:clean(v.address.houseNumber)}:{}),...(typeof v.address.postcode==='string'?{postcode:clean(v.address.postcode)}:{})}:undefined,coordinates:v.location?.precision==='approximate'&&Number.isFinite(v.location.latitude)&&Number.isFinite(v.location.longitude)&&Math.abs(v.location.latitude)<=90&&Math.abs(v.location.longitude)<=180?{latitude:Math.round(v.location.latitude*100)/100,longitude:Math.round(v.location.longitude*100)/100,precision:'approximate'}:undefined,actions:url?[{kind:'open-source',url}]:[],relevanceReasons:[...(v.city?[{kind:'city',value:clean(v.city)}]:[]),...(v.category?[{kind:'category',value:clean(v.category)}]:[])],sourceDetails:{provider:providers[report.PROVIDER_SELECTED]??'Source',retrievedAt:clean(p.retrievedAt),sourceUrl:url,classification:'SOURCE_DERIVED',worldVerification:'UNVERIFIED',attribution:clean(p.attribution)},category:clean(v.category),journey:report.PROVIDER_SELECTED==='bvg-transport-v6',lines:[...new Set((v.legs??[]).map(l=>clean(l.line)).filter(Boolean))],resultType:r.match.status==='compatible'?'MATCHED':'POSSIBLE',publisher:clean(v.publisher),city:clean(v.city),departure:clean(v.departure),arrival:clean(v.arrival),source:providers[report.PROVIDER_SELECTED]??'Source',catalogOnly:report.PROVIDER_SELECTED==='govdata-catalog',url,retrievedAt:clean(p.retrievedAt),match:['compatible','unresolved','incompatible'].includes(r.match?.status)?r.match.status:'unresolved',dimensions:(r.match?.dimensions??[]).filter(d=>['intent','entityType','role','location','time','trust','sourceQuality','provenance','constraints','exclusions','uncertainty','provenanceTime'].includes(d.dimension)&&!['NOT_REQUIRED','NONE_SUPPLIED','NOT_REQUIRED_SOURCE_AGE_NOT_ASSUMED'].includes(d.code)).map(d=>({dimension:d.dimension,status:d.status}))};
 });
 const constraint=key=>report.CONSTRAINTS?.find(q=>q.dimension===key&&q.operator==='equals'&&q.value.state==='known')?.value.value;
 const summary={count:cards.length,type:cards[0]?.type??(report.PROVIDER_SELECTED==='photon-places'?'place':report.PROVIDER_SELECTED==='bvg-transport-v6'?'transport':'information'),category:clean(constraint('CATEGORY')),city:clean(constraint('LOCATION')),area:clean(constraint('AREA'))};
 const clarification=['REFINEMENT_AREA_REQUIRED','REFINEMENT_NOT_SUPPORTED','STOP_NAME_CLARIFICATION_REQUIRED','PUBLIC_ANCHOR_NAME_UNRESOLVED','PLACE_LOCATION_REQUIRED','CLARIFICATION_REQUIRED','SEARCH_FIELDS_UNRESOLVED','ORIGIN_OR_DESTINATION_UNRESOLVED','EXPLICIT_TIME_REQUIRES_RESOLUTION_NO_DEFAULT_ALLOWED'].includes(report.code);
 const unavailable=report.stage==='provider-selection';
 const guidance=report.code==='REFINEMENT_AREA_REQUIRED'?'areaQuestion':report.code==='REFINEMENT_NOT_SUPPORTED'?'refineUnsupported':unavailable?'providerUnavailable':report.code==='STOP_NAME_CLARIFICATION_REQUIRED'?'stopClarify':report.code==='PUBLIC_ANCHOR_NAME_UNRESOLVED'?'anchorClarify':report.code==='PLACE_LOCATION_REQUIRED'?'whereSearch':report.stage==='privacy'?'privacyBlocked':clarification?'clarify':report.stage==='semantic'||report.stage==='extraction'?'interpretation':report.code==='CLOCK_UNVERIFIED'?'clock':(report.stage==='real-search'&&report.code!=='LIVE_NO_RESULTS'||report.code==='LIVE_STATION_LOOKUP_EMPTY_OR_FAILED')?'sourceUnavailable':'broaden';
 return {status:cards.length?'results':clarification?'clarification':'no-results',resultType:cards.length?(cards.some(c=>c.resultType==='MATCHED')?'MATCHED':'POSSIBLE'):clarification?'CLARIFICATION_REQUIRED':'NO_SUFFICIENT_RESULT',guidance,summary,refinements:report.REFINEMENT_ALLOWED?['change-location',...(summary.city==='Berlin'?['change-area']:[])]:['new-search'],canKeepLooking:Boolean(searchAcceptance(report)),stage:report.stage,understanding:(report.ENTITIES??[]).map(e=>clean(e.description?.value)).filter(Boolean),cards,independentlyVerified:false};
}
module.exports={resultView};
