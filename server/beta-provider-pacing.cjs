'use strict';
// One bounded wait for the existing transport's local spacing. The transport
// rechecks all limits; long Retry-After and concurrent in-flight denials stay closed.
function withShortProviderWait(read,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 return async request=>{const first=await read(request);if(first.code!=='RATE_LIMITED'||!Number.isFinite(first.retryAfterMs)||first.retryAfterMs<=0||first.retryAfterMs>2000)return first;await sleep(Math.ceil(first.retryAfterMs)+1);return read(request);};
}
module.exports={withShortProviderWait};
