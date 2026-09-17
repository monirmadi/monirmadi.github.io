'use strict';
const {routeUniversalSearch}=require('./universal-search-strategy-router.cjs');
const {getProvider}=require('./provider-registry.cjs');
const {BOUNDARY}=require('./psaksiconcepts.cjs');
const unknown=()=>({state:'unknown'});
const observed=(value,indexes=[0])=>({state:'known',value,epistemicStatus:'SOURCE_DERIVED',evidenceIndexes:indexes});
function candidateFromProviderResult(envelope,resultIndex=0){
 const r=envelope?.results?.[resultIndex],p=getProvider(r?.provenance?.providerId);
 if(!p||r?.epistemicStatus!=='SOURCE_DERIVED'||r.actionAuthority!=='NONE'||r.worldVerification!=='UNVERIFIED'||!['source-results','unverified-results'].includes(envelope.status))return {...BOUNDARY,status:'blocked',code:'INVALID_SOURCE_RESULT'};
 let origin=false;try{origin=new URL(r.provenance.url).origin===new URL(p.baseUrl).origin;}catch{}
 if(!origin||r.provenance.responseSha256!==envelope.provenance?.responseSha256||r.provenance.url!==envelope.provenance?.url)return {...BOUNDARY,status:'blocked',code:'PROVENANCE_MISMATCH'};
 const v=r.value;
 if(!v||typeof v!=='object'||Array.isArray(v))return {...BOUNDARY,status:'blocked',code:'INVALID_RESULT_VALUE'};
 const candidate={id:String(v.id??v.tripId??''),intent:unknown(),entityType:unknown(),role:null,location:null,time:null,attributes:{},provenance:[structuredClone(r.provenance)],uncertainty:[],freshness:{basis:'UNKNOWN',sourceUpdatedAt:null},...BOUNDARY};
 if(p.id==='photon-places'){
  if(v.entityType!=='PLACE'||v.countryCode!=='DE')return {...BOUNDARY,status:'blocked',code:'INVALID_PLACE'};
  candidate.intent=observed('PLACE_INFORMATION');candidate.entityType=observed('PLACE');candidate.role=observed('PLACE');candidate.location=v.location?observed(v.location):null;
  candidate.attributes.COUNTRY=observed(v.countryCode);if(v.city)candidate.attributes.LOCATION=observed(v.city);if(v.area)candidate.attributes.AREA=observed(v.area);if(v.category)candidate.attributes.CATEGORY=observed(v.category);
 }else if(p.id==='govdata-catalog'){
  if(v.entityType!=='INFORMATION_RESOURCE')return {...BOUNDARY,status:'blocked',code:'INVALID_DATASET'};
  candidate.intent=observed('INFORMATION_RESOURCE');candidate.entityType=observed('INFORMATION_RESOURCE');candidate.role=observed('INFORMATION_SOURCE');
  if(v.licenseId)candidate.attributes.LICENSE=observed(v.licenseId);
  // Catalogue membership does not establish relevance to the full Need.
  candidate.uncertainty.push('TOPIC_RELEVANCE_REQUIRES_REVIEW');
  if(v.requestedCapability){candidate.uncertainty.push('GEOGRAPHIC_RELEVANCE_REQUIRES_REVIEW','CATALOG_NOT_OFFICIAL_INSTRUCTIONS_OR_AVAILABILITY');}
 }else if(p.id==='bvg-transport-v6'&&v.entityType==='TRANSPORT_SERVICE'&&Array.isArray(v.legs)){
  candidate.intent=observed('JOURNEY_INFORMATION');candidate.entityType=observed('TRANSPORT_SERVICE');candidate.attributes.ORIGIN_ID=observed(v.originId);candidate.attributes.DESTINATION_ID=observed(v.destinationId);candidate.attributes.CANCELLED=observed(v.cancelled);candidate.time=observed({start:v.departure,end:v.arrival});candidate.freshness={basis:'SOURCE_UPDATE',sourceUpdatedAt:r.provenance.sourceUpdatedAt??null};candidate.uncertainty.push('USER_TRAVEL_TIME_UNSPECIFIED');
  if(envelope.freshness?.status!=='FRESH')candidate.uncertainty.push('SOURCE_FRESHNESS_UNVERIFIED');
 }else if(p.id==='bvg-transport-v6'&&typeof v.tripId==='string'){
  candidate.intent=observed('DEPARTURE_INFORMATION');candidate.entityType=observed('TRANSPORT_SERVICE');candidate.attributes.LINE=observed(v.line);candidate.attributes.CANCELLED=observed(v.cancelled);candidate.freshness={basis:'SOURCE_UPDATE',sourceUpdatedAt:r.provenance.sourceUpdatedAt??null};
  if(envelope.freshness?.status!=='FRESH')candidate.uncertainty.push('SOURCE_FRESHNESS_UNVERIFIED');
 }else return {...BOUNDARY,status:'blocked',code:'UNSUPPORTED_RESULT_TYPE'};
 return {...BOUNDARY,status:'candidate',candidate,sourceQuality:{role:p.reliability.role,publisher:p.provenance.publisher,independentVerification:false}};
}
// Re-enter the existing evidence boundary. Matching one explicit action/target avoids
// combining unrelated needs or silently choosing an alternative interpretation.
function matchingNeedFromExtraction(input,context,{actionId,entityId}={}){
 const route=routeUniversalSearch(input,context);
 if(route.status!=='candidate'||route.unresolvedStrategyAlternatives.length||route.clarificationNeeds.length)return {...BOUNDARY,status:'blocked',code:'ROUTE_NOT_RESOLVED',route};
 const i=input.proposal.need.interpretation.intent,a=i.actions.find(a=>a.id===actionId),e=i.entities.find(e=>e.id===entityId);
 if(!a||!e||!a.entityIds.includes(entityId))return {...BOUNDARY,status:'blocked',code:'EXPLICIT_ACTION_TARGET_REQUIRED'};
 const routes=[route.primaryStrategy,...route.secondaryStrategies].filter(Boolean).filter(s=>s.actionIds.includes(actionId));
 const strategy=routes.find(s=>['GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE','PLACE_SEARCH','GENERAL_INFORMATION','HOUSING_SEARCH','SERVICE_SEARCH','REPAIR_HELP','EXPERIENCE_MATCHING','PEOPLE_MATCHING','OPPORTUNITY_SEARCH','TRANSPORT_STATUS','TRANSPORT_SEARCH','BORROW','BUY','HELP_REQUEST','LIVE_INTENT'].includes(s.kind));
 if(!strategy)return {...BOUNDARY,status:'blocked',code:'UNSUPPORTED_MATCH_INTENT'};
 const provenance=input.textReferences.map(t=>({reference:t.reference,sourceFingerprint:route.provenance.sourceFingerprint,target:t.target}));
 function field(f,path){const indexes=input.textReferences.flatMap((t,n)=>t.target===path?[n]:[]);return f?.state==='known'?{state:'known',value:f.value,epistemicStatus:'INTERPRETED',evidenceIndexes:indexes}:unknown();}
 const ai=i.actions.indexOf(a),ei=i.entities.indexOf(e),root='/interpretation/intent';
 const intent=field(a.verb,`${root}/actions/${ai}/verb`);if(intent.state==='known')intent.value=strategy.kind;
 const profile={id:input.proposal.need.id,intent,entityType:field(e.kind,`${root}/entities/${ei}/kind`),role:null,location:null,time:null,constraints:[],provenance,uncertainty:['SEMANTIC_SUPPORT_NOT_AUTHENTICATED'],trustRequirement:'ATTRIBUTED',...BOUNDARY};
 for(const [ci,q]of i.constraints.entries())if([input.proposal.need.id,a.id,e.id].includes(q.subjectId)){
  const value=field(q.value,`${root}/constraints/${ci}/value`),constraint={dimension:q.dimension.toUpperCase(),operator:q.operator,value};
  if(q.unit?.state==='known')constraint.unit=q.unit.value;
  profile.constraints.push(constraint);
 }
 if(['GOVERNMENT_SERVICE_INFORMATION','HOUSING_INFORMATION'].includes(profile.entityType.value))profile.entityType.value='INFORMATION_RESOURCE';
 if(i.roles.some(r=>r.actionId===a.id))profile.uncertainty.push('ROLE_NORMALIZATION_REQUIRES_REVIEW');
 return {...BOUNDARY,status:'candidate',profile,route};
}
module.exports={candidateFromProviderResult,matchingNeedFromExtraction};
