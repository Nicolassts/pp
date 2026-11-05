const $=id=>document.getElementById(id);
const BAT=500,ENV={massa:"Massa",net:"NET / Recheio",dos:"Dosimetria",log:"Logística"},DIAS=["DOM","SEG","TER","QUA","QUI","SEX","SÁB"];
const fmt=n=>n==null||n===""?"":Number(n).toLocaleString("pt-BR",{maximumFractionDigits:0});
const f1=n=>Number(n).toLocaleString("pt-BR",{maximumFractionDigits:1});
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const wd=d=>{const x=new Date(d+"T12:00:00");return isNaN(x)?"":DIAS[x.getDay()]};
const br=d=>d?d.split("-").reverse().join("/"):"";
const ld=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}};
const sv=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
const aiSelect=$("aiProvider");
if(aiSelect){aiSelect.value=ld("kb_ai_provider","gemini");aiSelect.onchange=()=>sv("kb_ai_provider",aiSelect.value)}
async function requestAI(payload){
  const response=await fetch("/api/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...payload,provider:aiSelect?.value||"gemini"})});
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`Falha na API (HTTP ${response.status}).`);
  if(result.provider&&aiSelect&&result.provider!==aiSelect.value){aiSelect.value=result.provider;sv("kb_ai_provider",result.provider)}
  return result.text||""}
let rows=ld("kb_rows",[]),MAP=ld("kb_map",{}),obs=ld("kb_obs",[]),cur="massa",file=null;
const CLI=[
{n:"Hershey’s Io-Iô Duo",r:/\bio[\s-]?io\b.*duo|duo.*\bio[\s-]?io\b/,m:40,c:60,g:1.5},
{n:"Hershey’s Io-Iô",r:/\bio[\s-]?io\b/,m:40,c:60,g:1.5},
{n:"Hershey’s",r:/hershey/,m:35,c:65,g:1},
{n:"Kellogg’s",r:/kellog/,m:50,c:50,g:2},
{n:"Mondelez",r:/mondelez/,m:36,c:64,g:.5},
{n:"Arcor",r:/arcor/,m:40,c:60,g:1.5},
{n:"Neugebauer",r:/neugebauer|\bneu\b/,m:40,c:60,g:1.5},
{n:"Bauducco",r:/bauducco/,m:50,c:50,g:1},
{n:"Nutrimental",r:/nutrimental/,m:35,c:65,g:1},
{n:"Vitao",r:/vitao/,m:70,c:30,g:.5}];
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const cliOf=s=>{const k=norm(s),m=MAP[k];return CLI.find(c=>m?c.n===m:c.r.test(k))};

/* cálculo: meta do dia dividida por 3 turnos */
function calc(r,k){const p=+r.plan||0;if(!p)return null;const c=cliOf(r.sku);let pct=1,mg=0;
  if(k!=="log"){if(!c)return null;pct=(k==="net"?c.c:c.m)/100;mg=c.g/100}
  const dia=p*pct;return{c,pct,mg,dia,min:p*(pct-mg),max:p*(pct+mg),t:dia/3,bat:k==="massa"?dia/BAT:null,batT:k==="massa"?dia/BAT/3:null}}
const ext=k=>k==="massa";
const head=k=>["Data","Dia","Produto","Plano dia (kg)","%","Meta dia (kg)","Faixa aceitável (kg)","1º turno","2º turno","3º turno",...(ext(k)?["Bateladas/dia"]:[]),"Observação","Real (kg)"];
function body(r,k){const x=calc(r,k),T=x?(k==="massa"?" · "+f1(x.batT)+" bat":""):"";
  return[br(r.data),wd(r.data),r.sku,fmt(r.plan),x?f1(x.pct*100)+"%"+(x.mg?" ±"+f1(x.mg*100):""):(r.plan?"sem padrão":""),x?fmt(x.dia):"",x&&x.mg?fmt(x.min)+" – "+fmt(x.max):"",...[0,1,2].map(()=>x?fmt(x.t)+" kg"+T:""),...(ext(k)?[x?f1(x.bat):""]:[]),r.obs,""]}
const sel=()=>rows.filter(r=>(r.plan||r.obs)&&inRange(r)&&inLinha(r)).sort((a,b)=>a.linha-b.linha||String(a.data).localeCompare(b.data));
const byLine=()=>{const g={};sel().forEach(r=>(g[r.linha]=g[r.linha]||[]).push(r));return g};
function tl(L,rs,k){let t=0,b=0;rs.forEach(r=>{const x=calc(r,k);if(x){t+=x.dia;b+=x.bat||0}});return"Total Linha "+L+": "+fmt(t)+" kg"+(k==="massa"?" · "+f1(b)+" bateladas":"")}

