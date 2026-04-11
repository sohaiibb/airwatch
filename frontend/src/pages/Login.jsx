import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { glass } from '../lib/utils';
import { Wind, Eye, EyeOff, AlertCircle, Loader2, Lock, Mail } from 'lucide-react';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e?.preventDefault(); setError('');
    if (!email.trim()) { setError('Please enter your email address'); return; }
    if (!password) { setError('Please enter your password'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      onLogin?.();
    } catch (err) {
      setError(err.message?.includes('Invalid') ? 'Incorrect email or password.' : err.message || 'Something went wrong.');
    } finally { setLoading(false); }
  }

  const inp = { width:'100%', padding:'13px 14px 13px 42px', borderRadius:14, border:'1px solid rgba(255,255,255,0.5)', background:'rgba(255,255,255,0.35)', backdropFilter:'blur(8px)', fontSize:14, color:'#1C1917', fontFamily:'var(--font)', outline:'none', transition:'border-color 0.2s, box-shadow 0.2s' };
  const focus = e => { e.target.style.borderColor='rgba(16,163,74,0.4)'; e.target.style.boxShadow='0 0 0 3px rgba(16,163,74,0.08)'; };
  const blur = e => { e.target.style.borderColor='rgba(255,255,255,0.5)'; e.target.style.boxShadow='none'; };

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden', padding:20 }}>
      {/* Orbs */}
      <div style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none' }}>
        <div style={{ position:'absolute', top:'-15%', right:'-10%', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(16,185,129,0.14), transparent 70%)', animation:'float1 22s ease-in-out infinite', filter:'blur(45px)' }} />
        <div style={{ position:'absolute', bottom:'-15%', left:'-10%', width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle, rgba(59,130,246,0.12), transparent 70%)', animation:'float2 28s ease-in-out infinite', filter:'blur(50px)' }} />
        <div style={{ position:'absolute', top:'30%', left:'60%', width:350, height:350, borderRadius:'50%', background:'radial-gradient(circle, rgba(168,85,247,0.09), transparent 60%)', animation:'float3 18s ease-in-out infinite', filter:'blur(40px)' }} />
        <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:'linear-gradient(90deg, #10B981, #3B82F6, #8B5CF6, #EC4899, #F59E0B, #10B981)', backgroundSize:'200% 100%', animation:'shimmer 8s linear infinite', opacity:0.5 }} />
      </div>

      <div style={{ ...glass({ padding:'44px 40px 36px' }), width:'100%', maxWidth:420, position:'relative', zIndex:1, animation:'glassIn 0.7s cubic-bezier(.16,1,.3,1) both' }}>
        <div style={{ position:'absolute', top:-30, right:-30, width:100, height:100, borderRadius:'50%', background:'radial-gradient(circle, rgba(255,255,255,0.45), transparent 70%)', pointerEvents:'none' }} />

        <div style={{ textAlign:'center', marginBottom:32, position:'relative', zIndex:1 }}>
          <div style={{ width:56, height:56, borderRadius:16, margin:'0 auto 16px', background:'linear-gradient(135deg, rgba(16,185,129,0.75), rgba(6,182,212,0.75))', display:'flex', alignItems:'center', justifyContent:'center', border:'1px solid rgba(255,255,255,0.5)', boxShadow:'0 4px 20px rgba(16,185,129,0.25)' }}>
            <Wind size={26} color="#fff" />
          </div>
          <h1 style={{ fontSize:26, fontWeight:700, letterSpacing:'-0.03em', margin:'0 0 4px' }}>AirWatch<span style={{ color:'#16A34A' }}>.</span></h1>
          <p style={{ fontSize:13, color:'#78716C', fontWeight:500 }}>Air Quality Monitoring Platform</p>
          <p style={{ fontSize:11, color:'#A8A29E', marginTop:2 }}>Hills and Field Company Limited</p>
        </div>

        {error && (
          <div role="alert" style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'10px 14px', borderRadius:12, marginBottom:20, background:'rgba(220,38,38,0.08)', border:'1px solid rgba(220,38,38,0.2)' }}>
            <AlertCircle size={16} color="#DC2626" style={{ flexShrink:0, marginTop:1 }} />
            <p style={{ color:'#DC2626', fontSize:13, fontWeight:500, margin:0 }}>{error}</p>
          </div>
        )}

        <div>
          <div style={{ marginBottom:18 }}>
            <label htmlFor="email" style={{ display:'block', fontSize:12, fontWeight:600, color:'#57534E', marginBottom:6 }}>Email Address</label>
            <div style={{ position:'relative' }}>
              <Mail size={16} color="#A8A29E" style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }} />
              <input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={e=>{setEmail(e.target.value);setError('')}} style={inp} onFocus={focus} onBlur={blur} />
            </div>
          </div>
          <div style={{ marginBottom:24 }}>
            <label htmlFor="password" style={{ display:'block', fontSize:12, fontWeight:600, color:'#57534E', marginBottom:6 }}>Password</label>
            <div style={{ position:'relative' }}>
              <Lock size={16} color="#A8A29E" style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }} />
              <input id="password" type={showPass?'text':'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e=>{setPassword(e.target.value);setError('')}} onKeyDown={e=>e.key==='Enter'&&handleSubmit(e)} style={{...inp,paddingRight:48}} onFocus={focus} onBlur={blur} />
              <button type="button" onClick={()=>setShowPass(!showPass)} aria-label={showPass?'Hide':'Show'} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', padding:4, display:'flex' }}>
                {showPass ? <EyeOff size={18} color="#A8A29E"/> : <Eye size={18} color="#A8A29E"/>}
              </button>
            </div>
          </div>
          <button onClick={handleSubmit} disabled={loading} style={{ width:'100%', padding:'14px 20px', borderRadius:14, border:'none', background:loading?'rgba(22,163,74,0.5)':'linear-gradient(135deg, #16A34A, #0D9488)', color:'#fff', fontSize:15, fontWeight:700, fontFamily:'var(--font)', cursor:loading?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'transform 0.2s, box-shadow 0.2s', boxShadow:'0 4px 16px rgba(16,163,74,0.25)', opacity:loading?0.7:1 }}
            onMouseEnter={e=>{if(!loading){e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 6px 24px rgba(16,163,74,0.35)'}}}
            onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='0 4px 16px rgba(16,163,74,0.25)'}}>
            {loading?<><Loader2 size={18} style={{animation:'spin 1s linear infinite'}}/> Signing in...</>:'Sign In'}
          </button>
        </div>
        <div style={{ textAlign:'center', marginTop:24 }}>
          <p style={{ fontSize:11, color:'#A8A29E', lineHeight:1.5 }}>Login credentials provided by your administrator.<br/>Contact <span style={{ color:'#78716C', fontWeight:600 }}>support@hillsnfield.com</span></p>
        </div>
      </div>
      <div style={{ position:'fixed', bottom:16, left:0, right:0, textAlign:'center', zIndex:1 }}>
        <p style={{ fontSize:11, color:'#A8A29E', fontFamily:'var(--mono)' }}>AirWatch v2.1 — Hills and Field Company Limited</p>
      </div>
    </div>
  );
}
