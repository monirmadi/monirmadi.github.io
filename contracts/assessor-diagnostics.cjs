'use strict';
// Only internally branded failures carry diagnostics. Never inspect arbitrary error properties.
const categories=new Set(['AUTHENTICATION','PERMISSION','MODEL_ACCESS','QUOTA_BILLING','RATE_LIMIT','TIMEOUT','NETWORK','OUTPUT_VALIDATION','API_REJECTION']);
const diagnostics=new WeakMap();
function safeDiagnostic(category,httpStatus=null){return {category:categories.has(category)?category:'API_REJECTION',httpStatus:Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599?httpStatus:null};}
function diagnosticError(message,category,httpStatus=null){const error=Error(message);diagnostics.set(error,safeDiagnostic(category,httpStatus));return error;}
function readDiagnostic(error){const d=diagnostics.get(error);return d?{...d}:null;}
module.exports={safeDiagnostic,diagnosticError,readDiagnostic};
