import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const src=path.join(path.dirname(fileURLToPath(import.meta.url)),'verified_snapshots');
const dest=path.join(path.dirname(src),'..','outputs');
await fs.mkdir(dest,{recursive:true});
const dat=JSON.parse(await fs.readFile(src+'/logic_b_all_instruments.json','utf8'));
const rows=dat.rows,S=dat.summary;
const book=Workbook.create();
const sheets=['扫描总览','沪深京A股全量','可转债全量','ETF与指数','异常观察池','十八类策略覆盖','数据质量审计'];
sheets.forEach(n=>book.worksheets.add(n));
const sh=Object.fromEntries(sheets.map(n=>[n,book.worksheets.getItem(n)]));
const navy='#193A56',blue='#2D6683',sub='#65798B',red='#A52A39';
function top(s,t,d){s.showGridLines=false;s.getRange('A2').values=[[t]];s.getRange('A2').format.font={size:17,bold:true,color:navy};s.getRange('A2').format.rowHeight=34;s.getRange('A3').values=[[d]];s.getRange('A3').format.font={size:10,italic:true,color:sub};}
function header(s,r){const x=s.getRange(r);x.format.fill=blue;x.format.font={size:10,bold:true,color:'#FFFFFF'};x.format.rowHeight=48;x.format.wrapText=true;}
const astock=rows.filter(x=>x.asset==='A股');
const cb=rows.filter(x=>x.asset==='可转债');
const other=rows.filter(x=>!['A股','可转债'].includes(x.asset));
const alerts=rows.filter(x=>(x.asset==='A股'||x.asset==='可转债')&&x.signals.length).sort((a,b)=>b.attention_score_not_value-a.attention_score_not_value||a.code.localeCompare(b.code));
function cellRows(list,full=false){return list.map((x,i)=>[
 i+1,x.code,x.name,x.asset,x.open,x.high,x.low,x.close,x.prev_close,x.return_1d,x.return_5d,x.drawdown_20d,
 x.volume_shares,x.amount_yuan,x.turnover_pct==null?null:x.turnover_pct/100,x.volume_ratio_5d,x.below_one_consecutive_observed,x.signals.join('；'),
 x.attention_score_not_value,x.fair_value,x.mispricing_pct,x.mispricing_evidence,
 full?'20日已核收盘及成交量；退市/司法/清偿价值单独核查':x.source
]);}
const fields=['序号','代码','名称（当前主数据）','券种','11/18开盘','最高','最低','收盘','11/17收盘','单日收益率','近5日收益率','20日最大价差回撤','成交量（股）','成交额（元）','换手率','成交量/前5日均量','连续低于1元观察天数','异常标签（零门禁）','注意强度（非价值评分）','合理价值（未核）','错价幅度（未核）','定价错误原因/反证','数据说明'];
function detail(sheet,list,description){
 const s=sh[sheet];top(s,`逻辑B｜${sheet}`,description);
 s.getRange('A5:W5').values=[fields];header(s,'A5:W5');
 const v=cellRows(list,true);if(v.length)s.getRangeByIndexes(5,0,v.length,23).values=v;
 s.getRange('A:A').format.columnWidth=10;s.getRange('B:D').format.columnWidth=19;s.getRange('E:L').format.columnWidth=18;
 s.getRange('M:N').format.columnWidth=23;s.getRange('O:Q').format.columnWidth=21;s.getRange('R:R').format.columnWidth=71;
 s.getRange('S:U').format.columnWidth=21;s.getRange('V:W').format.columnWidth=69;
 if(v.length){s.getRangeByIndexes(5,9,v.length,3).setNumberFormat('0.00%');s.getRangeByIndexes(5,14,v.length,1).setNumberFormat('0.00%');s.getRangeByIndexes(5,4,v.length,5).setNumberFormat('0.000');s.getRangeByIndexes(5,15,v.length,1).setNumberFormat('0.00');}
 s.freezePanes.freezeRows(5);s.freezePanes.freezeColumns(3);
}
detail('沪深京A股全量',astock,'保留全部5580只证券；观察信号仅代表异常，所有价值栏留空待证据核验。');
detail('可转债全量',cb,'258条可转债行情；债价异常不代表债券便宜，转股条款/债底/到期回收尚待接入。');
detail('ETF与指数',other,'保留ETF与指数等其余证券，供情绪与系统性错杀对照；不把它们误当普通A股。');
{
 const s=sh['扫描总览'];top(s,'逻辑B｜屎坑找肉 · 完整日K底座','2026-11-18收盘；20个交易日逐日快照，证券全保留、风险只打标签；无证券进入/剔除门禁。');
 s.getRange('A5:C5').values=[['核心指标','结果','说明']];header(s,'A5:C5');
 const m=[
 ['原始证券行情',rows.length,'11/18 全市场日K，来源369授权接口'],
 ['A股证券数',astock.length,'沪深京股票全量行情'],
 ['A股当日有成交',S.a_traded,'成交量大于0'],
 ['A股当日零成交',S.a_zero_volume,'保留为停牌/零成交观察'],
 ['可转债证券数',cb.length,'转债日K；不代表具备转债完整条款信息'],
 ['ETF和指数/其他',other.length,'不算进A股分母'],
 ['完成的连续交易日窗口',S.days_obtained,'2026-10-22至2026-11-18；近20日'],
 ['收盘低于1元的A股',S.a_under1,'其中包含当日零成交股票'],
 ['收盘低于1元且当日有成交',S.a_under1_traded,'不等于全部满足退市风险计数条件'],
 ['ST名称标识',S.a_st_name,'按当前主数据名称判断，非完整历史ST事件库'],
 ['单日跌幅达到7%的A股',S.a_down7,'异常观察，不等于被错杀'],
 ['量能≥前5日均量2倍',S.a_volume_shock,'异常观察；分母不足时保留未知'],
 ['带异常信号的A股',S.a_observation_codes,'所有股票仍在全量表'],
 ['带异常信号的可转债',S.cb_observation_codes,'所有转债仍在全量表'],
 ['企业/债券合理价值',null,'未测：需要负债结构、财报、资产清偿、条款与概率'],
 ['交易所信用债逐券全量',null,'本API的9,330条不包含交易所信用债完整面板']
 ];
 s.getRange('A6:C21').values=m;s.getRange('A:A').format.columnWidth=38;s.getRange('B:B').format.columnWidth=21;s.getRange('C:C').format.columnWidth=101;s.getRange('A6:C21').format.rowHeight=33;s.getRange('C6:C21').format.wrapText=true;
 s.getRange('A24').values=[['判决：行情层已验证可用；错价层和信用债清偿价值尚缺。异常标签不构成买卖建议。']];s.getRange('A24').format.font={bold:true,size:12,color:red};s.tabColor='#1B708B';
}
{
 const s=sh['异常观察池'];top(s,'异常观察池｜不是股票白名单','A股与可转债全部保留在各自全量表；本页只是为了优先安排研究，按异常线索强弱排序。');
 s.getRange('A5:W5').values=[fields];header(s,'A5:W5');
 const v=cellRows(alerts,true);if(v.length)s.getRangeByIndexes(5,0,v.length,23).values=v;
 s.getRange('A:A').format.columnWidth=10;s.getRange('B:D').format.columnWidth=18;s.getRange('E:L').format.columnWidth=19;s.getRange('M:Q').format.columnWidth=22;s.getRange('R:R').format.columnWidth=72;s.getRange('S:U').format.columnWidth=20;s.getRange('V:W').format.columnWidth=74;
 if(v.length){s.getRangeByIndexes(5,9,v.length,3).setNumberFormat('0.00%');s.getRangeByIndexes(5,14,v.length,1).setNumberFormat('0.00%');}
 s.freezePanes.freezeRows(5);s.tabColor='#B9862A';
}
{
 const s=sh['十八类策略覆盖'];top(s,'十八类策略｜字段级证据完成度','价格、量能、收益仅揭示异常；基本面、司法和债权价值未取得的部分一律标缺。');
 const vals=[
 ['A1','短线情绪错杀','20日价量、1日/5日收益、跌停事件','题材核心身份、盘口与消息反证'],
 ['A2','流动性踩踏','当日成交量/额与5日量能比','融资平仓、赎回、盘口深度'],
 ['A3','利空误读','可观察急跌','公告原文与影响金额'],
 ['A4','被动资金抛售','量价可见','指数基金持仓及调仓明细'],
 ['B1','ST摘帽','当前名称ST标签','公告时点、审计、撤警示条件'],
 ['B2','面值保卫战','20日逐日收盘、成交状态、连续低于1元观察天数','交易所官方退市计数和救助资金执行'],
 ['B3','退市风险解除','价格与ST当前标签','所有财务/审计/合规门槛'],
 ['B4','监管诉讼修复','价格冲击可见','监管文书和赔偿敞口'],
 ['C1','司法重整','价格、短期趋势','法院计划、债权结构、完全稀释股本'],
 ['C2','债务化解','价格修复信号','债权人实缴/债务注销/现金流'],
 ['C3','行业周期反转','20日价格和成交量','季度财报及供需价格'],
 ['C4','资产处置释放','价格异动','协议对价/税费/交割进度'],
 ['D1','高收益信用债','未覆盖全部交易所信用债','逐券基本资料、YTM和现金流'],
 ['D2','违约债权回收','未覆盖违约债权','司法受偿优先级与回收时间'],
 ['D3','困境可转债','258只转债OHLCV、跌幅、成交量','转股价、债底、赎回/回售、评级'],
 ['E1','并购与控制权变化','价格和成交异动','收购公告、支付安排与批准状态'],
 ['E2','回购增持','量价异动','回购/增持真实成交公告'],
 ['E3','解禁与供给冲击','量价异常','解禁股权和股东减持行为']
 ];
 s.getRange('A5:D5').values=[['编号','策略','已接入字段','仍然缺少的关键证据']];header(s,'A5:D5');s.getRange('A6:D23').values=vals;s.getRange('A:A').format.columnWidth=12;s.getRange('B:B').format.columnWidth=31;s.getRange('C:D').format.columnWidth=87;s.getRange('A6:D23').format.rowHeight=38;s.getRange('C6:D23').format.wrapText=true;s.tabColor='#778AAA';
}
{
 const s=sh['数据质量审计'];top(s,'数据质量审计｜不把除息误差当坏数据','全日快照、20日窗口、证券名称类型主数据独立核验；时间戳与缺口如实列出。');
 s.getRange('A5:D5').values=[['项目','结果','解释','来源']];header(s,'A5:D5');
 const items=[
 ['行情日','2026-11-18','15:00收盘后历史日K，不使用19日盘中价','369 /day_kline?date=2026-11-18'],
 ['原始行情行',9330,'证券总记录，非只有A股','369授权响应'],
 ['A股核验',5580,'5,573成交、7零成交，与市场宽度数据相符','369 + 打板客'],
 ['可转债',258,'以最新证券类型主数据核对','369 /stock/list'],
 ['连续历史日数',S.days_obtained,'过去20个交易日逐日快照','369 20次按日请求'],
 ['证券主数据页',S.security_master_pages,'计划页数 '+S.security_master_required+'；名称为当前名称，不自动回填历史名称','369 /stock/list'],
 ['收盘差异5只','5条均为11月19日除息','原始18日收盘价高于19日调整昨收','分红实施公告'],
 ['600141兴发集团',0.20,'11/19每股现金派息0.20元','2026-11-19除息公告'],
 ['603043广州酒家',0.15,'11/19每股现金派息0.15元','2026-11-19除息公告'],
 ['603709中源家居',0.049,'11/19每股现金派息0.049元（价差四舍五入）','2026-11-19除息公告'],
 ['603866桃李面包',0.12,'11/19每股现金派息0.12元','2026-11-19除息公告'],
 ['002281光迅科技',0.37,'11/19每股现金派息0.37元','2026-11-19除息公告'],
 ['剩余信用债','未完成','该9,330条证券并非全交易所信用债池','上交所/深交所债券数据'],
 ['真实企业估值','未完成','债务结构、应收偿付和催化剂后续研究','年报、公告、法院/交易所信息']
 ];
 s.getRange('A6:D19').values=items;s.getRange('A:A').format.columnWidth=39;s.getRange('B:B').format.columnWidth=29;s.getRange('C:C').format.columnWidth=101;s.getRange('D:D').format.columnWidth=63;s.getRange('A6:D19').format.rowHeight=35;s.getRange('C6:D19').format.wrapText=true;s.tabColor='#A45A5A';
}
await fs.mkdir(dest,{recursive:true});
const outFile=path.join(dest,'逻辑B_20261118_全量A股与可转债_20交易日核验_V4.xlsx');
const f=await SpreadsheetFile.exportXlsx(book);await f.save(outFile);
console.log('DONE',outFile,JSON.stringify({all:rows.length,a:astock.length,cb:cb.length,other:other.length,alerts:alerts.length}));
