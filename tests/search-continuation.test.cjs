'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {extractionSchema,compileExtraction,createLocalLanguageRuntime}=require('../server/local-language-runtime.cjs');
const {emptyNeed}=require('../contracts/universal.cjs');
const {createUniversalRealSearch,inputFingerprint}=require('../server/universal-real-search.cjs');
const {publicResponse}=require('../server/public-ask-contract.cjs');
test('multi-turn schema has only control-free, unique verbatim evidence spans',()=>{
 for(const input of ['ich such ein wohnung\nBerlin','café\r\nبرلين','room\tBerlin','Berlin\nBerlin','ένα δωμάτιο\nΑθήνα']){
  const s=extractionSchema(input);let found=0;
  function walk(v){if(!v||typeof v!=='object')return;if(v.properties?.quote?.enum){found++;for(const q of v.properties.quote.enum){assert(!/[\u0000-\u001f\u007f]/u.test(q));assert(input.includes(q));assert.equal(input.indexOf(q,input.indexOf(q)+1),-1);}}for(const x of Object.values(v))if(typeof x==='object')walk(x);}
  walk(s);if(input==='Berlin\nBerlin'){assert.equal(s.properties.action.properties.quote.enum,undefined);}else assert(found>0);
 }
});
test('spelling stays verbatim and follow-up evidence keeps original offsets',async()=>{
 const turns=['ich such ein wohnung','Berlin'],input=turns.join('\n'),f=(value,quote)=>({value,quote});
 const output={action:f('FIND','ich such'),entity:{kind:f('HOUSING','wohnung'),description:f('Wohnung','wohnung')},constraints:[{dimension:'LOCATION',operator:'equals',value:f('Berlin','Berlin')}],domains:[],roles:[],components:[],unresolved:[]};
 let sent;
 const runtime=createLocalLanguageRuntime({model:'gpt-4.1-mini',contextTurns:turns,fetchImpl:async(u,i)=>{sent=JSON.parse(i.body);return new Response(JSON.stringify({done:true,done_reason:'stop',model:'gpt-4.1-mini',created_at:new Date().toISOString(),response:JSON.stringify(output)}));}});
 const wire=await runtime.extractor.extract(emptyNeed({id:'test',originalText:input}));
 assert.equal(wire.need.originalText,input);assert.deepEqual(JSON.parse(sent.prompt).userTurnRanges,[{start:0,end:20},{start:21,end:27}]);
 for(const r of wire.textReferences)assert.equal(input.slice(r.start,r.end),r.quote);
 output.entity.kind.quote='Wohnung';await assert.rejects(runtime.extractor.extract(emptyNeed({id:'test',originalText:input})),/QUOTE|SCHEMA_REJECTED/);
});
async function fixture(kind,domain){
 const input='ich such ein wohnung in Berlin',f=value=>({value,quote:input});
 const output={action:f('FIND'),entity:{kind:f(kind),description:f('Wohnung')},constraints:[{dimension:'LOCATION',operator:'equals',value:f('Berlin')}],roles:[],domains:domain?[f(domain)]:[],components:[],unresolved:[]};
 const extractor={id:'fixture',version:'1',extract:async source=>compileExtraction(source,output,extractor)};
 const assessor={id:'fixture-assessor',version:'1',assess:async p=>({binding:p.binding,claims:p.claims.map(c=>({claimId:c.id,decision:'support',reasons:['evidence-support'],evidenceIndexes:c.evidenceIndexes})),graph:{decision:'support',reasons:['evidence-support'],claimIds:p.claims.map(c=>c.id),evidenceIndexes:p.evidence.map(e=>e.index)}})};
 let calls=0;const search=createUniversalRealSearch({runtime:{extractor,assessor,receipts:[],model:'fixture'},search:async()=>{calls++;throw Error('Unexpected map lookup');}});
 const report=await search(input,{mode:'EXPLICIT_READ_ONLY',inputSha256:inputFingerprint(input),publicSearchDisclosure:true});return {report,calls};
}
test('actual accommodation never executes public map search or invents availability',async()=>{
 for(const kind of ['HOUSING','ROOM','APARTMENT','LIVE_HOUSING_LISTING']){const {report,calls}=await fixture(kind,'HOUSING');assert.equal(calls,0);assert.equal(report.code,'HOUSING_MATCHING_NOT_CONNECTED');const r=publicResponse(report,{locale:'de'});assert.equal(r.status,'unsupported');assert.equal(r.resultType,'HOUSING');assert.deepEqual(r.results,[]);assert.equal(r.canRefine,false);assert.match(r.message,/keine Verfügbarkeit/);}
});
test('generic place conflicting with housing domain fails closed',async()=>{
 const {report,calls}=await fixture('PLACE','HOUSING');assert.equal(calls,0);assert.equal(report.code,'TARGET_KIND_CONFLICT');assert.equal(publicResponse(report,{locale:'en'}).status,'clarification');
});
