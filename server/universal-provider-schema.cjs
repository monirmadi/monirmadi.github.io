'use strict';
// Provider-neutral wire schema. Runtime gates remain authoritative.
const object = properties => ({type:'object', properties, required:Object.keys(properties), additionalProperties:false});
const string = {type:'string'};
const list = items => ({type:'array', items, maxItems:100});
const choice = values => ({type:'string', enum:values});
const evidence = object({source:choice(['user-text']), reference:string, confidence:{type:'null'}});
const field = {anyOf:[
  object({state:choice(['unknown'])}),
  object({state:choice(['known']),value:string,confirmed:{type:'boolean',enum:[false]},evidence:list(evidence)}),
  object({state:choice(['ambiguous']),candidates:list(object({value:string,evidence:list(evidence)}))})
]};
const intent = object({
 state:choice(['unknown','partial','interpreted']),
 entities:list(object({id:string,kind:field,description:field})),
 actions:list(object({id:string,verb:field,entityIds:list(string)})),
 roles:list(object({id:string,participantId:string,actionId:string,role:field})),
 domains:list(object({id:string,context:field,entityIds:list(string)})),
 constraints:list(object({id:string,subjectId:string,dimension:string,operator:choice(['equals','excludes','at-most','at-least','within','prefers']),value:field,unit:field})),
 strategies:list(object({id:string,kind:field,actionIds:list(string)})),
 alternatives:list(object({id:string,actionIds:list(string),constraintIds:list(string)}))
});
function outputSchema(fingerprint) {
 return object({sourceFingerprint:{type:'string',enum:[fingerprint]},intent,
  textReferences:list(object({reference:string,target:string,start:{type:'integer'},end:{type:'integer'},quote:string})),
  clarifications:list(object({target:string,reason:choice(['missing','ambiguous','conflicting'])}))});
}
// Validate the finite wire schema locally too; never rely on provider schema enforcement.
function matches(value, schema, depth=0) {
 if(depth>30)return false;
 if(schema.anyOf)return schema.anyOf.some(s=>matches(value,s,depth+1));
 if(schema.enum&&!schema.enum.includes(value))return false;
 if(schema.type==='null')return value===null;
 if(schema.type==='string')return typeof value==='string'&&value.length<=4000;
 if(schema.type==='boolean')return typeof value==='boolean';
 if(schema.type==='integer')return Number.isSafeInteger(value);
 if(schema.type==='array')return Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=schema.maxItems&&value.every(v=>matches(v,schema.items,depth+1));
 if(schema.type==='object')return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===schema.required.length&&schema.required.every(k=>Object.hasOwn(value,k)&&matches(value[k],schema.properties[k],depth+1));
 return false;
}
module.exports={outputSchema,matches};
