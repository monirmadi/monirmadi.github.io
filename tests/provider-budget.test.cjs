'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPublicTransport}=require('../server/public-provider-http.cjs');
function fixture(options={}){
 let tick=0,calls=0,status=200,retry='3600';
 const wall=Date.parse('2026-10-25T12:00:00Z');
 const read=createPublicTransport({now:()=>wall+tick,monotonic:()=>tick,fetchImpl:async()=>{calls++;return new Response('{}',{status,headers:{'content-type':'application/json',date:new Date(wall+tick).toUTCString(),'retry-after':retry}});},...options});
 return {read,advance:n=>tick+=n,setStatus:n=>status=n,calls:()=>calls};
}
const request=i=>({providerId:'photon-places',operation:'places',query:'Berlin '+i});
test('hosted budget renews after an hour, never early; cache stays usable',async()=>{
 const f=fixture({requestBudgetWindowMs:3600000});
 for(let i=0;i<30;i++){assert.equal((await f.read(request(i))).status,'received');f.advance(2000);}
 assert.equal((await f.read(request(99))).code,'SESSION_REQUEST_LIMIT');
 assert.equal((await f.read(request(29))).fromCache,true);
 f.advance(3539999);assert.equal((await f.read(request(99))).code,'SESSION_REQUEST_LIMIT');
 f.advance(1);assert.equal((await f.read(request(99))).status,'received');assert.equal(f.calls(),31);
});
test('research default retains lifetime cap',async()=>{
 const f=fixture();for(let i=0;i<30;i++){await f.read(request(i));f.advance(2000);}
 f.advance(86400000);assert.equal((await f.read(request(99))).code,'SESSION_REQUEST_LIMIT');
});
test('renewal cannot bypass provider backoff or clock rollback',async()=>{
 const f=fixture({requestBudgetWindowMs:3600000});
 f.advance(3599000);f.setStatus(429);assert.equal((await f.read(request(1))).httpStatus,429);
 f.advance(2000);assert.equal((await f.read(request(2))).code,'RATE_LIMITED');
 f.advance(-4000000);assert.equal((await f.read(request(3))).code,'RATE_LIMITED');
 assert.equal(f.calls(),1);
});
test('budget configuration is bounded',()=>{
 for(const requestBudgetWindowMs of [0,-1,NaN,Infinity,86400001])assert.throws(()=>createPublicTransport({requestBudgetWindowMs}),RangeError);
});
