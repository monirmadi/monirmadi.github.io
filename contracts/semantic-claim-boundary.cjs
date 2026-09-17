'use strict';
const {createHash}=require('node:crypto');
const {verifyTextEvidence}=require('./text-evidence-boundary.cjs');
const {sourceFingerprint}=require('./interpretation-boundary.cjs');
function copy(input){let nodes=0,chars=0;const seen=new Set();function walk(v,d){if(++nodes>20000||d>30)throw Error();if(v===null||typeof v==='boolean')return v;if(typeof v==='string'){if((chars+=v.length)>200000)throw Error();return v;}if(typeof v==='number'&&Number.isFinite(v))return v;if(typeof v!=='object'||seen.has(v)||(!Array.isArray(v)&&![null,Object.prototype].includes(Object.getPrototypeOf(v))))throw Error();seen.add(v);const o=Array.isArray(v)?[]:{};for(const k of Reflect.ownKeys(v)){if(Array.isArray(v)&&k==='length')continue;const a=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!a.enumerable||!Object.hasOwn(a,'value')||(Array.isArray(v)&&!/^(0|[1-9][0-9]*)$/.test(k)))throw Error();chars+=k.length;if(chars>200000)throw Error();o[k]=walk(a.value,d+1);}if(Array.isArray(v)&&Object.keys(o).length!==v.length)throw Error();seen.delete(v);return o;}return walk(input,0);}
const canonical=v=>JSON.stringify(v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])));
function proposalFingerprint(proposal,evidence){return createHash('sha256').update(canonical(copy({proposal,evidence}))).digest('hex');}
const shape=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const string=v=>typeof v==='string'&&v.trim().length>0&&v.length<=1000;
function validateSemanticClaims(source,proposal,interpretationProvider,evidence,envelope,expectedAssessor){
 const reject=code=>({status:'rejected',code,semanticSupport:'UNASSESSED',worldTruth:'UNVERIFIED'});
 let s,p,ip,refs,e,a;try{[s,p,ip,refs,e,a]=copy([source,proposal,interpretationProvider,evidence,envelope,expectedAssessor]);}catch{return reject('MALFORMED_OR_LIMIT_EXCEEDED');}
 if(verifyTextEvidence(s,p,ip,refs).status!=='verified')return reject('TEXT_EVIDENCE_REJECTED');
 if(!shape(e,['version','sourceFingerprint','proposalFingerprint','assessor','claims','groups'])||e.version!==1)return reject('INVALID_ENVELOPE');
 if(!shape(a,['id','version'])||!string(a.id)||!string(a.version)||!shape(e.assessor,['id','version'])||canonical(e.assessor)!==canonical(a))return reject('ASSESSOR_MISMATCH');
 if(e.sourceFingerprint!==sourceFingerprint(s)||e.proposalFingerprint!==proposalFingerprint(p,refs))return reject('STALE_CONTEXT');
 if(!Array.isArray(e.claims)||e.claims.length>100||!Array.isArray(e.groups)||e.groups.length>100)return reject('INVALID_COLLECTION');
 const intent=p.need.interpretation.intent,entities=new Set(intent.entities.map(v=>v.id)),actions=new Set(intent.actions.map(v=>v.id)),ids=new Set(),targets=new Set();
 function fields(v,path){if(!v||typeof v!=='object')return;if(v.state==='known'||v.state==='unknown'){targets.add(path);return;}if(v.state==='ambiguous'){targets.add(path);v.candidates.forEach((c,i)=>targets.add(path+'/candidates/'+i));return;}for(const k of Object.keys(v))fields(v[k],path+'/'+k);}
 fields(intent,'/interpretation/intent');
 const values=v=>v===null||string(v);
 const references=(v,set)=>Array.isArray(v)&&v.length<=100&&v.every(x=>set.has(x))&&new Set(v).size===v.length;
 for(const c of e.claims){
 if(!shape(c,['id','target','subjects','actions','predicate','value','roles','evidenceIndexes','polarity','negationScope','modality','attribution','epistemicBasis','certainty','meaningState','time','location']))return reject('INVALID_CLAIM');
 if(!string(c.id)||ids.has(c.id))return reject('INVALID_CLAIM_ID');ids.add(c.id);
 if(!targets.has(c.target)||!references(c.subjects,entities)||!references(c.actions,actions))return reject('INVALID_BINDING');
 if(!values(c.predicate)||!values(c.value)||!Array.isArray(c.roles)||c.roles.length>100||!c.roles.every(r=>shape(r,['entityId','actionId','role'])&&entities.has(r.entityId)&&actions.has(r.actionId)&&string(r.role)))return reject('INVALID_ROLE_OR_VALUE');
 if(!Array.isArray(c.evidenceIndexes)||c.evidenceIndexes.length>100||!c.evidenceIndexes.every(i=>Number.isSafeInteger(i)&&i>=0&&i<refs.length&&refs[i].target===c.target)||new Set(c.evidenceIndexes).size!==c.evidenceIndexes.length)return reject('INVALID_EVIDENCE_BINDING');
 if(!['positive','negative','unknown'].includes(c.polarity)||!['asserted','wanted','possible','hypothetical','conditional','unknown'].includes(c.modality)||!['user-assertion','claimed-firsthand','reported-speech','hearsay','speculation','unknown'].includes(c.epistemicBasis)||!['unknown','ambiguous','conflicting','proposed'].includes(c.meaningState)||(c.certainty!==null&&(!Number.isFinite(c.certainty)||c.certainty<0||c.certainty>1)))return reject('INVALID_SEMANTIC_ANNOTATION');
 if(!shape(c.attribution,['kind','reporterEntityId'])||!['user','reported-person','unknown'].includes(c.attribution.kind)||(c.attribution.reporterEntityId!==null&&!entities.has(c.attribution.reporterEntityId)))return reject('INVALID_ATTRIBUTION');
 if(!Array.isArray(c.time)||c.time.length>10||!c.time.every(t=>shape(t,['kind','expression','anchor'])&&['event','report','source','assessment','retrieval'].includes(t.kind)&&values(t.expression)&&(t.anchor===null||t.anchor===e.sourceFingerprint)))return reject('INVALID_TIME');
 if(!Array.isArray(c.location)||c.location.length>10||!c.location.every(l=>shape(l,['kind','expression','entityId'])&&['mentioned','destination','event-area','exclusion','unresolved'].includes(l.kind)&&values(l.expression)&&(l.entityId===null||entities.has(l.entityId))))return reject('INVALID_LOCATION');
 }
 for(const c of e.claims)if(!references(c.negationScope,ids))return reject('INVALID_NEGATION_SCOPE');
 const groupIds=new Set();for(const g of e.groups){if(!shape(g,['id','kind','claimIds'])||!string(g.id)||ids.has(g.id)||groupIds.has(g.id)||!['AND','OR','exclusion','alternative','dependency','conflict'].includes(g.kind)||!references(g.claimIds,ids)||g.claimIds.length<2)return reject('INVALID_LOGIC');groupIds.add(g.id);}
 return {status:'valid-envelope',semanticSupport:'UNASSESSED',worldTruth:'UNVERIFIED',envelope:e};
}
module.exports={proposalFingerprint,validateSemanticClaims};
