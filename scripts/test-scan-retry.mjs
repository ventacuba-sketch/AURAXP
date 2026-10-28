import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('supabase/functions/process-scan/index.ts', 'utf8');
const stripped = source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');
const js = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
class GeminiUnavailableError extends Error {}
function setup({status='pending', owner='user', fail=false, delayed=false, claimError=false}={}) {
  const scan={id:'scan',user_id:owner,status,video_path:`${owner}/clip.mp4`,video_hash:'hash',error_message:status==='failed'?'gemini_unavailable':null};
  const counter={upload_count:1,xp_scan_count:0};
  let handler, calls=0, release;
  const barrier=new Promise(r=>{release=r;});
  const db={
    from(table) {
      let action='select', values, filters=[];
      const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},neq(){return q;},not(){return q;},is(){return q;},order(){return q;},limit(){return q;},
        update(v){action='update';values=v;return q;},upsert(v){action='upsert';values=v;return q;},
        single(){return run(true);},maybeSingle(){return run(true);},then(a,b){return run(false).then(a,b);}};
      async function run(single) {
        if(table==='scans') {
          if(action==='update') {
            if(claimError && values.status==='processing') return {data:null,error:new Error('db')};
            if(!filters.every(([k,v])=>scan[k]===v)) return {data:[],error:null};
            Object.assign(scan,values);return {data:[{id:scan.id}],error:null};
          }
          if(filters.some(([k,v])=>k==='status'&&v==='done')) return {data:null};
          return {data:{...scan}};
        }
        if(table==='profiles') return {data:{plan:'free',created_at:new Date().toISOString(),xp:0}};
        if(table==='system_status') return {data:{mode:'normal'}};
        if(table==='daily_scan_counts') {if(values) Object.assign(counter,values); return {data:{...counter}};}
        if(table==='inventory_items') return {data:null};
        throw Error('unexpected table '+table);
      }
      return q;
    },
    auth:{getUser:async()=>({data:{user:{id:'user'}}})},
    storage:{from:()=>({info:async()=>({data:{contentType:'video/mp4',size:8}}),download:()=>({asStream:async()=>({data:{}})})})},
  };
  vm.runInNewContext(js, {Deno:{env:{get:()=>''},serve:f=>handler=f},Response,console,Date,
    createClient:()=>db,corsHeaders:{},isUnlimitedTester:()=>false,resolveDailyCap:()=>({cap:5,isFairUseCap:false}),
    prepareGeminiVideoFile:async()=>({uri:'saved',mimeType:'video/mp4',name:'file'}),deleteGeminiFile:async()=>{},GeminiUnavailableError,
    analyzeVideo:async()=>{calls++;if(delayed) await barrier;if(fail) throw new GeminiUnavailableError();return {moderation:{flagged:false},signals:{hasClearAction:false},scores:{},verdict:{headline:'ok'}};},
    noActionResult:()=>({auraScore:-50,verdictTag:'none'}),computeXpGained:()=>0,DAILY_XP_SCAN_CAP:5,
  });
  return {scan,counter,get calls(){return calls;},release,run:()=>handler({method:'POST',headers:new Headers(),json:async()=>({scanId:'scan'})})};
}
const first=setup({fail:true});assert.equal((await first.run()).status,502);assert.equal(first.scan.status,'failed');assert.equal(first.scan.video_path,'user/clip.mp4');assert.equal(first.counter.upload_count,2);
const retry=setup({status:'failed'});assert.equal((await retry.run()).status,200);assert.equal(retry.scan.status,'done');assert.equal(retry.counter.upload_count,1);assert.equal(retry.calls,1);await retry.run();assert.equal(retry.calls,1);
const parallel=setup({status:'failed',delayed:true});const running=parallel.run();while(!parallel.calls) await new Promise(r=>setImmediate(r));assert.equal((await parallel.run()).status,202);parallel.release();await running;assert.equal(parallel.calls,1);
for(const status of ['done','processing','rejected']) {const t=setup({status});await t.run();assert.equal(t.calls,0);assert.equal(t.scan.status,status);}
const other=setup({owner:'other'});assert.equal((await other.run()).status,403);assert.equal(other.scan.status,'pending');
const broken=setup({claimError:true});assert.equal((await broken.run()).status,503);assert.equal(broken.calls,0);assert.equal(broken.scan.status,'pending');
console.log('PASS: transient failure preserves video; retry succeeds without quota charge; concurrent and terminal calls are idempotent; ownership and claim errors fail closed.');
