import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),load=n=>JSON.parse(fs.readFileSync(path.join(root,'assets/catalogs',n),'utf8'));
const engine=createRequire(import.meta.url)(path.join(root,'assets/editor/recommendations-case.js'));
const data={taxonomy:load('tags.json'),caseIndex:load('cases.json'),rules:load('recommendation-rules.json'),styles:load('styles.json').styles,layouts:load('layouts.json').layouts};
const tags={eventType:['展览展示类'],audience:['文化审美型'],contentTypes:['活动内容'],subjectType:['单主体']};
const brief={selectedTags:tags,hasSourcePhoto:true,materialUse:{mode:'subject',confirmed:true,subjectCount:1},content:{title:'测试'}};
const families=data.taxonomy.dimensions.find(d=>d.id==='styleFamily').options.map(o=>o.value);
const compositions=data.taxonomy.dimensions.find(d=>d.id==='composition').options.map(o=>o.value);
function record(row,style=0,composition=0){return {row,name:'test',tags:{...tags,styleFamily:[families[style]],composition:[compositions[composition]]}};}
function run(cases,input=brief){return engine.recommend(input,{...data,caseIndex:{cases}});}
const big=Array.from({length:75},(_,i)=>record(i+2,i%3,i%3)).reverse();
let result=run(big);
assert.equal(result.round1.cases.length,40);assert.equal(result.round2.cases.length,60);
assert.deepEqual(result.round1.cases.map(c=>c.row),Array.from({length:40},(_,i)=>i+2));
assert.equal(result.styleFamilies.length,3);assert.equal(result.layoutGroups.length,3);
assert.deepEqual(result.layoutGroups.map(g=>g.count),[20,20,20]);
// Boundary: nine counts recommend; eight do not. No padding to three.
const boundary=[...Array.from({length:9},(_,i)=>record(i+2,0,0)),...Array.from({length:8},(_,i)=>record(i+11,1,1))];
result=run(boundary);assert.deepEqual(result.styleFamilies.map(f=>f.count),[9]);assert.deepEqual(result.layoutGroups.map(g=>g.count),[9]);
result=run(boundary.slice(1));assert.equal(result.styleFamilies.length,0);assert.equal(result.layoutGroups.length,0);assert.equal(result.layouts.length,0);
assert(result.allLayouts.every(l=>!l.statisticalEligible));
// Multi-label style cases give one whole vote per distinct family.
const multi=Array.from({length:9},(_,i)=>({...record(i+2),tags:{...record(i+2).tags,styleFamily:[families[0],families[0],families[1]]}}));
result=run(multi);assert.deepEqual(result.styleFamilies.map(f=>f.count),[9,9]);
// Query-only dimensions: selected outputs and visualFocus cannot bias retrieval.
const original=run(big),extra=run(big,{...brief,selectedTags:{...tags,styleFamily:[families[5]],composition:[compositions[8]],visualSubtype:[data.taxonomy.visualSubtypes[0].name]}});
assert.deepEqual(original.round1,extra.round1);assert.deepEqual(original.round2,extra.round2);
// Multi-select overlap averages dimension fractions, not individual-tag votes.
const audienceOptions=data.taxonomy.dimensions.find(d=>d.id==='audience').options.map(o=>o.value);
const scored=engine.matchCases({...tags,audience:audienceOptions.slice(0,2)},[{...record(2),tags:{...tags,audience:[audienceOptions[0]]}}],['eventType','audience'],40);
assert.equal(scored.cases[0].similarity,.75);
// Completely unrelated records do not fill the sample. Missing tags stop the round.
const unrelated={...record(3),tags:{eventType:[],audience:[],contentTypes:[],subjectType:[],styleFamily:[families[0]],composition:[compositions[0]]}};
assert.equal(run([unrelated]).round1.cases.length,0);
assert.equal(run(big,{...brief,selectedTags:{}}).round1.ready,false);
assert.equal(run(big,{...brief,materialUse:{mode:'pending',confirmed:false,subjectCount:0}}).round2.ready,false);
assert.equal(run(big,{...brief,recommendationStage:'style'}).round2.skipped,true);
assert.equal(run(big,{...brief,recommendationStage:'layout'}).round1.skipped,true);
assert.throws(()=>run(big,{...brief,selectedTags:{...tags,eventType:['虚构标签']}}));
assert.throws(()=>run(big,{...brief,materialUse:{mode:'tile',confirmed:true,subjectCount:1}}));
// Uniform full-canvas protection removes mapped templates; it never invents a replacement.
result=run(big,{...brief,protectedRegions:[{layer:'background',name:'all',x:0,y:0,w:1,h:1}]});
assert.equal(result.layouts.length,0);assert.equal(result.layoutGroups.length,3);
const live=engine.recommend(brief,data);
assert.equal(live.round1.cases.length,40);assert.equal(live.round2.cases.length,60);
assert(live.styleFamilies.every(x=>x.count>=9));assert(live.layoutGroups.every(x=>x.count>=9));
console.log(JSON.stringify({tests:'passed',realLibrary:{cases:data.caseIndex.cases.length,round1:live.round1.cases.length,round2:live.round2.cases.length,styles:live.styleFamilies.map(({name,count})=>({name,count})),layouts:live.layoutGroups.map(({name,count})=>({name,count}))}},null,2));
