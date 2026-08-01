import { createClient } from "@supabase/supabase-js";
import { projectId, publicAnonKey } from "../../utils/supabase/info";

export const supabase = createClient(
  `https://${projectId}.supabase.co`,
  publicAnonKey,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a45f9ce8`;

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Profile ───────────────────────────────────────────────────────────────────
export const getProfile = (userId: string) =>
  apiFetch(`/profile/${userId}`);
export const saveProfile = (userId: string, data: object) =>
  apiFetch(`/profile/${userId}`, { method: "POST", body: JSON.stringify(data) });

// ── Learning progress ─────────────────────────────────────────────────────────
export const getProgress = (userId: string) =>
  apiFetch(`/progress/${userId}`);
export const saveProgress = (userId: string, data: object) =>
  apiFetch(`/progress/${userId}`, { method: "POST", body: JSON.stringify(data) });

// ── Custom signs ──────────────────────────────────────────────────────────────
export const getCustomSigns = (userId: string) =>
  apiFetch(`/custom-signs/${userId}`);
export const saveCustomSigns = (userId: string, signs: object[]) =>
  apiFetch(`/custom-signs/${userId}`, { method: "POST", body: JSON.stringify(signs) });

// ── Emergency profile ─────────────────────────────────────────────────────────
export const getEmergencyProfile = (userId: string) =>
  apiFetch(`/emergency/${userId}`);
export const saveEmergencyProfile = (userId: string, data: object) =>
  apiFetch(`/emergency/${userId}`, { method: "POST", body: JSON.stringify(data) });

// ── Community signs ───────────────────────────────────────────────────────────
export const getCommunitySignsFromDB = () =>
  apiFetch(`/community-signs`);
export const postCommunitySigns = (sign: object) =>
  apiFetch(`/community-signs`, { method: "POST", body: JSON.stringify({ sign }) });
export const updateCommunitySignsInDB = (signs: object[]) =>
  apiFetch(`/community-signs`, { method: "PUT", body: JSON.stringify(signs) });

// ── Favorites ─────────────────────────────────────────────────────────────────
export const getFavorites = (userId: string) =>
  apiFetch(`/favorites/${userId}`);
export const saveFavorites = (userId: string, ids: string[]) =>
  apiFetch(`/favorites/${userId}`, { method: "POST", body: JSON.stringify(ids) });

// ── Conversations ─────────────────────────────────────────────────────────────
export const getConversations = (userId: string) =>
  apiFetch(`/conversations/${userId}`);
export const appendConversations = (userId: string, messages: object[]) =>
  apiFetch(`/conversations/${userId}`, { method: "POST", body: JSON.stringify({ messages }) });

// ── Liked / saved ─────────────────────────────────────────────────────────────
export const getLiked = (userId: string) =>
  apiFetch(`/liked/${userId}`);
export const saveLiked = (userId: string, ids: string[]) =>
  apiFetch(`/liked/${userId}`, { method: "POST", body: JSON.stringify(ids) });

export const getSaved = (userId: string) =>
  apiFetch(`/saved/${userId}`);
export const saveSaved = (userId: string, ids: string[]) =>
  apiFetch(`/saved/${userId}`, { method: "POST", body: JSON.stringify(ids) });
