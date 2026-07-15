// Supabase joue ici le rôle du "facteur aveugle" : il transporte les messages
// entre les deux téléphones via son système realtime, mais ne reçoit et ne
// stocke jamais que du texte chiffré (base64 illisible sans la clé partagée).
// Il ne détient aucune clé et ne peut techniquement rien déchiffrer.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Envoie une donnée (déjà chiffrée) dans le salon "roomId"
export async function sendToRoom(roomId, payload) {
  return supabase.from('messages').insert({ room_id: roomId, payload });
}

// S'abonne aux nouveaux messages du salon en temps réel
export function subscribeToRoom(roomId, onMessage) {
  const channel = supabase
    .channel(`room:${roomId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
      (payload) => onMessage(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
