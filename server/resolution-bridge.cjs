'use strict';
const {verifyTextEvidence}=require('../contracts/text-evidence-boundary.cjs');
const {validateResolutionNeed,BOUNDARY}=require('../contracts/need-resolution.cjs');
const {routeUniversalSearch}=require('./universal-search-strategy-router.cjs');
const {decomposeNeed,evaluateResolution,planSolutionPaths}=require('./resolution-engine.cjs');
const ROLES={ASK_EXPERIENCE:['NEEDS_EXPERIENCE','HAS_EXPERIENCE'],BORROW:['BORROWER','LENDER'],LEND:['LENDER','BORROWER'],BUY:['BUYER','SELLER'],SELL:['SELLER','BUYER'],GIVE:['GIVER','RECEIVER'],LOST:['LOST_ITEM','FOUND_ITEM'],FOUND:['FOUND_ITEM','LOST_ITEM'],HELP_REQUEST:['NEEDS_HELP','CAN_HELP'],REPAIR:['NEEDS_SERVICE','OFFERS_SERVICE']};
const known=f=>f?.state==='known'?f.value:null;
function resolutionFromExtraction(wire,context){
 const fail=code=>({...BOUNDARY,status:'BLOCKED',code});
 if(verifyTextEvidence(context?.source,wire?.proposal,context?.expectedProvider,wire?.textReferences).status!=='verified')return fail('GROUNDED_EXTRACTION_REQUIRED');
 const route=routeUniversalSearch(wire,context);if(route.status!=='candidate')return fail('GROUNDED_ROUTE_REQUIRED');
 const original=wire.proposal.need,i=original.interpretation.intent;
 // Keep the complete outcome. An action/entity pair is a component of ONE need.
 const refs=wire.textReferences.slice(0,64).map(r=>({start:r.start,end:r.end,quote:r.quote,classification:'MODEL_INFERRED'}));
 const indexes=path=>wire.textReferences.flatMap((r,index)=>index<64&&r.target===path?[index]:[]);
 const components=[];
 for(const [ai,a] of i.actions.entries())for(const eid of a.entityIds){const ei=i.entities.findIndex(e=>e.id===eid),e=i.entities[ei],verb=known(a.verb),kind=known(e.kind),target=known(e.description);if(!verb||!kind||!target)return fail('UNRESOLVED_COMPONENT');
  const role=i.roles.find(r=>r.actionId===a.id&&r.participantId===eid&&known(r.role)==='EXPERIENCED_PERSON'),pair=role?['NEEDS_EXPERIENCE','HAS_EXPERIENCE']:ROLES[verb]??[null,null];
  const quantity=i.constraints.find(q=>q.subjectId===a.id&&q.dimension==='QUANTITY'&&q.operator==='equals');
  const value=quantity?Number(known(quantity.value)):1;
  components.push({id:'component-'+components.length,capability:kind,target,requesterRole:pair[0],counterpartRoles:pair[1]?[pair[1]]:[],quantity:Number.isInteger(value)&&value>0?value:1,optional:false,dependsOn:[],strategies:[route.primaryStrategy,...route.secondaryStrategies].filter(s=>s?.actionIds.includes(a.id)&&!['LOCAL_SEARCH','LIVE_INTENT'].includes(s.kind)).map(s=>s.kind),evidenceIndexes:indexes(`/interpretation/intent/entities/${ei}/description`),_action:a.id,_entity:eid});
 }
 const constraints=[],missingInformation=[];
 for(const [qi,q] of i.constraints.entries()){
  const scoped=components.filter(c=>[original.id,c._action,c._entity].includes(q.subjectId));
  if(q.dimension==='QUANTITY'){if(!Number.isInteger(Number(known(q.value)))||Number(known(q.value))<1)missingInformation.push('QUANTITY_UNRESOLVED');continue;}
  if(q.dimension==='DEPENDS_ON') {const targets=components.filter(c=>c._action===known(q.value)||c._entity===known(q.value));if(!targets.length)missingInformation.push('DEPENDENCY_UNRESOLVED');for(const c of scoped)c.dependsOn.push(...targets.filter(t=>t.id!==c.id).map(t=>t.id));continue;}
  if(!scoped.length||!known(q.value)){missingInformation.push('CONSTRAINT_UNRESOLVED');continue;}
  const value=known(q.value),numeric=/^\d+(?:\.\d+)?$/.test(value)?Number(value):value;
  constraints.push({id:'requirement-'+qi,dimension:q.dimension,operator:q.operator,value:['at-most','at-least'].includes(q.operator)?numeric:value,unit:known(q.unit),strength:q.operator==='prefers'?'SOFT':'UNKNOWN',componentIds:scoped.map(c=>c.id),evidenceIndexes:indexes(`/interpretation/intent/constraints/${qi}/value`),confirmed:q.value.confirmed===true});
 }
 const need={schemaVersion:1,id:original.id,revision:1,originalText:original.originalText,desiredOutcome:original.originalText,entities:i.entities.map((e,index)=>({id:e.id,kind:known(e.kind),description:known(e.description),evidenceIndexes:indexes(`/interpretation/intent/entities/${index}/description`)})),requesterRole:null,components:components.map(({_action,_entity,...c})=>c),constraints,provenance:refs,assumptions:[],missingInformation:[...new Set(missingInformation)],privacySensitivity:'UNKNOWN',safetySensitivity:'UNASSESSED',freshnessMaxAgeMs:null,evidenceRequirements:['ATTRIBUTION','EXPLICIT_AVAILABILITY_FOR_COMPLETE_SOLUTION'],persistentRequested:route.persistenceCandidate.candidate,...BOUNDARY};
 const v=validateResolutionNeed(need);return v.valid?{...BOUNDARY,status:'INTERPRETED',need:v.need,decomposition:decomposeNeed(v.need),userConfirmed:false}:fail(v.code);
}
// Plain explanation is a deliberate projection, never a dump of provider/debug data.
function explainResolution(need,state,plan,observations=[]){
 return {whatIUnderstood:need.desiredOutcome,whatINeedToSolve:need.components.map(c=>({component:c.target,quantity:c.quantity,optional:c.optional})),whatISearched:observations.map(o=>({component:need.components.find(c=>c.id===o.componentId)?.target??'unknown',status:o.reason})),whatIFound:(state.matches??[]).map(m=>({component:need.components.find(c=>c.id===m.componentId)?.target,quantity:m.quantity,evidence:m.classification})),whatIsStillMissing:[...(state.missingPieces??[]).map(m=>({component:need.components.find(c=>c.id===m.componentId)?.target,...(m.remainingQuantity===0?{waitingFor:need.components.find(c=>c.id===m.componentId)?.dependsOn.map(id=>need.components.find(c=>c.id===id)?.target)}:{quantity:m.remainingQuantity})})),...(state.softConflicts??[]).map(id=>{const q=need.constraints.find(q=>q.id===id);return {constraint:q?.dimension.toLowerCase().replaceAll('_',' '),requestedValue:q?.value,approvalRequired:true};}),...(state.assumptions??[]).map(()=>({information:'An unresolved requirement or assumption still needs review.'}))],whatCanBeTriedNext:(plan.nextOptions??[]).map(o=>({option:o.kind,requiresApproval:o.requiresConsent})),completePlan:state.status==='COMPLETE',resolved:false,worldVerification:'UNVERIFIED',actionAuthority:'NONE'};
}
function analyzeResolution(need,offers=[],options={}){
 const state=evaluateResolution(need,offers,options),plan=planSolutionPaths(need,state);
 return {state,plan,explanation:explainResolution(need,state,plan,options.observations??[])};
}
function offersFromProviderEnvelope(envelope){
 if(!['source-results','unverified-results'].includes(envelope?.status)||!Array.isArray(envelope.results))return [];
 const {fingerprint}=require('../contracts/saved-search-request.cjs');
 return envelope.results.filter(r=>r.epistemicStatus==='SOURCE_DERIVED'&&r.actionAuthority==='NONE'&&r.worldVerification==='UNVERIFIED').map(r=>{
  const p=r.provenance??{},v=r.value??{},fact=value=>({value,evidenceIndexes:[0]});
  const provenance=Object.fromEntries(['providerId','url','retrievedAt','sourceUpdatedAt','responseSha256','attribution','license'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
  const key=fingerprint([p.providerId,v.entityType,v.id??v.tripId??v.name]);
  return {id:key,resourceKey:key,sourceType:'SOURCE_DERIVED',provenance:[provenance],capabilities:[fact(v.entityType)],roles:[],capacity:{},attributes:Object.fromEntries([['LOCATION',v.city],['AREA',v.area],['CATEGORY',v.category]].filter(([,v])=>typeof v==='string').map(([k,v])=>[k,fact(v)])),availability:{value:null,evidenceIndexes:[]},permissions:{matching:false,discoverability:false,consentReference:null},privacy:'PUBLIC_NON_PERSONAL',...BOUNDARY};
 });
}
module.exports={resolutionFromExtraction,explainResolution,analyzeResolution,offersFromProviderEnvelope};
