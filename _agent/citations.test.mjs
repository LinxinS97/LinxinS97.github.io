import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from './core.mjs';
import { verifiedAnswer } from './citations.mjs';

const env={OPENROUTER_API_KEY:'test-key',OPENROUTER_BASE_URL:'https://model.invalid/v1',PROFILE:'# About Me\nLinxin Song researches agents.'};
const call=(name,args)=>Response.json({choices:[{message:{tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
const result={ok:true,text:'about-me'};

test('search-only answer cannot cite unread biography; one repair returns verified search citations',async()=>{
  for(const successfulRepair of [true,false]){
    let stage=0,repairs=0,searches=0,reservations=0;
    const e={...env,BILLING:async type=>{if(type==='reserve')reservations++;}};
    const fetcher=async(_,options)=>{
      const body=JSON.parse(options.body);
      if(body.plugins){searches++;return Response.json({choices:[{message:{content:'Available public citation ranking.',annotations:[{type:'url_citation',url_citation:{url:'https://scholar.google.com/citations?user=public-test',title:'Scholar',content:'Public citation ranking evidence; counts can change.'}}]}}]});}
      if(stage++===0)return call('check_scope',{allowed:true});
      if(stage===2)return call('observe_page',{});
      if(stage===3)return call('web_search',{query:'Linxin Song citations'});
      const answerTool=body.tools.find(tool=>tool.function.name==='answer_profile');
      assert.equal(answerTool.function.parameters.properties.sources.maxItems,0);
      const id=answerTool.function.parameters.properties.link_sources.items.enum[0];
      if(stage===4)return call('answer_profile',{answer:'First unverified answer.',sources:['about-me'],paper_sources:[],link_sources:[id]});
      repairs++;
      assert.equal(body.tools.length,1);
      assert.ok(body.messages.at(-1).content.includes('Invalid citations'));
      return call('answer_profile',{answer:successfulRepair?'Verified public ranking.':'Still unverified.',sources:successfulRepair?[]:['about-me'],paper_sources:[],link_sources:[id]});
    };
    let r=await runAgent({question:'Which Linxin paper is most cited?'},e,'https://profile.example.org',fetcher);
    while(r.type==='action')r=await runAgent({state:r.state,result},e,'https://profile.example.org',fetcher);
    assert.equal(reservations,1);assert.equal(searches,1);assert.equal(repairs,1);
    assert.ok(!r.answer.includes('unverified'));
    if(successfulRepair){assert.equal(r.answer,'Verified public ranking.');assert.equal(r.links.length,1);assert.equal(r.sources.length,0);}
    else {assert.ok(r.answer.includes('not sufficient'));assert.equal(r.links.length,0);}
  }
});

test('known citations are classified by evidence type; unknown IDs are never silently removed',()=>{
  const pool={sources:['about-me'],paper_sources:['arxiv:2601.00001'],link_sources:['search:1234567812345678']};
  const corrected=verifiedAnswer({answer:'Grounded.',sources:['search:1234567812345678'],paper_sources:['about-me'],link_sources:['arxiv:2601.00001']},pool);
  assert.deepEqual(corrected,{answer:'Grounded.',...pool});
  assert.equal(verifiedAnswer({answer:'Not grounded.',sources:['about-me','unread']},pool),null);
  assert.equal(verifiedAnswer({answer:'No evidence.',sources:[]},pool),null);
});
