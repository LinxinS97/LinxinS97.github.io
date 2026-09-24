import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from './core.mjs';
import { paperCatalog } from './papers.mjs';
import { linkCatalog } from './links.mjs';
import { turnDocuments, recentDocuments } from './memory.mjs';

const profile = '# About Me\nLinxin Song researches agents.\n' + Array.from({length:9},(_,i)=>`[Lab ${i}](https://lab${i}.example.org/)`).join('\n') + '\n# Agentic AI\n' + Array.from({length:13},(_,i)=>`- [Paper ${i}](https://arxiv.org/abs/2601.${String(i+1).padStart(5,'0')})`).join('\n');
const papers = paperCatalog(profile).map(p=>p.id);
const links = linkCatalog(profile).filter(l=>l.url.includes('.example.org')).map(l=>l.id);
const env = { OPENROUTER_API_KEY:'test-placeholder',OPENROUTER_BASE_URL:'https://model.invalid/v1',PROFILE:profile,
  SOURCE_FETCH:async()=>new Response('<p>Official research laboratory context. The laboratory studies reliable language model agents, interactive planning, and evaluation methods.</p>',{headers:{'Content-Type':'text/html'}}),
  PAPER_FETCH:async()=>new Response('<article class="ltx_document"><p>'+('Paper method and experiments. '.repeat(150))+'</p></article>',{headers:{'Content-Type':'text/html'}}) };
