'use strict';
const {randomUUID}=require('node:crypto');
const {acceptedSearchContext}=require('./universal-real-search.cjs');
const {proposalFingerprint}=require('../contracts/semantic-claim-boundary.cjs');
const {verifyTextEvidence}=require('../contracts/text-evidence-boundary.cjs');
const {validateInternalRecord,SOURCE_TYPE}=require('../contracts/internal-record.cjs');
const {fingerprint}=require('../contracts/saved-search-request.cjs');
const {gateSubject,proceed}=require('./trust-safety-gate.cjs');
const {BOUNDARY}=require('./psaksiconcepts.cjs');

function searchAcceptance(report){
 const proof=acceptedSearchContext(report);if(!proof)return null;
 const {wire,context,profile}=proof;
 if(verifyTextEvidence(context.source,wire.proposal,context.expectedProvider,wire.textReferences).status!=='verified')return null;
 const i=wire.proposal.need.interpretation.intent;
 // A single accepted need only; never silently combine or discard requests.
 if(i.actions.length!==1||i.entities.length!==1||i.alternatives.length)return null;
 const target=i.entities[0].description;if(target.state!=='known')return null;
 // Preserve the requested target in future external matching as well as in
 // the acceptance label. The generic matching projection otherwise contains
 // only entity type and explicit constraints, losing the target/topic text.
 if(!profile.constraints.some(q=>q.dimension==='TOPIC')){
  const evidenceIndexes=wire.textReferences.flatMap((r,index)=>r.target==='/interpretation/intent/entities/0/description'?[index]:[]);
  if(!evidenceIndexes.length)return null;
  profile.constraints.push({dimension:'TOPIC',operator:'equals',value:{state:'known',value:target.value,epistemicStatus:'INTERPRETED',evidenceIndexes}});
 }
 const preview={target:target.value,constraints:i.constraints.map(q=>({dimension:q.dimension,operator:q.operator,value:q.value.state==='known'?q.value.value:null,unit:q.unit?.state==='known'?q.unit.value:null})),uncertainty:[...profile.uncertainty,...(report.UNRESOLVED_INFORMATION??[])],provider:proof.providerId};
 return {...proof,preview,binding:fingerprint({proposal:proposalFingerprint(wire.proposal,wire.textReferences),profile,preview})};
}

// acceptedNeeds is an owner-scoped private repository with load + save. No
// in-memory production fallback and no synthetic safety review are provided.
function createBetaAcceptedSearch({acceptedNeeds,safetyReviews,clock=Date.now}){
 if(typeof acceptedNeeds?.save!=='function'||typeof acceptedNeeds?.load!=='function')throw Error('ACCEPTED_NEED_REPOSITORY_REQUIRED');
 return async function accept({ownerId,report,binding,confirmed}){
  const a=searchAcceptance(report);if(!a||confirmed!==true||binding!==a.binding)return null;
  const reference='beta-'+randomUUID(),now=clock(),confirmation='confirm-'+randomUUID();
  const fact=value=>({state:'known',value,epistemicStatus:'USER_STATED',evidenceIndexes:[0]});
  const i=a.wire.proposal.need.interpretation.intent;
  // Confirmation adopts the displayed interpretation as the user's private
  // search requirement. It asserts no person's role or availability.
  const record={schemaVersion:1,id:reference,needReference:reference,sourceType:SOURCE_TYPE,
   intent:fact(a.profile.intent.value),entities:[fact(a.profile.entityType.value)],role:{state:'unknown'},
   attributes:{TOPIC:fact(a.preview.target)},constraints:i.constraints.map(q=>({dimension:q.dimension,operator:q.operator,value:q.value.state==='known'?fact(q.value.value):{state:'unknown'},...(q.unit?.state==='known'?{unit:q.unit.value}:{})})),
   location:null,time:null,availability:'UNKNOWN',lifecycle:'PAUSED',permissions:{discoverability:false,matching:false,communication:false,consentReference:confirmation},privacy:'PRIVATE',trustRequirement:'UNKNOWN',
   provenance:[{sourceType:SOURCE_TYPE,reference:confirmation}],uncertainty:['INTERNAL_ROLE_NOT_ACCEPTED'],moderation:'NOT_ASSESSED',persistentSearch:{optIn:false},createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),expiresAt:null,...BOUNDARY};
  if(!validateInternalRecord(record).valid)return null;
  const subjectFingerprint=fingerprint(record),review=await safetyReviews?.read?.({ownerId,subjectFingerprint,subject:structuredClone(record)});
  if(!proceed(gateSubject(record,'ASSESS_CONTENT',{now,safety:subject=>fingerprint(subject)===subjectFingerprint?review:null})))return null;
  const entry={ownerId,reference,version:1,accepted:{status:'created',record,lineage:{sourceFingerprint:a.wire.proposal.sourceFingerprint,proposalFingerprint:proposalFingerprint(a.wire.proposal,a.wire.textReferences),confirmationBinding:a.binding,confirmationReference:confirmation,policyVersion:'beta-private-search-1'},...BOUNDARY},externalNeed:structuredClone(a.profile),externalNeedConfirmed:true};
  entry.externalNeed.provenance=entry.externalNeed.provenance.map(p=>({...p,proposalFingerprint:entry.accepted.lineage.proposalFingerprint}));
  if(await acceptedNeeds.save(ownerId,reference,entry)!==true)return null;
  const stored=await acceptedNeeds.load(ownerId,reference);
  return stored?.ownerId===ownerId&&fingerprint(stored)===fingerprint(entry)?reference:null;
 };
}
module.exports={searchAcceptance,createBetaAcceptedSearch};
