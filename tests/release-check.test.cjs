'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {samplesPassed}=require('../scripts/public-api-live-check.cjs');
const real=()=>({version:1,status:'results',conversationId:'same',results:[{source:{classification:'SOURCE_DERIVED'},independentlyVerified:false}],error:null});
const samples=()=>[{status:'clarification',conversationId:'same'},real(),real(),real(),real(),{status:'unsupported'}];
test('release verification fails on unavailable, empty or unproven source results',()=>{
 assert.equal(samplesPassed(...samples()),true);
 for(let i=1;i<=4;i++)for(const invalid of [{...real(),status:'provider_unavailable'},{...real(),status:'no_result'},{...real(),results:[]},{...real(),results:[{source:{classification:'DEMO'},independentlyVerified:false}]},{...real(),error:{code:'temporarily_unavailable'}}]){
  const s=samples();s[i]=invalid;assert.equal(samplesPassed(...s),false);
 }
});
test('release verification requires continuation to retain the actual conversation',()=>{
 const s=samples();s[1]={...real(),conversationId:'other'};assert.equal(samplesPassed(...s),false);
});
