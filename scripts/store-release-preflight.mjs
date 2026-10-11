#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const errors=[]; const warnings=[]; const strict=process.argv.includes('--strict');
const files=['apps/marketing-web/public/privacy.html','apps/marketing-web/public/terms.html','apps/marketing-web/public/support.html','store-assets/STORE_LISTING_VI.md','store-assets/RELEASE_CHECKLIST.md','store-assets/hendy-app-icon.svg','store-assets/STORE_SCREENSHOTS_GUIDE.md','scripts/validate-release-artifact.mjs','.github/workflows/app-release.yml','integrated-pipeline/iosApp/Assets.xcassets/AppIcon.appiconset/Contents.json','integrated-pipeline/iosApp/Assets.xcassets/AppIcon.appiconset/AppIcon-ios-marketing-1024x1024-1x.png','integrated-pipeline/androidApp/src/main/res/mipmap-xxxhdpi/ic_launcher.xml','apps/desktop-shell/build/icon.ico','apps/desktop-shell/build/icon.icns','apps/desktop-shell/build/appx/StoreLogo.png','scripts/set-release-version.mjs'];
for (const file of files) { try { await access(resolve(file)); } catch { errors.push(`Missing ${file}`); } }
for (const file of ['apps/marketing-web/public/privacy.html','apps/marketing-web/public/terms.html','apps/marketing-web/public/support.html','store-assets/STORE_LISTING_VI.md']) {
  const content=await readFile(resolve(file),'utf8').catch(()=> '');
  if (/\[THAY BẰNG|CHƯA HOÀN TẤT PHÁP LÝ|DRAFT|placeholder/i.test(content)) warnings.push(`${file} contains a publishing placeholder or legal draft; review before store submission.`);
}
console.log('Hendy Studio Store/Release preflight');
for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const error of errors) console.error(`FAIL ${error}`);
if (errors.length || (strict && warnings.length)) { if (strict && warnings.length) console.error('FAIL strict publication gate blocked by unresolved legal/listing placeholders.'); process.exit(1); }
console.log('PASS: required release workflow, public legal/support template pages, and store listing templates are present.');
console.log(strict ? 'PASS: strict listing/legal placeholder gate.' : 'NOTE: candidate preflight does not sign packages, validate developer accounts, or assert that a store has approved a build.');
