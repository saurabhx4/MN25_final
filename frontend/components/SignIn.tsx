'use client';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Atmosphere, GoogleIcon } from './Brand';
import { authLogin } from '../lib/api';

type Env = 'organization' | 'employee' | null;

export default function SignIn({ onBack, onSuccess, onGoToSignUp }: { onBack: () => void; onSuccess: (env: 'organization' | 'employee') => void; onGoToSignUp: () => void; }) {
  const [env, setEnv] = useState<Env>(null);
  const [identifier, setIdentifier] = useState('');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) { setError('Email and password are required to continue.'); return; }
    setBusy(true); setError('');
    try {
      const result = await authLogin({ email: identifier, password });
      const actualEnv = result.user.environment as 'organization' | 'employee';
      if (env && actualEnv !== env) throw new Error(`This account belongs to the ${actualEnv} environment.`);
      onSuccess(actualEnv);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }

  function googleContinue() { setError('Google authentication is not configured in this deployment.'); }

  return (
    <div className="signin-screen"><Atmosphere /><div className="signin-panel">
      {env === null ? <>
        <button className="back-link" onClick={onBack}><ArrowLeft size={14} /> Back</button>
        <h2>Welcome back to Mn 25</h2><p className="sub">Select your access environment</p>
        <div className="env-choice">
          <button className="env-option" onClick={() => setEnv('organization')}><b>Organization</b><span>For mining organizations, administrators and operational teams.</span></button>
          <button className="env-option" onClick={() => setEnv('employee')}><b>Employee</b><span>For authorized mining personnel and employees.</span></button>
        </div>
      </> : <>
        <button className="back-link" onClick={() => { setEnv(null); setError(''); }}><ArrowLeft size={14} /> Back</button>
        <h2>{env === 'organization' ? 'Organization Log In' : 'Employee Log In'}</h2><p className="sub">Enter your credentials to access your dashboard</p>
        <button type="button" className="btn-google" onClick={googleContinue}><GoogleIcon size={17} /> Continue with Google</button>
        <div className="auth-divider">or log in with credentials</div>
        <form onSubmit={submit}>
          <div className="field"><label>Email</label><input type="email" value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="you@company.com" autoComplete="email" /></div>
          <div className="field"><label>User ID (optional)</label><input value={userId} onChange={e => setUserId(e.target.value)} placeholder="Your MN25 user ID" /></div>
          <div className="field"><label>Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••••" autoComplete="current-password" /></div>
          {error && <div className="form-error">{error}</div>}
          <div className="signin-row"><label><input type="checkbox" /> Remember me</label><span>Forgot password?</span></div>
          <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Signing In…' : 'Log In'}</button>
        </form>
        <p className="auth-switch">Don&apos;t have an account? <button type="button" onClick={onGoToSignUp}>Sign up</button></p>
      </>}
    </div></div>
  );
}
