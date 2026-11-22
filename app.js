import {parseSpeechInput} from './parser.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const DB_NAME='vhd-voice-v1', STORE_NAME='documents', STORE_KEY='main';
let state, currentHouseholdId=null, currentMode='single', editedHouseholdId=null, editedAssetId=null;
let toastTimeout=null, saveChain=Promise.resolve();
const M_FIELDS = ['diameter_cm','circumference_cm','height_m','length_m','width_m','thickness_cm'];
const FIELD_IDS = ['asset-diameter','asset-circumference','asset-height','asset-length','asset-width','asset-thickness'];
const FIELD_NAMES = {'diameter_cm':'Đường kính','circumference_cm':'Chu vi','height_m':'Chiều cao','length_m':'Chiều dài','width_m':'Chiều rộng','thickness_cm':'Chiều dày'};
const FIELD_UNITS = {'diameter_cm':'cm','circumference_cm':'cm','height_m':'m','length_m':'m','width_m':'m','thickness_cm':'cm'};

function uid(prefix='ID'){
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
function blankState(){return {project:{id:uid('DA'),name:'Dự án chưa đặt tên'},households:[]};}
function esc(value){return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(message){
 const target=$('#toast');target.textContent=message;target.classList.add('show');
 clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>target.classList.remove('show'),4400);
}
function openDB(){return new Promise((resolve,reject)=>{
 if(!('indexedDB' in window)){reject(new Error('No IndexedDB'));return;}
 const request=indexedDB.open(DB_NAME,1);
 request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);};
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function readState(){
 try{const db=await openDB();return await new Promise((resolve,reject)=>{
 const tx=db.transaction(STORE_NAME,'readonly');const r=tx.objectStore(STORE_NAME).get(STORE_KEY);
 r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});
 }catch(e){try{return JSON.parse(localStorage.getItem(DB_NAME)||'null');}catch{return null;}}
}
async function saveStateNow(snapshot){
 try{const db=await openDB();await new Promise((resolve,reject)=>{
 const tx=db.transaction(STORE_NAME,'readwrite');tx.objectStore(STORE_NAME).put(snapshot,STORE_KEY);
 tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});db.close();
 }catch(e){try{localStorage.setItem(DB_NAME,JSON.stringify(snapshot));}catch{toast('Lỗi lưu dữ liệu! Hãy xuất bản sao lưu ngay.');}}
}
function persist(){const snapshot=structuredClone(state);saveChain=saveChain.then(()=>saveStateNow(snapshot));return saveChain;}
function household(){return state.households.find(h=>h.household_id===currentHouseholdId)||null;}
function assets(){return household()?.assets||[];}
function setTab(name){
 $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));
 ['entry','list','export'].forEach(x=>$(`#${x}-view`).classList.toggle('hidden',x!==name));
 if(name==='export')renderExport();
}
function setMode(mode){
 currentMode=mode;$$(".mode").forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
 $('#mode-hint').textContent=mode==='single'
  ? 'Đọc một tài sản mỗi lần để dễ kiểm tra thông số.'
  : 'Đọc nhiều tài sản, ngăn cách bằng “tiếp theo” hoặc “tài sản mới”.';
 $('#voice-text').placeholder=mode==='single'
  ? 'Ví dụ: Cây xoài, số lượng 3 cây, đường kính 20 cm, cao 4 mét.'
  : 'Ví dụ: Cây xoài 3 cây đường kính 20 cm cao 4 mét. Tiếp theo cây mít 2 cây đường kính 30 cm cao 5 mét.';
}
function updateStats(){
 const items=state.households.flatMap(h=>h.assets);
 $('#stat-households').textContent=state.households.length;
 $('#stat-assets').textContent=items.length;
 $('#stat-confirmed').textContent=items.filter(a=>a.review_status==='confirmed').length;
}
function renderSelects(){
 ['household-select','list-household-select'].forEach(id=>{
  const s=$('#'+id);s.replaceChildren();
  const p=new Option('— Chọn hộ dân —','');s.add(p);
  for(const h of state.households)s.add(new Option(`${h.kh} · ${h.full_name}`,h.household_id));
  s.value=currentHouseholdId||'';
 });
 $('#edit-household').disabled=!household();
}
function assetMeasurements(a){
 const parts=[];
 for(const [key,value] of Object.entries(a.measurements||{}))if(value!==null && value!==undefined && FIELD_NAMES[key])parts.push(`${FIELD_NAMES[key]}: ${value} ${FIELD_UNITS[key]}`);
 return parts.join(' · ')||'Chưa có thông số kỹ thuật';
}
function assetCard(a,idx){
 const ok=a.review_status==='confirmed';
 return `<article class="asset-card"><div class="asset-head"><div><strong>${idx+1}. ${esc(a.name||'Chưa rõ tài sản')}</strong><small>${a.quantity??'—'} ${esc(a.unit||'')} · ${esc(a.entry_mode==='continuous'?'Đọc liên tục':'Từng tài sản')}</small></div><span class="chip ${ok?'ok':'wait'}">${ok?'✓ Đã xác nhận':'! Cần kiểm tra'}</span></div><p>${esc(assetMeasurements(a))}</p>${!ok && a.issues?.length?`<p style="color:#a76d22">${esc(a.issues.join('; '))}</p>`:''}<div class="asset-footer"><small class="muted">${esc((a.raw_text||'').slice(0,90))}</small><button type="button" class="mini-btn" data-edit-asset="${esc(a.id)}">Sửa / xác nhận</button></div></article>`;
}
function renderAssets(){
 const list=assets();
 $('#entry-count').textContent=`${list.length} tài sản`;
 const markup=list.length?list.map(assetCard).join(''):'<div class="empty">Chưa có tài sản trong hộ này. Hãy nhập nội dung kê khai ở trên.</div>';
 $('#entry-assets').innerHTML=markup;
 $('#all-assets').innerHTML=markup;
 $('#list-caption').textContent=household()?`${household().kh} · ${household().full_name}`:'Chưa chọn hộ';
}
function renderExport(){
 const total=state.households.reduce((sum,h)=>sum+h.assets.length,0);
 const confirmed=state.households.reduce((sum,h)=>sum+h.assets.filter(a=>a.review_status==='confirmed').length,0);
 const selected=assets();
 $('#export-summary').innerHTML=`<p><span>Hộ dân trong dự án</span><b>${state.households.length}</b></p><p><span>Tổng tài sản</span><b>${total}</b></p><p><span>Đã xác nhận</span><b>${confirmed}</b></p><p><span>Cần kiểm tra</span><b>${total-confirmed}</b></p><p><span>Tài sản của hộ đang chọn</span><b>${selected.length}</b></p>`;
 $('#export-household').disabled=!household();$('#export-project').disabled=state.households.length===0;
}
function render(){updateStats();renderSelects();renderAssets();renderExport();}
function initHouseholdDialog(isEdit=false){
 editedHouseholdId=isEdit?currentHouseholdId:null;
 const h=isEdit?household():null;
 $('#household-dialog-title').textContent=isEdit?'Sửa thông tin hộ':'Thêm hộ dân';
 $('#household-kh').value=h?.kh||'';$('#household-name').value=h?.full_name||'';
 $('#household-dialog').showModal();
}
function getPositiveInput(id){
 const s=$('#'+id).value.trim();
 if(!s)return null;
 if(!/^(?:\d+)(?:[.,]\d+)?$/.test(s))return NaN;
 return Number(s.replace(',','.'));
}
function editAsset(id){
 const a=assets().find(x=>x.id===id);if(!a)return;
 editedAssetId=id;
 $('#asset-name').value=a.name||'';
 $('#asset-type').value=a.type||'other';
 $('#asset-unit').value=a.unit||'';
 $('#asset-quantity').value=a.quantity??'';
 M_FIELDS.forEach((field,i)=>$('#'+FIELD_IDS[i]).value=a.measurements?.[field]??'');
 $('#asset-raw').value=a.raw_text||'';
 $('#asset-warning').textContent=a.issues?.join('; ')||'Hãy kiểm tra lại toàn bộ số liệu trước khi xác nhận.';
 $('#asset-dialog').showModal();
}
function exportData(oneHousehold=false){
 let dataHouseholds=oneHousehold?(household()?[household()]:[]):state.households;
 if(!dataHouseholds.length){toast('Chưa có hộ để xuất file.');return;}
 const waiting=dataHouseholds.flatMap(h=>h.assets).filter(a=>a.review_status!=='confirmed').length;
 if(waiting && !confirm(`Có ${waiting} tài sản chưa xác nhận. Vẫn xuất file để lưu sao? Phần mềm Windows nên bỏ qua các tài sản này cho đến khi được xác nhận.`))return;
 const record={schema:'vhd.voice.export',schema_version:1,export_id:uid('EXP'),exported_at:new Date().toISOString(),project:{...state.project},households:dataHouseholds.map(h=>({household_id:h.household_id,kh:h.kh,full_name:h.full_name,assets:h.assets.map(a=>({id:a.id,sequence:a.sequence,entry_mode:a.entry_mode,raw_text:a.raw_text,name:a.name,type:a.type,unit:a.unit,quantity:a.quantity,measurements:a.measurements,review_status:a.review_status,issues:a.issues||[],created_at:a.created_at,updated_at:a.updated_at}))}))};
 const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const clean=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,55);
 const filename=`VHD_${clean(oneHousehold?dataHouseholds[0].kh:state.project.name)}_${new Date().toISOString().slice(0,10)}.json`;
 const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
 toast('Đã tạo file JSON. Trên iPhone, hãy kiểm tra mục Tệp / Tải về để lưu hoặc chia sẻ.');
}
function validateImportedFile(doc){
 if(!doc || doc.schema!=='vhd.voice.export' || doc.schema_version!==1 || !doc.project || !Array.isArray(doc.households))throw new Error('File JSON không đúng chuẩn VHD Voice phiên bản 1.');
 if(doc.households.length>10000)throw new Error('Quá nhiều hộ trong file.');
 const ids=new Set();
 for(const h of doc.households){
  if(!h.household_id||!h.kh||!h.full_name||!Array.isArray(h.assets))throw new Error('Thông tin hộ không hợp lệ.');
  if(ids.has(h.household_id))throw new Error('Trùng mã hộ trong file.');ids.add(h.household_id);
  if(h.assets.length>100000)throw new Error('Quá nhiều tài sản trong một hộ.');
  for(const a of h.assets){if(!a.id||!['needs_review','confirmed'].includes(a.review_status)||typeof a.name!=='string'||!a.measurements||typeof a.measurements!=='object')throw new Error('Có tài sản không hợp lệ trong file.');}
 }
 return {project:{id:String(doc.project.id||uid('DA')),name:String(doc.project.name||'Dự án chưa đặt tên')},households:doc.households.map(h=>({household_id:String(h.household_id),kh:String(h.kh),full_name:String(h.full_name),assets:h.assets.map(a=>({...a,issues:Array.isArray(a.issues)?a.issues:[],measurements:Object.fromEntries(Object.entries(a.measurements).filter(([key])=>M_FIELDS.includes(key)))}))}))};
}
function wireEvents(){
 $$('.tab').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
 $$('.mode').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
 $('#new-household').addEventListener('click',()=>initHouseholdDialog(false));
 $('#edit-household').addEventListener('click',()=>initHouseholdDialog(true));
 $('#household-form').addEventListener('submit',async e=>{
  e.preventDefault();const action=e.submitter?.value;
  if(action!=='save'){$('#household-dialog').close();return;}
  const kh=$('#household-kh').value.trim(),name=$('#household-name').value.trim();
  if(!kh||!name){toast('Vui lòng nhập ký hiệu và tên hộ.');return;}
  const duplicate=state.households.find(h=>h.kh.toLowerCase()===kh.toLowerCase()&&h.household_id!==editedHouseholdId);
  if(duplicate){toast('Ký hiệu hộ đã tồn tại trong dự án.');return;}
  if(editedHouseholdId){const h=household();if(h){h.kh=kh;h.full_name=name;}}
  else {const h={household_id:uid('H'),kh,full_name:name,assets:[]};state.households.push(h);currentHouseholdId=h.household_id;}
  $('#household-dialog').close();await persist();render();toast('Đã lưu thông tin hộ.');
 });
 ['household-select','list-household-select'].forEach(id=>$('#'+id).addEventListener('change',e=>{
  currentHouseholdId=e.target.value||null;render();
 }));
 $('#example-btn').addEventListener('click',()=>{
  $('#voice-text').value=currentMode==='single'?'Cây xoài, số lượng 3 cây, đường kính 20 cm, chiều cao 4 mét.':'Cây xoài 3 cây đường kính 20 cm cao 4 mét. Tiếp theo cây mít 2 cây đường kính 30 cm cao 5 mét.';
 });
 $('#parse-btn').addEventListener('click',async ()=>{
  const h=household();if(!h){toast('Hãy tạo hoặc chọn hộ dân trước.');return;}
  const val=$('#voice-text').value.trim();if(!val){toast('Hãy đọc hoặc nhập nội dung tài sản trước.');return;}
  const found=parseSpeechInput(val,currentMode);
  if(found.length>100){toast('Mỗi lần chỉ cho phép tối đa 100 tài sản.');return;}
  for(const item of found){const now=new Date().toISOString();h.assets.push({...item,id:uid('TS'),sequence:h.assets.length+1,created_at:now,updated_at:now});}
  $('#voice-text').value='';await persist();render();toast(`Đã thêm ${found.length} tài sản. Hãy sửa và xác nhận từng bản ghi.`);
 });
 ['entry-assets','all-assets'].forEach(id=>$('#'+id).addEventListener('click',e=>{
  const btn=e.target.closest('[data-edit-asset]');if(btn)editAsset(btn.dataset.editAsset);
 }));
 $('#asset-type').addEventListener('change',e=>{
  if(!$('#asset-unit').value || ['cái','cây'].includes($('#asset-unit').value))$('#asset-unit').value=e.target.value==='tree'?'cây':'cái';
 });
 $('#asset-form').addEventListener('submit',async e=>{
  e.preventDefault();const action=e.submitter?.value;
  if(action==='cancel'){$('#asset-dialog').close();return;}
  const h=household(),a=h?.assets.find(x=>x.id===editedAssetId);if(!a)return;
  const name=$('#asset-name').value.trim(),type=$('#asset-type').value;
  const unit=$('#asset-unit').value.trim();const qty=getPositiveInput('asset-quantity');
  const vals=FIELD_IDS.map(getPositiveInput);
  if(vals.some(v=>Number.isNaN(v))||Number.isNaN(qty)){toast('Vui lòng nhập số hợp lệ (ví dụ: 2,5 hoặc 2.5).');return;}
  if(action==='confirm' && (!name||!unit||qty===null||qty<=0||vals.some(v=>v!==null&&v<=0))){toast('Để xác nhận, cần tên tài sản, đơn vị, số lượng > 0 và số đo hợp lệ.');return;}
  a.name=name;a.type=type;a.unit=unit;a.quantity=qty;
  a.measurements=Object.fromEntries(M_FIELDS.flatMap((field,i)=>vals[i]===null?[]:[[field,vals[i]]]));
  a.raw_text=$('#asset-raw').value.trim();a.updated_at=new Date().toISOString();
  a.review_status=action==='confirm'?'confirmed':'needs_review';
  a.issues=[];
  if(!a.name)a.issues.push('Thiếu tên tài sản');
  if(a.quantity===null)a.issues.push('Thiếu số lượng');
  if(a.type==='tree' && a.measurements.diameter_cm!=null && a.measurements.height_m==null)a.issues.push('Có đường kính nhưng thiếu chiều cao');
  if(a.type==='tree' && a.measurements.height_m!=null && a.measurements.diameter_cm==null && a.measurements.circumference_cm==null)a.issues.push('Có chiều cao nhưng thiếu đường kính hoặc chu vi');
  if(action==='confirm'&&a.issues.length){toast('Tài sản có thông tin thiếu; hãy kiểm tra bổ sung.');a.review_status='needs_review';}
  $('#asset-dialog').close();await persist();render();toast(a.review_status==='confirmed'?'Đã xác nhận tài sản.':'Đã lưu bản nháp để kiểm tra.');
 });
 $('#asset-delete').addEventListener('click',async ()=>{
  const h=household();if(!h)return;
  if(!confirm('Xóa tài sản này khỏi danh sách?'))return;
  h.assets=h.assets.filter(a=>a.id!==editedAssetId);
  h.assets.forEach((a,i)=>a.sequence=i+1);
  $('#asset-dialog').close();await persist();render();toast('Đã xóa tài sản.');
 });
 let projectTimer;
 $('#project-name').addEventListener('input',()=>{
  clearTimeout(projectTimer);projectTimer=setTimeout(()=>{state.project.name=$('#project-name').value.trim()||'Dự án chưa đặt tên';persist();},350);
 });
 $('#project-name').addEventListener('blur',()=>{clearTimeout(projectTimer);state.project.name=$('#project-name').value.trim()||'Dự án chưa đặt tên';persist();});
 $('#export-household').addEventListener('click',()=>exportData(true));
 $('#export-project').addEventListener('click',()=>exportData(false));
 $('#import-json').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
   if(file.size>10_000_000)throw new Error('File quá lớn (giới hạn 10 MB).');
   const data=validateImportedFile(JSON.parse(await file.text()));
   if(!confirm(`Khôi phục ${data.households.length} hộ từ file này? Toàn bộ dữ liệu đang lưu trên iPhone sẽ bị thay thế. Bạn nên xuất bản sao lưu trước.`))return;
   state=data;currentHouseholdId=state.households[0]?.household_id||null;
   $('#project-name').value=state.project.name;await persist();render();setTab('entry');toast('Đã khôi phục dữ liệu từ file JSON.');
  }catch(err){toast('Không khôi phục được: '+(err.message||'File không hợp lệ'));}
  finally{e.target.value='';}
 });
}
async function init(){
 const saved=await readState();state=(saved && saved.project && Array.isArray(saved.households))?saved:blankState();
 currentHouseholdId=state.households[0]?.household_id||null;
 $('#project-name').value=state.project.name;
 wireEvents();setMode('single');render();
 if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
 }
}
init().catch(err=>{console.error(err);toast('Không thể khởi động ứng dụng. Vui lòng mở lại.');});
