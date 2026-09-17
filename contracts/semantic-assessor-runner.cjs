'use strict';
const {safeDiagnostic,readDiagnostic}=require('./assessor-diagnostics.cjs');
const {validateSemanticClaims,proposalFingerprint}=require('./semantic-claim-boundary.cjs');
function copy(v){let nodes=0,size=0;const seen=new Set();function walk(x,d){if(++nodes>20000||d>30)throw Error();if(x===null||typeof x==='boolean')return x;if(typeof x==='string'){if((size+=x.length)>200000)throw Error();return x;}if(typeof x==='number'&&Number.isFinite(x))return x;if(typeof x!=='object'||seen.has(x)||(!Array.isArray(x)&&![Object.prototype,null].includes(Object.getPrototypeOf(x))))throw Error();seen.add(x);const y=Array.isArray(x)?[]:{};for(const k of Reflect.ownKeys(x)){if(Array.isArray(x)&&k==='length')continue;const a=Object.getOwnPropertyDescriptor(x,k);if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!a.enumerable||!Object.hasOwn(a,'value')||(Array.isArray(x)&&!/^(0|[1-9][0-9]*)$/.test(k)))throw Error();size+=k.length;if(size>200000)throw Error();y[k]=walk(a.value,d+1);}if(Array.isArray(x)&&Object.keys(y).length!==x.length)throw Error();seen.delete(x);return y;}return walk(v,0);}
const shape=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===[...keys].sort().join('|');
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=100;
function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
async function runSemanticAssessor(input,assessor,{timeoutMs=1000,signal}={}){
 const fail=(code,diagnostic)=>({status:'failed',code,...(diagnostic?{diagnostic:safeDiagnostic(diagnostic.category,diagnostic.httpStatus)}:{}),worldVerification:'UNVERIFIED',actionAuthority:'NONE'});
 let i;try{i=copy(input);}catch{return fail('INVALID_INPUT');}
 if(!shape(i,['source','proposal','interpretationProvider','evidence','envelope','expectedAssessor','policyVersion','modelVersion','configVersion','authorizedEvidenceIndexes'])||!text(i.policyVersion)||![i.modelVersion,i.configVersion].every(v=>v===null||text(v))||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)return fail('INVALID_INPUT');
 if(!assessor||typeof assessor.assess!=='function'||assessor.id!==i.expectedAssessor?.id||assessor.version!==i.expectedAssessor?.version)return fail('ASSESSOR_MISMATCH');
 let validated;try{validated=validateSemanticClaims(i.source,i.proposal,i.interpretationProvider,i.evidence,i.envelope,i.expectedAssessor);}catch{return fail('INVALID_INPUT');}
 if(validated.status!=='valid-envelope')return fail('BOUNDARY_REJECTED');
 // Caller authorization is an explicit allowlist; there is no context source or tool access.
 if(!Array.isArray(i.authorizedEvidenceIndexes)||i.authorizedEvidenceIndexes.length!==i.evidence.length||new Set(i.authorizedEvidenceIndexes).size!==i.evidence.length||i.authorizedEvidenceIndexes.some(n=>!Number.isSafeInteger(n)||n<0||n>=i.evidence.length))return fail('UNAUTHORIZED_EVIDENCE');
 const binding={source:i.envelope.sourceFingerprint,proposal:i.envelope.proposalFingerprint,envelope:proposalFingerprint(i.envelope,[]),assessorId:assessor.id,assessorVersion:assessor.version,policyVersion:i.policyVersion,modelVersion:i.modelVersion,configVersion:i.configVersion};
 const payload=freeze(copy({binding,claims:i.envelope.claims,groups:i.envelope.groups,evidence:i.evidence.map((r,index)=>({index,text:r.quote,start:r.start,end:r.end})),language:i.source.language,market:i.source.market}));
 if(signal?.aborted)return fail('CANCELLED');
 const controller=new AbortController();let timer,onAbort;
 try{
 const output=await Promise.race([
  Promise.resolve().then(()=>assessor.assess(payload,{signal:controller.signal})).then(value=>({kind:'result',value}),error=>({kind:error?.message==='TIMEOUT'?'timeout':error?.message==='CANCELLED'?'cancel':'error',invalidDecisions:error?.code==='INVALID_DECISIONS',diagnostic:readDiagnostic(error)})),
  new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({kind:'timeout'});},timeoutMs);}),
  new Promise(resolve=>{onAbort=()=>{controller.abort();resolve({kind:'cancel'});};signal?.addEventListener('abort',onAbort,{once:true});})
 ]);
 if(output.kind!=='result')return fail(output.invalidDecisions?'INVALID_DECISIONS':{error:'ASSESSOR_FAILED',timeout:'TIMEOUT',cancel:'CANCELLED'}[output.kind],output.diagnostic||safeDiagnostic(output.kind==='error'?'API_REJECTION':'TIMEOUT'));
 let result;try{result=copy(output.value);}catch{return fail('INVALID_OUTPUT',safeDiagnostic('OUTPUT_VALIDATION'));}
 if(!shape(result,['binding','claims','graph'])||proposalFingerprint(result.binding,[])!==proposalFingerprint(binding,[]))return fail('STALE_OR_INVALID_BINDING',safeDiagnostic('OUTPUT_VALIDATION'));
 const decisions=['support','reject','abstain','ambiguous','conflict'],reasonCodes=['evidence-support','contradicted','insufficient-evidence','multiple-readings','inconsistent-claims','out-of-scope'];
 function validDecision(d,claim){if(!shape(d,claim?['claimId','decision','reasons','evidenceIndexes']:['decision','reasons','evidenceIndexes','claimIds']))return false;return decisions.includes(d.decision)&&Array.isArray(d.reasons)&&d.reasons.length>0&&d.reasons.length<=10&&d.reasons.every(r=>reasonCodes.includes(r))&&Array.isArray(d.evidenceIndexes)&&d.evidenceIndexes.length<=100&&d.evidenceIndexes.every(n=>Number.isSafeInteger(n)&&n>=0&&n<i.evidence.length)&&(d.decision!=='support'||d.evidenceIndexes.length>0);}
 if(!Array.isArray(result.claims)||result.claims.length!==i.envelope.claims.length||new Set(result.claims.map(d=>d?.claimId)).size!==result.claims.length)return fail('INVALID_DECISIONS',safeDiagnostic('OUTPUT_VALIDATION'));
 for(const d of result.claims){const original=i.envelope.claims.find(c=>c.id===d?.claimId);if(!original||!validDecision(d,true)||d.evidenceIndexes.some(n=>!original.evidenceIndexes.includes(n)))return fail('INVALID_DECISIONS',safeDiagnostic('OUTPUT_VALIDATION'));}
 if(result.graph!==null&&(!validDecision(result.graph,false)||!Array.isArray(result.graph.claimIds)||!result.graph.claimIds.length||result.graph.claimIds.length>100||result.graph.claimIds.some(id=>!i.envelope.claims.some(c=>c.id===id))))return fail('INVALID_DECISIONS',safeDiagnostic('OUTPUT_VALIDATION'));
 return {status:'assessed',assessment:result,worldVerification:'UNVERIFIED',actionAuthority:'NONE'};
 }catch{return fail('ASSESSOR_FAILED');}finally{clearTimeout(timer);if(onAbort)signal?.removeEventListener('abort',onAbort);}
}
module.exports={runSemanticAssessor};
