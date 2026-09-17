'use strict';
const {createHash}=require('node:crypto');
const {copyPlain}=require('../server/matching-foundation.cjs');
const {absolute}=require('./internal-record.cjs');
// Runtime specialization of SearchRequest (domain.d.ts), using its ownerId,
// needId, version, status, timestamps, private audience and matchHistory fields.
// No raw Need/contact/location data is stored here; accepted profiles stay with
// the trusted caller. As in policies.cjs, actor/consent inputs are server-owned.
const PERMISSIONS=Object.freeze(['STORE_REQUEST','REEVALUATE_REQUEST','INTERNAL_MATCHING','EXTERNAL_RESEARCH','FUTURE_NOTIFICATION']);
const opaque=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
function fingerprint(input){
 const clean=copyPlain(input);
 const canonical=v=>v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
 return createHash('sha256').update(JSON.stringify(canonical(clean))).digest('hex');
}
function validateSavedSearchRequest(input){
 const fail=()=>({valid:false,code:'INVALID_SAVED_REQUEST'});let r;
 try{r=copyPlain(input);}catch{return fail();}
 if(!shape(r,['schemaVersion','id','version','ownerId','needId','internalRecordId','kind','status','createdAt','updatedAt','expiresAt','audience','permissions','provenance','matchHistory','lastCheckedAt','worldVerification','actionAuthority']))return fail();
 if(r.schemaVersion!==1||![r.id,r.ownerId,r.needId,r.internalRecordId].every(opaque)||!Number.isSafeInteger(r.version)||r.version<1||!['STANDARD','LIVE_INTENT'].includes(r.kind)||!['ACTIVE','PAUSED','EXPIRED','DELETED'].includes(r.status)||r.audience!=='private'||r.worldVerification!=='UNVERIFIED'||r.actionAuthority!=='NONE')return fail();
 const created=absolute(r.createdAt),updated=absolute(r.updatedAt),expires=absolute(r.expiresAt);
 if(!Number.isFinite(created)||!Number.isFinite(updated)||updated<created||!Number.isFinite(expires)||expires<=created||r.lastCheckedAt!==null&&(!Number.isFinite(absolute(r.lastCheckedAt))||absolute(r.lastCheckedAt)<created||absolute(r.lastCheckedAt)>updated))return fail();
 if(r.kind==='LIVE_INTENT'&&expires-created>86400000)return fail();
 if(!shape(r.permissions,PERMISSIONS)||PERMISSIONS.some(k=>!shape(r.permissions[k],['allowed','reference'])||typeof r.permissions[k].allowed!=='boolean'||r.permissions[k].reference!==null&&!opaque(r.permissions[k].reference)||r.permissions[k].allowed&&!opaque(r.permissions[k].reference)))return fail();
 if(!shape(r.provenance,['sourceType','sourceFingerprint','proposalFingerprint','confirmationBinding','recordFingerprint','externalNeedFingerprint','persistenceReference'])||r.provenance.sourceType!=='PSAKSI_INTERNAL_USER_RECORD'||!['sourceFingerprint','proposalFingerprint','confirmationBinding','recordFingerprint'].every(k=>digest(r.provenance[k]))||r.provenance.externalNeedFingerprint!==null&&!digest(r.provenance.externalNeedFingerprint)||!opaque(r.provenance.persistenceReference))return fail();
 if(!Array.isArray(r.matchHistory)||r.matchHistory.length>500||new Set(r.matchHistory.map(h=>h?.identity)).size!==r.matchHistory.length||r.matchHistory.some(h=>!shape(h,['identity','content','sourceType','firstSeenAt','lastSeenAt'])||!digest(h.identity)||!digest(h.content)||!['INTERNAL','EXTERNAL'].includes(h.sourceType)||!Number.isFinite(absolute(h.firstSeenAt))||absolute(h.firstSeenAt)<created||absolute(h.lastSeenAt)<absolute(h.firstSeenAt)||!Number.isFinite(absolute(h.lastSeenAt))||absolute(h.lastSeenAt)>updated))return fail();
 return {valid:true,record:r};
}
module.exports={PERMISSIONS,opaque,digest,fingerprint,validateSavedSearchRequest};
