'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOpenAIModelFetch}=require('../server/public-api.cjs');
test('hosted model failures expose only status and allowlisted operational code',async()=>{
 const messages=[],original=console.warn;console.warn=(...args)=>messages.push(args);
 try{
  for(const code of ['insufficient_quota','private-user-text']){
   const adapter=createOpenAIModelFetch({apiKey:'sk-test-secret',fetchImpl:async()=>new Response(JSON.stringify({error:{code,message:'private-user-text',details:'sk-test-secret'}}),{status:429})});
   const response=await adapter('',{body:JSON.stringify({prompt:'private-user-text',format:{type:'object'}})});
   assert.equal(response.status,429);assert.equal((await response.json()).error.code,code);
  }
  assert.deepEqual(messages.map(x=>JSON.parse(x[1])),[{status:429,code:'insufficient_quota'},{status:429,code:'UNKNOWN'}]);
  assert(!JSON.stringify(messages).includes('private-user-text'));assert(!JSON.stringify(messages).includes('sk-test-secret'));
 }finally{console.warn=original;}
});
