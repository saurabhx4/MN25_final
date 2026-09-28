'use client';
import { useState } from 'react';
import Landing from '../components/Landing';
import SignIn from '../components/SignIn';
import SignUp from '../components/SignUp';
import AppShell from '../components/AppShell';

type Stage = 'landing' | 'login' | 'signup' | 'app';

export default function Home() {
  const [stage, setStage] = useState<Stage>('landing');
  const [env, setEnv] = useState<'organization' | 'employee'>('organization');

  const go = (next: Stage) => setStage(next);

  return (
    <div className={`stage-shell stage-${stage}`}>
      {stage === 'landing' && <Landing onExplore={() => go('login')} onSignIn={() => go('login')} onSignUp={() => go('signup')} />}
      {stage === 'login' && (
        <SignIn
          onBack={() => go('landing')}
          onSuccess={(chosen) => { setEnv(chosen); go('app'); }}
          onGoToSignUp={() => go('signup')}
        />
      )}
      {stage === 'signup' && (
        <SignUp
          onBack={() => go('landing')}
          onSuccess={(chosen) => { setEnv(chosen); go('app'); }}
          onGoToLogin={() => go('login')}
        />
      )}
      {stage === 'app' && <AppShell env={env} onExit={() => go('landing')} />}
    </div>
  );
}
