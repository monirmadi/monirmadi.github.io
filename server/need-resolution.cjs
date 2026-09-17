'use strict';
// Pure, provider-neutral planning. This module never searches, publishes or schedules.
const {createHash}=require('node:crypto');
const {BOUNDARY}=require('./psaksiconcepts.cjs');
const {REQUIREMENTS}=require('./search-strategy-policy.cjs');
const {listProviders}=require('./provider-registry.cjs');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const base=()=>({...BOUNDARY,executionAllowed:false,communicationAuthorized:false});
function planNeedResolution(route,{providers=listProviders(),outcome='NOT_RUN'}={}){
 if(route?.status!=='candidate'||route.executionAllowed!==false||route.actionAuthority!=='NONE'||!route.provenance?.proposalFingerprint)return {...base(),status:'blocked',code:'GROUNDED_ROUTE_REQUIRED'};
 const strategies=[route.primaryStrategy,...route.secondaryStrategies].filter(Boolean);
 const kinds=new Set(strategies.map(s=>s.kind));
 const tasks=strategies.filter(s=>!['LOCAL_SEARCH','LIVE_INTENT'].includes(s.kind)).map((s,index)=>{
  const requirements=[...new Set([...(REQUIREMENTS[s.kind]??[]),...route.providerRequirements])];
  const candidates=providers.filter(p=>p.readOnly===true&&p.strategies.includes(s.kind));
  const coverage=candidates.map(p=>({providerId:p.id,missing:requirements.filter(r=>!p.capabilities.includes(r))}));
  return {id:'step-'+index,strategy:s.kind,actionIds:s.actionIds,entityIds:s.entityIds,requirements,
   sources:coverage,status:coverage.some(p=>!p.missing.length)?'SOURCE_CANDIDATE':coverage.length?'PARTIAL_DISCOVERY_ONLY':'UNCONNECTED',provenance:s.provenance};
 });
 const holes=tasks.filter(t=>t.status!=='SOURCE_CANDIDATE').map(t=>({stepId:t.id,kind:'CAPABILITY_GAP',requirements:t.requirements,status:t.status}));
 const clarification=route.clarificationNeeds.map(q=>({...q,kind:'USER_MEANING_GAP'}));
 const noResults=outcome==='NO_RESULTS';
 const has=k=>k.some(v=>kinds.has(v));
 return {...base(),schemaVersion:1,status:'PLAN_ONLY',binding:route.provenance.proposalFingerprint,
  tasks,clarification,missingPieceEngine:{status:'PLAN_ONLY',missingPieces:[...clarification,...holes],inferredResources:[],requiresUserConfirmation:true},
  multiPartyMatching:{status:'UNCONNECTED',candidate: new Set(strategies.flatMap(s=>s.actionIds)).size>1,requires:['EXPLICIT_DEPENDENCY_GRAPH','PER_PARTY_OPT_IN','INDEPENDENT_PAIR_SAFETY','ALL_HARD_CONSTRAINTS'],completed:false},
  zeroResultNetwork:{status:noResults?'PROPOSAL_ONLY':'DORMANT',publishEnabled:false,retentionEnabled:false,requires:['EXPLICIT_SAVE_AND_DISCOVERY_CONSENT','CONNECTED_PRIVATE_REPOSITORY','EXPIRY','SAFETY_REVIEW']},
  experiencePassport:{status:'UNCONNECTED',candidate:has(['EXPERIENCE_MATCHING']),classification:'USER_DECLARED_ONLY',requires:['OPT_IN_EXPERIENCE_DATA','TOPIC_AND_ROLE_EVIDENCE','ATTRIBUTION','CONTACT_CONSENT'],verifiedExpertise:false,reputation:null},
  liveIntent:{status:'INACTIVE',candidate:route.liveIntentCandidate.candidate,requires:['EXPLICIT_OPT_IN','BOUNDED_TIME_WINDOW','EXPIRY','CONSENT_RECHECK','CONNECTED_NETWORK']},
  needEvolution:{status:noResults?'MAY_PROPOSE_EDITS':'UNCHANGED',automaticRelaxation:false,requires:['EXACT_EDIT_PREVIEW','CURRENT_NEED_BINDING','USER_APPROVAL']},
  opportunityCollision:{status:'UNCONNECTED',candidate:has(['OPPORTUNITY_SEARCH','PEOPLE_MATCHING','LOCAL_RESOURCE_MATCHING']),requires:['CONSENTED_RECORDS','COMPLEMENTARY_ROLES','CONSTRAINT_COMPATIBILITY','INDEPENDENT_SAFETY_REVIEW'],communicationEnabled:false},
  watch:{status:'INACTIVE',candidate:route.persistenceCandidate.candidate,monitoringEnabled:false,notificationsEnabled:false,requires:['EXPLICIT_OPT_IN','SUPPORTED_SOURCE','TRUSTED_WATCH_AUTHORIZATION','CONNECTED_RUNTIME']},
  outcome,worldVerification:'UNVERIFIED'};
}
// The proposal is process-bound and immutable to its caller. No approval inferred
// from a zero-result state; revisions/edits require a new preview and new approval.
function createNeedEvolution(){
 const pending=new WeakMap();
 return {
  propose(need,edits){
   if(!Array.isArray(need?.constraints)||!Array.isArray(edits)||!edits.length||edits.length>12)throw Error('INVALID_EDITS');
   const ids=new Set();
   for(const e of edits){
    if(!e||ids.has(e.constraintId)||!need.constraints.some(q=>q.id===e.constraintId)||!['REMOVE','REPLACE'].includes(e.operation))throw Error('INVALID_EDIT');
    if(e.operation==='REPLACE'&&(!e.replacement||e.replacement.id!==e.constraintId))throw Error('INVALID_REPLACEMENT');
    ids.add(e.constraintId);
   }
   const snapshot=structuredClone({need,edits}),binding=digest(snapshot);
   const preview={...base(),status:'AWAITING_APPROVAL',binding,changes:structuredClone(edits),needBinding:digest(need)};
   pending.set(preview,snapshot);return preview;
  },
  approve(preview,currentNeed,approval){
   const saved=pending.get(preview);
   if(!saved||approval?.approved!==true||approval.binding!==digest(saved)||digest(currentNeed)!==digest(saved.need))return {...base(),status:'blocked',code:'CURRENT_BOUND_APPROVAL_REQUIRED'};
   pending.delete(preview);
   const next=structuredClone(saved.need);
   for(const e of saved.edits)next.constraints=e.operation==='REMOVE'?next.constraints.filter(q=>q.id!==e.constraintId):next.constraints.map(q=>q.id===e.constraintId?structuredClone(e.replacement):q);
   return {...base(),status:'APPROVED_DRAFT',need:next,priorBinding:digest(saved.need),requiresReassessment:true};
  }
 };
}
// Explicit dependency graph only; never infer a person's resources or availability.
// Each edge goes through the existing consent/expiry/privacy/safety matcher.
function evaluateResolutionNetwork(records,edges,options={}){
 const {matchInternalRecords}=require('./internal-matching.cjs');
 if(!Array.isArray(records)||records.length>20||!Array.isArray(edges)||!edges.length||edges.length>40)return {...base(),status:'blocked',code:'BOUNDED_NETWORK_REQUIRED'};
 const byId=new Map(records.map(r=>[r?.id,r]));
 if(byId.size!==records.length||edges.some(e=>!byId.has(e?.from)||!byId.has(e?.to)||e.from===e.to))return {...base(),status:'blocked',code:'INVALID_DEPENDENCIES'};
 const results=edges.map(e=>({match:matchInternalRecords(byId.get(e.from),byId.get(e.to),options)}));
 const blocked=results.some(r=>['MATCH_BLOCKED','NO_MATCH'].includes(r.match.state));
 const complete=results.every(r=>r.match.state==='MATCH_CANDIDATE');
 return {...base(),status:blocked?'NETWORK_BLOCKED':complete?'COMPATIBLE_REPORTED_EDGES':'NETWORK_UNRESOLVED',edges:results,
  atomicCompletion:false,requiresAllPartyConfirmation:true,availability:'NOT_INDEPENDENTLY_VERIFIED'};
}
module.exports={planNeedResolution,createNeedEvolution,evaluateResolutionNetwork,resolveAcceptedNeed:(...args)=>require('./resolve-accepted-need.cjs').resolveAcceptedNeed(...args)};
