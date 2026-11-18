// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useStore } from '../state/store';
import { Modal } from './common';

export function UnlockDialog() {
  const locked = useStore((s) => s.locked)!;
  const unlock = useStore((s) => s.unlock);
  const cancel = useStore((s) => s.cancelUnlock);
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const submit = async () => {
    setBusy(true); setWrong(false);
    const ok = await unlock(passcode);
    if (!ok) { setWrong(true); setBusy(false); }
  };
  return (
    <Modal title="Open protected report" onClose={cancel} footer={<>
      <button className="btn" onClick={cancel}>Cancel</button>
      <button className="btn primary" disabled={!passcode || busy} onClick={() => void submit()}><LockKeyhole size={15} /> {busy ? 'Unlocking' : 'Unlock'}</button>
    </>}>
      <p className="hint">{locked.name} is encrypted. Enter the passcode you were given.</p>
      <label className="field">Passcode <input type="password" autoFocus autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && passcode) void submit(); }} /></label>
      {wrong && <p className="notice bad" role="alert">That passcode does not open this file.</p>}
    </Modal>
  );
}