const call=(name,args)=>Response.json({choices:[{message:{tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
const observed={ok:true,text:'Linxin Song researches agents.'};
async function finish(fetcher){let r=await runAgent({question:'Compare Linxin’s papers and lab context'},env,'https://profile.example.org',fetcher);for(let i=0;r.type==='action'&&i<10;i++)r=await runAgent({state:r.state,result:observed},env,'https://profile.example.org',fetcher);return r;}

test('context is separate from 12-paper budget; exhaustion recovers and all twelve citations survive',async()=>{
  let stage=0, paperReads=0, repaired=false;
  const r=await finish(async(_,options)=>{
    const body=JSON.parse(options.body);
    if(!body.tools){paperReads++;return Response.json({choices:[{message:{content:'Detailed factual notes about the method, experimental setup, results, and limitations.'}}]});}
    const names=body.tools.map(t=>t.function.name);
    assert.ok(!names.some(n=>['read_papers','read_links','focus_section'].includes(n)));
    if(names.every(n=>['answer_profile','refuse_request'].includes(n))){repaired=true;return call('answer_profile',{answer:'Comparison grounded in twelve papers and the lab context.',sources:['about-me'],paper_sources:papers.slice(0,12),link_sources:links.slice(0,3)});}
    if(stage++===0)return call('check_scope',{allowed:true});
    if(stage===2)return call('observe_page',{});
    if(stage===3)return call('read_context',{section:'',link_ids:links.slice(0,3),query:'research'});
    if(stage===4){assert.ok(body.messages[0].content.includes('12 paper reads remaining'));return call('read_context',{section:'about-me',link_ids:[],query:''});}
    if(stage<=8)return call('read_paper',{paper_ids:papers.slice((stage-5)*3,(stage-4)*3)});
    assert.equal(paperReads,12);assert.ok(!names.includes('read_paper'));assert.ok(names.includes('read_context'));
    return call('read_paper',{paper_ids:[papers[12]]}); // Ignore the schema once: recovery must not fetch it.
  });
  assert.equal(r.type,'answer');assert.equal(r.papers.length,12);assert.equal(r.links.length,3);assert.equal(paperReads,12);assert.equal(repaired,true);
});

test('more than six ordinary pages do not spend paper quota',async()=>{
  let stage=0;
  const r=await finish(async(_,options)=>{
    const body=JSON.parse(options.body);
    if(stage++===0)return call('check_scope',{allowed:true});
    if(stage===2)return call('observe_page',{});
    if(stage<=5)return call('read_context',{section:'',link_ids:links.slice((stage-3)*3,(stage-2)*3),query:'lab'});
    assert.ok(body.messages[0].content.includes('12 paper reads remaining'));
    return call('answer_profile',{answer:'Nine laboratory pages read.',sources:[],paper_sources:[],link_sources:links});
  });
  assert.equal(r.links.length,9);
});

test('context accepts a section and links together, grounding both on the server',async()=>{
  let stage=0;
  const r=await finish(async(_,options)=>{
    const body=JSON.parse(options.body);
    if(stage++===0)return call('check_scope',{allowed:true});
    if(stage===2)return call('observe_page',{});
    if(stage===3)return call('read_context',{section:'about-me',link_ids:links.slice(0,2),query:'research'});
    const result=JSON.parse(body.messages.filter(m=>m.role==='tool').at(-1).content);
    assert.equal(result.section.id,'about-me');
    assert.ok(result.section.text.includes('Linxin Song researches agents'));
    assert.equal(result.links.length,2);
    assert.ok(body.messages[0].content.includes('12 paper reads remaining'));
    return call('answer_profile',{answer:'Profile and external context agree.',sources:['about-me'],paper_sources:[],link_sources:links.slice(0,2)});
  });
  assert.equal(r.type,'answer');assert.equal(r.sources.length,1);assert.equal(r.links.length,2);
});

test('empty context targets default to biography; combined invalid targets remain blocked',async()=>{
  for(const args of [{section:'',link_ids:[],query:''},{section:null,link_ids:null},{section:'invalid-section',link_ids:[links[0]]},{section:'about-me',link_ids:['https://unlisted.example.org/']}]) {
    let stage=0;
    const fetcher=async()=>{
      if(stage++===0)return call('check_scope',{allowed:true});
      if(stage===2)return call('observe_page',{});
      if(stage===3)return call('read_context',args);
      return call('answer_profile',{answer:'Biography read.',sources:['about-me'],paper_sources:[],link_sources:[]});
    };
    if(args.section==='invalid-section'||args.link_ids?.[0]?.startsWith('https:'))await assert.rejects(finish(fetcher),/blocked|invalid linked source/);
    else assert.equal((await finish(fetcher)).type,'answer');
  }
});

test('last paper batch is clamped to remaining allowance instead of failing the conversation',async()=>{
  let stage=0, reads=0;
  const batches=[papers.slice(0,2),papers.slice(2,5),papers.slice(5,8),papers.slice(8,11),[papers[11],papers[12],papers[0]]];
  const r=await finish(async(_,options)=>{
    const body=JSON.parse(options.body);
    if(!body.tools){reads++;return Response.json({choices:[{message:{content:'Detailed paper notes covering the method, experimental evidence, and limitations.'}}]});}
    if(stage++===0)return call('check_scope',{allowed:true});
    if(stage===2)return call('observe_page',{});
    if(stage<=7){
      if(stage===7)assert.equal(body.tools.find(t=>t.function.name==='read_paper').function.parameters.properties.paper_ids.maxItems,1);
      return call('read_paper',{paper_ids:batches[stage-3]});
    }
    return call('answer_profile',{answer:'Twelve papers compared.',sources:[],paper_sources:papers.slice(0,12),link_sources:[]});
  });
  assert.equal(reads,12);assert.equal(r.papers.length,12);
});

test('current-turn notes preserve early evidence with a UTF-8 byte bound; later memory still has six documents',()=>{
  const documents=Object.fromEntries(Array.from({length:20},(_,i)=>['source:'+i,{notes:'研究结果'.repeat(4000)}]));
  const bounded=turnDocuments(documents);
  assert.equal(Object.keys(bounded).length,20);assert.ok(bounded['source:0']);
  assert.ok(Object.values(bounded).reduce((n,d)=>n+new TextEncoder().encode(d.notes).length,0)<=96000);
  assert.ok(Object.values(bounded).every(d=>!d.notes.includes('\uFFFD')&&d.truncated));
  assert.equal(Object.keys(recentDocuments(bounded,[{role:'assistant',content:Object.keys(bounded).join(';')}])).length,6);
});
