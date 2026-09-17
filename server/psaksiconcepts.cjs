'use strict';
// Reuse the existing controlled vocabulary; knowledge never grants execution rights.
const policy = require('./search-strategy-policy.cjs');
const BOUNDARY = Object.freeze({worldVerification:'UNVERIFIED',actionAuthority:'NONE'});
function concept(value, category) {
 const key=policy.token(value);
 const values={strategy:policy.STRATEGIES,domain:policy.DOMAINS,action:Object.keys(policy.ACTIONS),entity:Object.keys(policy.KINDS)}[category];
 return {...BOUNDARY,status:values?.includes(key)?'known':'unknown',category,value:values?.includes(key)?key:null,policyVersion:policy.VERSION};
}
function sourceKnowledge(value, provenance) {
 if(!provenance || typeof provenance.url!=='string' || !Number.isFinite(Date.parse(provenance.retrievedAt)) || !/^[a-f0-9]{64}$/.test(provenance.responseSha256||'')) throw Error('INVALID_PROVENANCE');
 return {...BOUNDARY,epistemicStatus:'SOURCE_DERIVED',value:structuredClone(value),provenance:structuredClone(provenance)};
}
module.exports={concept,sourceKnowledge,BOUNDARY};
