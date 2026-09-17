'use strict';
const {searchBvg}=require('./providers/bvg-transport-provider.cjs');
const {BOUNDARY}=require('./psaksiconcepts.cjs');
// Trusted server entry, never an HTTP endpoint. An explicit scoped read bypasses no
// semantic gate: it does not execute a candidate route or send the original Need.
async function controlledRealSearch(request,authorization,options){
 if(!request||typeof request!=='object'||Array.isArray(request))return {...BOUNDARY,status:'blocked',code:'INVALID_REQUEST'};
 if(authorization?.mode!=='EXPLICIT_READ_ONLY'||authorization.providerId!==request?.providerId||authorization.operation!==request?.operation||authorization.disclosureApproved!==true)return {...BOUNDARY,status:'blocked',code:'EXPLICIT_SCOPED_READ_REQUIRED'};
 if(request.providerId==='bvg-transport-v6')return searchBvg(request,options);
 const {requestFingerprint}=require('./public-provider-http.cjs');
 if(authorization.queryClass!=='PUBLIC_NON_PERSONAL'||authorization.requestFingerprint!==requestFingerprint(request))return {...BOUNDARY,status:'blocked',code:'PUBLIC_QUERY_APPROVAL_REQUIRED'};
 const handlers={'photon-places':require('./providers/photon-places-provider.cjs').searchPhoton,'govdata-catalog':require('./providers/govdata-catalog-provider.cjs').searchGovData};
 if(!Object.hasOwn(handlers,request.providerId))return {...BOUNDARY,status:'blocked',code:'UNSUPPORTED_PROVIDER'};
 if(!options?.onTiming)return handlers[request.providerId](request,options);
 const start=performance.now();let readMs=0;
 const transport=options.transport??require('./public-provider-http.cjs').readPublic;
 try{return await handlers[request.providerId](request,{...options,transport:async r=>{const t=performance.now();try{return await transport(r);}finally{readMs+=performance.now()-t;}}});}
 finally{options.onTiming('provider-read',Math.round(readMs*100)/100);options.onTiming('normalization',Math.round(Math.max(0,performance.now()-start-readMs)*100)/100);}
}
module.exports={controlledRealSearch};
