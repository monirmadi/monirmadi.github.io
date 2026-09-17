'use strict';
const {randomUUID}=require('node:crypto');
const {validateResolutionNeed,BOUNDARY}=require('../contracts/need-resolution.cjs');
const {fingerprint}=require('../contracts/saved-search-request.cjs');
const {copyPlain}=require('./matching-foundation.cjs');
function constraintChanges(before,after){
 const changes=[],unused=new Set(before.constraints);
 const sameScope=(p,q)=>p.dimension===q.dimension&&fingerprint([...p.componentIds].sort())===fingerprint([...q.componentIds].sort());
 for(const q of after.constraints){
  const p=[...unused].find(p=>p.id===q.id&&sameScope(p,q))??[...unused].find(p=>sameScope(p,q)&&p.operator===q.operator)??[...unused].find(p=>sameScope(p,q));
  if(!p)changes.push({type:'ADDED_CONSTRAINT',constraintId:q.id});
  else if(fingerprint([p.dimension,p.operator,p.value,p.unit,p.strength,p.componentIds])!==fingerprint([q.dimension,q.operator,q.value,q.unit,q.strength,q.componentIds]))changes.push({type:'CHANGED_CONSTRAINT',constraintId:q.id});
  else if(!p.confirmed&&q.confirmed)changes.push({type:'CONFIRMED_CONSTRAINT',constraintId:q.id});
  unused.delete(p);
 }
 for(const p of unused)changes.push({type:'REMOVED_CONSTRAINT',constraintId:p.id});return changes;
}
function createResolutionMemory({clock=Date.now,ttlMs=600000,maxSessions=32}={}){
 if(!Number.isFinite(ttlMs)||ttlMs<1||ttlMs>600000||!Number.isInteger(maxSessions)||maxSessions<1||maxSessions>100)throw Error('INVALID_MEMORY_LIMITS');
 const sessions=new Map(),pending=new Map();
 const expire=()=>{if(!Number.isFinite(clock()))throw Error('INVALID_CLOCK');for(const [id,s]of sessions)if(s.until<=clock()||clock()<s.createdAt){sessions.delete(id);for(const [pid,p]of pending)if(p.sessionId===id)pending.delete(pid);}};
 const get=id=>{expire();const s=sessions.get(id);if(!s)throw Error('SESSION_EXPIRED');return s;};
 return {
  remember(sessionId,need){const v=validateResolutionNeed(need);if(typeof sessionId!=='string'||!sessionId||sessionId.length>128||!v.valid)throw Error('INVALID_SESSION_NEED');expire();if(sessions.has(sessionId))throw Error('USE_BOUND_EDIT_FOR_EXISTING_NEED');if(sessions.size>=maxSessions){const oldest=sessions.keys().next().value;sessions.delete(oldest);for(const [id,p]of pending)if(p.sessionId===oldest)pending.delete(id);}sessions.set(sessionId,{need:v.need,createdAt:clock(),until:clock()+ttlMs,events:[]});return {binding:v.binding,...BOUNDARY};},
  read(sessionId){return structuredClone(get(sessionId));},
  propose(sessionId,edits,reason){const s=get(sessionId);if(s.need.provenance.length>=64)throw Error('EVIDENCE_HISTORY_LIMIT');if(!Array.isArray(edits)||!edits.length||edits.length>16||typeof reason!=='string'||!reason.trim()||reason.length>500)throw Error('INVALID_EDIT');const next=structuredClone(s.need),ids=new Set();
   for(const raw of edits){const e=copyPlain(raw);if(ids.has(e.constraintId)||!['ADD','REPLACE','REMOVE','CONFIRM'].includes(e.operation))throw Error('INVALID_EDIT');ids.add(e.constraintId);const q=next.constraints.find(q=>q.id===e.constraintId);if(e.operation==='ADD'){if(q||e.constraint?.id!==e.constraintId)throw Error('INVALID_ADD');next.constraints.push(e.constraint);}else {if(!q)throw Error('UNKNOWN_CONSTRAINT');if(e.operation==='REMOVE')next.constraints=next.constraints.filter(q=>q.id!==e.constraintId);if(e.operation==='REPLACE'){if(e.constraint?.id!==e.constraintId)throw Error('INVALID_REPLACEMENT');next.constraints=next.constraints.map(q=>q.id===e.constraintId?e.constraint:q);}if(e.operation==='CONFIRM')q.confirmed=true;}}
   next.revision++;const v=validateResolutionNeed(next);if(!v.valid)throw Error(v.code);const id=randomUUID(),binding=fingerprint({prior:s.need,next,reason});const preview={id,binding,changes:edits.map(e=>({operation:e.operation,constraintId:e.constraintId,before:s.need.constraints.find(q=>q.id===e.constraintId)??null,after:next.constraints.find(q=>q.id===e.constraintId)??null})),reason,status:'PROPOSED_RELAXATION',executionAllowed:false,...BOUNDARY};
   for(const [key,p]of pending)if(p.sessionId===sessionId)pending.delete(key);
   pending.set(id,{sessionId,prior:fingerprint(s.need),next,preview:fingerprint(preview),binding});s.events.push({type:'PROPOSED_RELAXATION',proposalId:id});s.events=s.events.slice(-32);return preview;
  },
  approve(sessionId,preview,decision){const s=get(sessionId),p=pending.get(preview?.id);if(!p||p.sessionId!==sessionId||p.prior!==fingerprint(s.need)||p.preview!==fingerprint(preview)||decision?.approved!==true||decision.binding!==p.binding)return {...BOUNDARY,status:'BLOCKED',code:'EXACT_CURRENT_APPROVAL_REQUIRED',executionAllowed:false};const changes=constraintChanges(s.need,p.next);s.need=p.next;const evidenceIndex=s.need.provenance.length;s.need.provenance.push({source:'USER_APPROVAL',reference:preview.id,binding:p.binding,classification:'USER_PROVIDED'});for(const change of changes){const q=s.need.constraints.find(q=>q.id===change.constraintId);if(q)q.evidenceIndexes=[evidenceIndex];}s.events.push(...changes,{type:'USER_APPROVED_RELAXATION',proposalId:preview.id});s.events=s.events.slice(-32);pending.delete(preview.id);return {...BOUNDARY,status:'APPROVED_DRAFT',need:structuredClone(s.need),changes,requiresReassessment:true,executionAllowed:false};},
  forget(sessionId){sessions.delete(sessionId);for(const [id,p]of pending)if(p.sessionId===sessionId)pending.delete(id);}
 };
}
module.exports={createResolutionMemory,constraintChanges};
