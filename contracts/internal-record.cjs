'use strict';
const {copyPlain,usable}=require('../server/matching-foundation.cjs');
const SOURCE_TYPE='PSAKSI_INTERNAL_USER_RECORD';
const ROLE_PAIRS=Object.freeze([
 ['NEED','OFFER'],['LOST','FOUND'],['BORROW','LEND'],['BUYER','SELLER'],
 ['HELP_NEEDED','HELPER'],['EXPERIENCE_NEEDED','EXPERIENCED_PERSON'],
 ['HOUSING_SEEKER','HOUSING_OFFER'],['LIVE_INTENT','LIVE_INTENT']
].map(Object.freeze));
const token=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(v);
const reference=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(v);
const absolute=v=>{
 if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v))return NaN;
 const time=Date.parse(v);
 if(!Number.isFinite(time))return NaN;
 const canonical=v.includes('.')?v.replace(/\.(\d+)Z$/,(_,ms)=>`.${ms.padEnd(3,'0')}Z`):v.replace('Z','.000Z');
 return new Date(time).toISOString()===canonical?time:NaN;
};
const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const scalar=v=>typeof v==='string'&&v.length<=128||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v);
// A projection for matching, not a replacement for the private universal Need.
// References are opaque identifiers resolved by the trusted caller, never contact details.
function validateInternalRecord(input){
 let r;try{r=copyPlain(input);}catch{return {valid:false,errors:['INVALID_OR_OVERSIZED_INPUT']};}
 const errors=[];const check=(ok,code)=>{if(!ok)errors.push(code);};
 if(!shape(r,['schemaVersion','id','needReference','sourceType','intent','entities','role','attributes','constraints','location','time','availability','lifecycle','permissions','privacy','trustRequirement','provenance','uncertainty','moderation','persistentSearch','createdAt','updatedAt','expiresAt','worldVerification','actionAuthority']))return {valid:false,errors:['INVALID_RECORD_SHAPE']};
 check(r.schemaVersion===1&&reference(r.id)&&reference(r.needReference)&&r.sourceType===SOURCE_TYPE,'INVALID_RECORD_ID_OR_SOURCE');
 check(r.worldVerification==='UNVERIFIED'&&r.actionAuthority==='NONE','INVALID_BOUNDARY');
 check(Array.isArray(r.provenance)&&r.provenance.length>0&&r.provenance.length<=32&&r.provenance.every(p=>shape(p,['sourceType','reference'])&&p.sourceType===SOURCE_TYPE&&reference(p.reference)),'INVALID_PROVENANCE');
 function fact(f,predicate){
  if(shape(f,['state'])&&f.state==='unknown')return true;
  return shape(f,['state','value','epistemicStatus','evidenceIndexes','unit'])&&f.state==='known'&&f.epistemicStatus==='USER_STATED'&&Array.isArray(r.provenance)&&usable(f,r)&&predicate(f.value)&&(f.unit===undefined||token(f.unit));
 }
 check(fact(r.intent,token),'INVALID_INTENT');
 check(fact(r.role,v=>ROLE_PAIRS.flat().includes(v)),'INVALID_ROLE');
 check(Array.isArray(r.entities)&&r.entities.length>0&&r.entities.length<=16&&r.entities.every(f=>fact(f,token)),'INVALID_ENTITIES');
 check(shape(r.attributes,Object.keys(r.attributes||{}))&&Object.keys(r.attributes).length<=32&&Object.entries(r.attributes).every(([k,v])=>token(k)&&fact(v,x=>scalar(x)||Array.isArray(x)&&x.length<=32&&x.every(scalar))),'INVALID_ATTRIBUTES');
 check(Array.isArray(r.constraints)&&r.constraints.length<=32&&r.constraints.every(q=>shape(q,['dimension','operator','value','unit'])&&token(q.dimension)&&['equals','excludes','at-most','at-least'].includes(q.operator)&&fact(q.value,scalar)&&(q.unit===undefined||token(q.unit))),'INVALID_CONSTRAINTS');
 const geo=v=>shape(v,['country','region','city','district'])&&token(v.country)&&['region','city','district'].every(k=>v[k]===undefined||typeof v[k]==='string'&&v[k].trim().length>0&&v[k].length<=100)&&(!v.district||Boolean(v.city));
 check(r.location===null||fact(r.location,geo),'INVALID_LOCATION');
 const window=v=>shape(v,['start','end'])&&Number.isFinite(absolute(v.start))&&absolute(v.end)>absolute(v.start);
 check(r.time===null||fact(r.time,window),'INVALID_TIME_WINDOW');
 check(['AVAILABLE','UNAVAILABLE','UNKNOWN'].includes(r.availability),'INVALID_AVAILABILITY');
 check(['ACTIVE','PAUSED','CLOSED'].includes(r.lifecycle),'INVALID_LIFECYCLE');
 check(['PRIVATE','MATCHING_ONLY'].includes(r.privacy),'INVALID_PRIVACY');
 check(shape(r.permissions,['discoverability','matching','communication','consentReference'])&&['discoverability','matching','communication'].every(k=>r.permissions[k]===undefined||typeof r.permissions[k]==='boolean')&&(r.permissions.consentReference===undefined||reference(r.permissions.consentReference)),'INVALID_PERMISSIONS');
 check(['ATTRIBUTED','VERIFIED_IDENTITY','UNKNOWN'].includes(r.trustRequirement),'INVALID_TRUST_REQUIREMENT');
 check(Array.isArray(r.uncertainty)&&r.uncertainty.length<=32&&r.uncertainty.every(token),'INVALID_UNCERTAINTY');
 check(['NOT_ASSESSED','BLOCKED','PENDING'].includes(r.moderation),'INVALID_MODERATION_HOOK');
 check(shape(r.persistentSearch,['optIn','consentReference'])&&typeof r.persistentSearch.optIn==='boolean'&&(r.persistentSearch.consentReference===undefined||reference(r.persistentSearch.consentReference))&&(!r.persistentSearch.optIn||reference(r.persistentSearch.consentReference)),'INVALID_PERSISTENT_OPT_IN');
 const created=absolute(r.createdAt),updated=absolute(r.updatedAt),expiry=absolute(r.expiresAt);
 check(Number.isFinite(created)&&updated>=created&&(r.expiresAt===null||expiry>updated),'INVALID_RECORD_TIMESTAMPS');
 return errors.length?{valid:false,errors}:{valid:true,errors:[],record:r};
}
module.exports={SOURCE_TYPE,ROLE_PAIRS,absolute,validateInternalRecord};
