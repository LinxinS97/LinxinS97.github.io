import test from 'node:test';
import assert from 'node:assert/strict';
import cleanAnswer from '../assets/js/agent-text.js';
import { searchWeb } from './web-search.mjs';
import { runAgent } from './core.mjs';

const env = { OPENROUTER_API_KEY: 'test-secret', OPENROUTER_BASE_URL: 'https://model.invalid/v1', PROFILE: '# About Me\nLinxin Song researches language models.', VISITOR_ID: 'test' };
const annotation = url => ({ type: 'url_citation', url_citation: { url, title: 'Research source', content: 'Linxin Song researches language model agents.' } });
const evidence = () => Response.json({ choices: [{ message: { content: 'Linxin researches language model agents.', annotations: [annotation('https://research.example.org/paper')] } }] });
const call = (name, args) => Response.json({ choices: [{ message: { tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const observed = { ok: true, text: 'about-me: Linxin Song researches language models.' };

test('internal citation blocks and raw IDs disappear without removing ordinary brackets', () => {
  assert.equal(cleanAnswer('Research [post-training; link:37508b23a4ef4544; link:a873ef57b61940d7].'), 'Research.');
  assert.equal(cleanAnswer('See [agentic-ai](#agentic-ai).'), 'See.');
  assert.equal(cleanAnswer('Result [search:1234567812345678] link:1234567812345678'), 'Result');
  assert.equal(cleanAnswer('Intervals [1, 2] and [post-training results] matter.'), 'Intervals [1, 2] and [post-training results] matter.');
});

test('search enables the bounded plugin and admits only annotated public sources', async () => {
  const docs = await searchWeb('Linxin research', 'What does Linxin study?', env, async (_, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.plugins, [{ id: 'web', engine: 'exa', max_results: 5 }]);
    assert.equal(body.model, 'openai/gpt-6-luna');
    assert.equal(body.reasoning.effort, 'high');
    assert.ok(!options.body.includes(env.OPENROUTER_API_KEY));
    return Response.json({ choices: [{ message: { content: 'Search notes', annotations: [annotation('javascript:alert(1)'), annotation('http://127.0.0.1/'), ...Array.from({length:7}, (_, i) => annotation('https://research.example.org/' + i))] } }] });
  });
  assert.equal(docs.length, 5);
  assert.equal(docs[0].kind, 'websearch');
  await assert.rejects(searchWeb('Linxin', 'Research?', env, async () => Response.json({ choices: [{ message: { content: 'An unsupported claim https://made-up.example.org' } }] })), /verifiable/);
  await assert.rejects(searchWeb('Linxin', 'Research?', env, async () => new Response('private provider error', {status:500})), /unavailable/);
});

test('search tool retrieves on server, costs one visitor question, returns clickable verified sources', async () => {
  let stage = 0, searches = 0, charges = 0;
  const e = {...env, BILLING: async type => { if(type === 'reserve') charges++; }};
  const fetcher = async (_, options) => {
    const body = JSON.parse(options.body);
    if(body.plugins) { searches++; return evidence(); }
    switch(stage++) {
      case 0: return call('check_scope', {allowed:true});
      case 1: return call('observe_page', {});
      case 2: return call('web_search', {query:'Linxin Song agents'});
      default: {
        const id = body.messages[0].content.match(/search:[a-f0-9]{16}/)[0];
        assert.ok(!body.tools.some(tool => tool.function.name === 'send_message'));
        return call('answer_profile', {answer:'He researches agents [' + id + '].',sources:[],paper_sources:[],link_sources:[id]});
      }
    }
  };
  let result=await runAgent({question:'Search the web for Linxin Song research.'},e,'https://profile.example.org',fetcher);
  while(result.type==='action') result=await runAgent({state:result.state,result:observed},e,'https://profile.example.org',fetcher);
  assert.equal(result.answer,'He researches agents.');
  assert.equal(result.links[0].url,'https://research.example.org/paper');
  assert.equal(searches,1); assert.equal(charges,1);
});

test('a third search is blocked, and invented search citations are rejected', async () => {
  for(const forged of [false,true]) {
    let stage=0, searches=0;
    const fetcher=async(_,options)=>{
      const body = JSON.parse(options.body);
      if(body.plugins) {searches++;return evidence();}
      if(body.tools.every(tool => ['answer_profile', 'refuse_request'].includes(tool.function.name))) {
        const id = body.messages[0].content.match(/search:[a-f0-9]{16}/)[0];
        return call('answer_profile',{answer:'Search budget used; these are the retrieved findings.',sources:[],paper_sources:[],link_sources:[id]});
      }
      if(stage++===0) return call('check_scope',{allowed:true});
      if(stage===2) return call('observe_page',{});
      if(forged) return call('answer_profile',{answer:'Invented.',sources:[],paper_sources:[],link_sources:['search:0000000000000000']});
      return call('web_search',{query:'Linxin Song research'});
    };
    let result=await runAgent({question:'Search Linxin research'},env,'https://profile.example.org',fetcher);
    const finish = async()=>{while(result.type==='action') result=await runAgent({state:result.state,result:observed},env,'https://profile.example.org',fetcher);};
    if(forged) await assert.rejects(finish,/verify/);
    else { await finish(); assert.equal(result.type,'answer'); }
    assert.equal(searches,forged?0:2);
  }
});

test('unrelated requests stop before search and failed searches cannot become citations', async () => {
  let calls=0;
  const refused=await runAgent({question:'Search for dinner recipes.'},env,'https://profile.example.org',async()=>{calls++;return call('check_scope',{allowed:false,refusal_message:'Only profile-related questions.'});});
  assert.equal(refused.type,'refusal');assert.equal(calls,1);
  let stage=0;
  const fetcher=async(_,options)=>{
    const body=JSON.parse(options.body);
    if(body.plugins) return new Response('secret upstream details',{status:500});
    if(stage++===0) return call('check_scope',{allowed:true});
    if(stage===2) return call('observe_page',{});
    if(stage===3) return call('web_search',{query:'Linxin research'});
    assert.ok(body.messages.some(m=>m.role==='tool' && m.content.includes('Web search failed')));
    assert.ok(!options.body.includes('secret upstream details'));
    return call('answer_profile',{answer:'Invented.',sources:[],paper_sources:[],link_sources:['search:0000000000000000']});
  };
  let result=await runAgent({question:'Search Linxin research'},env,'https://profile.example.org',fetcher);
  await assert.rejects(async()=>{while(result.type==='action')result=await runAgent({state:result.state,result:observed},env,'https://profile.example.org',fetcher);},/verify/);
});
