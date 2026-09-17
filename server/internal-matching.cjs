'use strict';
const {BOUNDARY}=require('./psaksiconcepts.cjs');
const {usable}=require('./matching-foundation.cjs');
const {SOURCE_TYPE,ROLE_PAIRS,absolute,validateInternalRecord}=require('../contracts/internal-record.cjs');
const {gateSubject,proceed,sanitizeCandidateOutput}=require('./trust-safety-gate.cjs');
const MAX_LIVE_LIFETIME_MS=24*60*60*1000;
function eligibility(input,{now=Date.now()}={}){
 const v=validateInternalRecord(input);
 if(!v.valid)return {eligible:false,reasons:v.errors};
 const r=v.record,reasons=[];
 if(!Number.isFinite(now)||absolute(r.updatedAt)>now)reasons.push('CLOCK_OR_RECORD_TIME_INVALID');
 if(r.lifecycle!=='ACTIVE')reasons.push('RECORD_NOT_ACTIVE');
 if(r.expiresAt!==null&&absolute(r.expiresAt)<=now)reasons.push('RECORD_EXPIRED');
 if(r.permissions.discoverability!==true)reasons.push('DISCOVERABILITY_NOT_ALLOWED');
 if(r.permissions.matching!==true||!r.permissions.consentReference)reasons.push('MATCHING_CONSENT_NOT_ESTABLISHED');
 if(r.privacy!=='MATCHING_ONLY')reasons.push('PRIVACY_FORBIDS_MATCHING');
 if(r.moderation!=='NOT_ASSESSED')reasons.push('SAFETY_GATE_INELIGIBLE');
 if(r.role.value==='LIVE_INTENT'&&(r.expiresAt===null||absolute(r.expiresAt)-absolute(r.createdAt)>MAX_LIVE_LIFETIME_MS||r.time?.state!=='known'||absolute(r.time.value.end)>absolute(r.expiresAt)))reasons.push('LIVE_INTENT_REQUIRES_SHORT_EXPIRY_AND_WINDOW');
 return {eligible:reasons.length===0,reasons,scope:'STRUCTURAL_ONLY',requiresSafetyGate:true};
}
// This hook neither retains records nor schedules work. Consent must be rechecked later.
function persistentSearchHook(input,options){
 const v=validateInternalRecord(input),gate=eligibility(input,options);
 const safetyGate=v.valid?gateSubject(v.record,'INTERNAL_MATCHING',{...options,permissions:{INTERNAL_MATCHING:v.record.permissions.matching,DISCOVERABILITY:v.record.permissions.discoverability},privacy:v.record.privacy}):null;
 return {...BOUNDARY,eligibleForFutureEvaluation:Boolean(v.valid&&gate.eligible&&v.record.persistentSearch.optIn&&proceed(safetyGate)),requiresEligibilityRecheck:true,schedulingEnabled:false,notificationsEnabled:false};
}
function matchInternalRecords(left,right,{now=Date.now(),safety}={}){
 const gates=[eligibility(left,{now}),eligibility(right,{now})],dimensions=[];
 const add=(dimension,status,code,detail={})=>dimensions.push({dimension,status,code,...detail});
 const finish=state=>({...BOUNDARY,sourceType:SOURCE_TYPE,policyVersion:'internal-matching-1',state,compatible:state==='MATCH_CANDIDATE',ownershipVerification:'UNVERIFIED',communicationAuthorized:false,executionAllowed:false,scope:'COMPATIBILITY_OF_USER_REPORTS_ONLY',dimensions,reasons:dimensions.filter(d=>d.status==='compatible'),blockingReasons:dimensions.filter(d=>d.status==='incompatible'),unresolved:dimensions.filter(d=>d.status==='unresolved'),confidenceComponents:dimensions.map(d=>({dimension:d.dimension,status:d.status,basis:d.code,score:null}))});
 if(gates.some(g=>!g.eligible)){
  gates.forEach((g,i)=>g.reasons.forEach(code=>add('eligibility','incompatible',code,{side:i===0?'left':'right'})));
  return finish('MATCH_BLOCKED');
 }
 const a=validateInternalRecord(left).record,b=validateInternalRecord(right).record;
 for(const r of [a,b]){
  const gate=gateSubject(r,'INTERNAL_MATCHING',{now,safety,permissions:{INTERNAL_MATCHING:r.permissions.matching,DISCOVERABILITY:r.permissions.discoverability},privacy:r.privacy});
  if(!proceed(gate)){for(const reason of gate.reasons)add('safety',gate.decision==='BLOCK'?'incompatible':'unresolved',reason.code);return {...finish(gate.decision==='BLOCK'?'MATCH_BLOCKED':'MATCH_UNRESOLVED'),safetyDecision:gate};}
 }
 if(a.id===b.id||a.needReference===b.needReference){add('eligibility','incompatible','SAME_RECORD_OR_NEED');return finish('MATCH_BLOCKED');}
 add('privacy','compatible','MATCHING_SCOPE_EXPLICIT');add('consent','compatible','BOTH_MATCHING_OPT_INS_PRESENT');
 const known=(f,r)=>usable(f,r);
 function compare(d,x,y,predicate){
  if(!known(x,a)||!known(y,b)){add(d,'unresolved','REQUIRED_REPORTED_VALUE_MISSING');return;}
  add(d,predicate(x.value,y.value)?'compatible':'incompatible',predicate(x.value,y.value)?'EXPLICIT_COMPATIBILITY_RULE':'REPORTED_VALUES_CONFLICT');
 }
 compare('role',a.role,b.role,(x,y)=>ROLE_PAIRS.some(([l,r])=>l===x&&r===y||l===y&&r===x));
 // Intent is the shared purpose; role expresses its complementary direction.
 compare('intent',a.intent,b.intent,(x,y)=>x===y);
 if([...a.entities.map(f=>[f,a]),...b.entities.map(f=>[f,b])].some(([f,r])=>!known(f,r)))add('entity','unresolved','ENTITY_INFORMATION_MISSING');
 else{
  const aa=new Set(a.entities.map(f=>f.value)),bb=new Set(b.entities.map(f=>f.value));
  const equal=aa.size===bb.size&&[...aa].every(x=>bb.has(x));
  add('entity',equal?'compatible':'incompatible',equal?'REPORTED_ENTITY_TYPES_AGREE':'ENTITY_TYPES_CONFLICT');
 }
 const live=a.role.value==='LIVE_INTENT'||b.role.value==='LIVE_INTENT';
 if(a.location===null&&b.location===null&&!live)add('location','compatible','NO_GEOGRAPHIC_REQUIREMENT');
 else if(!known(a.location,a)||!known(b.location,b))add('location','unresolved','GEOGRAPHIC_SCOPE_REQUIRED');
 else{
  const x=a.location.value,y=b.location.value,normalize=s=>s.normalize('NFC').trim().toLowerCase();
  let missing=false,conflict=false;
  for(const key of ['country','region','city','district']){
   if(x[key]===undefined&&y[key]===undefined)continue;
   if(x[key]===undefined||y[key]===undefined)missing=true;
   else if(normalize(x[key])!==normalize(y[key]))conflict=true;
  }
  add('location',conflict?'incompatible':missing?'unresolved':'compatible',conflict?'GEOGRAPHIC_SCOPE_CONFLICT':missing?'GEOGRAPHIC_DETAIL_MISSING':'PERMITTED_AREA_AGREES_DISTANCE_NOT_ESTABLISHED');
 }
 if(a.time===null&&b.time===null&&!live)add('time','compatible','NO_TIME_REQUIREMENT');
 else if(!known(a.time,a)||!known(b.time,b))add('time','unresolved','AVAILABILITY_WINDOW_REQUIRED');
 else{
  const start=Math.max(now,absolute(a.time.value.start),absolute(b.time.value.start));
  const end=Math.min(absolute(a.time.value.end),absolute(b.time.value.end),a.expiresAt===null?Infinity:absolute(a.expiresAt),b.expiresAt===null?Infinity:absolute(b.expiresAt));
  add('time',start<end?'compatible':'incompatible',start<end?'REPORTED_WINDOWS_OVERLAP':'NO_REMAINING_TIME_OVERLAP');
 }
 const available=[a.availability,b.availability];
 add('availability',available.includes('UNAVAILABLE')?'incompatible':available.includes('UNKNOWN')?'unresolved':'compatible',available.includes('UNAVAILABLE')?'REPORTED_UNAVAILABLE':available.includes('UNKNOWN')?'AVAILABILITY_UNKNOWN':'BOTH_REPORT_AVAILABLE');
 for(const [request,candidate,side] of [[a,b,'left'],[b,a,'right']]){
  for(const [index,q] of request.constraints.entries()){
   const d=q.operator==='excludes'?'exclusions':'constraints',actual=candidate.attributes[q.dimension],detail={side,constraintIndex:index};
   if(!known(q.value,request)||!known(actual,candidate)){add(d,'unresolved','CONSTRAINT_EVIDENCE_MISSING',detail);continue;}
   if(q.unit!==actual.unit||q.value.unit!==undefined&&q.value.unit!==q.unit){add(d,'unresolved','UNITS_NOT_COMPARABLE',detail);continue;}
   const v=q.value.value,x=actual.value;
   if(['at-most','at-least'].includes(q.operator)&&(typeof v!=='number'||typeof x!=='number')){add(d,'unresolved','NUMERIC_VALUES_REQUIRED',detail);continue;}
   const equal=Array.isArray(x)?x.includes(v):x===v;
   const met=q.operator==='at-most'?x<=v:q.operator==='at-least'?x>=v:q.operator==='excludes'?!equal:equal;
   add(d,met?'compatible':'incompatible',met?'REPORTED_CONSTRAINT_SATISFIED':'EXPLICIT_CONSTRAINT_CONFLICT',detail);
  }
 }
 if(!a.constraints.length&&!b.constraints.length)add('constraints','compatible','NONE_SUPPLIED');
 add('trust',[a,b].every(r=>r.trustRequirement==='ATTRIBUTED')?'compatible':'unresolved',[a,b].every(r=>r.trustRequirement==='ATTRIBUTED')?'ATTRIBUTED_USER_REPORTS_NOT_IDENTITY_VERIFICATION':'REQUIRED_TRUST_NOT_ESTABLISHED');
 add('provenance','compatible','INTERNAL_USER_EVIDENCE_REFERENCES_VALID');
 add('freshness','compatible','ACTIVE_NOT_EXPIRED_CONTENT_NOT_INDEPENDENTLY_RECONFIRMED');
 add('uncertainty',a.uncertainty.length||b.uncertainty.length?'unresolved':'compatible',a.uncertainty.length||b.uncertainty.length?'UNRESOLVED_REPORTED_ASSUMPTIONS':'NO_REPORTED_ASSUMPTIONS');
 const state=dimensions.some(d=>d.status==='incompatible')?'NO_MATCH':dimensions.some(d=>d.status==='unresolved')?'MATCH_UNRESOLVED':'MATCH_CANDIDATE';
 const result=finish(state);
 // Only opaque references leave the boundary; never attributes, text, locations or contacts.
 result.provenance=sanitizeCandidateOutput({provenance:[a,b].map(r=>({sourceType:SOURCE_TYPE,recordReference:r.id,needReference:r.needReference,epistemicStatus:'USER_STATED',evidenceReferences:r.provenance.map(p=>p.reference),updatedAt:r.updatedAt}))}).provenance;
 result.trustSignals=['USER_DECLARED','IDENTITY_UNVERIFIED','OWNERSHIP_UNVERIFIED','FRESHNESS_UNKNOWN','CONSENT_PRESENT','COMMUNICATION_NOT_AUTHORIZED'];
 return result;
}
module.exports={matchInternalRecords,eligibility,persistentSearchHook,MAX_LIVE_LIFETIME_MS};
