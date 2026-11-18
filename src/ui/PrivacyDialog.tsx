// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useState } from 'react';
import { CloudOff, EyeOff, FrameIcon, KeyRound, Trash2 } from 'lucide-react';
import { useStore } from '../state/store';
import { Modal } from './common';

const PROTECTIONS = [
  { icon: CloudOff, title: 'Your files stay on this device', text: 'Files are read inside your browser and are never uploaded.' },
  { icon: EyeOff, title: 'No tracking or outside connections', text: 'There are no accounts or analytics, and the site is blocked from sending data to other websites.' },
  { icon: KeyRound, title: 'Saved reports are encrypted', text: 'Reports kept in this browser are protected with AES-256 encryption.' },
  { icon: FrameIcon, title: 'Protected from hidden pages', text: 'Other websites cannot show this site inside their own pages.' },
];

export function PrivacyDialog({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const privateMode = useStore((s) => s.privateMode);
  const setPrivateMode = useStore((s) => s.setPrivateMode);
  const deleteSavedData = useStore((s) => s.deleteSavedData);
  const toast = useStore((s) => s.toast);
  const [confirming, setConfirming] = useState(false);

  const remove = async () => {
    await deleteSavedData();
    setConfirming(false);
    onDeleted();
    toast('success', 'All saved reports were deleted from this browser.');
  };

  return (
    <Modal title="Privacy and security" onClose={onClose}>
      <ul className="protections">
        {PROTECTIONS.map((p) => <li key={p.title}><p.icon size={18} /><span><b>{p.title}</b><small>{p.text}</small></span></li>)}
      </ul>
      <section className="privacy-controls">
        <label className="switch">
          <input type="checkbox" checked={privateMode} onChange={(e) => setPrivateMode(e.target.checked)} />
          <i /> <span>Private mode: do not save reports on this device</span>
        </label>
        {confirming ? (
          <div className="row-gap">
            <span className="hint">This permanently deletes every saved report in this browser.</span>
            <button className="btn sm" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="btn sm danger" onClick={() => void remove()}>Delete permanently</button>
          </div>
        ) : (
          <button className="btn sm danger" onClick={() => setConfirming(true)}><Trash2 size={14} /> Delete all saved reports</button>
        )}
      </section>
      <section className="privacy-limits">
        <b>What you still need to protect</b>
        <ul>
          <li>Downloaded files are ordinary files. Store and share them carefully.</li>
          <li>Anyone using your browser profile can open saved reports. Use private mode on shared computers.</li>
          <li>Viruses and untrusted browser extensions can read what is on your screen.</li>
        </ul>
      </section>
    </Modal>
  );
}
