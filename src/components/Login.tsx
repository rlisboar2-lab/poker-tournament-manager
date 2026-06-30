// src/components/Login.tsx
import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    if (!supabase) return;
    setBusy(true); setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg(error.message);
    setBusy(false);
  };

  return (
    <div className="app">
      <h1>♠ Gerenciador de Torneios</h1>
      <div className="panel" style={{ maxWidth: 380 }}>
        <h2>Entrar</h2>
        <div style={{ marginBottom: 10 }}>
          <label>E-mail</label>
          <input type="email" value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label>Senha</label>
          <input type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && signIn()} />
        </div>
        <button className="primary" disabled={busy} onClick={signIn}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        {msg && <p className="warn" style={{ marginTop: 10 }}>{msg}</p>}
        <p className="notice" style={{ marginTop: 14 }}>
          O usuário é criado no painel do Supabase em Authentication → Users → Add user.
        </p>
      </div>
    </div>
  );
}
