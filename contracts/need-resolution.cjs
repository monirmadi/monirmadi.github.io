'use strict';
const {copyPlain}=require('../server/matching-foundation.cjs');
const {fingerprint}=require('./saved-search-request.cjs');
const {BOUNDARY}=require('../server/psaksiconcepts.cjs');
const KINDS=['USER_PROVIDED','SOURCE_DERIVED','INTERNAL_OPT_IN','MODEL_INFERRED','UNVERIFIED'];
const STRENGTHS=['HARD','SOFT','UNKNOWN'];
const ROLE_PAIRS=Object.freeze([
 ['NEEDS_EXPERIENCE','HAS_EXPERIENCE'],['NEEDS_HELP','CAN_HELP'],['NEEDS_ITEM','HAS_ITEM'],
 ['NEEDS_SERVICE','OFFERS_SERVICE'],['GUEST','HOST'],['BORROWER','LENDER'],['RECEIVER','GIVER'],
 ['BUYER','SELLER'],['LOST_ITEM','FOUND_ITEM'],['PARTICIPANT','PARTICIPANT'],['INFORMATION_SEEKER','INFORMATION_SOURCE']
].map(Object.freeze));
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(x);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=2000;
const token=x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(x);
const shape=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k));
const refs=(xs,source)=>Array.isArray(xs)&&xs.length>0&&xs.length<=64&&xs.every(i=>Number.isInteger(i)&&i>=0&&i<source.length);
function validateResolutionNeed(input){
 const fail=code=>({valid:false,code});let n;
 try{n=copyPlain(input);}catch{return fail('INVALID_OR_OVERSIZED_NEED');}
 if(!shape(n,['schemaVersion','id','originalText','desiredOutcome','entities','requesterRole','components','constraints','provenance','assumptions','missingInformation','privacySensitivity','safetySensitivity','freshnessMaxAgeMs','evidenceRequirements','persistentRequested','revision','worldVerification','actionAuthority']))return fail('INVALID_NEED_SHAPE');
 if(n.schemaVersion!==1||!id(n.id)||!text(n.originalText)||!text(n.desiredOutcome)||n.actionAuthority!=='NONE'||n.worldVerification!=='UNVERIFIED'||!Number.isInteger(n.revision)||n.revision<1)return fail('INVALID_NEED_IDENTITY');
 if(!Array.isArray(n.provenance)||!n.provenance.length||n.provenance.length>64||n.provenance.some(p=>p?.source==='USER_APPROVAL'?!(shape(p,['source','reference','binding','classification'])&&id(p.reference)&&/^[a-f0-9]{64}$/.test(p.binding)&&p.classification==='USER_PROVIDED'):!shape(p,['start','end','quote','classification'])||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end<=p.start||n.originalText.slice(p.start,p.end)!==p.quote||!['USER_PROVIDED','MODEL_INFERRED'].includes(p.classification)))return fail('UNGROUNDED_NEED');
 if(!Array.isArray(n.components)||!n.components.length||n.components.length>8||!Array.isArray(n.constraints)||n.constraints.length>32)return fail('NEED_SIZE_LIMIT');
 if(!n.components.some(c=>c?.optional===false))return fail('REQUIRED_COMPONENT_MISSING');
 const ids=new Set(n.components.map(c=>c?.id));if(ids.size!==n.components.length)return fail('DUPLICATE_COMPONENT');
 if(!Array.isArray(n.entities)||n.entities.length>16||n.entities.some(e=>!shape(e,['id','kind','description','evidenceIndexes'])||!id(e.id)||!token(e.kind)||!text(e.description)||!refs(e.evidenceIndexes,n.provenance)))return fail('INVALID_ENTITIES');
 if(n.requesterRole!==null&&!token(n.requesterRole))return fail('INVALID_REQUESTER_ROLE');
 for(const c of n.components){
  if(!shape(c,['id','capability','target','requesterRole','counterpartRoles','quantity','optional','dependsOn','strategies','evidenceIndexes'])||!id(c.id)||!token(c.capability)||!text(c.target)||c.requesterRole!==null&&!token(c.requesterRole)||!Array.isArray(c.counterpartRoles)||c.counterpartRoles.length>8||!c.counterpartRoles.every(token)||!Number.isInteger(c.quantity)||c.quantity<1||c.quantity>20||typeof c.optional!=='boolean'||!Array.isArray(c.dependsOn)||c.dependsOn.length>8||c.dependsOn.some(d=>!ids.has(d)||d===c.id)||!Array.isArray(c.strategies)||c.strategies.length>8||!c.strategies.every(token)||!refs(c.evidenceIndexes,n.provenance))return fail('INVALID_COMPONENT');
 }
 // Dependencies are prerequisite edges. Cyclic barter proposals need a separate
 // simultaneous exchange contract; they cannot masquerade as satisfied prerequisites.
 const visiting=new Set(),done=new Set();function visit(key){if(visiting.has(key))return false;if(done.has(key))return true;visiting.add(key);for(const dep of n.components.find(c=>c.id===key).dependsOn)if(!visit(dep))return false;visiting.delete(key);done.add(key);return true;}
 if(!n.components.every(c=>visit(c.id)))return fail('CYCLIC_DEPENDENCY');
 const qids=new Set();
 for(const q of n.constraints){
  if(!shape(q,['id','dimension','operator','value','unit','strength','componentIds','evidenceIndexes','confirmed'])||!id(q.id)||qids.has(q.id)||!token(q.dimension)||!['equals','excludes','at-most','at-least','prefers','window'].includes(q.operator)||!STRENGTHS.includes(q.strength)||!Array.isArray(q.componentIds)||!q.componentIds.length||q.componentIds.some(i=>!ids.has(i))||!refs(q.evidenceIndexes,n.provenance)||q.unit!==null&&typeof q.unit!=='string'||typeof q.confirmed!=='boolean'||q.value===undefined||q.value===null)return fail('INVALID_CONSTRAINT');
  if(!['string','number','boolean'].includes(typeof q.value)&&!(q.operator==='window'&&shape(q.value,['start','end'])&&validWindow(q.value)))return fail('INVALID_CONSTRAINT_VALUE');qids.add(q.id);
 }
 if(!['PUBLIC','PRIVATE','SENSITIVE','UNKNOWN'].includes(n.privacySensitivity)||!['UNASSESSED','SENSITIVE'].includes(n.safetySensitivity)||!Array.isArray(n.assumptions)||n.assumptions.length>32||!n.assumptions.every(text)||!Array.isArray(n.missingInformation)||n.missingInformation.length>32||!n.missingInformation.every(token)||!Array.isArray(n.evidenceRequirements)||!n.evidenceRequirements.every(token)||typeof n.persistentRequested!=='boolean'||n.freshnessMaxAgeMs!==null&&(!Number.isFinite(n.freshnessMaxAgeMs)||n.freshnessMaxAgeMs<0))return fail('INVALID_NEED_REQUIREMENTS');
 return {valid:true,need:n,binding:fingerprint(n)};
}
function validWindow(v){return v&&typeof v.start==='string'&&typeof v.end==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v.start)&&/(Z|[+-]\d\d:\d\d)$/.test(v.end)&&Number.isFinite(Date.parse(v.start))&&Date.parse(v.end)>Date.parse(v.start);}
function validateOffer(input){
 const fail=code=>({valid:false,code});let o;try{o=copyPlain(input);}catch{return fail('INVALID_OFFER');}
 if(!shape(o,['id','resourceKey','sourceType','provenance','capabilities','roles','capacity','attributes','availability','permissions','privacy','worldVerification','actionAuthority'])||!id(o.id)||!id(o.resourceKey)||!KINDS.includes(o.sourceType)||o.actionAuthority!=='NONE'||o.worldVerification!=='UNVERIFIED'||!Array.isArray(o.provenance)||!o.provenance.length||o.provenance.length>32)return fail('INVALID_OFFER');
 if(o.provenance.some(p=>!shape(p,['providerId','url','retrievedAt','sourceUpdatedAt','responseSha256','attribution','license','reference','updatedAt','expiresAt'])))return fail('INVALID_OFFER_PROVENANCE');
 const fact=f=>shape(f,['value','evidenceIndexes','unit'])&&f.value!==undefined&&(f.value===null?Array.isArray(f.evidenceIndexes)&&f.evidenceIndexes.length===0:refs(f.evidenceIndexes,o.provenance))&&(f.unit===undefined||typeof f.unit==='string');
 if(!Array.isArray(o.capabilities)||!o.capabilities.length||o.capabilities.length>8||!o.capabilities.every(f=>fact(f)&&token(f.value))||!Array.isArray(o.roles)||!o.roles.every(f=>fact(f)&&token(f.value))||!shape(o.capacity,o.capabilities.map(c=>c.value))||Object.values(o.capacity).some(f=>!fact(f)||!Number.isInteger(f.value)||f.value<0||f.value>20)||!shape(o.attributes,Object.keys(o.attributes??{}))||Object.keys(o.attributes).length>32||Object.entries(o.attributes).some(([k,v])=>!token(k)||!fact(v))||!fact(o.availability)||o.availability.value!==null&&typeof o.availability.value!=='boolean')return fail('INVALID_OFFER_FACTS');
 if(!shape(o.permissions,['matching','discoverability','consentReference'])||typeof o.permissions.matching!=='boolean'||typeof o.permissions.discoverability!=='boolean'||o.permissions.consentReference!==null&&!id(o.permissions.consentReference)||!['PUBLIC_NON_PERSONAL','MATCHING_ONLY','PRIVATE'].includes(o.privacy))return fail('INVALID_OFFER_PRIVACY');
 return {valid:true,offer:o};
}
module.exports={validateResolutionNeed,validateOffer,validWindow,ROLE_PAIRS,KINDS,STRENGTHS,BOUNDARY};
