'use strict';
const {createHash}=require('node:crypto');
const {copyPlain}=require('./matching-foundation.cjs');
const {fingerprint}=require('../contracts/saved-search-request.cjs');
const {absolute}=require('../contracts/internal-record.cjs');
const {BOUNDARY}=require('./psaksiconcepts.cjs');
const {getProvider}=require('./provider-registry.cjs');
const {ROLE_PAIRS}=require('../contracts/internal-record.cjs');
const {KINDS}=require('./search-strategy-policy.cjs');
const {PURPOSES,PROHIBITED,CONTEXTS,PRIVACY,VERSION}=require('../contracts/trust-safety.cjs');
const proceed=d=>['ALLOW','ALLOW_WITH_RESTRICTIONS'].includes(d?.decision);
// Assessment is a CURRENT server-owned review, not user/model JSON. Fingerprints
// bind content; they are not signatures or proof that a reviewer was honest.
function trustSafetyDecision(input){
 const reasons=[],restrictions=['NO_CONTACT','NO_PAYMENT_OR_HANDOVER','NO_IDENTITY_OR_OWNERSHIP_PROOF','NO_PRECISE_LOCATION_DISCLOSURE'];
 const finish=decision=>({...BOUNDARY,policyVersion:VERSION,decision,reasons,restrictions,trustSignals:['IDENTITY_UNVERIFIED','OWNERSHIP_UNVERIFIED','FRESHNESS_UNKNOWN','COMMUNICATION_NOT_AUTHORIZED',...(reasons.some(r=>r.dimension==='consent')?['CONSENT_MISSING']:[])],communicationAuthorized:false,notificationAuthorized:false});
 const reason=(code,dimension)=>reasons.push({code,dimension});let x;
 try{x=copyPlain(input);}catch{reason('INVALID_POLICY_INPUT','input');return finish('BLOCK');}
 if(!x||!PURPOSES.includes(x.purpose)||!Number.isFinite(x.now)||typeof x.subjectFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(x.subjectFingerprint)||x.exposure!==undefined&&!Array.isArray(x.exposure)){reason('INVALID_POLICY_INPUT','input');return finish('BLOCK');}
 const a=x.assessment;
 // A deterministic prohibition wins even if another supplied field claims ALLOW.
 if(Array.isArray(a?.categories)&&a.categories.some(c=>PROHIBITED.includes(c))){for(const c of a.categories.filter(c=>PROHIBITED.includes(c)))reason(c,'safety');return finish('BLOCK');}
 if(x.exposure?.some(k=>!Object.hasOwn(PRIVACY,k)||['PRIVATE','SENSITIVE','PROHIBITED_TO_EXPOSE'].includes(PRIVACY[k]))){reason('PROHIBITED_EXPOSURE','privacy');return finish('BLOCK');}
 if(x.exposure?.some(k=>PRIVACY[k]==='MATCHING_ONLY')&&(x.permissions?.INTERNAL_MATCHING!==true||x.permissions?.DISCOVERABILITY!==true)){reason('MATCHING_DISCLOSURE_CONSENT_REQUIRED','privacy');return finish('REQUIRE_CONFIRMATION');}
 if(['COMMUNICATION','FUTURE_NOTIFICATION'].includes(x.purpose)){reason('ACTION_NOT_IMPLEMENTED_OR_AUTHORIZED','authority');return finish('BLOCK');}
 if(x.purpose!=='ASSESS_CONTENT'){
  // Eligibility to propose a future alert is not authority to send one.
  const needed=x.purpose==='INTERNAL_MATCHING'?['INTERNAL_MATCHING','DISCOVERABILITY']:x.purpose==='ALERT_DECISION'?['FUTURE_NOTIFICATION']:[x.purpose];
  for(const p of needed)if(x.permissions?.[p]!==true){reason(p+'_CONSENT_MISSING','consent');return finish(x.permissions?.[p]===false?'BLOCK':'REQUIRE_CONFIRMATION');}
  if(x.purpose==='INTERNAL_MATCHING'&&x.privacy!=='MATCHING_ONLY'){reason('PRIVACY_FORBIDS_MATCHING','privacy');return finish('BLOCK');}
 }
 if(!a){reason('CURRENT_SAFETY_REVIEW_REQUIRED','safety');return finish('REQUIRE_REVIEW');}
 const keys=['subjectFingerprint','policyVersion','status','categories','contexts','reviewReference','reviewedAt','expiresAt'];
 if(typeof a!=='object'||Array.isArray(a)||Object.keys(a).sort().join()!==keys.sort().join()||!['ASSESSED','UNKNOWN','AMBIGUOUS','PENDING'].includes(a.status)||!Array.isArray(a.categories)||!Array.isArray(a.contexts)||a.categories.some(c=>!PROHIBITED.includes(c))||a.contexts.some(c=>!CONTEXTS.includes(c))||typeof a.reviewReference!=='string'||!/^[A-Za-z0-9_-]{1,96}$/.test(a.reviewReference)){reason('INVALID_SAFETY_REVIEW','safety');return finish('REQUIRE_REVIEW');}
 if(a.subjectFingerprint!==x.subjectFingerprint||a.policyVersion!==VERSION||!Number.isFinite(absolute(a.reviewedAt))||absolute(a.reviewedAt)>x.now||!Number.isFinite(absolute(a.expiresAt))||absolute(a.expiresAt)<=x.now){reason('STALE_OR_UNBOUND_SAFETY_REVIEW','safety');return finish('REQUIRE_REVIEW');}
 if(a.status!=='ASSESSED'||a.contexts.length){for(const c of a.contexts)reason(c,'safety');reason('HUMAN_REVIEW_REQUIRED','safety');return finish('REQUIRE_REVIEW');}
 reason('CURRENT_REVIEW_NO_PROHIBITED_FINDINGS','safety');
 const result=finish(x.purpose==='ASSESS_CONTENT'?'ALLOW':'ALLOW_WITH_RESTRICTIONS');
 if(x.purpose!=='ASSESS_CONTENT')result.trustSignals.push('CONSENT_PRESENT');
 return result;
}
function gateSubject(subject,purpose,{safety,now=Date.now(),permissions={},privacy='PRIVATE',exposure=[]}={}){
 try{
 const clean=copyPlain(subject);
 if(['BLOCKED','PENDING'].includes(clean?.moderation))return {...BOUNDARY,policyVersion:VERSION,decision:clean.moderation==='BLOCKED'?'BLOCK':'REQUIRE_REVIEW',reasons:[{code:'EXISTING_MODERATION_GATE',dimension:'safety'}],restrictions:['NO_CONTACT','NO_EXPOSURE'],trustSignals:['IDENTITY_UNVERIFIED','OWNERSHIP_UNVERIFIED','COMMUNICATION_NOT_AUTHORIZED'],communicationAuthorized:false,notificationAuthorized:false};
 return trustSafetyDecision({purpose,subjectFingerprint:fingerprint(clean),assessment:typeof safety==='function'?safety(clean,purpose):null,now,permissions,privacy,exposure});}
 catch{return trustSafetyDecision({purpose,subjectFingerprint:'unavailable',assessment:null,now,permissions,privacy,exposure});}
}
// Allowlist projection, never a recursive blacklist. Text, URLs, arbitrary metadata,
// credentials, consent references and raw IDs are intentionally not forwarded.
const STATES=new Set(['NO_MATCH','MATCH_CANDIDATE','MATCH_BLOCKED','MATCH_UNRESOLVED','NO_CANDIDATE','NEW_CANDIDATE','KNOWN_CANDIDATE','BLOCKED','UNRESOLVED']);
const DIMENSIONS=new Set(['input','eligibility','privacy','consent','safety','role','intent','entity','entityType','location','time','availability','constraints','exclusions','trust','provenance','sourceQuality','freshness','uncertainty','provenanceTime']);
const CODES=new Set(`INVALID_OR_OVERSIZED_INPUT INVALID_PROFILE CLOCK_OR_RECORD_TIME_INVALID RECORD_NOT_ACTIVE RECORD_EXPIRED DISCOVERABILITY_NOT_ALLOWED MATCHING_CONSENT_NOT_ESTABLISHED PRIVACY_FORBIDS_MATCHING SAFETY_GATE_INELIGIBLE LIVE_INTENT_REQUIRES_SHORT_EXPIRY_AND_WINDOW SAME_RECORD_OR_NEED MATCHING_SCOPE_EXPLICIT BOTH_MATCHING_OPT_INS_PRESENT REQUIRED_REPORTED_VALUE_MISSING EXPLICIT_COMPATIBILITY_RULE REPORTED_VALUES_CONFLICT ENTITY_INFORMATION_MISSING REPORTED_ENTITY_TYPES_AGREE ENTITY_TYPES_CONFLICT NO_GEOGRAPHIC_REQUIREMENT GEOGRAPHIC_SCOPE_REQUIRED GEOGRAPHIC_SCOPE_CONFLICT GEOGRAPHIC_DETAIL_MISSING PERMITTED_AREA_AGREES_DISTANCE_NOT_ESTABLISHED NO_TIME_REQUIREMENT AVAILABILITY_WINDOW_REQUIRED REPORTED_WINDOWS_OVERLAP NO_REMAINING_TIME_OVERLAP REPORTED_UNAVAILABLE AVAILABILITY_UNKNOWN BOTH_REPORT_AVAILABLE CONSTRAINT_EVIDENCE_MISSING UNITS_NOT_COMPARABLE NUMERIC_VALUES_REQUIRED REPORTED_CONSTRAINT_SATISFIED EXPLICIT_CONSTRAINT_CONFLICT NONE_SUPPLIED ATTRIBUTED_USER_REPORTS_NOT_IDENTITY_VERIFICATION REQUIRED_TRUST_NOT_ESTABLISHED INTERNAL_USER_EVIDENCE_REFERENCES_VALID ACTIVE_NOT_EXPIRED_CONTENT_NOT_INDEPENDENTLY_RECONFIRMED UNRESOLVED_REPORTED_ASSUMPTIONS NO_REPORTED_ASSUMPTIONS CURRENT_SAFETY_REVIEW_REQUIRED INVALID_SAFETY_REVIEW STALE_OR_UNBOUND_SAFETY_REVIEW HUMAN_REVIEW_REQUIRED SOURCE_TRIGGER_MISMATCH CAPABILITY_CONSENT_MISSING ACCEPTED_RECORD_BINDING_MISMATCH INTERNAL_ELIGIBILITY_REJECTED ACCEPTED_EXTERNAL_PROFILE_BINDING_MISMATCH NORMALIZED_SOURCE_ID_REQUIRED MATCHING_NOT_COMPATIBLE HISTORY_CAPACITY_REACHED INVALID_CANDIDATE_OR_PROFILE SAFETY_GATE MISSING_OR_UNSUPPORTED_EVIDENCE INVALID_VALUE_TYPE UNMAPPED_RELATION CONFLICTING_REPORTED_VALUES NOT_REQUIRED APPROXIMATE_LOCATION_AND_RADIUS_REQUIRED WITHIN_RADIUS_WITH_UNCERTAINTY OUTSIDE_RADIUS DISTANCE_UNCERTAINTY_OVERLAPS_BOUNDARY AVAILABILITY_MISSING EXPLICIT_VALID_TIME_WINDOWS_REQUIRED CANDIDATE_AVAILABILITY_EXPIRED REPORTED_WINDOW_COVERS_NEED TIME_WINDOWS_CONFLICT PARTIAL_TIME_OVERLAP UNSUPPORTED_CONSTRAINT CONSTRAINT_VALUE_OR_EVIDENCE_MISSING UNIT_MISMATCH_NO_CONVERSION NUMERIC_CONSTRAINT_REQUIRES_NUMBERS UNSUPPORTED_CONSTRAINT_VALUE EXPLICIT_CONSTRAINT_SATISFIED PREFERENCE_NOT_MET_NON_BLOCKING NOT_REQUIRED_SOURCE_AGE_NOT_ASSUMED SOURCE_AGE_NOT_ESTABLISHED SOURCE_TIME_IN_FUTURE SOURCE_TOO_OLD SOURCE_TIME_WITHIN_REQUIRED_AGE INSPECTABLE_LINEAGE_PRESENT MISSING_LINEAGE SOURCE_POLICY_REVIEW_NOT_TRUTH_PROOF USER_REPORT_ONLY SOURCE_OR_RETRIEVAL_TIME_IN_FUTURE ATTRIBUTED_NOT_INDEPENDENTLY_VERIFIED INDEPENDENT_VERIFICATION_NOT_IMPLEMENTED UNRESOLVED_PROFILE_ASSUMPTIONS NO_ADDITIONAL_ASSUMPTIONS_REPORTED`.split(' ').concat(PROHIBITED,CONTEXTS));
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
CODES.add('EXISTING_MODERATION_GATE');
function sanitizeCandidateOutput(input,{allowApproximateRegion=false}={}){
 let x;try{x=copyPlain(input);}catch{x={state:'BLOCKED'};}
 const out={...BOUNDARY,state:STATES.has(x?.state)?x.state:'UNRESOLVED',ownershipVerification:'UNVERIFIED',communicationAuthorized:false,notificationAuthorized:false,executionAllowed:false};
 const dimensions=x?.dimensions??x?.match?.dimensions??[];
 out.dimensions=Array.isArray(dimensions)?dimensions.slice(0,200).filter(d=>DIMENSIONS.has(d?.dimension)&&['compatible','incompatible','unresolved'].includes(d.status)).map(d=>({dimension:d.dimension,status:d.status,code:CODES.has(d.code)?d.code:'REDACTED_REASON'})):[];
 // Only engine codes, never human prose. Unexpected strings are reduced to hashes.
 if(CODES.has(x?.code))out.code=x.code;
 if(ROLE_PAIRS.flat().includes(x?.role))out.role=x.role;
 if(typeof x?.entityType==='string'&&(Object.hasOwn(KINDS,x.entityType)||['ITEM','OBJECT','ACTIVITY','PERSON'].includes(x.entityType)))out.entityType=x.entityType;
 if(typeof x?.reference==='string')out.referenceFingerprint=hash(x.reference);
 if(allowApproximateRegion===true&&typeof x?.approximateRegion==='string'&&/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/.test(x.approximateRegion))out.approximateRegion=x.approximateRegion;
 if(['UNSEEN','CHANGED','UNCHANGED'].includes(x?.change))out.change=x.change;
 const sources=Array.isArray(x?.provenance)?x.provenance:x?.provenance?[x.provenance]:[];
 const cleanSources=sources.slice(0,32).map(p=>({sourceType:['PSAKSI_INTERNAL_USER_RECORD','EXTERNAL_PROVIDER_RESULT'].includes(p?.sourceType)?p.sourceType:'UNVERIFIED_SOURCE',referenceFingerprint:hash(JSON.stringify(p)),...(/^[a-f0-9]{64}$/.test(p?.identity)?{identity:p.identity}:{}),...(getProvider(p?.providerId)?{providerId:p.providerId}:{}),epistemicStatus:p?.epistemicStatus==='SOURCE_DERIVED'?'SOURCE_DERIVED':p?.epistemicStatus==='USER_STATED'?'USER_STATED':'UNVERIFIED'}));
 out.provenance=Array.isArray(x?.provenance)?cleanSources:cleanSources[0]??null;
 out.trustSignals=['IDENTITY_UNVERIFIED','OWNERSHIP_UNVERIFIED','FRESHNESS_UNKNOWN','COMMUNICATION_NOT_AUTHORIZED'];
 if(cleanSources.some(p=>p.epistemicStatus==='USER_STATED'))out.trustSignals.push('USER_DECLARED');
 if(cleanSources.some(p=>p.epistemicStatus==='SOURCE_DERIVED'))out.trustSignals.push('SOURCE_DERIVED');
 return out;
}
module.exports={trustSafetyDecision,gateSubject,proceed,sanitizeCandidateOutput};
