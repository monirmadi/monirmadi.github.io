'use strict';
const {decomposeNeed,evaluateResolution,planSolutionPaths}=require('./resolution-engine.cjs');
const {searchMissingPieces}=require('./resolution-orchestrator.cjs');
const {explainResolution}=require('./resolution-bridge.cjs');
const {BOUNDARY}=require('../contracts/need-resolution.cjs');
// Trusted backend entry for an accepted canonical need; no HTTP endpoint, storage,
// messaging or background worker. New reads require exact component authorization.
async function resolveAcceptedNeed(need,records=[],options={}){
 const start=performance.now(),decomposition=decomposeNeed(need),decompositionMs=performance.now()-start;
 if(decomposition.status==='BLOCKED')return {...decomposition,timings:{decompositionMs}};
 let state=evaluateResolution(need,records,options),search=null,observations=options.observations??[];
 const initialCompositionMs=state.timings.compositionMs;
 if(options.searchMissing===true&&!['BLOCKED','COMPLETE','NEEDS_CLARIFICATION'].includes(state.status)){
  search=await searchMissingPieces(need,state,options);
  if(search.status==='READ_COMPLETED'){
   observations=[...observations,...search.observations];
   // Re-evaluate retained records too: expiry, consent and safety can change.
   state=evaluateResolution(need,[...records,...search.offers],{...options,observations});
  }
 }
 const plan=planSolutionPaths(need,state);
 return {...BOUNDARY,executionAllowed:false,resolved:false,decomposition,state,plan,search,explanation:explainResolution(need,state,plan,observations),timings:{decompositionMs,compositionMs:initialCompositionMs+(search?.status==='READ_COMPLETED'?state.timings.compositionMs:0),providerMs:search?.timings.providerMs??0,heavySemanticMs:0,totalMs:performance.now()-start}};
}
module.exports={resolveAcceptedNeed};