function viewDoc(){const k=cur,g=byLine(),ls=Object.keys(g),pd=pend(),ok=skus().length>0&&!pd.length;["pdf1","pdfA","csv","csvI"].forEach(i=>$(i).disabled=!ok);
  if(!ok){$("tabs").innerHTML="";$("dv").innerHTML=skus().length?`<div class="alert"><b>Cole a receita padrão de todos os produtos identificados para gerar os documentos.</b><br>Faltam: ${pd.map(esc).join("; ")}</div>`:'<p class="sub">Leia a foto do planejamento para identificar os produtos.</p>';return}
  $("tabs").innerHTML=Object.entries(ENV).map(([a,n])=>`<button class="${a===k?"on":""}" data-k="${a}">${n}</button>`).join("");
  
  $("dv").innerHTML=ls.length?ls.map(L=>`<div class="band">Linha ${L}</div><div class="wrap"><table><thead><tr>${head(k).map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${g[L].map(r=>`<tr class="${r.plan?"":r.obs?"ev":"off"}">${body(r,k).map(c=>`<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="sub"><b>${tl(L,g[L],k)}</b></p>`).join(""):'<p class="sub">Nenhum dia com produção no intervalo escolhido.</p>';$("dv").innerHTML+=insHTML(k)}
$("tabs").onclick=e=>{const k=e.target.dataset.k;if(k){cur=k;document.querySelectorAll("#psel input").forEach(c=>c.checked=c.value===k);viewDoc()}};

function renderSum(){const rs=rows.filter(r=>r.plan),tot=rs.reduce((a,r)=>a+r.plan,0),b=rs.reduce((a,r)=>{const x=calc(r,"massa");return a+(x?x.bat:0)},0);
  const um=[...new Set(rs.filter(r=>r.sku&&!cliOf(r.sku)).map(r=>r.sku.trim()))];
  $("sum").innerHTML=`<div class="kpi"><div>Total planejado<b>${f1(tot/1000)} t</b></div><div>Dias com produção<b>${rs.length}</b></div><div>Bateladas de massa<b>${f1(b)}</b></div><div class="a">Média por turno<b>${rs.length?f1(tot/rs.length/3/1000):0} t</b></div></div>`+
  (um.length?`<div class="alert"><b>${um.length} produto(s) sem padrão na base.</b> Associe a um cliente para calcular massa e recheio:${um.map(s=>`<div class="row"><span style="min-width:200px">${esc(s)}</span><select data-u="${esc(s)}"><option value="">Selecionar cliente…</option>${CLI.map(c=>`<option>${c.n}</option>`).join("")}</select></div>`).join("")}</div>`:"")}
$("sum").onchange=e=>{const s=e.target.dataset.u;if(s&&e.target.value){MAP[norm(s)]=e.target.value;sv("kb_map",MAP);refresh()}};

function renderKits(){const g={};rows.forEach(r=>{if(!r.plan||!r.sku)return;const x=calc(r,"massa"),y=calc(r,"net"),k=r.linha+"|"+r.sku.trim().toUpperCase(),o=g[k]=g[k]||{km:0,kr:0,b:0,c:cliOf(r.sku)};if(x){o.km+=x.dia;o.b+=x.bat}if(y)o.kr+=y.dia});
  const ks=Object.keys(g).sort();$("kempty").hidden=ks.length>0;
  $("kb").innerHTML=ks.map(k=>{const[l,...s]=k.split("|"),o=g[k];return`<tr><td>${l}</td><td>${esc(s.join("|"))}</td><td>${o.c?esc(o.c.n):"<small>sem padrão</small>"}</td><td>${fmt(o.km)}</td><td>${fmt(o.kr)}</td><td><b>${Math.ceil(o.b)}</b></td><td>${f1(o.b/3)}</td></tr>`}).join("")}
function refresh(){sv("kb_rows",rows);viewDoc();renderSum();renderKits();renderRec()}

/* planejamento */
function setFile(f){if(!f||!f.type.startsWith("image/"))return;file=f;const p=$("prev");p.src=URL.createObjectURL(f);p.hidden=false;$("read").disabled=false}
$("drop").onclick=()=>$("file").click();$("file").onchange=e=>setFile(e.target.files[0]);
$("drop").ondragover=e=>e.preventDefault();$("drop").ondrop=e=>{e.preventDefault();setFile(e.dataTransfer.files[0])};
addEventListener("paste",e=>{const it=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith("image/"));if(it)setFile(it.getAsFile())});
async function shrink(f){try{const b=await createImageBitmap(f),s=Math.min(1,1800/Math.max(b.width,b.height)),c=document.createElement("canvas");c.width=Math.round(b.width*s);c.height=Math.round(b.height*s);c.getContext("2d").drawImage(b,0,0,c.width,c.height);return await new Promise(r=>c.toBlob(r,"image/jpeg",.9))||f}catch(e){return f}}
async function imageData(f){const blob=await shrink(f);const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)});return{mimeType:blob.type||"image/jpeg",data}}
$("read").onclick=async()=>{$("read").disabled=true;$("msg").textContent="Lendo a imagem…";
  try{const text=await requestAI({prompt:`Você recebe a foto de um quadro de planejamento de produção com LINHA 1 a LINHA 4 (colunas: dia, data, PLAN, REAL, SKU). Retorne SOMENTE JSON, sem texto extra:
{"periodo":"Outubro/2026","dias":[{"linha":1,"data":"2026-10-16","plan":5000,"sku":"SDV MINI","obs":""}]}
Regras: plan em kg como número (5.000 vira 5000; vazio vira null). Textos escritos na coluna REAL (DESIN, TROCA P/ ..., Ag. Laudo massa, PRODUÇÃO L3, VISITA TÉCNICA) vão em obs. Se um dia está sem SKU, repita o SKU só se estiver escrito. Inclua TODOS os dias de TODAS as linhas, inclusive sábados e domingos. Use o ano do cabeçalho.`,image:await imageData(file)});
    const r=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""));
    rows=(r.dias||[]).map(d=>({linha:+d.linha,data:d.data,plan:d.plan,sku:d.sku||"",obs:d.obs||""}));if(r.periodo)$("periodo").value=r.periodo;
    setRange();render();$("msg").textContent=rows.length+" dias lidos. Cole a receita de cada produto para gerar os documentos."}
  catch(e){$("msg").textContent="Não consegui ler: "+(e.message||e.code||"erro")+". Tente novamente."}finally{$("read").disabled=false}};
