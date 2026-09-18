'use strict';
// Prototype-only configuration and release history; resets on reload.
const styleOptions = {
  tone: ['面试官表达', ['温和鼓励', '专业中立', '简洁直接']],
  focus: ['考察倾向', ['均衡考察', '基础原理优先', '项目深挖', '业务场景优先']],
  depth: ['追问策略', ['逐步引导', '标准递进', '深入挑战']],
  detail: ['反馈详略', ['简明要点', '详细分析']]
};
const stylePresets = {
  基础巩固: {tone:'温和鼓励',focus:'基础原理优先',depth:'逐步引导',detail:'详细分析'},
  标准面试: {tone:'专业中立',focus:'均衡考察',depth:'标准递进',detail:'简明要点'},
  项目深挖: {tone:'简洁直接',focus:'项目深挖',depth:'深入挑战',detail:'详细分析'}
};
let defaultStyle = {...stylePresets.标准面试};
let sessionStyle = {...defaultStyle};
const promptCatalog = [
  ['P01','简历理解','导入简历后','resume_text','提取经历、技术栈、项目、职责和成果。区分明确事实与推断，信息不确定时标记待确认，不补写经历。'],
  ['P02','目标岗位分析','确认岗位或导入 JD 后','job_description, target_level','提取岗位能力、技术重点与目标级别要求。没有 JD 时标记为通用岗位建议，不冒充具体公司的招聘标准。'],
  ['P03','需求澄清与方向推荐','面试准备对话中','resume_profile, job_profile, preferences','根据简历和岗位推荐可多选的技术方向，说明理由。信息不足时提出必要的澄清问题，区分已有经验与希望补强。'],
  ['P04','面试大纲规划','用户确认准备配置后','resume_profile, job_profile, session_config','围绕目标级别、时长和选定方向规划面试。按自我介绍、技术、业务、个人递进，给出考察目标、主问题及衔接依据。'],
  ['P05','自我介绍后调整','自我介绍提交后','introduction, outline, resume_profile','识别新的项目、技术和个人贡献线索。只调整未开始的问题，输出修改理由。确认或自动应用由系统按面试模式执行。'],
  ['P06','主问题生成','进入新问题时','outline_node, conversation_history','承接已有回答生成当前主问题，一次只考察一个核心问题，不重复已覆盖内容，不提前泄露答案。'],
  ['P07','回答评价','每轮回答提交后','question, answer, rubric, assistance_history','根据问题与级别评价回答，提供原文证据、判断依据与不确定性。未考察维度不计零分，区分首次表现与辅导后表现。'],
  ['P08','追问决策与生成','回答分析后','answer, outline, followup_history, remaining_budget','综合简历、大纲和回答，决定澄清、深入原理、讨论边界、迁移场景或结束。通常追问三至四次，依据回答质量和预算调整。'],
  ['P09','辅导与答案优化','陪练每轮结束或复盘时','answer, evaluation, resume_profile','指出问题并给出可执行的优化建议。示范表达只能基于真实经历，不编造成果。不得提前泄露后续追问的答案。'],
  ['P10','整场复盘报告','面试结束后','interview_history, evaluations, coverage','汇总能力表现、薄弱项、回答证据与后续练习建议。区分未考察项、重答和获得提示后的表现，不推断未验证的编码能力。']
];
const promptRecords = Object.fromEntries(promptCatalog.map(([id,, , ,text])=>[id,{
  draft:text,saved:text,tested:null,published:text,history:[{version:1,text,action:'初始示例版本'}]
}]));
let selectedPrompt='P08';
let lockedPromptVersions=null;
let lockedStyle=null;
function styleFields(config, scope){
  return `<div class="fields">${Object.entries(styleOptions).map(([key,[label,options]])=>`<label class="field">${label}<select data-style="${key}" data-scope="${scope}">${options.map(value=>`<option ${config[key]===value?'selected':''}>${value}</option>`).join('')}</select></label>`).join('')}</div>`;
}
function stylePanel(){
 return `<section class="card" style="margin-bottom:20px"><div class="row between"><div><h2>面试风格</h2><p class="subtitle">设置默认偏好，每场开始前还可以单独调整。</p></div>${tag('普通用户设置','blue')}</div><div class="choice" style="margin:20px 0">${Object.keys(stylePresets).map(name=>btn(name,`preset:${name}`)).join('')}</div>${styleFields(defaultStyle,'default')}<div class="notice">表达风格不改变评分标准。模拟面试中，逐步引导仅表示分解问题，不提供答案提示。</div><div class="actions">${btn('保存默认偏好（演示）','save-style','primary')}</div></section>`;
}
function sessionStylePanel(){
 return `<section class="card" style="margin:0 auto 22px;max-width:890px"><h3>本场面试风格</h3>${styleFields(sessionStyle,'session')}<small>只影响本场配置。示例题目与评分固定，不随风格调用模型生成。</small></section>`;
}
function lockConfiguration(){
 lockedPromptVersions=Object.fromEntries(promptCatalog.map(([id])=>[id,promptRecords[id].history.at(-1).version]));
 lockedStyle={...sessionStyle};
}
function adminPage(){
 const [id,name,trigger,variables]=promptCatalog.find(row=>row[0]===selectedPrompt);
 const record=promptRecords[id];
 return `${heading('ADMIN / PROMPT WORKSPACE','提示词管理','管理员视角演示 · 无真实权限认证，所有修改刷新后重置。',btn('返回用户设置','nav:settings'))}
 <div class="notice amber" style="margin-bottom:20px">本页是管理后台原型入口，不代表普通用户可以进入真实后台。正式产品须由服务端校验管理员权限。</div>
 <div class="admin-grid"><aside class="card prompt-list"><h3>任务模板 · 10</h3>${promptCatalog.map(([key,label])=>btn(`<small>${key}</small> ${label}`,`prompt:${key}`,key===id?'active':'')).join('')}</aside>
 <section class="card"><div class="row between"><div><div class="eyebrow">${id} / TASK TEMPLATE</div><h2>${name}</h2></div>${tag('已发布 v'+record.history.at(-1).version,'green')}</div><p class="subtitle">触发时机：${trigger}</p>
 <div class="review-path">${variables.split(', ').map(v=>`<span>${esc(v)}</span>`).join('')}</div>
 <label class="field">任务提示词草稿<textarea id="prompt-editor" style="min-height:225px" data-prompt-editor>${esc(record.draft)}</textarea></label>
 <div class="notice">系统自动注入上方上下文。权限、模式隔离与输出结构校验属于程序约束，不能通过此处修改。</div>
 <div class="actions">${btn('保存草稿','save-prompt')}${btn('示例测试（演示）','test-prompt')}${btn('发布新版本（演示）','publish-prompt','primary',record.tested!==record.draft||record.saved!==record.draft?'disabled':'')}</div>
 <p id="draft-status" class="subtitle" style="margin-top:12px">${record.draft!==record.saved?'有未保存修改':record.tested===record.draft?'本草稿已完成演示检查，可模拟发布':'草稿已保存，尚未测试'}</p>
 ${record.tested===record.draft?`<div class="update"><h3>示例测试结果 · 流程演示</h3><p>示例输入：Java 中级 / 订单项目 / 回答未说明多实例边界。</p><p>将此草稿、风格规则和上下文组合交给对应任务处理。</p><p><b>未调用模型。</b>这里只检查草稿非空并演示发布门槛，不代表提示词质量测试通过。</p></div>`:''}
 </section><aside class="stack"><section class="card"><h3>发布记录</h3>${[...record.history].reverse().map((v,index)=>`<div class="list-row"><div><b>v${v.version}</b><p>${v.action}</p></div>${index===0?tag('当前','green'):btn('回滚至此',`rollback:${v.version}`)}</div>`).join('')}<p class="subtitle" style="margin-top:18px">回滚会创建一个新版本，保留完整历史。</p></section><section class="card"><h3>本场版本锁定</h3><p class="subtitle">${lockedPromptVersions?`已开始的面试使用 ${id} v${lockedPromptVersions[id]}。新发布不会改变这场面试。`:'尚未开始面试。开始时固定全部任务模板版本与风格配置。'}</p></section><section class="card"><h3>规则管理范围</h3><p class="subtitle">风格规则映射与评价量表已纳入需求，编辑界面下一轮细化；本版先评审任务模板的发布流程。</p></section></aside></div>`;
}
document.addEventListener('change',event=>{
 const {style,scope}=event.target.dataset;
 if(style){(scope==='session'?sessionStyle:defaultStyle)[style]=event.target.value;}
});
document.addEventListener('input',event=>{
 if(!event.target.hasAttribute('data-prompt-editor'))return;
 const record=promptRecords[selectedPrompt];record.draft=event.target.value;record.tested=null;
 const publish=document.querySelector('[data-action="publish-prompt"]');if(publish)publish.disabled=true;
 const status=document.querySelector('#draft-status');if(status)status.textContent='草稿已修改，请保存并重新测试。';
});
function handlePromptAction(action,value){
 const record=promptRecords[selectedPrompt];
 switch(action){
  case'preset':defaultStyle={...stylePresets[value]};break;
  case'save-style':notify('默认偏好已保存在本页内存；刷新后重置。');break;
  case'prompt':selectedPrompt=value;break;
  case'save-prompt':if(!record.draft.trim()){notify('提示词不能为空。');return true;}record.saved=record.draft;record.tested=null;notify('草稿已保存（演示）。');break;
  case'test-prompt':if(!record.draft.trim()||record.draft!==record.saved){notify('请先保存非空草稿再测试。');return true;}record.tested=record.draft;notify('仅完成演示检查，未请求模型。');break;
  case'publish-prompt':if(record.tested!==record.draft||record.saved!==record.draft){notify('请保存并重新测试当前草稿。');return true;}record.published=record.draft;record.history.push({version:record.history.at(-1).version+1,text:record.draft,action:'发布草稿（演示）'});record.tested=null;notify('已模拟发布；仅影响之后开始的面试。');break;
  case'rollback':{const previous=record.history.find(x=>x.version===Number(value));if(!previous)return true;record.published=previous.text;record.saved=previous.text;record.draft=previous.text;record.tested=null;record.history.push({version:record.history.at(-1).version+1,text:previous.text,action:`回滚自 v${previous.version}（演示）`});notify('已模拟回滚，历史记录已保留。');break;}
  default:return false;
 }
 render();return true;
}
