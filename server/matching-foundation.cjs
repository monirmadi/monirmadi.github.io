'use strict';
const {BOUNDARY}=require('./psaksiconcepts.cjs');
const {getProvider}=require('./provider-registry.cjs');
const CLASSIFICATIONS=Object.freeze(['USER_STATED','INTERPRETED','SOURCE_DERIVED','AI_INFERRED','UNVERIFIED','REAL_WORLD_VERIFIED']);
const PAIRS=Object.freeze({GOVERNMENT_SERVICES:['INFORMATION_RESOURCE'],HOUSING_INTELLIGENCE:['INFORMATION_RESOURCE'],HOUSING_SEARCH:['HOUSING_OFFER'],HELP_REQUEST:['HELP_OFFER'],LOST:['FOUND'],BORROW:['LEND'],BUY:['SELL'],EXPERIENCE_MATCHING:['EXPERIENCED_PERSON'],LIVE_INTENT:['LIVE_INTENT'],PEOPLE_MATCHING:['PERSON_AVAILABLE'],SERVICE_SEARCH:['SERVICE_OFFER'],REPAIR_HELP:['SERVICE_OFFER'],PLACE_SEARCH:['PLACE_INFORMATION'],GENERAL_INFORMATION:['INFORMATION_RESOURCE'],OPPORTUNITY_SEARCH:['OPPORTUNITY_OFFER'],OPPORTUNITY_OFFER:['OPPORTUNITY_SEEKER'],TRANSPORT_STATUS:['DEPARTURE_INFORMATION'],TRANSPORT_SEARCH:['JOURNEY_INFORMATION']});
const ROLES=Object.freeze({SEEKER:['OFFERER'],HELP_SEEKER:['HELPER'],OWNER:['FINDER'],BORROWER:['LENDER'],BUYER:['SELLER'],LEARNER:['EXPERIENCED_PERSON'],PARTICIPANT:['PARTICIPANT'],CUSTOMER:['SERVICE_PROVIDER'],VISITOR:['PLACE'],INFORMATION_SEEKER:['INFORMATION_SOURCE'],APPLICANT:['OPPORTUNITY_PROVIDER'],OPPORTUNITY_PROVIDER:['APPLICANT']});
function copyPlain(x){let count=0;const seen=new Set();function walk(v,depth){if(++count>15000||depth>20)throw Error('INPUT_LIMIT');if(v===null||typeof v==='boolean')return v;if(typeof v==='string'){if(v.length>10000)throw Error('INPUT_LIMIT');return v;}if(typeof v==='number'&&Number.isFinite(v))return v;if(!v||typeof v!=='object'||seen.has(v)||(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v))))throw Error('INVALID_INPUT');seen.add(v);const out=Array.isArray(v)?[]:{};for(const k of Object.keys(v)){if(['__proto__','constructor','prototype'].includes(k))throw Error('INVALID_INPUT');const d=Object.getOwnPropertyDescriptor(v,k);if(!Object.hasOwn(d,'value'))throw Error('INVALID_INPUT');out[k]=walk(d.value,depth+1);}seen.delete(v);return out;}return walk(x,0);}
function validSource(p){return p&&typeof p.url==='string'&&/^https:\/\//.test(p.url)&&Number.isFinite(Date.parse(p.retrievedAt))&&/^[a-f0-9]{64}$/.test(p.responseSha256||'');}
function usable(f,profile){
 if(f?.state!=='known'||!CLASSIFICATIONS.includes(f.epistemicStatus)||['AI_INFERRED','UNVERIFIED','REAL_WORLD_VERIFIED'].includes(f.epistemicStatus)||!Array.isArray(f.evidenceIndexes)||!f.evidenceIndexes.length)return false;
 return f.evidenceIndexes.every(i=>Number.isInteger(i)&&i>=0&&i<profile.provenance.length&&(f.epistemicStatus==='SOURCE_DERIVED'?validSource(profile.provenance[i]):typeof profile.provenance[i]?.reference==='string'));
}
function haversine(a,b){const rad=Math.PI/180,dlat=(b.latitude-a.latitude)*rad,dlon=(b.longitude-a.longitude)*rad;const h=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));}
function approximateLocation(v){return v&&v.precision==='approximate'&&Number.isFinite(v.latitude)&&Math.abs(v.latitude)<=90&&Number.isFinite(v.longitude)&&Math.abs(v.longitude)<=180&&Number.isFinite(v.uncertaintyMeters)&&v.uncertaintyMeters>=1000&&Math.abs(v.latitude*100-Math.round(v.latitude*100))<1e-7&&Math.abs(v.longitude*100-Math.round(v.longitude*100))<1e-7;}
function absolute(v){return typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;}
function matchNeedToCandidate(need,candidate,{now=Date.now()}={}){
 const dimensions=[];
 const add=(dimension,status,code,detail={})=>dimensions.push({dimension,status,code,...detail});
 const finish=()=>({...BOUNDARY,policyVersion:'matching-1',status:dimensions.some(d=>d.status==='incompatible')?'incompatible':dimensions.some(d=>d.status==='unresolved')?'unresolved':'compatible',matchReasons:dimensions.filter(d=>d.status==='compatible'),conflictReasons:dimensions.filter(d=>d.status==='incompatible'),missingInformation:dimensions.filter(d=>d.status==='unresolved'),confidenceComponents:dimensions.map(d=>({dimension:d.dimension,status:d.status,basis:d.code,score:null})),dimensions,scope:'COMPATIBILITY_OF_REPORTED_INFORMATION_ONLY',executionAllowed:false});
 let n,c;try{[n,c]=copyPlain([need,candidate]);}catch{add('input','unresolved','INVALID_OR_OVERSIZED_INPUT');return finish();}
 if(!n||!c||!Array.isArray(n.provenance)||!Array.isArray(c.provenance)||!Array.isArray(n.constraints)||!Array.isArray(n.uncertainty)||!Array.isArray(c.uncertainty)||!Number.isFinite(now)){add('input','unresolved','INVALID_PROFILE');return finish();}
 function pair(d,a,b,allowed){
  if(!usable(a,n)||!usable(b,c)){add(d,'unresolved','MISSING_OR_UNSUPPORTED_EVIDENCE');return;}
  if(typeof a.value!=='string'||typeof b.value!=='string'||!/^([A-Z][A-Z0-9_]{0,63})$/.test(a.value)||!/^([A-Z][A-Z0-9_]{0,63})$/.test(b.value)){add(d,'unresolved','INVALID_VALUE_TYPE');return;}
  const values=allowed(a.value);if(!values){add(d,'unresolved','UNMAPPED_RELATION');return;}
  add(d,values.includes(b.value)?'compatible':'incompatible',values.includes(b.value)?'EXPLICIT_COMPATIBILITY_RULE':'CONFLICTING_REPORTED_VALUES',{evidence:{need:a.evidenceIndexes,candidate:b.evidenceIndexes}});
 }
 pair('intent',n.intent,c.intent,v=>Object.hasOwn(PAIRS,v)?PAIRS[v]:null);
 pair('entityType',n.entityType,c.entityType,v=>[v]);
 if(n.role==null)add('role','compatible','NOT_REQUIRED');else pair('role',n.role,c.role,v=>Object.hasOwn(ROLES,v)?ROLES[v]:null);
 if(n.location==null)add('location','compatible','NOT_REQUIRED');
 else if(!usable(n.location,n)||!usable(c.location,c)||!approximateLocation(n.location.value)||!approximateLocation(c.location.value)||!Number.isFinite(n.location.value.radiusMeters)||n.location.value.radiusMeters<0)add('location','unresolved','APPROXIMATE_LOCATION_AND_RADIUS_REQUIRED');
 else{
  const a=n.location.value,b=c.location.value,d=haversine(a,b),error=a.uncertaintyMeters+b.uncertaintyMeters,min=Math.max(0,d-error),max=d+error;
  add('location',max<=a.radiusMeters?'compatible':min>a.radiusMeters?'incompatible':'unresolved',max<=a.radiusMeters?'WITHIN_RADIUS_WITH_UNCERTAINTY':min>a.radiusMeters?'OUTSIDE_RADIUS':'DISTANCE_UNCERTAINTY_OVERLAPS_BOUNDARY',{distanceRangeMeters:{min:Math.floor(min/1000)*1000,max:Math.ceil(max/1000)*1000}});
 }
 if(n.time==null)add('time','compatible','NOT_REQUIRED');
 else if(!usable(n.time,n)||!usable(c.time,c))add('time','unresolved','AVAILABILITY_MISSING');
 else{
  const ns=absolute(n.time.value?.start),ne=absolute(n.time.value?.end),cs=absolute(c.time.value?.start),ce=absolute(c.time.value?.end);
  if(![ns,ne,cs,ce].every(Number.isFinite)||ne<=ns||ce<=cs)add('time','unresolved','EXPLICIT_VALID_TIME_WINDOWS_REQUIRED');
  else if(ce<=now)add('time','incompatible','CANDIDATE_AVAILABILITY_EXPIRED');
  else add('time',cs<=ns&&ce>=ne?'compatible':ce<=ns||cs>=ne?'incompatible':'unresolved',cs<=ns&&ce>=ne?'REPORTED_WINDOW_COVERS_NEED':ce<=ns||cs>=ne?'TIME_WINDOWS_CONFLICT':'PARTIAL_TIME_OVERLAP');
 }
 if(!n.constraints.length)add('constraints','compatible','NONE_SUPPLIED');
 for(const [i,q] of n.constraints.entries()){
  const dimension=q?.operator==='excludes'?'exclusions':'constraints';
  const fail=code=>add(dimension,'unresolved',code,{constraintIndex:i});
  if(!q||typeof q.dimension!=='string'||!['equals','excludes','at-most','at-least','prefers'].includes(q.operator)){fail('UNSUPPORTED_CONSTRAINT');continue;}
  const actual=Object.hasOwn(c.attributes||{},q.dimension)?c.attributes[q.dimension]:null;
  if(!usable(q.value,n)||!usable(actual,c)){fail('CONSTRAINT_VALUE_OR_EVIDENCE_MISSING');continue;}
  if(q.unit!==actual.unit){fail('UNIT_MISMATCH_NO_CONVERSION');continue;}
  const a=actual.value,v=q.value.value;
  let met;
  if(['at-most','at-least'].includes(q.operator)){if(typeof a!=='number'||typeof v!=='number'){fail('NUMERIC_CONSTRAINT_REQUIRES_NUMBERS');continue;}met=q.operator==='at-most'?a<=v:a>=v;}
  else if(['string','number','boolean'].includes(typeof v)&&(['string','number','boolean'].includes(typeof a)||Array.isArray(a)&&a.every(x=>['string','number','boolean'].includes(typeof x)))){const equal=Array.isArray(a)?a.includes(v):a===v;met=q.operator==='excludes'?!equal:equal;}
  else{fail('UNSUPPORTED_CONSTRAINT_VALUE');continue;}
  add(dimension,met?'compatible':q.operator==='prefers'?'compatible':'incompatible',met?'EXPLICIT_CONSTRAINT_SATISFIED':q.operator==='prefers'?'PREFERENCE_NOT_MET_NON_BLOCKING':'EXPLICIT_CONSTRAINT_CONFLICT',{constraintIndex:i,evidence:{need:q.value.evidenceIndexes,candidate:actual.evidenceIndexes}});
 }
 // Freshness claims are recomputed from source time, never taken from a 'FRESH' label.
 const sourceTime=absolute(c.freshness?.sourceUpdatedAt);
 if(n.maxSourceAgeMs==null)add('freshness','compatible','NOT_REQUIRED_SOURCE_AGE_NOT_ASSUMED');
 else if(!Number.isFinite(n.maxSourceAgeMs)||n.maxSourceAgeMs<0||!Number.isFinite(sourceTime)||c.freshness?.basis!=='SOURCE_UPDATE'||!c.provenance.some(p=>validSource(p)&&p.sourceUpdatedAt===c.freshness.sourceUpdatedAt))add('freshness','unresolved','SOURCE_AGE_NOT_ESTABLISHED');
 else add('freshness',sourceTime>now+30000?'unresolved':now-sourceTime>n.maxSourceAgeMs?'incompatible':'compatible',sourceTime>now+30000?'SOURCE_TIME_IN_FUTURE':now-sourceTime>n.maxSourceAgeMs?'SOURCE_TOO_OLD':'SOURCE_TIME_WITHIN_REQUIRED_AGE');
 const prov=c.provenance.length>0&&c.provenance.every(p=>validSource(p)||typeof p?.reference==='string');
 add('provenance',prov?'compatible':'unresolved',prov?'INSPECTABLE_LINEAGE_PRESENT':'MISSING_LINEAGE');
 const sources=c.provenance.filter(p=>p.url);
 const sourceQuality=sources.map(p=>{const registry=getProvider(p.providerId);let origin=false;try{origin=registry&&new URL(p.url).origin===new URL(registry.baseUrl).origin;}catch{}return {providerId:registry?.id??null,reviewedOrigin:Boolean(origin),role:origin?registry.reliability.role:null,independentVerification:false};});
 add('sourceQuality',sourceQuality.every(p=>p.reviewedOrigin)?'compatible':'unresolved',sources.length?'SOURCE_POLICY_REVIEW_NOT_TRUTH_PROOF':'USER_REPORT_ONLY',{sources:sourceQuality});
 if(sources.some(p=>Date.parse(p.retrievedAt)>now+30000||p.sourceUpdatedAt&&Date.parse(p.sourceUpdatedAt)>Date.parse(p.retrievedAt)+30000))add('provenanceTime','unresolved','SOURCE_OR_RETRIEVAL_TIME_IN_FUTURE');
 const requirement=n.trustRequirement??'ATTRIBUTED';
 add('trust',requirement==='ATTRIBUTED'&&prov?'compatible':'unresolved',requirement==='ATTRIBUTED'&&prov?'ATTRIBUTED_NOT_INDEPENDENTLY_VERIFIED':'INDEPENDENT_VERIFICATION_NOT_IMPLEMENTED');
 const uncertainty=[...n.uncertainty,...c.uncertainty];
 add('uncertainty',uncertainty.length?'unresolved':'compatible',uncertainty.length?'UNRESOLVED_PROFILE_ASSUMPTIONS':'NO_ADDITIONAL_ASSUMPTIONS_REPORTED',{count:uncertainty.length});
 return finish();
}
module.exports={CLASSIFICATIONS,PAIRS,ROLES,matchNeedToCandidate,usable,copyPlain};
