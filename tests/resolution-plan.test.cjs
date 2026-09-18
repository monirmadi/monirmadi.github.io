'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createUniversalRealSearch,inputFingerprint}=require('../server/universal-real-search.cjs');
const {compileExtraction}=require('../server/local-language-runtime.cjs');
const {publicResponse}=require('../server/public-ask-contract.cjs');
const {publicResolutionPlan}=require('../server/public-resolution-plan.cjs');
async function run(person=false,reject=false){
 const input=person?'I need a room in Berlin and a person to help me move':'I need a cafe in Berlin and a library in Hamburg';
 const f=value=>({value,quote:input});
 const part=(kind,target,city)=>({action:f('FIND'),entity:{kind:f(kind),description:f(target)},constraints:[{dimension:'LOCATION',operator:'equals',value:f(city)}],roles:[],domains:[]});
 const output=person?part('HOUSING','room','Berlin'):part('PLACE','cafe','Berlin');
 if(!person)output.constraints.push({dimension:'CATEGORY',operator:'equals',value:f('cafe')});
 output.components=[person?{...part('PERSON','moving helper','Berlin'),roles:[f('HELPER')]}:{...part('PLACE','library','Hamburg'),constraints:[{dimension:'LOCATION',operator:'equals',value:f('Hamburg')},{dimension:'CATEGORY',operator:'equals',value:f('library')}]}];
 // Test-owned model fixture, never a production evidence shortcut.
 const extractor={id:'test-fixture',version:'1',extract:async source=>compileExtraction(source,output,extractor)};
 let calls=0;
 const assessor={id:'test-assessor',version:'1',assess:async p=>({binding:p.binding,claims:p.claims.map(c=>({claimId:c.id,decision:reject?'reject':'support',reasons:[reject?'contradicted':'evidence-support'],evidenceIndexes:c.evidenceIndexes})),graph:{decision:reject?'conflict':'support',reasons:[reject?'inconsistent-claims':'evidence-support'],claimIds:p.claims.map(c=>c.id),evidenceIndexes:p.evidence.map(e=>e.index)}})};
 const search=createUniversalRealSearch({runtime:{extractor,assessor,receipts:[],model:'fixture'},search:async()=>{calls++;throw Error('Unexpected provider call');}});
 const report=await search(input,{mode:'EXPLICIT_READ_ONLY',inputSha256:inputFingerprint(input),publicSearchDisclosure:true});
 return {report,calls};
}
test('composite need returns an honest plan without executing any component',async()=>{
 const {report,calls}=await run();
 assert.equal(report.code,'COMPOSITE_NEED_REQUIRES_COMPONENT_EVIDENCE_AND_INDEPENDENT_GATES');
 const response=publicResponse(report,{locale:'en',conversationId:'x'});
 assert.equal(response.resultType,'COMPOSITE');assert.equal(response.resolutionPlan.components.length,2);
 assert.deepEqual(response.resolutionPlan.constraints.filter(c=>c.dimension==='LOCATION').map(c=>c.value),['Berlin','Hamburg']);
 assert.equal(response.resolutionPlan.executionAllowed,false);assert.equal(response.resolutionPlan.monitoringEnabled,false);
 assert.equal(response.canRefine,false);assert.equal(response.nextAction,'open_account');assert.deepEqual(response.results,[]);assert.equal(calls,0);
 assert.match(response.message,/not been searched/);
});
test('mixed person and housing need is preserved with no public people lookup',async()=>{
 const {report,calls}=await run(true);
 assert.equal(report.code,'PERSON_MATCHING_NOT_CONNECTED');assert.equal(calls,0);
 const response=publicResponse(report,{locale:'ar'});
 assert.equal(response.resultType,'COMPOSITE');assert.deepEqual(response.resolutionPlan.components.map(c=>c.kind),['HOUSING','PERSON']);
 assert.match(response.message,/لم أبحث/);assert.equal(response.resolutionPlan.communicationAuthorized,false);
});
test('unassessed and rejected graphs cannot become user-facing plans',async()=>{
 const {report}=await run(false,true);assert.equal(publicResolutionPlan(report),null);
 const good=(await run()).report;good.SEMANTIC_GATE.semanticReady=false;assert.equal(publicResolutionPlan(good),null);
});
test('model diagnostics contain operational codes only, never query or raw response',async()=>{
 const {createLocalLanguageRuntime}=require('../server/local-language-runtime.cjs');
 const {emptyNeed}=require('../contracts/universal.cjs');
 const runtime=createLocalLanguageRuntime({fetchImpl:async()=>new Response('private response',{status:502})});
 await assert.rejects(runtime.extractor.extract(emptyNeed({id:'test',originalText:'private query'})));
 assert.deepEqual(runtime.failures,[{stage:'extraction',code:'LOCAL_MODEL_HTTP_ERROR'}]);
 assert(!JSON.stringify(runtime.failures).includes('private'));
});
