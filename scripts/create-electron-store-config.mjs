#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(process.cwd());
const identityName=process.env.MICROSOFT_STORE_IDENTITY_NAME?.trim();
const publisher=process.env.MICROSOFT_STORE_PUBLISHER?.trim();
const certificateFile=process.env.MICROSOFT_STORE_CERTIFICATE_PATH?.trim();
const certificatePassword=process.env.MICROSOFT_STORE_CERTIFICATE_PASSWORD;
if(!identityName || !publisher || !certificateFile || !certificatePassword){
  console.error('Microsoft Store package build requires identity/publisher values and a valid publisher PFX path/password from Partner Center.');
  process.exit(2);
}
if(!/^[A-Za-z0-9.-]{3,50}$/.test(identityName)) throw new Error('MICROSOFT_STORE_IDENTITY_NAME contains unsupported characters.');
if(!/^CN=.+/i.test(publisher)) throw new Error('MICROSOFT_STORE_PUBLISHER must be the publisher ID string from Partner Center, e.g. CN=... .');
await readFile(certificateFile).then(buffer => { if (buffer.length < 100) throw new Error('Microsoft Store certificate file appears empty or invalid.'); });
const base=JSON.parse(await readFile(resolve(root,'electron-builder.json'),'utf8'));
base.win={...(base.win||{}),target:[{target:'appx',arch:['x64']}]};
base.appx={
  ...(base.appx||{}),
  applicationId:'HendyStudioPro',
  identityName,
  publisher,
  publisherDisplayName:'Hendy Studio',
  certificateFile,
  certificatePassword,
  backgroundColor:'#080b12',
  languages:['en-US','vi-VN'],
  showNameOnTiles:true
};
const out=resolve(root,'electron-builder.store.generated.json');
await writeFile(out,JSON.stringify(base,null,2)+'\n','utf8');
console.log(`Generated temporary AppX builder configuration: ${out}`);
