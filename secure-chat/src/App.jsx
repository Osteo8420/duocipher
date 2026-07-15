import { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  getOrCreateKeyPair,
  exportPublicKeyB64,
  importPeerPublicKey,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
  computeSafetyNumber,
  randomRoomId,
} from './crypto.js';
import { sendToRoom, subscribeToRoom } from './supabase.js';

// Étapes de l'écran : home -> creating (attend le scan) -> scanning (caméra) -> chat
export default function App() {
  const [screen, setScreen] = useState('home');
  const [roomId, setRoomId] = useState(null);
  const [myPublicKeyB64, setMyPublicKeyB64] = useState(null);
  const [sharedKey, setSharedKey] = useState(null);
  const [safetyNumber, setSafetyNumber] = useState(null);
  const [messages, setMessages] = useState([]); // {mine: bool, text: string}
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);

  const keyPairRef = useRef(null);
  const unsubRef = useRef(null);

  useEffect(() => {
    getOrCreateKeyPair().then(async (kp) => {
      keyPairRef.current = kp;
      setMyPublicKeyB64(await exportPublicKeyB64(kp.publicKey));
    });
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, []);

  // --- Créer un salon (Personne A) ---
  const startCreateRoom = () => {
    const id = randomRoomId();
    setRoomId(id);
    setScreen('creating');
    unsubRef.current = subscribeToRoom(id, async (row) => {
      const payload = row.payload;
      if (payload.type === 'handshake' && !sharedKey) {
        const peerPublicKey = await importPeerPublicKey(payload.pubKey);
        const key = await deriveSharedKey(keyPairRef.current.privateKey, peerPublicKey);
        setSharedKey(key);
        setSafetyNumber(await computeSafetyNumber(myPublicKeyB64, payload.pubKey));
        setScreen('chat');
      }
    });
  };

  // --- Rejoindre un salon (Personne B, via scan) ---
  const handleScanResult = useCallback(async (decodedText) => {
    try {
      const data = JSON.parse(decodedText);
      const peerPublicKey = await importPeerPublicKey(data.pubKey);
      const key = await deriveSharedKey(keyPairRef.current.privateKey, peerPublicKey);
      setSharedKey(key);
      setSafetyNumber(await computeSafetyNumber(myPublicKeyB64, data.pubKey));
      setRoomId(data.roomId);

      // Envoie sa propre clé publique en clair (une clé publique n'est pas un secret)
      await sendToRoom(data.roomId, { type: 'handshake', pubKey: myPublicKeyB64 });

      unsubRef.current = subscribeToRoom(data.roomId, async (row) => {
        if (row.payload.type === 'msg') {
          const text = await decryptMessage(key, row.payload.ciphertext);
          setMessages((m) => [...m, { mine: false, text }]);
        }
      });
      setScreen('chat');
    } catch (e) {
      setError('QR code invalide ou expiré.');
    }
  }, [myPublicKeyB64]);

  // Une fois en chat côté créateur (A), il faut aussi écouter les messages entrants
  useEffect(() => {
    if (screen === 'chat' && roomId && sharedKey && unsubRef.current) {
      // Ré-abonnement complet incluant les messages de chat (le premier abonnement
      // ne traitait que le handshake côté créateur)
      unsubRef.current();
      unsubRef.current = subscribeToRoom(roomId, async (row) => {
        if (row.payload.type === 'msg') {
          const text = await decryptMessage(sharedKey, row.payload.ciphertext);
          setMessages((m) => [...m, { mine: false, text }]);
        }
      });
    }
  }, [screen, roomId, sharedKey]);

  const sendMessage = async () => {
    if (!draft.trim() || !sharedKey) return;
    const ciphertext = await encryptMessage(sharedKey, draft);
    await sendToRoom(roomId, { type: 'msg', ciphertext });
    setMessages((m) => [...m, { mine: true, text: draft }]);
    setDraft('');
  };

  return (
    <div className="app">
      {screen === 'home' && (
        <Home onCreate={startCreateRoom} onJoin={() => setScreen('scanning')} />
      )}
      {screen === 'creating' && myPublicKeyB64 && (
        <CreatingRoom roomId={roomId} publicKeyB64={myPublicKeyB64} />
      )}
      {screen === 'scanning' && (
        <Scanner onResult={handleScanResult} onCancel={() => setScreen('home')} error={error} />
      )}
      {screen === 'chat' && (
        <Chat
          messages={messages}
          draft={draft}
          setDraft={setDraft}
          onSend={sendMessage}
          safetyNumber={safetyNumber}
        />
      )}
    </div>
  );
}

function Home({ onCreate, onJoin }) {
  return (
    <div className="screen center">
      <h1>Chat sécurisé</h1>
      <p className="muted">Chiffrement de bout en bout. Le serveur ne voit jamais vos messages en clair.</p>
      <button className="primary" onClick={onCreate}>Créer un salon</button>
      <button className="secondary" onClick={onJoin}>Rejoindre un salon (scanner)</button>
    </div>
  );
}

function CreatingRoom({ roomId, publicKeyB64 }) {
  const qrValue = JSON.stringify({ roomId, pubKey: publicKeyB64 });
  return (
    <div className="screen center">
      <h2>Fais scanner ce code</h2>
      <div className="qr-box"><QRCodeSVG value={qrValue} size={240} /></div>
      <p className="muted">En attente que l'autre personne scanne…</p>
    </div>
  );
}

function Scanner({ onResult, onCancel, error }) {
  const regionId = 'qr-scanner-region';
  useEffect(() => {
    const scanner = new Html5Qrcode(regionId);
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (decodedText) => {
          scanner.stop().catch(() => {});
          onResult(decodedText);
        },
        () => {}
      )
      .catch(() => {});
    return () => { scanner.stop().catch(() => {}); };
  }, [onResult]);

  return (
    <div className="screen center">
      <h2>Scanne le code de l'autre personne</h2>
      <div id={regionId} className="qr-scanner" />
      {error && <p className="error">{error}</p>}
      <button className="secondary" onClick={onCancel}>Annuler</button>
    </div>
  );
}

function Chat({ messages, draft, setDraft, onSend, safetyNumber }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  return (
    <div className="screen chat-screen">
      {safetyNumber && (
        <div className="safety-banner">
          Code de sécurité : <strong>{safetyNumber}</strong>
          <br />
          Vérifiez à voix haute qu'il est identique sur les deux téléphones (protection contre l'interception du tout premier échange).
        </div>
      )}
      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.mine ? 'mine' : 'theirs'}`}>{m.text}</div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSend()}
          placeholder="Écris un message…"
        />
        <button onClick={onSend}>Envoyer</button>
      </div>
    </div>
  );
}
