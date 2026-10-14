// GitHub-only visual fixtures; no database or service connection.
import { sampleDocHtml } from '../cf/v2/docs-sample.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'docs/terms-restructure-2026-11/publication-preview-20261014-r5';
const db = { prepare(){return {bind(){return {async all(){return {results:[]};}};}};} };
await mkdir(out,{recursive:true});
for(const kind of ['condition','special']) await writeFile(out+'/'+kind+'-sample.html',await sampleDocHtml(db,kind,Date.parse('2026-10-14T03:00:00Z')));
