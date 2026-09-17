'use strict';
const {createHash}=require('node:crypto');
const {validateNeed}=require('./universal.cjs');
// Offline structural gate. The caller supplies trusted snapshot/provider configuration.
function snapshot(value){
 let nodes=0;const seen=new Set();
 function copy(v,depth){
  if(++nodes>20000||depth>30)throw new Error('LIMIT');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='string'){if(v.length>100000)throw new Error('LIMIT');return v;}
  if(typeof v==='number'&&Number.isFinite(v))return v;
  if(typeof v!=='object'||seen.has(v))throw new Error('NON_JSON');
  const proto=Object.getPrototypeOf(v);if(!Array.isArray(v)&&proto!==Object.prototype&&proto!==null)throw new Error('NON_JSON');
  seen.add(v);const result=Array.isArray(v)?[]:{};
  for(const key of Reflect.ownKeys(v)){
   if(Array.isArray(v)&&key==='length')continue;
   if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))throw new Error('NON_JSON');
   const d=Object.getOwnPropertyDescriptor(v,key);if(!d.enumerable||!Object.hasOwn(d,'value'))throw new Error('NON_JSON');
   if(Array.isArray(v)&&! /^(0|[1-9][0-9]*)$/.test(key))throw new Error('NON_JSON');
   result[key]=copy(d.value,depth+1);
  }
  if(Array.isArray(v)&&Object.keys(result).length!==v.length)throw new Error('NON_JSON');
  seen.delete(v);return result;
 }
 return copy(value,0);
}
const canonical=v=>JSON.stringify(v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])));
const equal=(a,b)=>canonical(a)===canonical(b);
function sourceFingerprint(source){const s=snapshot(source);if(!validateNeed(s).valid)throw new Error('INVALID_SOURCE');return createHash('sha256').update(canonical(s)).digest('hex');}
function acceptProposal(source,proposal,expected){
 const reject=code=>({status:'rejected',code,trust:'structural-only',semanticGrounding:'unverified'});
 let s,p,e;
 try{s=snapshot(source);if(!validateNeed(s).valid)return reject('INVALID_SOURCE');}catch{return reject('INVALID_SOURCE');}
 try{p=snapshot(proposal);e=snapshot(expected);}catch{return reject('MALFORMED_PROPOSAL');}
 if(!e||typeof e.providerId!=='string'||!e.providerId.trim()||typeof e.providerVersion!=='string'||!e.providerVersion.trim()||Object.keys(e).sort().join()!=='providerId,providerVersion')return reject('INVALID_PROVIDER_CONFIGURATION');
 if(!p||typeof p!=='object'||Object.keys(p).sort().join()!=='need,sourceFingerprint')return reject('MALFORMED_PROPOSAL');
 if(p.sourceFingerprint!==sourceFingerprint(s))return reject('SOURCE_CONTEXT_MISMATCH');
 try{if(!validateNeed(p.need).valid)return reject('INVALID_PROPOSAL');}catch{return reject('INVALID_PROPOSAL');}
 const n=p.need;
 if(n.interpretation.providerId!==e.providerId||n.interpretation.providerVersion!==e.providerVersion)return reject('PROVIDER_MISMATCH');
 for(const key of ['schemaVersion','id','originalText','language','market','lifecycle','privacy'])if(!equal(s[key],n[key]))return reject('PROTECTED_CONTEXT_CHANGED');
 let forged=false;
 function scan(v,original){if(!v||typeof v!=='object')return;
  if(v.source==='authored-fixture')forged=true;
  if((v.source==='user-confirmation'||v.confirmed===true)&&!equal(v,original??null))forged=true;
  for(const k of Object.keys(v))scan(v[k],original?.[k]);
 }
 scan(n,s);if(forged)return reject('UNTRUSTED_EVIDENCE');
 // No automatic conflict resolution or replacement of an existing interpretation.
 if(s.interpretation.intent.state!=='unknown'&&!equal(s.interpretation.intent,n.interpretation.intent))return reject('INTERPRETATION_CONFLICT');
 return {status:'accepted',trust:'structural-only',semanticGrounding:'unverified',sourceFingerprint:p.sourceFingerprint,need:n};
}
module.exports={sourceFingerprint,acceptProposal};
