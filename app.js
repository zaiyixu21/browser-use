"use strict";
const $ = s => document.querySelector(s);
const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const typeNames = {single:"单选题",multi:"多选题",judge:"判断题"};
const statusNames = {source:"原资料答案",supplemented:"补充参考答案",corrected:"已纠错",pending:"待核实 · 不计分"};
const KEY = "cyber-study-v1";
let questions=[], byId=new Map(), pool=[], index=0, view="practice", practice=new Map(), result=null, reviewWrongOnly=false;
let state={version:1,records:{},history:[],activeExam:null,lastQuestion:null}, canStore=true, toastTimeout;
function loadState(){
  try {
    const raw=localStorage.getItem(KEY);
    if(raw){const parsed=JSON.parse(raw);if(parsed.version===1 && parsed.records && Array.isArray(parsed.history))state=parsed;}
  } catch(e){storageNotice("学习记录无法读取，本次可以继续练习。");}
}
function storageNotice(text){canStore=false;$("#storageWarning").textContent=text;$("#storageWarning").classList.remove("hidden");}
function save(){
  if(!canStore)return;
  try{localStorage.setItem(KEY,JSON.stringify(state));}
  catch(e){storageNotice("浏览器无法保存学习记录，请保持页面打开；关闭后本次进度可能丢失。");}
}
function toast(text){$("#toast").textContent=text;$("#toast").classList.remove("hidden");clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$("#toast").classList.add("hidden"),3200);}
function confirmAction(title,text){
  $("#dialogTitle").textContent=title;$("#dialogText").textContent=text;
  const dialog=$("#confirmDialog");dialog.returnValue="cancel";dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener("close",()=>resolve(dialog.returnValue==="ok"),{once:true}));
}
function shuffle(list){
  const a=list.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;
}
function isCorrect(q,selected){return selected.length===q.answers.length && [...selected].sort((a,b)=>a-b).every((v,i)=>v===[...q.answers].sort((a,b)=>a-b)[i]);}
function answerText(q,selected){return selected.length?selected.map(i=>String.fromCharCode(65+i)+" · "+q.options[i]).join("；"):"未作答";}
function statUpdate(){
  const records=Object.entries(state.records).filter(([id])=>byId.has(id));
  const scored=records.filter(([id])=>byId.get(id).scored);
  const attempts=scored.reduce((n,[,r])=>n+(r.attempts||0),0);
  const right=scored.reduce((n,[,r])=>n+(r.correctCount||0),0);
  const wrong=scored.filter(([,r])=>r.lastCorrect===false).length;
  $("#learnedStat").innerHTML=records.length+'<small>题</small>';
  $("#accuracyStat").textContent=attempts?Math.round(right/attempts*100)+"%":"—";
  $("#wrongStat").innerHTML=wrong+'<small>题</small>';$("#wrongBadge").textContent=wrong;
  $("#resumeExam").classList.toggle("hidden",!state.activeExam);
}
function recordAttempt(q,selected,mode){
  const prev=state.records[q.id]||{attempts:0,correctCount:0};
  const correct=q.scored?isCorrect(q,selected):null;
  state.records[q.id]={attempts:prev.attempts+(q.scored?1:0),correctCount:prev.correctCount+(correct?1:0),lastCorrect:correct,lastSelected:selected,lastAt:Date.now(),mode};
}
function setView(next){
  view=next;location.hash=next;$("#pageTitle").textContent={practice:"题库练习",wrong:"错题复习",exam:"模拟考试",history:"考试记录",about:"资料说明"}[next];
  document.querySelectorAll(".nav").forEach(b=>{b.classList.toggle("active",b.dataset.view===next);if(b.dataset.view===next)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
  ["practice","exam","history","about"].forEach(v=>$("#"+v+"View").classList.toggle("hidden",v!==(next==="wrong"?"practice":next)));
  if(next==="practice"||next==="wrong"){updatePool(true);renderPractice();}
  else if(next==="exam")renderExam();else if(next==="history")renderHistory();else renderAbout();
  statUpdate();
}
function updatePool(reset=false){
  const old=pool[index]?.id;
  const type=$("#typeFilter").value, category=$("#categoryFilter").value, search=$("#searchInput").value.trim().toLowerCase();
  pool=questions.filter(q=>(!type||q.type===type)&&(!category||q.category===category)&&(!search||q.prompt.toLowerCase().includes(search)||q.id.includes(search))&&(view!=="wrong"||state.records[q.id]?.lastCorrect===false));
  if($("#orderFilter").value==="random")pool=shuffle(pool);
  index=reset?0:Math.max(0,pool.findIndex(q=>q.id===old));
  if(view==="practice" && reset && state.lastQuestion && !type&&!category&&!search && $("#orderFilter").value==="ordered"){const i=pool.findIndex(q=>q.id===state.lastQuestion);if(i>=0)index=i;}
}
function sourceMarkup(q){
  const original=q.originalAnswers.length?q.originalAnswers.map(a=>a.letter+" · "+escapeHTML(a.text)).join("；"):"原表未提供答案";
  const refs=q.references.map((url,i)=>'<a href="'+escapeHTML(url)+'" target="_blank" rel="noopener noreferrer">参考资料 '+(i+1)+'</a>').join("");
  return '<p class="original">来源：'+escapeHTML(q.source.sheet)+' 第 '+q.source.row+' 行 · '+escapeHTML(q.id)+'<br>原表答案：'+original+'<br>'+escapeHTML(q.supplement)+'</p>'+(refs?'<div class="sources">'+refs+'</div>':"");
}
function explanationMarkup(q,selected){
  const correct=q.scored?isCorrect(q,selected):null;
  const headline=correct===null?"待核实，本题不计分":correct?"回答正确":"回答有误";
  return '<div class="explanation" aria-live="polite"><h3 class="'+(correct===null?"uncertain":correct?"":"error")+'">'+headline+'</h3>'+(q.answers.length?'<p><strong>'+(q.scored?"参考答案":"原资料给出的答案")+'：</strong>'+escapeHTML(answerText(q,q.answers))+'</p>':"")+'<p>'+escapeHTML(q.explanation)+'</p>'+sourceMarkup(q)+'</div>';
}
function renderOptions(q,selected,checked=false,examMode=false){
  return '<div class="options" role="group" aria-label="'+typeNames[q.type]+'选项">'+q.options.map((o,i)=>{
    let cls=selected.includes(i)?" selected":"", tag="";
    if(checked && q.scored){if(q.answers.includes(i)){cls+=" answer";tag="正确项";}else if(selected.includes(i)){cls+=" mistake";tag="错选";}}
    return '<button type="button" class="option'+cls+'" data-option="'+i+'" aria-pressed="'+selected.includes(i)+'"'+(checked?" disabled":"")+'><span class="option-letter">'+String.fromCharCode(65+i)+'</span><span class="option-text">'+escapeHTML(o)+'</span>'+(tag?'<span class="option-tag">'+tag+'</span>':"")+'</button>';
  }).join("")+'</div>';
}
function renderPractice(){
  $("#poolCount").textContent=pool.length+" 题";
  if(!pool.length){$("#questionPanel").innerHTML='<div class="card empty"><h2>'+(view==="wrong"?"当前没有符合条件的错题":"没有匹配的题目")+'</h2><p>'+(view==="wrong"?"答错的计分题会自动加入这里；答对后移出。":"试着调整题型、模块或搜索词。")+'</p><button class="primary" data-action="resetFilters">查看全部题目</button></div>';$("#questionGrid").innerHTML="";return;}
  const q=pool[index], p=practice.get(q.id)||{selected:[],checked:false};practice.set(q.id,p);
  $("#questionPanel").innerHTML='<article class="card question-card"><div class="section-head"><div class="q-meta"><span class="pill">'+typeNames[q.type]+'</span><span>'+escapeHTML(q.category)+'</span><span class="pill '+q.status+'">'+statusNames[q.status]+'</span></div><span class="q-count">'+(index+1)+' / '+pool.length+'</span></div><h2 class="question-text">'+escapeHTML(q.prompt)+'</h2><div class="hint">'+(q.type==="multi"?"请选择所有正确项；少选、多选均判错。":q.type==="judge"?"请选择正确或错误。":"请选择一个答案。")+(q.status==="pending"?" 本题保留练习，暂不计分。":"")+'</div>'+renderOptions(q,p.selected,p.checked)+(p.checked?explanationMarkup(q,p.selected):"")+'<div class="q-actions"><div class="button-group"><button class="secondary" data-action="prev"'+(index===0?" disabled":"")+'>上一题</button><button class="secondary" data-action="next"'+(index===pool.length-1?" disabled":"")+'>下一题</button></div><button class="primary" data-action="'+(p.checked?"retry":"check")+'">'+(p.checked?"重新作答":q.scored?"提交答案":"查看参考解析")+'</button></div></article>';
  $("#questionGrid").innerHTML=pool.map((item,i)=>{
    const r=state.records[item.id];const cls=item.status==="pending"?"pending":r?.lastCorrect===true?"done":r?.lastCorrect===false?"wrong":"";
    return '<button class="number '+cls+(i===index?" current":"")+'" data-jump="'+i+'" title="'+escapeHTML(item.source.sheet+" 第"+item.source.row+"行")+'"'+(i===index?' aria-current="true"':"")+'>'+(i+1)+'</button>';
  }).join("");
}
function choose(i){
  if(view==="exam"){
    const ex=state.activeExam;if(!ex)return;if(Date.now()>=ex.deadline){finishExam(true);return;}
    const q=byId.get(ex.ids[ex.index]);const selected=ex.selections[q.id]||[];
    ex.selections[q.id]=q.type==="multi"?(selected.includes(i)?selected.filter(v=>v!==i):[...selected,i]):[i];
    save();renderExam();
  }else{
    const q=pool[index],p=practice.get(q.id);if(p.checked)return;
    p.selected=q.type==="multi"?(p.selected.includes(i)?p.selected.filter(v=>v!==i):[...p.selected,i]):[i];renderPractice();
  }
}
function moveQuestion(i){
  if(view==="exam"&&state.activeExam){state.activeExam.index=Math.max(0,Math.min(state.activeExam.ids.length-1,i));save();renderExam();}
  else{index=Math.max(0,Math.min(pool.length-1,i));if(pool[index]){state.lastQuestion=pool[index].id;save();}renderPractice();}
}
function renderExam(){
  if(result){renderResult();return;}
  const ex=state.activeExam;
  if(!ex){
    const counts={};Object.keys(typeNames).forEach(t=>counts[t]=questions.filter(q=>q.scored&&q.type===t).length);
    $("#examView").innerHTML='<div class="card exam-intro"><span class="intro-label">MOCK EXAMINATION</span><h2>按考试节奏，检验复习效果</h2><p>从 '+questions.filter(q=>q.scored).length+' 道可计分题中随机组卷。考试期间不显示答案，交卷后统一评分和解析。</p><div class="preset-row"><button class="secondary" data-preset="standard">标准卷 · 50 题</button><button class="secondary" data-preset="long">加强卷 · 100 题</button><button class="secondary" data-preset="all">全部可计分题</button></div><div class="exam-layout"><div class="config"><div class="config-fields">'+Object.keys(typeNames).map((t,i)=>'<div class="field"><label for="count-'+t+'">'+typeNames[t]+'</label><input id="count-'+t+'" type="number" min="0" max="'+counts[t]+'" step="1" value="'+[20,15,15][i]+'"><span class="hint">可用 '+counts[t]+' 题</span></div>').join("")+'</div><div class="config-bottom"><div class="field"><label for="examMinutes">考试时长（分钟）</label><input id="examMinutes" type="number" min="1" max="180" step="1" value="60"></div><button class="primary" data-action="startExam">开始模拟考试</button></div><p class="hint" id="examError" role="alert"></p></div><aside class="exam-rules"><h3>本地模拟考试规则</h3><p><strong>满分 100 分 · 60 分及格</strong><br>各题等权，成绩按答对比例换算。</p><p>多选题需全选正确，少选、多选均为 0 分。未答题计 0 分。</p><p>到时自动交卷，刷新页面可以继续，关闭页面期间计时仍继续。</p><p>44 道待核实题不参与组卷。此规则为本站模拟设置。</p></aside></div></div>';
    return;
  }
  const q=byId.get(ex.ids[ex.index]), selected=ex.selections[q.id]||[];
  const answered=ex.ids.filter(id=>(ex.selections[id]||[]).length).length;
  $("#examView").innerHTML='<div class="exam-bar"><div><small>剩余时间</small><div id="examTimer" class="timer"></div></div><div><small>已答 '+answered+' / '+ex.ids.length+' 题</small><div class="exam-progress"><span style="width:'+answered/ex.ids.length*100+'%"></span></div></div><button class="primary" data-action="submitExam">交卷并评分</button></div><div class="workgrid"><article class="card question-card"><div class="section-head"><div class="q-meta"><span class="pill">'+typeNames[q.type]+'</span><span>'+escapeHTML(q.category)+'</span></div><span class="q-count">'+(ex.index+1)+' / '+ex.ids.length+'</span></div><h2 class="question-text">'+escapeHTML(q.prompt)+'</h2><div class="hint">'+(q.type==="multi"?"请选择所有正确项；少选、多选均判错。":"请选择一个答案。")+'</div>'+renderOptions(q,selected,false,true)+'<div class="q-actions"><button class="secondary" data-action="prev"'+(ex.index===0?" disabled":"")+'>上一题</button><button class="primary" data-action="next"'+(ex.index===ex.ids.length-1?" disabled":"")+'>下一题</button></div></article><aside class="card navigator"><div class="section-head"><h2>考试答题卡</h2><span>'+ex.ids.length+' 题</span></div><div class="legend"><span><i class="done"></i>已作答</span><span>浅灰：未作答</span></div><div class="number-grid">'+ex.ids.map((id,i)=>'<button class="number '+((ex.selections[id]||[]).length?"done ":"")+(i===ex.index?"current":"")+'" data-jump="'+i+'"'+(i===ex.index?' aria-current="true"':"")+'>'+(i+1)+'</button>').join("")+'</div><div class="navigator-note">答案自动保存。可通过题号返回检查或修改。</div></aside></div>';
  updateTimer();
}
function applyPreset(preset){
  const values=preset==="standard"?[20,15,15]:preset==="long"?[40,25,35]:Object.keys(typeNames).map(t=>questions.filter(q=>q.scored&&q.type===t).length);
  Object.keys(typeNames).forEach((t,i)=>$("#count-"+t).value=values[i]);$("#examMinutes").value=preset==="standard"?60:120;
}
function startExam(){
  const picked=[];let error="";
  for(const t of Object.keys(typeNames)){
    const all=questions.filter(q=>q.scored&&q.type===t),count=Number($("#count-"+t).value);
    if(!Number.isInteger(count)||count<0||count>all.length){error=typeNames[t]+"数量须为 0–"+all.length+" 的整数。";break;}
    picked.push(...shuffle(all).slice(0,count));
  }
  const minutes=Number($("#examMinutes").value);
  if(!error && (!Number.isInteger(minutes)||minutes<1||minutes>180))error="考试时长须为 1–180 分钟的整数。";
  if(!error && !picked.length)error="请至少选择一道题。";
  if(error){$("#examError").textContent=error;return;}
  const now=Date.now();state.activeExam={id:"exam-"+now,ids:shuffle(picked).map(q=>q.id),index:0,selections:{},startedAt:now,deadline:now+minutes*60000,minutes};
  save();statUpdate();renderExam();
}
async function requestSubmit(){
  const ex=state.activeExam;if(!ex)return;
  const unanswered=ex.ids.filter(id=>!(ex.selections[id]||[]).length).length;
  if(await confirmAction("提交试卷",unanswered?"还有 "+unanswered+" 道题未答，未答题计 0 分。确认交卷？":"所有题目已作答，确认交卷并查看成绩？"))finishExam(false);
}
function finishExam(timedOut){
  const ex=state.activeExam;if(!ex)return;
  const items=ex.ids.map(id=>{const q=byId.get(id),selected=ex.selections[id]||[];return {id,selected: [...selected],correct:isCorrect(q,selected)};});
  const correct=items.filter(i=>i.correct).length;
  result={id:ex.id,at:Date.now(),startedAt:ex.startedAt,minutes:ex.minutes,duration:Math.min(ex.minutes*60,Math.max(0,Math.floor((Date.now()-ex.startedAt)/1000))),timedOut,score:Number((correct/items.length*100).toFixed(1)),correct,total:items.length,items};
  // Exactly once: clear the active attempt before any further timer callback.
  state.activeExam=null;
  for(const item of items)recordAttempt(byId.get(item.id),item.selected,"exam");
  state.history.unshift(result);state.history=state.history.slice(0,100);save();statUpdate();reviewWrongOnly=false;
  if(view==="exam")renderResult();else{toast("模拟考试已到时，成绩已保存。");}
}
function updateTimer(){
  const ex=state.activeExam;if(!ex)return;
  const remaining=Math.max(0,Math.ceil((ex.deadline-Date.now())/1000));
  if(remaining===0){finishExam(true);return;}
  const node=$("#examTimer");if(node && view==="exam"){node.textContent=String(Math.floor(remaining/60)).padStart(2,"0")+":"+String(remaining%60).padStart(2,"0");node.classList.toggle("urgent",remaining<=300);}
}
function renderResult(){
  if(!result)return;
  const items=reviewWrongOnly?result.items.filter(i=>!i.correct):result.items;
  $("#examView").innerHTML='<div class="result-banner"><div><span class="intro-label">EXAM RESULT</span><h2>'+(result.score>=60?"本次考试通过":"继续复习，再试一次")+'</h2><p>答对 '+result.correct+' / '+result.total+' 题 · 用时 '+Math.floor(result.duration/60)+' 分 '+result.duration%60+' 秒'+(result.timedOut?" · 到时自动交卷":"")+'</p></div><div class="result-score">'+result.score+'<small> / 100</small></div></div><div class="review-toolbar"><div class="button-group"><button class="'+(!reviewWrongOnly?"primary":"secondary")+'" data-action="reviewAll">全部题目</button><button class="'+(reviewWrongOnly?"primary":"secondary")+'" data-action="reviewWrong">只看错题（'+(result.total-result.correct)+'）</button></div><button class="secondary" data-action="newExam">再考一套</button></div>'+(items.length?items.map(item=>{
    const q=byId.get(item.id);if(!q)return "";
    const number=result.items.indexOf(item)+1;
    return '<article class="card review-item"><div class="q-meta"><span class="pill">'+typeNames[q.type]+'</span><span>第 '+number+' 题</span><span class="pill '+(item.correct?"":"pending")+'">'+(item.correct?"答对":item.selected.length?"答错":"未作答")+'</span></div><h3>'+escapeHTML(q.prompt)+'</h3><div class="review-options">'+q.options.map((o,i)=>'<div class="'+(q.answers.includes(i)?"right":item.selected.includes(i)?"incorrect":"")+'">'+String.fromCharCode(65+i)+'. '+escapeHTML(o)+(q.answers.includes(i)?" ✓ 正确项":item.selected.includes(i)?" · 你的选择":"")+'</div>').join("")+'</div><p>你的答案：'+escapeHTML(answerText(q,item.selected))+'</p><p><strong>解析：</strong>'+escapeHTML(q.explanation)+'</p>'+sourceMarkup(q)+'</article>';
  }).join(""):'<div class="card empty"><h2>全部答对</h2><p>本次考试没有错题。</p></div>');
}
function renderHistory(){
  $("#historyView").innerHTML=state.history.length?'<div class="review-toolbar"><h2>最近 '+state.history.length+' 次考试</h2><span class="hint">成绩与试卷保存在当前浏览器</span></div>'+state.history.map(h=>'<article class="card history-card"><div><h2>'+new Date(h.at).toLocaleString("zh-CN")+'</h2><p>'+h.total+' 题 · 答对 '+h.correct+' 题 · '+(h.timedOut?"到时交卷":"主动交卷")+'</p></div><strong class="history-score">'+h.score+'<small> 分</small></strong><button class="secondary" data-history="'+escapeHTML(h.id)+'">查看试卷</button></article>').join(""):'<div class="card empty"><h2>还没有考试记录</h2><p>完成一次模拟考试，成绩与解析就会出现在这里。</p><button class="primary" data-action="goExam">开始模拟考试</button></div>';
}
function renderAbout(){
  const pending=questions.filter(q=>!q.scored);
  $("#aboutView").innerHTML='<article class="card about"><h2>236 道原题，逐行保留</h2><p>题目来自《网络安全复习资料(1).xlsx》的三个工作表。重复题保留原行，解析中可核对工作表、行号与原答案。原文件未修改。</p><div class="counts"><span>单选 100</span><span>多选 50</span><span>判断 86</span><span>可计分 192</span><span>待核实 44</span></div><h3>选项与答案如何补充</h3><p>选择题保留原表正确答案，补充干扰项并调整选项顺序。新选项是本站编写，并非原试卷选项。判断题原表没有答案，本站补充了参考答案与逐题解析。</p><p>“已纠错”题按修正后的答案评分，例如 RDP 本身是远程桌面协议，原表给出的 Telnet 有误。其余资料答案与补充答案的来源均在解析中标明。</p><h3>待核实题如何处理</h3><p>缺少“以上都是”的前置选项、产品命令缺少型号版本，以及答案有歧义或明显争议的题，仍可查看和练习，但不计入正确率、错题统计或模拟考试。判断题无可靠结论时不给出强制对错。</p><h3>模拟考试规则</h3><p>题目不重复抽取，题型数量和时长可自定义。各题等权，按正确题数 / 总题数 × 100 计分，60 分及格。多选必须完全一致，未答、少选和多选均不得分。此规则为本站设置，不代表官方考试标准。</p><h3>资料核对来源</h3><ul><li><a target="_blank" rel="noopener" href="https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpbcgr/422e59a0-98c8-4a28-af9f-235a572b6e4d">Microsoft RDP 协议文档</a>：RDP与加密安全层。</li><li><a target="_blank" rel="noopener" href="https://www.nist.gov/publications/guide-intrusion-detection-and-prevention-systems-idps">NIST IDS/IPS 指南</a>：检测与主动阻断的区别。</li><li><a target="_blank" rel="noopener" href="https://www.ghxrd.gov.cn/zlk_0/zcfg/202511/t20251110_229733.html">2025 年修正的《网络安全法》</a>：使用现行法律核对，原资料可能采用旧版口径。</li><li><a target="_blank" rel="noopener" href="https://www.cac.gov.cn/2017-06/27/c_1121220113.htm">2017 年《国家网络安全事件应急预案》</a>：原题七类分类所用口径。</li></ul><h3>待核实题清单（'+pending.length+' 道）</h3><div class="review-options">'+pending.map(q=>'<div><button class="quiet" data-open-question="'+q.id+'">'+escapeHTML(q.source.sheet)+' 第 '+q.source.row+' 行</button> '+escapeHTML(q.prompt)+'</div>').join("")+'</div><h3>学习记录</h3><p>进度、错题和最近 100 次考试保存在当前浏览器中。模拟考试使用截止时间计时，刷新、切换页面或关闭浏览器不会暂停考试。浏览器清理站点数据后记录会消失。</p><button class="secondary" data-action="exportRecords">导出学习记录</button> <button class="quiet" data-action="clearRecords">清空学习记录</button></article>';
}
function resetFilters(){$("#typeFilter").value="";$("#categoryFilter").value="";$("#searchInput").value="";$("#orderFilter").value="random";state.lastQuestion=null;save();view="practice";setView("practice");}
async function handleAction(action){
  if(action==="prev"||action==="next"){moveQuestion((view==="exam"?state.activeExam?.index:index)+(action==="prev"?-1:1));return;}
  if(action==="check"){
    const q=pool[index],p=practice.get(q.id);if(q.scored&&!p.selected.length){toast("请先选择答案。");return;}
    p.checked=true;recordAttempt(q,p.selected,"practice");save();statUpdate();renderPractice();
  }else if(action==="retry"){practice.set(pool[index].id,{selected:[],checked:false});renderPractice();}
  else if(action==="reshuffle"){practice.clear();$("#orderFilter").value="random";updatePool(true);index=0;renderPractice();toast("题目顺序已重新打乱。");}
  else if(action==="resetFilters")resetFilters();
  else if(action==="startExam")startExam();
  else if(action==="submitExam")await requestSubmit();
  else if(action==="reviewAll"||action==="reviewWrong"){reviewWrongOnly=action==="reviewWrong";renderResult();}
  else if(action==="newExam"){result=null;renderExam();}
  else if(action==="goExam"){result=null;setView("exam");}
  else if(action==="exportRecords"){
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="网安复习记录-"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }else if(action==="clearRecords"){
    if(await confirmAction("清空学习记录","将删除当前浏览器中的练习进度、错题、考试记录和正在进行的考试。此操作不能撤销。")){
      state={version:1,records:{},history:[],activeExam:null,lastQuestion:null};practice.clear();result=null;save();statUpdate();renderAbout();toast("学习记录已清空。");
    }
  }
}
document.addEventListener("click",event=>{
  const btn=event.target.closest("button");if(!btn||btn.disabled)return;
  if(btn.dataset.view){if(btn.dataset.view==="exam")result=null;setView(btn.dataset.view);}
  else if(btn.dataset.option!==undefined)choose(Number(btn.dataset.option));
  else if(btn.dataset.jump!==undefined)moveQuestion(Number(btn.dataset.jump));
  else if(btn.dataset.action)handleAction(btn.dataset.action);
  else if(btn.dataset.preset)applyPreset(btn.dataset.preset);
  else if(btn.dataset.history){result=state.history.find(h=>h.id===btn.dataset.history);reviewWrongOnly=false;setView("exam");}
  else if(btn.dataset.openQuestion){resetFilters();const i=pool.findIndex(q=>q.id===btn.dataset.openQuestion);moveQuestion(i);const q=pool[i];practice.set(q.id,{selected:[],checked:true});renderPractice();}
});
$("#resumeExam").addEventListener("click",()=>{result=null;setView("exam");});
["typeFilter","categoryFilter","orderFilter"].forEach(id=>$("#"+id).addEventListener("change",()=>{updatePool(true);index=0;renderPractice();}));
let searchTimeout;$("#searchInput").addEventListener("input",()=>{clearTimeout(searchTimeout);searchTimeout=setTimeout(()=>{updatePool(true);index=0;renderPractice();},180);});
window.addEventListener("hashchange",()=>{const v=location.hash.slice(1);if(["practice","wrong","exam","history","about"].includes(v)&&v!==view)setView(v);});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)updateTimer();});
async function init(){
  try{
    const response=await fetch("questions.json");if(!response.ok)throw Error("HTTP "+response.status);
    questions=await response.json();if(!Array.isArray(questions)||questions.length!==236)throw Error("题库不完整");
    byId=new Map(questions.map(q=>[q.id,q]));loadState();
    if(state.activeExam && (!Array.isArray(state.activeExam.ids)||state.activeExam.ids.some(id=>!byId.has(id)||!byId.get(id).scored)||!Number.isFinite(state.activeExam.deadline))){state.activeExam=null;save();}
    [...new Set(questions.map(q=>q.category))].forEach(category=>{const o=document.createElement("option");o.value=category;o.textContent=category;$("#categoryFilter").append(o);});
    if(state.activeExam && Date.now()>=state.activeExam.deadline)finishExam(true);
    const initial=location.hash.slice(1);setView(["practice","wrong","exam","history","about"].includes(initial)?initial:"practice");
    setInterval(updateTimer,500);registerTools();
  }catch(e){
    $("#questionPanel").innerHTML='<div class="error-screen"><h2>题库加载失败</h2><p>请通过本地网址打开本站，并确认 questions.json 文件存在。</p><p>'+escapeHTML(e.message)+'</p><button class="primary" onclick="location.reload()">重新加载</button></div>';
  }
}
function registerTools(){
  if(!document.modelContext?.registerTool)return;
  const controller=new AbortController();
  const tools=[
    {name:"read_study_progress",title:"查看复习进度",description:"读取本地已练习题数、错题数和可计分题量，不修改状态。",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({total:questions.length,scored:questions.filter(q=>q.scored).length,practiced:Object.keys(state.records).length,wrong:Object.values(state.records).filter(r=>r.lastCorrect===false).length,activeExam:Boolean(state.activeExam)})},
    {name:"navigate_practice_question",title:"打开练习题",description:"按稳定题目ID打开对应练习题，不提交答案。",inputSchema:{type:"object",properties:{questionId:{type:"string"}},required:["questionId"],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{if(!input||typeof input.questionId!=="string"||!byId.has(input.questionId))throw Error("无效题目ID");resetFilters();moveQuestion(pool.findIndex(q=>q.id===input.questionId));return {questionId:input.questionId,view:"practice"};}}
  ];
  for(const tool of tools){try{Promise.resolve(document.modelContext.registerTool(tool,{signal:controller.signal})).catch(()=>{});}catch(e){}}
  window.addEventListener("pagehide",()=>controller.abort(),{once:true});
}
init();
