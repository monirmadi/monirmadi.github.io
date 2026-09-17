'use strict';
const {acceptProposal,sourceFingerprint}=require('./interpretation-boundary.cjs');
// JSON-only input boundary; never logs source text, quotes, or provider payloads.
function copy(value){let count=0,chars=0;const seen=new Set();function visit(v,depth){
 if(++count>20000||depth>30)throw Error('LIMIT');
 if(v===null||typeof v==='boolean')return v;
 if(typeof v==='string'){chars+=v.length;if(chars>200000)throw Error('LIMIT');return v;}
 if(typeof v==='number'&&Number.isFinite(v))return v;
 if(typeof v!=='object'||seen.has(v))throw Error('JSON');
 if(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error('JSON');
 seen.add(v);const out=Array.isArray(v)?[]:{};
 for(const k of Reflect.ownKeys(v)){if(Array.isArray(v)&&k==='length')continue;
 const d=Object.getOwnPropertyDescriptor(v,k);
 if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!d.enumerable||!Object.hasOwn(d,'value')||(Array.isArray(v)&&!/^(0|[1-9][0-9]*)$/.test(k)))throw Error('JSON');
 out[k]=visit(d.value,depth+1);}
 if(Array.isArray(v)&&Object.keys(out).length!==v.length)throw Error('JSON');seen.delete(v);return out;
 }return visit(value,0);}
const shape=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const split=(s,n)=>n>0&&n<s.length&&s.charCodeAt(n-1)>=0xD800&&s.charCodeAt(n-1)<=0xDBFF&&s.charCodeAt(n)>=0xDC00&&s.charCodeAt(n)<=0xDFFF;
function verifyTextEvidence(source,proposal,expectedProvider,evidence){
 const reject=code=>({status:'rejected',code,semanticSupport:'unverified',worldTruth:'unverified'});
 let s,p,x,refs;try{[s,p,x,refs]=copy([source,proposal,expectedProvider,evidence]);}catch{return reject('MALFORMED_OR_LIMIT_EXCEEDED');}
 const gate=acceptProposal(s,p,x);if(gate.status!=='accepted')return reject('INTERPRETATION_REJECTED');
 if(!Array.isArray(refs)||refs.length>100)return reject('INVALID_EVIDENCE_LIST');
 const fingerprint=sourceFingerprint(s),text=s.originalText,claims=new Map();
 // Canonical JSON Pointer paths target Field objects or individual ambiguous candidates.
 function fields(v,path){if(!v||typeof v!=='object')return;
 if(v.state==='known'){claims.set(path,v.evidence);return;}
 if(v.state==='ambiguous'){v.candidates.forEach((c,i)=>claims.set(path+'/candidates/'+i,c.evidence));return;}
 if(v.state==='unknown')return;
 for(const k of Object.keys(v))fields(v[k],path+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1'));
 }
 fields(gate.need.interpretation.intent,'/interpretation/intent');
 const checked=[],seen=new Set();
 for(const ref of refs){
 if(!shape(ref,['reference','source','sourceFingerprint','target','start','end','quote']))return reject('INVALID_REFERENCE');
 if(ref.source!=='original-need-text')return reject('UNSUPPORTED_SOURCE');
 if(ref.sourceFingerprint!==fingerprint)return reject('SOURCE_CONTEXT_MISMATCH');
 if(typeof ref.reference!=='string'||!ref.reference||ref.reference.length>200||typeof ref.target!=='string'||ref.target.length>1000)return reject('INVALID_REFERENCE');
 const attached=claims.get(ref.target);
 if(!attached)return reject('INVALID_CLAIM_TARGET');
 if(!attached.some(e=>e.source==='user-text'&&e.reference===ref.reference))return reject('UNATTACHED_REFERENCE');
 const key=ref.target+'\u0000'+ref.reference;if(seen.has(key))return reject('DUPLICATE_REFERENCE');seen.add(key);
 if(!Number.isSafeInteger(ref.start)||!Number.isSafeInteger(ref.end)||ref.start<0||ref.end<=ref.start||ref.end>text.length||split(text,ref.start)||split(text,ref.end))return reject('INVALID_RANGE');
 if(typeof ref.quote!=='string'||ref.quote!==text.slice(ref.start,ref.end))return reject('QUOTE_MISMATCH');
 // No excerpts, values, IDs, provider-controlled paths or reference strings in output.
 checked.push({index:checked.length,status:'text-reference-verified',start:ref.start,end:ref.end});
 }
 for(const [target,items]of claims)for(const e of items)if(e.source==='user-text'&&!seen.has(target+'\u0000'+e.reference))return reject('MISSING_TEXT_REFERENCE');
 return {status:'verified',scope:'submitted-text-references-only',offsetConvention:'utf16-half-open',semanticSupport:'unverified',worldTruth:'unverified',references:checked};
}
module.exports={verifyTextEvidence};
