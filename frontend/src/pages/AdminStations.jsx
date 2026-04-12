import { useState, useEffect } from 'react';
import { glass, glassInner } from '../lib/utils';
import { createStation, updateStation, supabase } from '../lib/supabase';
import { Plus, Radio, Settings, Trash2, Save, Loader2, Wifi, WifiOff, X } from 'lucide-react';

const EMPTY = { name:'',slug:'',description:'',latitude:'',longitude:'',device_id:'',api_base_url:'',api_auth_token:'',data_protocol:'rest',polling_interval_seconds:300,
  field_mapping:{pm25:'PM2.5',pm10:'PM10',so2:'so2',no2:'no2',o3:'o3',co:'CO',temperature:'Temperature',humidity:'Humidity',pressure:'press',wind_speed:'ws',wind_direction:'Wind Direction'}};
const FIELDS = {pm25:'PM2.5',pm10:'PM10',so2:'SO₂',no2:'NO₂',o3:'O₃',co:'CO',temperature:'Temperature',humidity:'Humidity',pressure:'Pressure',wind_speed:'Wind Speed',wind_direction:'Wind Dir'};

export default function AdminStations() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  const [stations,setStations]=useState([]);
  const [loading,setLoading]=useState(true);
  const [editing,setEditing]=useState(null);
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState('');

  useEffect(()=>{load()},[]);
  async function load(){setLoading(true);try{const{data}=await supabase.from('stations').select('*').order('name');setStations(data||[]);}catch{}setLoading(false);}

  async function handleSave(){
    if(!editing.name||!editing.latitude||!editing.longitude){setMsg('Name, lat, lng required.');return;}
    setSaving(true);setMsg('');
    try{
      const p={name:editing.name,slug:editing.slug||editing.name.toLowerCase().replace(/\s+/g,'-'),description:editing.description,latitude:parseFloat(editing.latitude),longitude:parseFloat(editing.longitude),device_id:editing.device_id,api_base_url:editing.api_base_url,data_protocol:editing.data_protocol,polling_interval_seconds:parseInt(editing.polling_interval_seconds)||300,field_mapping:editing.field_mapping};
      if(editing._isNew){const{data:{user}}=await supabase.auth.getUser();const{data:pr}=await supabase.from('profiles').select('org_id').eq('id',user.id).single();p.org_id=pr.org_id;await createStation(p);setMsg('Created!');}
      else{await updateStation(editing.id,p);setMsg('Updated!');}
      await load();setTimeout(()=>setEditing(null),800);
    }catch(e){setMsg(`Error: ${e.message}`);}
    setSaving(false);
  }

  async function handleDelete(id){if(!confirm('Delete this station?'))return;try{await supabase.from('stations').delete().eq('id',id);await load();setEditing(null);}catch(e){setMsg(`Error: ${e.message}`);}}

  const inp={width:'100%',padding:'10px 12px',borderRadius:10,border:'1px solid rgba(255,255,255,0.5)',background:'rgba(255,255,255,0.35)',fontSize:13,color:'#1C1917',fontFamily:'var(--font)',outline:'none'};

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div><h2 style={{fontSize:20,fontWeight:700}}>Manage Stations</h2><p style={{fontSize:12,color:'#78716C'}}>{stations.length} stations</p></div>
        <button onClick={()=>{setEditing({...EMPTY,_isNew:true});setMsg('');}} style={{...glassInner({padding:'8px 16px',borderRadius:12}),display:'flex',alignItems:'center',gap:6,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:'#16A34A',fontFamily:'var(--font)'}}><Plus size={16}/>Add Station</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:editing && !isMobile ?'1fr 1fr':'1fr',gap:16}}>
        <div style={{...glass({padding:'16px'}),animation:'glassIn 0.5s ease both'}}>
          {loading?<div style={{textAlign:'center',padding:40}}><Loader2 size={24} color="#A8A29E" style={{animation:'spin 1s linear infinite'}}/></div>
          :stations.length===0?<div style={{textAlign:'center',padding:40,color:'#A8A29E'}}><Radio size={32} style={{marginBottom:8,opacity:.4}}/><p style={{fontWeight:600}}>No stations yet</p></div>
          :<div style={{display:'flex',flexDirection:'column',gap:6}}>
            {stations.map(s=>(
              <button key={s.id} onClick={()=>{setEditing({...s,field_mapping:s.field_mapping||EMPTY.field_mapping,_isNew:false});setMsg('');}} style={{
                ...glassInner({padding:'12px 14px'}),display:'flex',alignItems:'center',justifyContent:'space-between',
                border:editing?.id===s.id?'1px solid rgba(22,163,74,0.4)':'1px solid rgba(255,255,255,0.45)',
                background:editing?.id===s.id?'rgba(255,255,255,0.5)':'rgba(255,255,255,0.3)',
                cursor:'pointer',fontFamily:'var(--font)',textAlign:'left',width:'100%',transition:'all 0.2s',
              }}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:s.status==='online'?'#16A34A':s.status==='stale'?'#CA8A04':'#A8A29E'}}/>
                  <div><p style={{fontSize:13,fontWeight:600}}>{s.name}</p><p style={{fontSize:10,color:'#A8A29E',fontFamily:'var(--mono)'}}>{s.device_id||'No device'} — {s.data_protocol?.toUpperCase()}</p></div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  {s.status==='online'?<Wifi size={12} color="#16A34A"/>:<WifiOff size={12} color="#A8A29E"/>}
                  <Settings size={14} color="#78716C"/>
                </div>
              </button>
            ))}
          </div>}
        </div>

        {editing&&(
          <div style={{...glass({padding:'20px'}),animation:'glassIn 0.4s ease both',position:'relative'}}>
            <button onClick={()=>setEditing(null)} style={{position:'absolute',top:14,right:14,background:'none',border:'none',cursor:'pointer',padding:4}}><X size={18} color="#A8A29E"/></button>
            <h3 style={{fontSize:15,fontWeight:700,marginBottom:16}}>{editing._isNew?'New Station':`Edit: ${editing.name}`}</h3>
            {msg&&<div style={{padding:'8px 12px',borderRadius:10,marginBottom:14,fontSize:12,fontWeight:600,background:msg.includes('Error')?'rgba(220,38,38,0.08)':'rgba(22,163,74,0.08)',color:msg.includes('Error')?'#DC2626':'#16A34A',border:`1px solid ${msg.includes('Error')?'rgba(220,38,38,0.2)':'rgba(22,163,74,0.2)'}`}}>{msg}</div>}

            <p style={{fontSize:11,fontWeight:700,color:'#78716C',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.06em'}}>Basic Info</p>
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:10,marginBottom:16}}>
              <div><label style={{fontSize:11,fontWeight:600,color:'#57534E',display:'block',marginBottom:4}}>Station Name *</label><input value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})} placeholder="Al Khobar Central" style={inp}/></div>
              <div><label style={{fontSize:11,fontWeight:600,color:'#57534E',display:'block',marginBottom:4}}>Device ID</label><input value={editing.device_id} onChange={e=>setEditing({...editing,device_id:e.target.value})} placeholder="ENE04771" style={inp}/></div>
              <div><label style={{fontSize:11,fontWeight:600,color:'#57534E',display:'block',marginBottom:4}}>Latitude *</label><input value={editing.latitude} onChange={e=>setEditing({...editing,latitude:e.target.value})} placeholder="26.2956" style={inp} type="number" step="0.0001"/></div>
              <div><label style={{fontSize:11,fontWeight:600,color:'#57534E',display:'block',marginBottom:4}}>Longitude *</label><input value={editing.longitude} onChange={e=>setEditing({...editing,longitude:e.target.value})} placeholder="50.2123" style={inp} type="number" step="0.0001"/></div>
            </div>

            <p style={{fontSize:11,fontWeight:700,color:'#78716C',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.06em'}}>Data Source</p>
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:10,marginBottom:10}}>
              <div><label style={{fontSize:11,fontWeight:600,color:'#57534E',display:'block',marginBottom:4}}>API Base URL</label><input value={editing.api_base_url} onChange={e=>setEditing({...editing,api_base_url:e.target.value})} placeholder="https://apis.enggenv.com/api/v1/uz/data" style={inp}/></div>
              <div><label style={{fontSize:11,fontWeight:600,color:'#57534E',display:'block',marginBottom:4}}>Polling (sec)</label><input value={editing.polling_interval_seconds} onChange={e=>setEditing({...editing,polling_interval_seconds:e.target.value})} style={inp} type="number"/></div>
            </div>

            <p style={{fontSize:11,fontWeight:700,color:'#78716C',margin:'16px 0 8px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Field Mapping</p>
            <p style={{fontSize:10,color:'#A8A29E',marginBottom:10}}>Map API field names → dashboard parameters</p>
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:6}}>
              {Object.entries(FIELDS).map(([k,label])=>(
                <div key={k} style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:11,fontWeight:600,color:'#57534E',width:80,flexShrink:0}}>{label}</span>
                  <input value={editing.field_mapping?.[k]||''} onChange={e=>setEditing({...editing,field_mapping:{...editing.field_mapping,[k]:e.target.value}})} style={{...inp,padding:'6px 10px',fontSize:11,fontFamily:'var(--mono)'}} placeholder="API field"/>
                </div>
              ))}
            </div>

            <div style={{display:'flex',gap:10,marginTop:20}}>
              <button onClick={handleSave} disabled={saving} style={{flex:1,padding:'10px',borderRadius:12,border:'none',background:'linear-gradient(135deg,#16A34A,#0D9488)',color:'#fff',fontSize:13,fontWeight:700,cursor:saving?'not-allowed':'pointer',fontFamily:'var(--font)',display:'flex',alignItems:'center',justifyContent:'center',gap:6,opacity:saving?.7:1}}>
                {saving?<Loader2 size={14} style={{animation:'spin 1s linear infinite'}}/>:<Save size={14}/>}{saving?'Saving...':'Save Station'}
              </button>
              {!editing._isNew&&<button onClick={()=>handleDelete(editing.id)} style={{padding:'10px 16px',borderRadius:12,border:'1px solid rgba(220,38,38,0.2)',background:'rgba(220,38,38,0.06)',color:'#DC2626',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'var(--font)',display:'flex',alignItems:'center',gap:5}}><Trash2 size={14}/>Delete</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