function render(){$("tb").innerHTML=rows.map((r,i)=>`<tr class="${r.plan?"":"off"}"><td><input class="n" data-i="${i}" data-k="linha" value="${esc(r.linha)}" style="width:44px"></td><td><input type="date" data-i="${i}" data-k="data" value="${esc(r.data)}"></td><td><input class="n" data-i="${i}" data-k="plan" value="${r.plan??""}"></td><td><input data-i="${i}" data-k="sku" value="${esc(r.sku)}"></td><td><input data-i="${i}" data-k="obs" value="${esc(r.obs)}"></td><td><button class="sec" data-del="${i}">×</button></td></tr>`).join("");
  $("empty").hidden=rows.length>0;$("cnt").textContent=rows.length?"("+rows.length+" dias)":"";refresh()}
$("tb").oninput=e=>{const t=e.target,i=t.dataset.i;if(i==null)return;const k=t.dataset.k;rows[i][k]=k==="plan"?(t.value===""?null:+t.value.replace(/\./g,"").replace(",",".")):k==="linha"?+t.value:t.value;refresh()};
$("tb").onclick=e=>{const d=e.target.dataset.del;if(d!=null){rows.splice(+d,1);render()}};
$("add").onclick=()=>{rows.push({linha:1,data:"",plan:null,sku:"",obs:""});render()};

