// src/components/Login.tsx
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { SpadeIcon } from './Icons';

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
    <div className="app login-shell">
      <main className="login-layout">
        <div className="login-brand">
          <h1 className="app-title">
            <SpadeIcon size={26} />
            <span>Gerenciador de Torneios</span>
          </h1>
          <p className="credit">Texas Hold'em · Torneios entre amigos</p>
        </div>

        <form className="panel login-card" onSubmit={(e) => { e.preventDefault(); signIn(); }}>
          <div className="login-heading">
            <h2>Entrar</h2>
            <p className="notice">Acesse a gestão dos seus torneios.</p>
          </div>

          <div className="login-fields">
            <div>
              <label htmlFor="login-email">E-mail</label>
              <input id="login-email" name="email" type="email" value={email} autoComplete="username"
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="login-password">Senha</label>
              <input id="login-password" name="password" type="password" value={password}
                autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>

          <button className="primary login-submit" type="submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
          {msg && <p className="login-message" role="alert">{msg}</p>}
          <p className="notice login-help">Novos acessos são criados pelo administrador do aplicativo.</p>
        </form>
      </main>
    </div>
  );
}
