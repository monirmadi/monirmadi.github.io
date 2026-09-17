'use strict';
const {createUniversalRealSearch,inputFingerprint}=require('./universal-real-search.cjs');
const {createPublicRuntime}=require('./public-intent-fast-path.cjs');
const rawBetaTransport=require('./public-provider-http.cjs').createPublicTransport({timeoutMs:5000});
const betaTransport=require('./beta-provider-pacing.cjs').withShortProviderWait(rawBetaTransport);
function createBetaSearch(options={}){
 options={...options,search:options.search??((request,authorization,metrics)=>require('./controlled-real-search.cjs').controlledRealSearch(request,authorization,{...metrics,transport:betaTransport,timeoutMs:5000}))};
 const heavy=createUniversalRealSearch({...options,requirePrivacyReview:true,requirePlaceContext:true});
 return async(input,authorization)=>{
  const start=performance.now();const allowed=typeof input==='string'&&authorization?.mode==='EXPLICIT_READ_ONLY'&&authorization?.inputSha256===inputFingerprint(input)&&authorization?.publicSearchDisclosure===true;
  // A known unsupported action may be rejected without any disclosure or model inference.
  // This never authorizes a replacement place search or claims full interpretation.
  if(allowed&&/^(?:buy|purchase|kaufe|kaufen|ich möchte kaufen|اشتري|اشتر|أريد شراء|اريد شراء)\s+\S/iu.test(input.trim())){
   return {status:'blocked',stage:'provider-selection',code:'CAPABILITY_NOT_AVAILABLE',UNDERSTANDING:[{verb:{state:'known',value:'BUY'}}],ENTITIES:[{description:{value:input}}],CONSTRAINTS:[],MODEL_RECEIPTS:[],LIVE_RESULTS:[],PROVENANCE:[],MATCHING_RESULT:[],PROVIDER_SELECTED:null,ACTION_AUTHORITY:'NONE',WORLD_VERIFICATION:'UNVERIFIED',actionAuthority:'NONE',worldVerification:'UNVERIFIED',FAST_PATH:{used:true,rule:'UNSUPPORTED_PURCHASE_CAPABILITY'},REFINEMENT_ALLOWED:false,...(options.measureTimings?{TIMINGS:{stages:[{stage:'capability-routing',durationMs:performance.now()-start}],totalMs:performance.now()-start}}:{})};
  }
  if(allowed&&authorization.contextTurns?.length>1){
   const turns=authorization.contextTurns,previous=require('./public-intent-fast-path.cjs').parsePublicContext(turns.slice(0,-1)),reply=turns.at(-1).trim();
   const askArea=/^(?:show me another area|another area|in another area|anderes gebiet|anderer stadtteil|منطقة أخرى|حي آخر)[.!؟?]*$/iu.test(reply);
   const unsupported=/^(?:closer|nearest|أقرب|näher|open now|only open now|best rated|cheapest|wifi|واي فاي|مفتوح الآن|الأرخص|jetzt geöffnet)\b/iu.test(reply)||/^(?:أقرب|مفتوح الآن|الأرخص)/u.test(reply);
   if(previous?.family==='place'&&(askArea||unsupported))return {status:'blocked',stage:'clarification',code:askArea?'REFINEMENT_AREA_REQUIRED':'REFINEMENT_NOT_SUPPORTED',ENTITIES:[{description:{value:previous.term}}],CONSTRAINTS:previous.place?[{dimension:previous.place.dimension,operator:'equals',value:{state:'known',value:previous.place.value}}]:[],MODEL_RECEIPTS:[],LIVE_RESULTS:[],PROVENANCE:[],MATCHING_RESULT:[],PROVIDER_SELECTED:null,ACTION_AUTHORITY:'NONE',WORLD_VERIFICATION:'UNVERIFIED',actionAuthority:'NONE',worldVerification:'UNVERIFIED',FAST_PATH:{used:true,rule:'REFINEMENT_CLARIFICATION'},REFINEMENT_ALLOWED:true,CONTEXT_KEEP_PRIOR:true,...(options.measureTimings?{TIMINGS:{stages:[],totalMs:performance.now()-start}}:{})};
  }
  const runtime=allowed?createPublicRuntime(input,{turns:authorization.contextTurns}):null;
  const interpreted=performance.now()-start;
  const run=runtime?createUniversalRealSearch({...options,runtime,requirePrivacyReview:true,requirePlaceContext:true}):heavy;
  const report=await run(input,authorization);report.FAST_PATH={used:Boolean(runtime),rule:runtime?'CLOSED_PUBLIC_INTENT_GRAMMAR_V1':null};
  report.REFINEMENT_ALLOWED=Boolean(report.ENTITIES?.length)&&!['authorization','input','privacy'].includes(report.stage);
  if(authorization?.contextTurns?.length>1&&['extraction','semantic'].includes(report.stage)&&report.status==='blocked'){report.CONTEXT_KEEP_PRIOR=true;report.REFINEMENT_ALLOWED=true;}
  report.ORCHESTRATION={capabilities:['places','transport','public-information'],internalMatching:'REQUIRES_CONFIRMED_RECORDS_AND_SAFETY_GRANTS',chosenProvider:report.PROVIDER_SELECTED??null,heavyFallback:!runtime};
  if(runtime)report.TRUTH_CLASSIFICATION.modelAssessment='INTERPRETED';
  if(report.TIMINGS){report.TIMINGS.stages.unshift({stage:'fast-path-interpretation',durationMs:interpreted});report.TIMINGS.totalMs=performance.now()-start;}
  return report;
 };
}
async function searchAcceptedInternalNeed(record,candidates,options){
 if(!Array.isArray(candidates)||candidates.length>50)throw Error('BOUNDED_CANDIDATES_REQUIRED');
 const {matchInternalRecords}=require('./internal-matching.cjs');
 return candidates.map(candidate=>matchInternalRecords(record,candidate,options));
}
module.exports={createBetaSearch,searchAcceptedInternalNeed};