/* downloads: PDF e CSV */
const toast=t=>{$("dmsg").textContent=t};
const tag=()=>($("periodo").value||"periodo").replace(/[^\w]+/g,"-")+($("d_de").value?"_"+$("d_de").value+"_a_"+$("d_ate").value:"");
async function save(name,data){const blob=data instanceof Blob?data:new Blob([data],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("")}
const q=v=>{v=String(v??"");return/[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
const nz=v=>v==null?"":String(Math.round(v*100)/100).replace(".",",");
$("csv").onclick=()=>{if(!sel().length)return toast("Sem dados para exportar.");
  const L=[["Ambiente","Linha","Data","Dia","Produto","Cliente (padrão)","Plano dia (kg)","% do ambiente","Margem de erro (pp)","Meta dia (kg)","Faixa mín (kg)","Faixa máx (kg)","1º turno (kg)","2º turno (kg)","3º turno (kg)","Bateladas/dia","Bateladas por turno","Status","Observação"].join(";")];
  Object.keys(ENV).forEach(k=>sel().forEach(r=>{const x=calc(r,k);L.push([ENV[k],r.linha,br(r.data),wd(r.data),r.sku,x&&x.c?x.c.n:"",nz(r.plan),x?nz(x.pct*100):"",x?nz(x.mg*100):"",x?nz(x.dia):"",x?nz(x.min):"",x?nz(x.max):"",x?nz(x.t):"",x?nz(x.t):"",x?nz(x.t):"",x&&x.bat!=null?nz(x.bat):"",x&&x.batT!=null?nz(x.batT):"",r.plan?(x?"OK":"Sem padrão"):"Sem produção",r.obs].map(q).join(";"))}));
  save("kanban-"+tag()+".csv","\ufeff"+L.join("\r\n"))};

const AC=[217,154,30],PR=[36,71,106];
function pdfEnv(d,k){const W=d.internal.pageSize.getWidth(),H=d.internal.pageSize.getHeight(),g=byLine();
  d.setFillColor(22,34,46);d.rect(0,0,W,56,"F");d.setFillColor(...AC);d.rect(0,56,W,3,"F");
  d.setTextColor(255);d.setFont("helvetica","bold");d.setFontSize(16);d.text(ENV[k]+" - Plano de produção",32,28);
  d.setFont("helvetica","normal");d.setFontSize(9);d.text($("periodo").value+($("d_de").value?" ("+br($("d_de").value)+" a "+br($("d_ate").value)+")":"")+"  |  meta do dia dividida por 3 turnos  |  gerado em "+new Date().toLocaleString("pt-BR"),32,44);
  let y=78;
  Object.keys(g).forEach(L=>{const rs=g[L];if(y>H-120){d.addPage();y=40}
    d.setTextColor(23,33,43);d.setFont("helvetica","bold");d.setFontSize(11);d.text("Linha "+L,32,y);
    d.autoTable({startY:y+6,head:[head(k)],body:rs.map(r=>body(r,k)),theme:"striped",margin:{left:32,right:32},styles:{fontSize:7.5,cellPadding:3,lineColor:[211,218,226],lineWidth:.3,textColor:[23,33,43]},headStyles:{fillColor:PR,textColor:255},alternateRowStyles:{fillColor:[245,247,250]},didParseCell:h=>{if(h.section==="body"&&!rs[h.row.index].plan)h.cell.styles.textColor=[120,130,140]}});
    y=d.lastAutoTable.finalY+14;d.setFont("helvetica","bold");d.setFontSize(9);d.setTextColor(23,33,43);d.text(tl(L,rs,k),32,y);y+=24});
  insumos(k).forEach(b=>{if(y>H-140){d.addPage();y=40}d.setTextColor(23,33,43);d.setFont("helvetica","bold");d.setFontSize(11);d.text("Receita - "+b.nome,32,y);d.setFont("helvetica","normal");d.setFontSize(8.5);d.text(b.resumo,32,y+11);d.autoTable({startY:y+16,head:[INSH],body:b.items.map(insRow),theme:"striped",margin:{left:32,right:32},styles:{fontSize:7.5,cellPadding:3,lineColor:[211,218,226],lineWidth:.3,textColor:[23,33,43]},headStyles:{fillColor:PR,textColor:255},alternateRowStyles:{fillColor:[245,247,250]}});y=d.lastAutoTable.finalY+24});
  if(!Object.keys(g).length){d.setTextColor(23,33,43);d.setFontSize(11);d.text("Sem dados de planejamento.",32,y)}
  /* melhoria contínua */
  d.addPage();d.setFillColor(...PR);d.rect(0,0,W,40,"F");d.setFillColor(...AC);d.rect(0,40,W,3,"F");
  d.setTextColor(255);d.setFont("helvetica","bold");d.setFontSize(14);d.text("Melhoria contínua - "+ENV[k],32,26);
  d.setTextColor(23,33,43);d.setFont("helvetica","normal");d.setFontSize(9);
  d.text("Ciclo PDCA: Planejar (meta e faixa aceitável nas páginas anteriores) > Executar > Verificar (real x faixa) > Agir (causa raiz e ação).",32,62);
  const o=oee();d.text(o.O!=null?`Indicadores do período: OEE ${pc(o.O)} | Disponibilidade ${pc(o.A)} | Desempenho ${pc(o.P)} | Qualidade ${pc(o.Q)} | Paradas ${f1(o.par)} h`:"Indicadores: lance a produção real e as ocorrências no site para preencher o OEE.",32,76);
  const lin=obs.map(x=>[br(x.d)+" / "+x.t+" turno / L"+x.l,x.c+": "+x.x+(x.m?" ("+x.m+" min)":"")+(x.k?" "+x.k+" kg":""),"","","","",""]);while(lin.length<8)lin.push(["","","","","","",""]);
  d.autoTable({startY:88,head:[["Data / turno / linha","Desvio observado","Causa raiz (5 porquês)","Ação corretiva / preventiva","Responsável","Prazo","Status"]],body:lin,theme:"grid",margin:{left:32,right:32},styles:{fontSize:8,cellPadding:4,minCellHeight:26,lineColor:[211,218,226],lineWidth:.4,textColor:[23,33,43]},headStyles:{fillColor:PR,textColor:255,minCellHeight:18}});
  let z=d.lastAutoTable.finalY+22;d.setFont("helvetica","bold");d.text("Verificação do turno",32,z);d.setFont("helvetica","normal");
  d.text("(   ) Meta dentro da faixa aceitável      (   ) Fora da faixa: registrar desvio      (   ) Ação padronizada      (   ) Escalar à liderança",32,z+16);
  d.text("Líder do turno: ______________________     Data: ____/____/______     Visto: ______________",32,z+42)}
async function savePdf(keys){if(!window.jspdf)return toast("Biblioteca de PDF não carregou. Recarregue a página.");
  if(!sel().length)return toast("Sem dados para gerar o PDF.");
  const d=new window.jspdf.jsPDF({orientation:"landscape",unit:"pt",format:"a4"});keys.forEach((k,i)=>{if(i)d.addPage();pdfEnv(d,k)});
  const n=d.getNumberOfPages(),W=d.internal.pageSize.getWidth(),H=d.internal.pageSize.getHeight();
  for(let i=1;i<=n;i++){d.setPage(i);d.setFontSize(8);d.setTextColor(120);d.text("Kanban de Produção",32,H-14);d.text("Página "+i+" de "+n,W-32,H-14,{align:"right"})}
  save("kanban-"+(keys.length===4?"todos":keys.join("-"))+"-"+tag()+".pdf",d.output("blob"))}
$("pdf1").onclick=()=>{const ks=[...document.querySelectorAll("#psel input:checked")].map(c=>c.value);if(!ks.length)return toast("Marque ao menos um setor.");savePdf(ks)};$("pdfA").onclick=()=>savePdf(Object.keys(ENV));

/* produção: ocorrências, OEE, IA e chat */
const pc=x=>x==null?"–":f1(x*100)+"%";
function oee(){const hp=+$("h_p").value||0,par=obs.reduce((a,o)=>a+(+o.m||0),0)/60,perd=obs.reduce((a,o)=>a+(+o.k||0),0),plan=+$("k_p").value||rows.reduce((a,r)=>a+(+r.plan||0),0),real=+$("k_r").value||0;
  const A=hp?Math.max(0,(hp-par)/hp):null,P=A&&real&&plan?Math.min(1,real/(plan*A)):null,Q=real?Math.max(0,(real-perd)/real):null;return{hp,par,perd,plan,real,A,P,Q,O:A!=null&&P!=null&&Q!=null?A*P*Q:null}}
function kpis(){const o=oee();$("kpi").innerHTML=[["Disponibilidade",o.A],["Desempenho",o.P],["Qualidade",o.Q],["OEE",o.O]].map(([n,v],i)=>`<div class="${i===3?"a":""}">${n}<b>${pc(v)}</b></div>`).join("")+`<div>Paradas<b>${f1(o.par)} h</b></div>`}
["h_p","k_r","k_p"].forEach(i=>$(i).addEventListener("input",kpis));
function renderO(){$("ob").innerHTML=obs.map((o,i)=>`<tr><td>${br(o.d)}</td><td>${esc(o.l)}</td><td>${esc(o.t)}</td><td>${esc(o.c)}</td><td>${fmt(o.m)}</td><td>${fmt(o.k)}</td><td>${esc(o.x)}</td><td><button class="sec" data-o="${i}">×</button></td></tr>`).join("");kpis()}
$("o_add").onclick=()=>{const x=$("o_x").value.trim();if(!x)return;obs.push({d:$("o_d").value,l:$("o_l").value,t:$("o_t").value,c:$("o_c").value,m:+$("o_m").value||0,k:+$("o_k").value||0,x});$("o_x").value="";sv("kb_obs",obs);renderO()};
$("ob").onclick=e=>{const i=e.target.dataset.o;if(i!=null){obs.splice(+i,1);sv("kb_obs",obs);renderO()}};
$("ocsv").onclick=()=>{if(!obs.length)return;save("ocorrencias-"+tag()+".csv","\ufeff"+["Data;Linha;Turno;Tipo;Minutos parados;Kg perdidos;Descrição"].concat(obs.map(o=>[br(o.d),o.l,o.t,o.c,o.m,o.k,o.x].map(q).join(";"))).join("\r\n"))};
const showP=()=>{$("prod").style.display="block";$("prod").scrollIntoView({behavior:"smooth"})};
$("bprod").onclick=showP;$("bchat").onclick=()=>{showP();setTimeout(()=>$("cin").focus(),300)};
function ctx(){const o=oee(),pl=rows.filter(r=>r.plan).slice(0,150).map(r=>`L${r.linha} ${r.data} ${r.sku} plano ${r.plan}kg${r.obs?" obs:"+r.obs:""}`).join("\n");
  return`PERÍODO: ${$("periodo").value}\nOEE: disponibilidade ${pc(o.A)}, desempenho ${pc(o.P)}, qualidade ${pc(o.Q)}, OEE ${pc(o.O)} (horas planejadas ${o.hp}, paradas ${f1(o.par)} h, plano ${fmt(o.plan)} kg, real ${fmt(o.real)} kg, perdas ${fmt(o.perd)} kg)\nOCORRÊNCIAS:\n`+(obs.map(x=>`${x.d} L${x.l} turno ${x.t} | ${x.c} | ${x.m} min | ${x.k} kg | ${x.x}`).join("\n")||"nenhuma lançada")+`\nPLANO:\n`+pl}
$("ana").onclick=async()=>{const out=$("aout");out.hidden=false;if(!obs.length){out.textContent="Lance ao menos uma ocorrência para analisar.";return}
  out.textContent="Analisando…";$("ana").disabled=true;
  try{out.textContent=await requestAI({prompt:`Você é analista de processo industrial (fábrica de massas e recheios, linhas 1 a 4, 3 turnos). Com os dados abaixo, responda em português, direto, com estas seções: 1) PRINCIPAIS PROBLEMAS (Pareto por tempo parado e kg perdidos, por linha e turno); 2) OEE (interprete os números e diga qual fator pesa mais); 3) GEE (use os dados disponíveis; se faltarem dados para calcular, diga exatamente quais lançar); 4) INTERFERÊNCIAS NO PROCEDIMENTO (onde o procedimento está sendo quebrado ou gerando perda); 5) AÇÕES RECOMENDADAS (máx. 5, priorizadas, no formato de melhoria contínua PDCA). Não invente dados.\n\n`+ctx()})}
  catch(e){out.textContent="Falha na análise: "+(e.message||e.code||"erro")}finally{$("ana").disabled=false}};
const hist=[];
function addM(t,u){const d=document.createElement("div");d.className="m"+(u?" u":"");d.textContent=t;$("log").appendChild(d);$("log").scrollTop=1e9;return d}
async function send(){const t=$("cin").value.trim();if(!t)return;$("cin").value="";addM(t,1);
  hist.push({role:"user",content:t});const m=addM("…");
  try{const text=await requestAI({messages:[{role:"user",content:"Você é o assistente de ocorrências do Kanban de Produção. Responda em português, curto e objetivo, só com base nestes dados; se não houver o dado, diga que não há.\n"+ctx()},{role:"assistant",content:"Entendido."},...hist]});m.textContent=text;hist.push({role:"assistant",content:text})}
  catch(e){m.textContent="Falha: "+(e.message||e.code||"erro");hist.pop()}}
$("csend").onclick=send;$("cin").onkeydown=e=>{if(e.key==="Enter")send()};
/* receitas */
const RECS=ld("kb_rec",{});let rcur=null;
const f4=n=>n.toLocaleString("pt-BR",{minimumFractionDigits:4,maximumFractionDigits:4});
const fq=n=>n.toLocaleString("pt-BR",{maximumFractionDigits:n<10?2:1});
const num=s=>{const v=parseFloat(String(s??"").replace(/\./g,"").replace(",","."));return isNaN(v)?null:v};
const skus=()=>{const m=new Map();rows.forEach(r=>{if(r.sku&&r.sku.trim()&&r.plan){const k=norm(r.sku);if(!m.has(k))m.set(k,{key:k,name:r.sku.trim()})}});return[...m.values()]};
function parseRec(t){const it=[];let sec="direto";
  String(t).split(/\r?\n/).forEach(l=>{const c=(l.includes("\t")?l.split("\t"):l.split(/\s{2,}/)).map(x=>x.trim());if(c.length<2)return;
    const cod=c[0],nome=c[1],base=num(c[2]),perda=num(c[5])||0;if(base==null||/reprocesso/i.test(nome))return;
    if(/etiqueta|filme|fita|bobina|display|\bcx\b|caixa|chocolate|embalag|papel/i.test(nome)){it.push({cod,nome,base,perda,sec:"direto"});return}
    if(/massa/i.test(nome)){sec="massa";return}if(/recheio/i.test(nome)){sec="recheio";return}
    it.push({cod,nome,base,perda,sec})});return it}
function renderRec(){const S=skus();$("rc").hidden=!S.length;if(!S.length)return;if(!S.some(s=>s.key===rcur))rcur=S[0].key;
  $("rtabs").innerHTML=S.map(s=>`<button class="${s.key===rcur?"on":""}" data-k="${esc(s.key)}">${esc(s.name)}${(RECS[s.key]||{items:[]}).items.length?" ✓":""}</button>`).join("");
  const R=RECS[rcur]||{txt:"",items:[]};if(document.activeElement!==$("rtxt"))$("rtxt").value=R.txt||"";
  const sm=s=>R.items.filter(i=>i.sec===s),tt=a=>a.reduce((x,i)=>x+i.base,0),bad=s=>sm(s).length&&Math.abs(tt(sm(s))-1)>.01;
  $("rsum").innerHTML=R.items.length?`<div class="kpi" style="margin-top:12px"><div>Insumos da massa<b>${sm("massa").length}</b>soma da base ${f4(tt(sm("massa")))}</div><div>Insumos do recheio<b>${sm("recheio").length}</b>soma da base ${f4(tt(sm("recheio")))}</div><div class="a">Embalagem e outros<b>${sm("direto").length}</b>itens</div></div>`+(bad("massa")||bad("recheio")?`<div class="alert">A soma da base de massa e de recheio deveria dar 1,0000. Confira se a receita foi colada completa.</div>`:""):""}
$("rtabs").onclick=e=>{const k=e.target.dataset.k;if(k){rcur=k;$("rtxt").value=(RECS[k]||{}).txt||"";renderRec()}};
$("rtxt").oninput=e=>{const v=e.target.value;RECS[rcur]={txt:v,items:parseRec(v)};sv("kb_rec",RECS);renderRec();viewDoc()};
$("rclr").onclick=()=>{delete RECS[rcur];sv("kb_rec",RECS);$("rtxt").value="";renderRec();viewDoc()};
function insumosV1(k){return skus().map(s=>{const R=RECS[s.key];if(!R||!R.items||!R.items.length)return null;
  const rs=rows.filter(r=>r.plan&&norm(r.sku)===s.key),nd=new Set(rs.map(r=>r.linha+"|"+r.data)).size||1,secs=k==="massa"?["massa"]:k==="net"?["recheio"]:k==="dos"?["massa","recheio"]:["direto"];
  const items=R.items.filter(i=>secs.includes(i.sec)).map(i=>{let q=0;rs.forEach(r=>{q+=i.sec==="direto"?+r.plan:((calc(r,i.sec==="massa"?"massa":"net")||{}).dia||0)});const tot=q*i.base*(1+i.perda/100);return{...i,pb:i.sec==="direto"?null:i.base*BAT,mt:tot/nd/3,tot}});
  return items.length?{nome:s.name,items}:null}).filter(Boolean)}
const INSH=["Código","Insumo","Base (kg/kg)","Perda","Dia (c/ perda)","1º turno","2º turno","3º turno"];
const insRow=i=>[i.cod,i.nome,f4(i.base),i.perda?f1(i.perda)+"%":"–",fq(i.dia),fq(i.t),fq(i.t),fq(i.t)];
function insHTML(k){return insumos(k).map(b=>`<div class="band">Receita · ${esc(b.nome)} <small>— ${esc(b.resumo)}</small></div><div class="wrap"><table><thead><tr>${INSH.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${b.items.map(i=>`<tr>${insRow(i).map(c=>`<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("")}
$("csvI").onclick=()=>{const L=[["Ambiente","Produto","Código","Insumo","Seção","Base (kg/kg)","Perda %","Por batelada (kg)","Média por turno","Total período c/ perda"].join(";")];
  Object.keys(ENV).forEach(k=>insumos(k).forEach(b=>b.items.forEach(i=>L.push([ENV[k],b.nome,i.cod,i.nome,i.sec,nz(i.base),nz(i.perda),i.pb==null?"":nz(i.pb),nz(i.mt),nz(i.tot)].map(q).join(";")))));
  if(L.length<2)return toast("Cole ao menos uma receita para exportar os insumos.");save("insumos-"+tag()+".csv","\ufeff"+L.join("\r\n"))};
const pend=()=>skus().flatMap(s=>{const m=[];if(!(RECS[s.key]&&RECS[s.key].items.length))m.push("receita");if(!cliOf(s.name))m.push("cliente padrão");return m.length?[s.name+" ("+m.join(" e ")+")"]:[]});
function insumos(k){const out=[],secs=k==="massa"?["massa"]:k==="net"?["recheio"]:k==="dos"?["massa"]:["massa","recheio","direto"];
  sel().forEach(r=>{if(!r.plan)return;const R=RECS[norm(r.sku)];if(!R||!R.items.length)return;const xm=calc(r,"massa"),xn=calc(r,"net");
    const items=R.items.filter(i=>secs.includes(i.sec)).map(i=>{const q=i.sec==="direto"?+r.plan:i.sec==="massa"?(xm?xm.dia:0):(xn?xn.dia:0),dia=q*i.base*(1+i.perda/100);return{...i,nome:k==="log"?i.nome+" ("+i.sec+")":i.nome,dia,t:dia/3,l:r.linha,d:r.data,p:r.sku}});
    if(!items.length)return;
    const rs=k==="massa"&&xm?`Massa do dia ${fmt(xm.dia)} kg = ${f1(xm.bat)} bateladas | por turno ${fmt(xm.t)} kg (${f1(xm.batT)} bat)`:k==="net"&&xn?`Recheio do dia ${fmt(xn.dia)} kg | por turno ${fmt(xn.t)} kg`:k==="dos"&&xm?`Massa do dia ${fmt(xm.dia)} kg | por turno ${fmt(xm.t)} kg`:k==="log"?`Produto do dia ${fmt(r.plan)} kg | tudo que entra na produção (massa, recheio e embalagem), por turno = dia ÷ 3`:"";
    out.push({nome:`Linha ${r.linha} · ${br(r.data)} ${wd(r.data)} · ${r.sku}`,resumo:rs,items})});return out}
$("csvI").onclick=()=>{const L=[["Ambiente","Linha","Data","Produto","Código","Insumo","Origem","Base (kg/kg)","Perda %","Dia c/ perda (kg)","1º turno","2º turno","3º turno"].join(";")];
  Object.keys(ENV).forEach(k=>insumos(k).forEach(b=>b.items.forEach(i=>L.push([ENV[k],i.l,br(i.d),i.p,i.cod,i.nome,i.sec,nz(i.base),nz(i.perda),nz(i.dia),nz(i.t),nz(i.t),nz(i.t)].map(q).join(";")))));
  if(L.length<2)return toast("Sem insumos para exportar.");save("receitas-"+tag()+".csv","\ufeff"+L.join("\r\n"))};
function novaFoto(){file=null;$("prev").hidden=true;$("prev").removeAttribute("src");$("file").value="";$("read").disabled=true;$("msg").textContent="Escolha a nova foto do planejamento.";window.scrollTo({top:0,behavior:"smooth"})}
$("bnew").onclick=novaFoto;
let wt=0;$("wipe").onclick=e=>{const b=e.target;if(!wt){b.textContent="Confirmar limpeza?";wt=setTimeout(()=>{wt=0;b.textContent="Limpar planejamento"},4000);return}clearTimeout(wt);wt=0;b.textContent="Limpar planejamento";rows=[];render();novaFoto();$("msg").textContent="Planejamento limpo. As receitas coladas foram mantidas."};
function inRange(r){const a=$("d_de").value,b=$("d_ate").value;return !r.data||((!a||r.data>=a)&&(!b||r.data<=b))}
function setRange(){const ds=rows.map(r=>r.data).filter(Boolean).sort();if(ds.length){$("d_de").value=ds[0];$("d_ate").value=ds[ds.length-1]}}
$("d_de").onchange=$("d_ate").onchange=()=>viewDoc();$("d_all").onclick=()=>{setRange();viewDoc()};
function inLinha(r){return[...document.querySelectorAll("#lsel input:checked")].some(c=>+c.value===+r.linha)}
$("lsel").onchange=()=>viewDoc();
setRange();renderO();render();
