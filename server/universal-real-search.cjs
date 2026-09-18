'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {emptyNeed}=require('../contracts/universal.cjs');
const {extractUniversalIntent}=require('./universal-extractor-pipeline.cjs');
const {assessExtractedIntent}=require('./semantic-pipeline-bridge.cjs');
const {routeUniversalSearch}=require('./universal-search-strategy-router.cjs');
const {selectProviders}=require('./provider-selector.cjs');
const {controlledRealSearch}=require('./controlled-real-search.cjs');
const {requestFingerprint}=require('./public-provider-http.cjs');
const {matchingNeedFromExtraction,candidateFromProviderResult}=require('./matching-adapters.cjs');
const {matchNeedToCandidate}=require('./matching-foundation.cjs');
const {createLocalLanguageRuntime}=require('./local-language-runtime.cjs');
const {BOUNDARY}=require('./psaksiconcepts.cjs');
const sha=text=>createHash('sha256').update(text).digest('hex');
// Process-local proof: only this invocation can authorize an acceptance preview.
// Never serialize extraction evidence or accept a client-supplied assessed flag.
const acceptanceContexts=new WeakMap();
const acceptedSearchContext=report=>acceptanceContexts.has(report)?structuredClone(acceptanceContexts.get(report)):null;
function semanticReady(result){
 if(result?.status!=='assessed'||result.assessment?.graph?.decision!=='support'||!result.envelope?.claims?.length)return false;
 const expected=result.envelope.claims;
 const decisions=result.assessment.claims;
 if(!Array.isArray(decisions)||decisions.length!==expected.length)return false;
 const expectedIds=new Set(expected.map(c=>c?.id));
 if(expectedIds.size!==expected.length||expectedIds.has(undefined))return false;
 const allowed=new Set(['support','reject','abstain','ambiguous','conflict']);
 const seen=new Set();let supports=0;
 for(const decision of decisions){
  if(!decision||typeof decision!=='object'||typeof decision.claimId!=='string'||!allowed.has(decision.decision))return false;
  if(!expectedIds.has(decision.claimId)||seen.has(decision.claimId))return false;
  seen.add(decision.claimId);
  if(decision.decision==='reject'||decision.decision==='conflict')return false;
  if(decision.decision==='support')supports++;
 }
 return seen.size===expected.length&&supports>0;
}
function rankExplained(results){const seen=new Set();results=results.filter(r=>{if(!r.result?.provenance)return true;const key=JSON.stringify([r.result.value,r.result.provenance]);if(seen.has(key))return false;seen.add(key);return true;});const order={compatible:0,unresolved:1,incompatible:2};return results.map((r,index)=>({...r,originalIndex:index})).sort((a,b)=>order[a.match.status]-order[b.match.status]||a.match.conflictReasons.length-b.match.conflictReasons.length||a.match.missingInformation.length-b.match.missingInformation.length||a.originalIndex-b.originalIndex).map((r,i)=>({...r,rank:i+1,rankingBasis:['MATCH_STATUS','FEWER_EXPLICIT_CONFLICTS','FEWER_UNRESOLVED_DIMENSIONS','SOURCE_ORDER_TIEBREAK_NOT_CONFIDENCE']}));}
function createUniversalRealSearch({runtime:baseRuntime=createLocalLanguageRuntime(),search=controlledRealSearch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),requirePrivacyReview=false,measureTimings=false,requirePlaceContext=false,resolutionOptions={},executeProvider=require('./provider-execution.cjs').executeConnectedProvider}={}){
 return async function run(input,authorization){
  const validContext=authorization?.contextTurns===undefined||Array.isArray(authorization.contextTurns)&&authorization.contextTurns.length>0&&authorization.contextTurns.length<=6&&authorization.contextTurns.every(t=>typeof t==='string'&&t.trim())&&authorization.contextTurns.join('\n')===input;
  const runtime=validContext&&authorization?.contextTurns?.length>1&&baseRuntime.forContext?baseRuntime.forContext(authorization.contextTurns):baseRuntime;
  const started=performance.now(),timings=[],receiptStart=runtime.receipts.length,traceStart=runtime.traces?.length??0;
  const timed=async(stage,fn)=>{const start=performance.now();try{return await fn();}finally{if(measureTimings)timings.push({stage,durationMs:Math.round((performance.now()-start)*100)/100});}};
  const report={INPUT:input,UNDERSTANDING:null,ENTITIES:[],CONSTRAINTS:[],UNRESOLVED_INFORMATION:[],STRATEGY:null,PROVIDER_SELECTED:null,WHY_THIS_PROVIDER:null,LIVE_REQUEST:[],LIVE_RESULTS:[],MATCHING_RESULT:[],MATCH_REASONS:[],CONFLICT_REASONS:[],MISSING_INFORMATION:[],PROVENANCE:[],RETRIEVED_AT:[],FRESHNESS:[],TRUTH_CLASSIFICATION:{input:'USER_STATED',understanding:'INTERPRETED',modelAssessment:'AI_INFERRED',results:'SOURCE_DERIVED'},WORLD_VERIFICATION:'UNVERIFIED',ACTION_AUTHORITY:'NONE',status:'blocked',stage:'authorization',...BOUNDARY};
  const finish=(stage,code)=>{report.stage=stage;report.code=code;if(measureTimings)report.TIMINGS={stages:timings,totalMs:Math.round((performance.now()-started)*100)/100};report.MODEL_RECEIPTS=structuredClone(runtime.receipts.slice(receiptStart));if(runtime.traces)report.MODEL_TRACE=structuredClone(runtime.traces.slice(traceStart));return report;};
  if(typeof input!=='string'||!input.trim()||input.length>2000)return finish('input','INVALID_INPUT');
  if(authorization?.mode!=='EXPLICIT_READ_ONLY'||authorization.inputSha256!==sha(input)||authorization.publicSearchDisclosure!==true)return finish('authorization','EXPLICIT_INPUT_BOUND_PUBLIC_SEARCH_REQUIRED');
  if(!validContext)return finish('input','INVALID_CONVERSATION_CONTEXT');
  const prior=authorization?.previousResolution&&require('../contracts/need-resolution.cjs').validateResolutionNeed(authorization.previousResolution);
  const continuing=prior?.valid&&authorization.contextTurns?.length>1;
  if(continuing&&prior.need.originalText!==authorization.contextTurns.slice(0,-1).join('\n'))return finish('input','STALE_CONVERSATION_NEED');
  const source=emptyNeed({id:continuing?prior.need.id:randomUUID(),originalText:input});
  let x;try{x=await timed('extraction',()=>extractUniversalIntent(source,runtime.extractor));}catch{return finish('extraction','LOCAL_EXTRACTION_FAILED');}
  if(x.status!=='verified'){report.EXTRACTION=x;return finish('extraction',x.code);}
  const missingSearchFields=intent=>{
   const has=dimension=>intent.constraints.some(q=>q.dimension===dimension&&q.operator==='equals'&&q.value.state==='known');
   if(intent.actions.some(a=>a.verb.value==='TRAVEL'))return ['ORIGIN','DESTINATION'].filter(d=>!has(d));
   if(intent.entities.some(e=>e.kind.value==='PLACE')&&has('NEAR')&&!has('CATEGORY'))return ['CATEGORY'];
   return [];
  };
  const missing=missingSearchFields(x.need.interpretation.intent);
  if(missing.length){
   report.EXTRACTION_REFINEMENT={reason:'MISSING_SEARCH_FIELDS',requiredDimensions:missing,attempts:1};
   // One bounded correction, from the original source; never fill from a name,
   // repeat until support, or bypass any text/semantic boundary.
   x=await timed('extraction-refinement',()=>extractUniversalIntent(source,runtime.extractor,{requiredDimensions:missing}));
   if(x.status!=='verified'){report.EXTRACTION=x;return finish('extraction',x.code);}
   if(missingSearchFields(x.need.interpretation.intent).length)return finish('extraction','SEARCH_FIELDS_UNRESOLVED');
  }
  const intent=x.need.interpretation.intent;
  report.UNDERSTANDING=intent.actions;report.ENTITIES=intent.entities;report.CONSTRAINTS=intent.constraints;report.TEXT_EVIDENCE=x.textReferences;
  const assessed=await timed('semantic-assessment',()=>assessExtractedIntent(x,runtime.assessor,{timeoutMs:runtime.assessorTimeoutMs??30000,modelVersion:runtime.model,configVersion:'local-e2e-2'}));
  report.SEMANTIC_BOUNDARY={status:assessed.status,code:assessed.code??null,assessment:assessed.assessment??null,envelope:assessed.envelope??null};
  const ready=semanticReady(assessed);
  report.SEMANTIC_GATE={semanticReady:ready,runnerStatus:assessed.status,runnerCode:assessed.code??null,graphDecision:assessed.assessment?.graph?.decision??null,expectedClaims:assessed.envelope?.claims?.length??null,supportedClaims:assessed.assessment?.claims?.filter(c=>c.decision==='support').length??0,claimDecisions:assessed.assessment?.claims??null};
  if(!ready)return finish('semantic',assessed.code||'SEMANTIC_SUPPORT_OR_COVERAGE_NOT_ESTABLISHED');
  const context={source:x.source,expectedProvider:x.expectedProvider},wire={proposal:x.proposal,textReferences:x.textReferences};
  const route=await timed('strategy-routing',()=>routeUniversalSearch(wire,context));report.ROUTE=route;report.STRATEGY=route.primaryStrategy?.kind??null;
  report.RESOLUTION_INTELLIGENCE=await timed('need-decomposition',()=>require('./resolution-bridge.cjs').resolutionFromExtraction(wire,context));
  if(report.RESOLUTION_INTELLIGENCE.status==='INTERPRETED'&&continuing){report.RESOLUTION_INTELLIGENCE.need.revision=prior.need.revision+1;report.RESOLUTION_INTELLIGENCE.decomposition=require('./resolution-engine.cjs').decomposeNeed(report.RESOLUTION_INTELLIGENCE.need);}
  if(report.RESOLUTION_INTELLIGENCE.status==='INTERPRETED'&&continuing&&authorization.previousResolution&&require('../contracts/need-resolution.cjs').validateResolutionNeed(authorization.previousResolution).valid)report.NEED_CHANGES=require('./resolution-memory.cjs').constraintChanges(authorization.previousResolution,report.RESOLUTION_INTELLIGENCE.need);
  if(report.RESOLUTION_INTELLIGENCE.status==='INTERPRETED'&&(intent.actions.length>1||intent.entities.length>1))Object.assign(report.RESOLUTION_INTELLIGENCE,require('./resolution-bridge.cjs').analyzeResolution(report.RESOLUTION_INTELLIGENCE.need,[],resolutionOptions));
  // People are not interchangeable with places or public directory entries.
  // Until opted-in matching is connected, do not disclose or search for people
  // through public providers, even when a composite need also names a place.
  if(intent.entities.some(e=>e.kind?.value==='PERSON')||intent.roles.some(r=>['CO_PARTICIPANT','HELPER','EXPERIENCED_PERSON'].includes(r.role?.value))){
   report.REFINEMENT_ALLOWED=false;
   return finish('provider-selection','PERSON_MATCHING_NOT_CONNECTED');
  }
  if(intent.actions.length>1||intent.entities.length>1){report.NEED_RESOLUTION=require('./need-resolution.cjs').planNeedResolution(route);report.REFINEMENT_ALLOWED=true;return finish('resolution-planning','COMPOSITE_NEED_REQUIRES_COMPONENT_EVIDENCE_AND_INDEPENDENT_GATES');}
  const selection=await timed('provider-selection',()=>selectProviders(route,{allowPartialDiscovery:true}));report.PROVIDER_SELECTION=selection;
  report.NEED_RESOLUTION=require('./need-resolution.cjs').planNeedResolution(route);
  if(!['candidate','partial-candidate'].includes(selection.status))return finish('provider-selection',selection.code);
  if(selection.providers.length!==1)return finish('provider-selection','PROVIDER_CHOICE_UNRESOLVED');
  const provider=selection.providers[0];report.PROVIDER_SELECTED=provider.id;report.WHY_THIS_PROVIDER={supportedStrategies:provider.strategies,capabilities:provider.capabilities,coverage:provider.coverage,unresolvedRequirements:provider.unresolvedRequirements||[],policyUrl:provider.policyUrl};
  if(requirePlaceContext&&provider.id==='photon-places'&&(runtime.requiresLocationClarification===true||!intent.constraints.some(q=>['LOCATION','AREA','NEAR'].includes(q.dimension)&&q.operator==='equals'&&q.value.state==='known')))return finish('clarification','PLACE_LOCATION_REQUIRED');
  const built=matchingNeedFromExtraction(wire,context,{actionId:intent.actions[0]?.id,entityId:intent.entities[0]?.id});
  if(built.status!=='candidate')return finish('matching-need',built.code);
  const profile=built.profile;
  // Only an assessment performed in this invocation, through the bound existing
  // runner, may discharge this uncertainty. No caller-supplied assessed flag.
  profile.uncertainty=profile.uncertainty.filter(c=>c!=='SEMANTIC_SUPPORT_NOT_AUTHENTICATED');
  for(const q of profile.constraints)if(q.dimension==='CATEGORY'&&q.value.state==='known')q.value.value=q.value.value.toLowerCase();
  acceptanceContexts.set(report,structuredClone({wire,context,profile,providerId:provider.id}));
  const qs=intent.constraints;
  const value=dim=>{const matches=qs.filter(q=>q.dimension===dim&&q.operator==='equals'&&q.value.state==='known');return matches.length===1?matches[0].value.value:null;};
  const term=intent.entities[0]?.description?.value;
  const requests=[];
  async function read(request){
   if(requirePrivacyReview){
    let review=null;
    const minimized=typeof request.query!=='string'||request.query.trim().length>0&&request.query.length<=240;
    try{if(minimized)review=await timed('privacy-review',()=>runtime.privacyAssessor?.review({input,request:structuredClone(request)}));}catch{}
    report.PRIVACY_REVIEWS??=[];report.PRIVACY_REVIEWS.push({requestFingerprint:requestFingerprint(request),decision:review?.decision??'UNCERTAIN',epistemicStatus:runtime.model==='DETERMINISTIC_PUBLIC_GRAMMAR'?'INTERPRETED':'AI_INFERRED',scope:'EXACT_OUTBOUND_FIELDS_ONLY'});
    if(review?.decision!=='PUBLIC_NON_PERSONAL'){
     acceptanceContexts.delete(report);
     return {status:'blocked',code:'PUBLIC_QUERY_NOT_ESTABLISHED',results:[],...BOUNDARY};
    }
   }
   if(requests.some(r=>r.providerId===request.providerId))await timed('provider-spacing',()=>sleep(2100));
   requests.push(request);report.LIVE_REQUEST.push({request,requestFingerprint:requestFingerprint(request),purpose:'USER_AUTHORIZED_PUBLIC_READ'});
   const result=await timed('provider-and-normalization',()=>search(request,{mode:'EXPLICIT_READ_ONLY',providerId:request.providerId,operation:request.operation,disclosureApproved:true,queryClass:'PUBLIC_NON_PERSONAL',requestFingerprint:requestFingerprint(request)},{...(measureTimings?{onTiming:(stage,durationMs)=>timings.push({stage,durationMs})}:{})}));
   report.LIVE_RESULTS.push(result);if(result.provenance){report.PROVENANCE.push(result.provenance);report.RETRIEVED_AT.push(result.provenance.retrievedAt);}if(result.freshness)report.FRESHNESS.push(result.freshness);
   return result;
  }
  const sourceFact=(value,sourceResult)=>{const index=profile.provenance.length;profile.provenance.push(structuredClone(sourceResult.provenance));return {state:'known',value,epistemicStatus:'SOURCE_DERIVED',evidenceIndexes:[index]};};
  const execution=await executeProvider({provider,report,route,profile,value,term,read,sourceFact});
  if(execution.stop)return finish(execution.stop.stage,execution.stop.code);
  const final=execution.final;
  if(final?.code==='PUBLIC_QUERY_NOT_ESTABLISHED')return finish('privacy',final.code);
  if(!final?.results?.length){report.NEED_RESOLUTION=require('./need-resolution.cjs').planNeedResolution(route,{outcome:final?.status==='failed'||final?.status==='blocked'?'SOURCE_UNAVAILABLE':'NO_RESULTS'});return finish('real-search',final?.code||'LIVE_NO_RESULTS');}
  const ranked=[];
  for(let index=0;index<final.results.length;index++){
   const adapted=await timed('matching-adapter',()=>candidateFromProviderResult(final,index));if(adapted.status!=='candidate')return finish('matching-adapter',adapted.code);
   const match=await timed('matching',()=>matchNeedToCandidate(profile,adapted.candidate));
   ranked.push({result:final.results[index],match,sourceQuality:adapted.sourceQuality});
  }
  report.MATCHING_RESULT=await timed('ranking',()=>rankExplained(ranked));report.MATCH_REASONS=report.MATCHING_RESULT.map(r=>({rank:r.rank,reasons:r.match.matchReasons}));report.CONFLICT_REASONS=report.MATCHING_RESULT.map(r=>({rank:r.rank,reasons:r.match.conflictReasons}));report.MISSING_INFORMATION=report.MATCHING_RESULT.map(r=>({rank:r.rank,reasons:r.match.missingInformation}));report.MATCHING_NEED=profile;
  report.status='end-to-end-read-and-match';return finish('ranked-results','READ_AND_MATCH_COMPLETED_NOT_WORLD_VERIFIED');
 };
}
module.exports={createUniversalRealSearch,semanticReady,rankExplained,inputFingerprint:sha,acceptedSearchContext};
