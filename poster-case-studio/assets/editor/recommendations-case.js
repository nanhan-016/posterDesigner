(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./planning.js'));
  else root.PosterRecommendations=factory(root.PosterPlanning);
})(typeof globalThis!=='undefined'?globalThis:this,function(planning){
  'use strict';
  const unique=xs=>[...new Set(xs)];
  function normalizeTags(value,taxonomy){
    if(value===undefined||value===null)value={};
    if(typeof value!=='object'||Array.isArray(value))throw new Error('selectedTags 必须是对象');
    const defs=[...taxonomy.dimensions,{id:'visualSubtype',multiple:true,options:taxonomy.visualSubtypes.map(s=>({value:s.name}))}],clean={};
    for(const d of defs){
      const v=value[d.id]===undefined?[]:value[d.id];
      if(!Array.isArray(v)||v.some(x=>typeof x!=='string'))throw new Error((d.label||d.id)+' 必须为字符串数组');
      const values=unique(v.map(x=>taxonomy.aliases[x]||x));
      if(!d.multiple&&values.length>1)throw new Error((d.label||d.id)+' 只能选择一项');
      if(values.some(x=>!d.options.some(o=>o.value===x)))throw new Error((d.label||d.id)+' 含素材库以外的标签');
      clean[d.id]=values;
    }
    for(const k of Object.keys(value))if(!defs.some(d=>d.id===k))throw new Error('未知标签类别：'+k);
    return clean;
  }
  function matchCases(tags,cases,dimensions,limit){
    if(dimensions.some(d=>!tags[d]?.length))return {ready:false,missing:dimensions.filter(d=>!tags[d]?.length),cases:[]};
    const matches=cases.map(c=>{
      const hits={};let sum=0;
      for(const d of dimensions){hits[d]=tags[d].filter(t=>(c.tags[d]||[]).includes(t));sum+=hits[d].length/tags[d].length;}
      return {row:c.row,name:c.name,tags:c.tags,similarity:sum/dimensions.length,hits};
    }).filter(c=>c.similarity>0).sort((a,b)=>b.similarity-a.similarity||a.row-b.row).slice(0,limit);
    return {ready:true,missing:[],cases:matches};
  }
  function countLabels(cases,dimension,order){
    const counts=new Map();
    for(const c of cases)for(const label of unique(c.tags[dimension]||[]))if(order.includes(label))counts.set(label,(counts.get(label)||0)+1);
    return [...counts].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||order.indexOf(a.name)-order.indexOf(b.name));
  }
  function recommend(input,data){
    const {taxonomy,caseIndex,rules,styles,layouts}=data,tags=normalizeTags(input.selectedTags,taxonomy),warnings=[];
    const stage=input.recommendationStage||'both';
    if(!['style','layout','both'].includes(stage))throw new Error('recommendationStage 应为 style、layout 或 both');
    const hasPhoto=input.hasSourcePhoto??null;
    if(hasPhoto!==null&&typeof hasPhoto!=='boolean')throw new Error('hasSourcePhoto 必须是布尔值或 null');
    const familyOrder=taxonomy.dimensions.find(d=>d.id==='styleFamily').options.map(o=>o.value);
    const compositionOrder=taxonomy.dimensions.find(d=>d.id==='composition').options.map(o=>o.value);
    const round1=stage==='layout'?{ready:false,missing:[],cases:[],skipped:true}:matchCases(tags,caseIndex.cases,['eventType','audience'],40);
    const material=planning.normalizeMaterialUse(input.materialUse);
    const round2=stage==='style'?{ready:false,missing:[],cases:[],skipped:true}:!material.confirmed?{ready:false,missing:['materialUse 用户确认'],cases:[]}:matchCases(tags,caseIndex.cases,['contentTypes','subjectType'],60);
    if(material.confirmed){
      const expected=material.mode==='subject'?(material.subjectCount===1?'单主体':'多主体'):'无主体（不能抠图）';
      if(tags.subjectType.length&&tags.subjectType[0]!==expected)throw new Error('主视觉侧重类型与已确认素材用途不一致');
    }
    const styleRanking=countLabels(round1.cases,'styleFamily',familyOrder),layoutRanking=countLabels(round2.cases,'composition',compositionOrder);
    const styleFamilies=styleRanking.slice(0,3).filter(x=>x.count>=9).map(x=>({...x,recipes:styles.filter(s=>s.category===x.name).map(s=>({id:s.id,name:s.name,visualSubtype:s.visualSubtype,needsPhoto:!!s.needsPhoto,eligible:!(s.needsPhoto&&hasPhoto===false),referenceImages:s.referenceImages||[]}))}));
    const layoutGroups=layoutRanking.slice(0,3).filter(x=>x.count>=9).map(x=>({...x,templateIds:rules.compositionLayouts[x.name]?.layouts||[],approximate:!!rules.compositionLayouts[x.name]?.approximate,note:rules.compositionLayouts[x.name]?.note||''}));
    for(const [name,round,candidates] of [['风格',round1,styleFamilies],['排版',round2,layoutGroups]]){
      if(round.skipped)continue;
      if(!round.ready)warnings.push(name+'匹配尚未就绪，缺少：'+round.missing.join('、'));
      else if(!candidates.length)warnings.push(name+'频数前三名均未达到 9 条；不补入其他候选。请查看现有目录并明确选择。');
      if(round.ready&&!round.cases.length)warnings.push(name+'匹配没有正相似度案例，不用零命中记录凑数。');
    }
    const routeCandidates=styles.map((s,index)=>{
      const f=styleFamilies.find(f=>f.name===s.category);
      return {id:s.id,name:s.name,category:s.category,visualSubtype:s.visualSubtype,count:f?.count||0,score:f?.count||0,eligible:!!f&&!(s.needsPhoto&&hasPhoto===false),needsPhoto:!!s.needsPhoto,reasons:f?[`第一轮 ${round1.cases.length} 条案例中，该大类出现 ${f.count} 条；配方没有独立案例频数`]:[],referenceImages:s.referenceImages||[],index};
    });
    const proposed=styleFamilies.flatMap(f=>routeCandidates.filter(s=>s.category===f.name&&s.eligible));
    const active=styles.find(s=>s.id===input.styleId),copy=input.content||{};
    const bodyLength=['body','note','footer1','footer2','footer3'].reduce((n,k)=>n+String(copy[k]||'').replace(/\s/g,'').length,0);
    const allLayouts=layouts.map(l=>{
      const groups=layoutGroups.filter(g=>g.templateIds.includes(l.id)),conflicts=planning.layoutConflicts(l,input),reasons=[];
      let fitness=active?.preferredLayouts.includes(l.id)?2:0;
      if(bodyLength>160||tags.contentTypes.length>=5)fitness+=l.capacity==='long'?3:l.capacity==='short'?-3:1;
      if(String(copy.title||'').replace(/\s/g,'').length>14&&l.slots.find(s=>s.key==='title')?.vertical)fitness--;
      for(const g of groups)reasons.push(`${g.name}：${g.count}/${round2.cases.length} 条；${g.note}`);
      return {id:l.id,name:l.name,description:l.description,capacity:l.capacity,score:fitness,fitness,statisticalEligible:groups.length>0,compositionGroups:groups.map(g=>g.name),conflicts,eligible:conflicts.length===0,reasons};
    }).sort((a,b)=>b.fitness-a.fitness||a.id.localeCompare(b.id));
    const layoutProposals=[];
    for(const g of layoutGroups){const candidate=allLayouts.find(l=>l.eligible&&g.templateIds.includes(l.id)&&!layoutProposals.some(p=>p.id===l.id));if(candidate)layoutProposals.push({...candidate,composition:g.name,count:g.count});else warnings.push(g.name+' 的映射模板暂未通过筛选；保留统计结果，调整素材位置或文字分组后重试。');}
    for(const g of layoutGroups)if(g.approximate)warnings.push(g.note);
    if(bodyLength>160||tags.contentTypes.length>=5)warnings.push('信息较多，请检查真实文字排版；必要时扩展图层，不能删除必需信息。');
    if(active?.needsPhoto&&hasPhoto!==true)warnings.push('当前所选配方需要原始照片；请确认素材，不能自动替换选择。');
    if(!planning.protectedRects(input).length&&(input.background||(input.subjectImages||[]).length))warnings.push('尚未标注保护区域，模板仍需查看实际画面后确认。');
    const evidence=round=>round.cases.map(({tags,...c})=>c);
    return {schemaVersion:3,recommendationStage:stage,selectedTags:tags,styleFamilies,layoutGroups,styleRanking,layoutRanking,styles:proposed,allStyles:routeCandidates,layouts:layoutProposals,allLayouts,round1:{...round1,cases:evidence(round1)},round2:{...round2,cases:evidence(round2)},evidence:evidence(stage==='layout'?round2:round1).slice(0,3),evidenceCount:(stage==='layout'?round2:round1).cases.length,warnings:unique(warnings),requiresHumanGate:true};
  }
  return {normalizeTags,matchCases,countLabels,recommend};
});
