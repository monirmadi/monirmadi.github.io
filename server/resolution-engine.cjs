'use strict';
const {validateResolutionNeed,validateOffer,validWindow,ROLE_PAIRS,BOUNDARY}=require('../contracts/need-resolution.cjs');
const {gateSubject,proceed}=require('./trust-safety-gate.cjs');
const {getProvider,listProviders}=require('./provider-registry.cjs');
const {KINDS:ENTITY_STRATEGIES}=require('./search-strategy-policy.cjs');
const {fingerprint}=require('../contracts/saved-search-request.cjs');
const base=()=>({...BOUNDARY,executionAllowed:false,communicationAuthorized:false,monitoringEnabled:false,resolved:false,resolutionScope:'EVIDENCE_SUPPORTED_PLAN_NOT_FULFILLED'});
const fold=s=>typeof s==='string'?s.normalize('NFC').trim().toLocaleLowerCase('und'):s;
const unique=xs=>[...new Set(xs)];
function decomposeNeed(input){
 const v=validateResolutionNeed(input);if(!v.valid)return {...base(),status:'BLOCKED',code:v.code};
 const n=v.need,labels=[n.components.length===1?'ATOMIC':'COMPOSITE'];
 if(n.components.some(c=>c.dependsOn.length))labels.push('DEPENDENT');
 if(n.components.some(c=>c.counterpartRoles.length||c.quantity>1))labels.push('MULTI_PARTY');
 if(n.persistentRequested)labels.push('PERSISTENT');
 if(n.constraints.some(q=>['TIME','DATE','TIME_WINDOW'].includes(q.dimension)))labels.push('TEMPORAL');
 if(n.constraints.some(q=>['LOCATION','ORIGIN','DESTINATION','AREA'].includes(q.dimension)))labels.push('LOCATION_DEPENDENT');
 if(n.components.some(c=>c.strategies.some(s=>['GENERAL_INFORMATION','GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE'].includes(s))))labels.push('INFORMATIONAL');
 if(n.components.some(c=>c.strategies.some(s=>['BUY','SELL','BORROW','LEND','GIVE','SWAP'].includes(s))))labels.push('TRANSACTIONAL');
 if(n.components.some(c=>c.counterpartRoles.length))labels.push('COMMUNICATION_DEPENDENT');
 return {...base(),status:'DECOMPOSED',binding:v.binding,needId:n.id,originalText:n.originalText,desiredOutcome:n.desiredOutcome,labels,components:n.components,constraints:n.constraints,dependencies:n.components.flatMap(c=>c.dependsOn.map(id=>({requires:id,componentId:c.id}))),optionalComponents:n.components.filter(c=>c.optional).map(c=>c.id),assumptions:n.assumptions,missingInformation:n.missingInformation,provenance:n.provenance};
}
function sourceEligibility(o,n,{now,safety}){
 if(!['SOURCE_DERIVED','INTERNAL_OPT_IN','USER_PROVIDED'].includes(o.sourceType))return 'UNVERIFIED';
 if(o.sourceType==='SOURCE_DERIVED'){
  if(o.privacy!=='PUBLIC_NON_PERSONAL')return 'CONSENT_REQUIRED';
  for(const p of o.provenance){
   const provider=getProvider(p.providerId);let correct=false;
   try{const url=new URL(p.url);correct=provider&&url.origin===new URL(provider.baseUrl).origin&&!url.username&&!url.password;}catch{}
   if(!correct||o.capabilities.some(c=>!provider.strategies.includes(ENTITY_STRATEGIES[c.value]??(c.value==='TRANSPORT_SERVICE'?'TRANSPORT_SEARCH':null)))||o.availability.value===true&&!provider.capabilities.includes('TIME_AVAILABILITY')||!/^[a-f0-9]{64}$/.test(p.responseSha256??'')||!Number.isFinite(Date.parse(p.retrievedAt))||Date.parse(p.retrievedAt)>now)return 'UNVERIFIED';
   if(p.sourceUpdatedAt!==undefined&&(!Number.isFinite(Date.parse(p.sourceUpdatedAt))||Date.parse(p.sourceUpdatedAt)>Date.parse(p.retrievedAt)))return 'SOURCE_STALE';
   if(n.freshnessMaxAgeMs!==null&&(!Number.isFinite(Date.parse(p.sourceUpdatedAt))||Date.parse(p.sourceUpdatedAt)>now||now-Date.parse(p.sourceUpdatedAt)>n.freshnessMaxAgeMs))return 'SOURCE_STALE';
  }
 }else{
  if(o.privacy!=='MATCHING_ONLY'||!o.permissions.matching||!o.permissions.discoverability||!o.permissions.consentReference)return 'CONSENT_REQUIRED';
  if(o.provenance.some(p=>!/^[A-Za-z0-9_-]{1,96}$/.test(p.reference??'')||!Number.isFinite(Date.parse(p.updatedAt))||Date.parse(p.updatedAt)>now||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=now))return 'SOURCE_STALE';
  if(n.freshnessMaxAgeMs!==null&&o.provenance.some(p=>now-Date.parse(p.updatedAt)>n.freshnessMaxAgeMs))return 'SOURCE_STALE';
 }
 const gate=gateSubject(o,o.sourceType==='SOURCE_DERIVED'?'ASSESS_CONTENT':'INTERNAL_MATCHING',{now,safety,privacy:o.privacy,permissions:{INTERNAL_MATCHING:o.permissions.matching,DISCOVERABILITY:o.permissions.discoverability}});
 return proceed(gate)?null:'SAFETY_BLOCKED';
}
function compareConstraint(q,f,now=null){
 if(!f)return {status:'unresolved',code:'CONSTRAINT_EVIDENCE_MISSING'};
 if(q.unit!==null&&q.unit!==f.unit)return {status:'unresolved',code:'UNIT_MISMATCH_NO_CONVERSION'};
 const a=f.value,b=q.value;let met;
 if(q.operator==='window'){
  if(!validWindow(a)||!validWindow(b))return {status:'unresolved',code:'MISSING_REQUIRED_INFORMATION'};
  if(now!==null&&Date.parse(b.end)<=now)return {status:'incompatible',code:'REQUEST_WINDOW_EXPIRED'};
  met=Date.parse(a.start)<=Date.parse(b.start)&&Date.parse(a.end)>=Date.parse(b.end);
 }else if(['TIME','TIME_WINDOW','DATE'].includes(q.dimension))return {status:'unresolved',code:'MISSING_REQUIRED_INFORMATION'};
 else if(['at-most','at-least'].includes(q.operator)){
  if(typeof a!=='number'||typeof b!=='number')return {status:'unresolved',code:'NUMERIC_VALUES_REQUIRED'};
  met=q.operator==='at-most'?a<=b:a>=b;
 }else {const same=Array.isArray(a)?a.some(v=>fold(v)===fold(b)):fold(a)===fold(b);met=q.operator==='excludes'?!same:same;}
 return {status:met?'compatible':q.strength==='SOFT'?'proposal-required':'incompatible',code:met?['LOCATION','AREA'].includes(q.dimension)?'SAME_REQUESTED_AREA':q.operator==='window'?'REPORTED_WINDOW_COVERS_NEED':'EXPLICIT_CONSTRAINT_SATISFIED':'CONSTRAINT_NOT_MET'};
}
function componentMatch(n,c,o,now){
 const reasons=[];const add=(dimension,status,code,evidenceIndexes=[])=>reasons.push({dimension,status,code,evidenceIndexes});
 const capability=o.capabilities.find(f=>f.value===c.capability);add('capability',capability?'compatible':'incompatible',capability?'REQUESTED_CAPABILITY_MATCHES':'CAPABILITY_NOT_OFFERED',capability?.evidenceIndexes);
 const requiredRoles=c.counterpartRoles.length?c.counterpartRoles:ROLE_PAIRS.filter(([r])=>r===c.requesterRole).map(([,r])=>r);
 const roleFacts=o.roles.filter(f=>requiredRoles.includes(f.value));
 if(c.counterpartRoles.length||c.requesterRole){const compatible=requiredRoles.length>0&&requiredRoles.every(r=>roleFacts.some(f=>f.value===r));add('role',compatible?'compatible':'incompatible',compatible?'OFFERS_REQUIRED_ROLE':'ROLE_NOT_COMPATIBLE',unique(roleFacts.flatMap(f=>f.evidenceIndexes)));}
 const capacity=o.capacity[c.capability];add('quantity',capacity?.value>0?'compatible':'unresolved',capacity?.value>0?'REPORTED_CAPACITY':'CAPACITY_NOT_ESTABLISHED',capacity?.evidenceIndexes);
 add('availability',o.availability.value===null?'unresolved':o.availability.value?'compatible':'incompatible',o.availability.value===null?'AVAILABILITY_NOT_ESTABLISHED':o.availability.value?'SOURCE_REPORTS_AVAILABLE':'REPORTED_UNAVAILABLE',o.availability.evidenceIndexes);
 for(const q of n.constraints.filter(q=>q.componentIds.includes(c.id)&&!(q.dimension==='BUDGET'&&q.componentIds.length>1))){const f=o.attributes[q.dimension];reasons.push({dimension:q.dimension,constraintId:q.id,...compareConstraint(q,f,now),evidenceIndexes:f?.evidenceIndexes??[]});}
 return {eligible:!reasons.some(r=>['incompatible','unresolved'].includes(r.status)),reasons,softConflicts:reasons.filter(r=>r.status==='proposal-required').map(r=>r.constraintId),units:capacity?.value??0};
}
function evaluateResolution(input,records=[],options={}){
 const start=performance.now(),v=validateResolutionNeed(input),finish=x=>({...base(),...x,timings:{compositionMs:performance.now()-start}});
 if(options.observations!==undefined&&(!Array.isArray(options.observations)||options.observations.length>64))return finish({status:'BLOCKED',code:'OBSERVATION_LIMIT',satisfied:[],missingPieces:[]});
 if(!v.valid||!Array.isArray(records)||records.length>40)return finish({status:'BLOCKED',code:v.code??'CANDIDATE_LIMIT',satisfied:[],missingPieces:[]});
 const n=v.need,now=options.now??Date.now();if(!Number.isFinite(now))return finish({status:'BLOCKED',code:'INVALID_CLOCK',satisfied:[],missingPieces:[]});
 const needGate=gateSubject(n,'ASSESS_CONTENT',{now,safety:options.safety});
 if(!proceed(needGate))return finish({status:'BLOCKED',code:'SAFETY_BLOCKED',matches:[],satisfied:[],missingPieces:n.components.filter(c=>!c.optional).map(c=>({componentId:c.id,remainingQuantity:c.quantity,reason:'SAFETY_BLOCKED'})),binding:v.binding});
 const offers=[],rejected=[],resources=new Set();
 for(const raw of records){const o=validateOffer(raw);if(!o.valid){rejected.push('UNVERIFIED');continue;}const error=sourceEligibility(o.offer,n,{now,safety:options.safety});if(error){rejected.push(error);continue;}if(resources.has(o.offer.resourceKey)){rejected.push('DUPLICATE_RESOURCE');continue;}resources.add(o.offer.resourceKey);offers.push(o.offer);}
 const comparisons=n.components.map(c=>offers.map(o=>componentMatch(n,c,o,now)));
 const requiredIds=new Set(n.components.filter(c=>!c.optional).map(c=>c.id));let expanded;do{expanded=false;for(const c of n.components)if(requiredIds.has(c.id))for(const id of c.dependsOn)if(!requiredIds.has(id)){requiredIds.add(id);expanded=true;}}while(expanded);
 const required=n.components.filter(c=>requiredIds.has(c.id)),allocations=[],usage=new Map();let best=null,states=0;const encounteredGroupIssues=new Set();
 const maxStates=Number.isInteger(options.maxStates)?Math.min(4096,Math.max(1,options.maxStates)):512;
 function inspect(){
  const quantities=Object.fromEntries(n.components.map(c=>[c.id,allocations.filter(a=>a.componentId===c.id).reduce((sum,a)=>sum+a.quantity,0)]));
  const satisfied=new Set(n.components.filter(c=>quantities[c.id]>=c.quantity).map(c=>c.id));
  let changed;do{changed=false;for(const c of n.components)if(satisfied.has(c.id)&&c.dependsOn.some(id=>!satisfied.has(id))){satisfied.delete(c.id);changed=true;}}while(changed);
  const soft=unique(allocations.flatMap(a=>comparisons[n.components.findIndex(c=>c.id===a.componentId)][a.offerIndex].softConflicts));
  const groupIssues=[];
  for(const q of n.constraints.filter(q=>q.dimension==='BUDGET'&&q.componentIds.length>1)){
   const selected=unique(allocations.filter(a=>q.componentIds.includes(a.componentId)).map(a=>a.offerIndex));let total=0,known=true;
   for(const index of selected){const o=offers[index],price=o.attributes.PRICE,basis=o.attributes.PRICE_BASIS;const units=Math.max(...allocations.filter(a=>a.offerIndex===index).map(a=>a.quantity));if(typeof price?.value!=='number'||price.value<0||price.unit!==q.unit||!['PER_RESOURCE','PER_UNIT'].includes(basis?.value)){known=false;break;}total+=price.value*(basis.value==='PER_UNIT'?units:1);}
   const comparison=known?compareConstraint(q,{value:total,unit:q.unit}):{status:'unresolved',code:'BUNDLE_PRICE_NOT_ESTABLISHED'};
   if(comparison.status!=='compatible'){groupIssues.push({constraintId:q.id,...comparison});encounteredGroupIssues.add(comparison.code);}
  }
  const hardGroup=groupIssues.filter(q=>q.status!=='proposal-required').length;
  const score=[hardGroup?0:required.filter(c=>satisfied.has(c.id)).length,-hardGroup,required.reduce((sum,c)=>sum+Math.min(c.quantity,quantities[c.id]),0),-soft.length-groupIssues.length,-allocations.length];
  if(!best||score.some((value,i)=>value!==best.score[i]&&score.slice(0,i).every((v,j)=>v===best.score[j])&&value>best.score[i]))best={score,allocations:allocations.map(a=>({...a})),quantities,satisfied:[...satisfied],soft,groupIssues};
 }
 function visit(ci,oi,remaining){
  if(states++>=maxStates)return;inspect();if(ci>=n.components.length)return;
  const c=n.components[ci];if(remaining===undefined)remaining=c.quantity;
  if(remaining===0||oi>=offers.length){visit(ci+1,0);return;}
  const m=comparisons[ci][oi],key=offers[oi].resourceKey+':'+c.capability,used=usage.get(key)??0;
  if(m.eligible){const take=Math.min(remaining,Math.max(0,m.units-used));if(take){usage.set(key,used+take);allocations.push({componentId:c.id,offerIndex:oi,quantity:take});visit(ci,oi+1,remaining-take);allocations.pop();usage.set(key,used);}}
  visit(ci,oi+1,remaining);
 }
 visit(0,0);if(!best)inspect();
 const missingPieces=required.filter(c=>!best.satisfied.includes(c.id)).map(c=>({componentId:c.id,remainingQuantity:Math.max(0,c.quantity-best.quantities[c.id]),reason:c.dependsOn.some(id=>!best.satisfied.includes(id))?'DEPENDENCY_UNSATISFIED':best.quantities[c.id]>0?'INSUFFICIENT_QUANTITY':'NO_ELIGIBLE_COMPONENT'}));
 const unsupportedEvidence=n.evidenceRequirements.filter(r=>!['ATTRIBUTION','EXPLICIT_AVAILABILITY','EXPLICIT_AVAILABILITY_FOR_COMPLETE_SOLUTION'].includes(r));
 const assumptions=[...unsupportedEvidence.map(r=>'UNSUPPORTED_EVIDENCE_REQUIREMENT:'+r),...n.assumptions,...n.missingInformation,...best.groupIssues.map(q=>q.code)];
 const unsupported=required.some(c=>!c.strategies.length),softConflicts=unique([...best.soft,...best.groupIssues.filter(q=>q.status==='proposal-required').map(q=>q.constraintId)]);
 const matches=best.allocations.map(a=>{const o=offers[a.offerIndex],c=n.components.find(c=>c.id===a.componentId);return {componentId:a.componentId,quantity:a.quantity,candidateReference:fingerprint([o.sourceType,o.resourceKey]),classification:o.sourceType,reasons:comparisons[n.components.indexOf(c)][a.offerIndex].reasons,provenance:o.sourceType==='SOURCE_DERIVED'?structuredClone(o.provenance):o.provenance.map(p=>({referenceFingerprint:fingerprint(p),updatedAt:p.updatedAt,expiresAt:p.expiresAt}))};});
 const proposedRelaxations=softConflicts.flatMap(id=>{
  const q=n.constraints.find(q=>q.id===id);if(!q||q.strength!=='SOFT')return [];
  const actual=best.allocations.filter(a=>q.componentIds.includes(a.componentId)).map(a=>offers[a.offerIndex].attributes[q.dimension]?.value).filter(v=>v!==undefined);
  let to;if(actual.length&&actual.every(v=>typeof v==='number'))to=q.operator==='at-most'?Math.max(...actual):q.operator==='at-least'?Math.min(...actual):undefined;
  else if(actual.length&&actual.every(v=>v===actual[0])&&q.operator==='equals')to=actual[0];
  return to===undefined?[]:[{constraintId:id,strength:q.strength,from:q.value,to,unit:q.unit,reason:'CURRENT_CANDIDATE_CONFLICTS_WITH_PREFERENCE',requiresUserApproval:true,executionAllowed:false}];
 });
 const missingInput=n.missingInformation.length||n.constraints.some(q=>['TIME','DATE','TIME_WINDOW'].includes(q.dimension)&&q.operator!=='window');
 const complete=!missingPieces.length&&!assumptions.length&&!softConflicts.length;
 const status=complete?'COMPLETE':missingInput?'NEEDS_CLARIFICATION':matches.length?'PARTIAL':rejected.includes('SAFETY_BLOCKED')?'BLOCKED':unsupported?'NO_CURRENT_PATH':'NO_CURRENT_PATH';
 const reasons=unique([
  ...(missingInput?['MISSING_REQUIRED_INFORMATION']:[]),...(matches.length&&!complete?['PARTIAL_SOLUTION_AVAILABLE']:[]),...(unsupported||unsupportedEvidence.length?['UNSUPPORTED_REQUEST']:[]),
  ...rejected.filter(c=>['SAFETY_BLOCKED','CONSENT_REQUIRED','SOURCE_STALE'].includes(c)),...(softConflicts.length||!complete&&encounteredGroupIssues.has('CONSTRAINT_NOT_MET')||comparisons.flat().some(m=>m.reasons.some(r=>r.code==='CONSTRAINT_NOT_MET'))?['CONSTRAINT_TOO_NARROW']:[]),
  ...(missingPieces.some(m=>!listProviders().some(p=>n.components.find(c=>c.id===m.componentId).strategies.some(s=>p.strategies.includes(s))))?['NO_PROVIDER_COVERAGE']:[]),...(!records.length?['NO_CANDIDATES']:[]),...(options.observations??[]).filter(o=>n.components.some(c=>c.id===o.componentId)).map(o=>o.reason).filter(r=>['NO_PROVIDER_COVERAGE','PROVIDER_UNAVAILABLE','NO_CANDIDATES','SOURCE_STALE'].includes(r))
 ]);
 return finish({status,needId:n.id,binding:v.binding,originalText:n.originalText,evidenceCoveredComponents:n.components.filter(c=>best.quantities[c.id]>=c.quantity).map(c=>c.id),satisfied:best.satisfied,missingPieces,matches,assumptions,softConflicts,proposedRelaxations,reasons,boundedSearch:{visited:Math.min(states,maxStates),limit:maxStates,truncated:states>=maxStates},rejectedCandidateCount:rejected.length,
  optionalRemaining:n.components.filter(c=>c.optional&&!best.satisfied.includes(c.id)).map(c=>c.id),combinationScope:'REPORTED_COMPATIBILITY_ONLY_NO_BOOKING_OR_OWNERSHIP_VERIFICATION'});
}
function planSolutionPaths(input,state){
 const v=validateResolutionNeed(input);if(!v.valid||state?.binding!==v.binding)return {...base(),status:'BLOCKED',code:'CURRENT_RESOLUTION_REQUIRED'};
 const n=v.need,missing=state.missingPieces??[],paths=[];
 const add=(kind,componentIds,details={})=>paths.push({...base(),id:'path-'+paths.length,kind,componentIds,...details,requiresIndependentSafetyPrivacyReview:true,availability:'NOT_ESTABLISHED'});
 if(state.status==='BLOCKED')return {...base(),status:'BLOCKED',paths:[],nextOptions:[],watchEligibility:false,watchReason:'SAFETY_BLOCKED',requiredUserConsent:[]};
 if(state.status==='NEEDS_CLARIFICATION')add('CLARIFICATION',missing.map(m=>m.componentId),{missingInformation:n.missingInformation});
 for(const missingPiece of missing){if(missingPiece.remainingQuantity===0)continue;const c=n.components.find(c=>c.id===missingPiece.componentId),providers=listProviders().filter(p=>p.readOnly&&c.strategies.some(s=>p.strategies.includes(s)));
  if(providers.length)add(state.matches?.length?'MISSING_PIECE_SEARCH':'DIRECT_PROVIDER_SEARCH',[c.id],{providerIds:providers.map(p=>p.id),hardConstraintsPreserved:true,unresolvedAssumptions:n.assumptions.length});
  if(c.counterpartRoles.length)add(c.requesterRole==='NEEDS_EXPERIENCE'?'ASK_EXPERIENCED_PERSON':'INTERNAL_MATCH',[c.id],{status:'UNCONNECTED',providerIds:[],requires:['OPTED_IN_RECORDS','DISCOVERABILITY','MATCHING_CONSENT']});
 }
 if(missing.length&&n.components.length>1)add('MULTI_PARTY_COMPOSITION',missing.map(m=>m.componentId),{status:'PLAN_ONLY',retainedComponents:state.evidenceCoveredComponents??state.satisfied??[],unresolvedAssumptions:n.assumptions.length});
 const direct=paths.filter(p=>['DIRECT_PROVIDER_SEARCH','MISSING_PIECE_SEARCH'].includes(p.kind));
 if(direct.length>1)add('MULTI_PROVIDER_SEARCH',unique(direct.flatMap(p=>p.componentIds)),{providerIds:unique(direct.flatMap(p=>p.providerIds))});
 const watchEligibility=missing.length>0&&!['BLOCKED','NEEDS_CLARIFICATION'].includes(state.status)&&!state.reasons?.some(r=>['CONSENT_REQUIRED','SAFETY_BLOCKED'].includes(r));
 if(watchEligibility)add('PERSISTENT_SEARCH',missing.map(m=>m.componentId),{status:'READINESS_ONLY'});
 if(!paths.length&&state.status!=='COMPLETE')add('NO_SUPPORTED_PATH',missing.map(m=>m.componentId));
 // Deterministic lexicographic explanation; these are feasibility plans, not probabilities.
 const order={CLARIFICATION:0,MISSING_PIECE_SEARCH:1,DIRECT_PROVIDER_SEARCH:2,MULTI_PROVIDER_SEARCH:3,MULTI_PARTY_COMPOSITION:4,ASK_EXPERIENCED_PERSON:5,INTERNAL_MATCH:6,PERSISTENT_SEARCH:7,NO_SUPPORTED_PATH:8};
 paths.sort((a,b)=>(a.status==='UNCONNECTED')-(b.status==='UNCONNECTED')||(a.unresolvedAssumptions??0)-(b.unresolvedAssumptions??0)||order[a.kind]-order[b.kind]);
 const nextOptions=paths.map(p=>({kind:p.kind,componentIds:p.componentIds,requiresConsent:true,executionAllowed:false}));
 if(state.softConflicts?.length)nextOptions.unshift({kind:'PROPOSE_CONSTRAINT_CHANGE',constraintIds:state.softConflicts,proposedChanges:state.proposedRelaxations??[],requiresConsent:true,executionAllowed:false});
 return {...base(),status:'PLANNED',binding:v.binding,zeroResult:{reasons:unique([...(state.reasons??[]),...(watchEligibility?['PERSISTENT_SEARCH_ELIGIBLE']:[])]),nextOptions},paths:paths.slice(0,16),nextOptions,rankingBasis:['INDEPENDENT_SAFETY_AND_PRIVACY_REQUIRED','CONNECTED_LEGITIMATE_SOURCE','FEWER_UNRESOLVED_ASSUMPTIONS','BOUNDED_EXECUTION_COMPLEXITY'],watchEligibility,watchReason:watchEligibility?'MISSING_COMPONENT_READINESS_ONLY':'NOT_ELIGIBLE',watchConditionCandidate:watchEligibility?{kind:'MISSING_COMPONENT_BECOMES_AVAILABLE',componentIds:missing.map(m=>m.componentId),needBinding:v.binding}:null,requiredUserConsent:watchEligibility?['SAVE_NEED','WATCH_OPT_IN','SOURCE_DISCLOSURE','EXPIRY']:[]};
}
module.exports={decomposeNeed,evaluateResolution,planSolutionPaths,compareConstraint};
