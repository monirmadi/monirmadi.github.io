"use strict";
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
for(const folder of ['server','contracts']){
 for(const entry of fs.readdirSync(folder,{recursive:true})){
  if(!entry.endsWith('.cjs'))continue;
  const result=spawnSync(process.execPath,['--check',path.join(folder,entry)],{stdio:'inherit'});
  if(result.status!==0)process.exit(1);
 }
}
require('../server/public-api.cjs');
console.log('PSAKSI API syntax and runtime imports verified. No dependency install required.');
