import { projectId, publicAnonKey } from "../../utils/supabase/info";

export const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a45f9ce8`;

async function apiFetch(path: string, options: RequestInit = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${publicAnonKey}`,
        ...options.headers
      },
      ...options,
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`API Error [${res.status}]:`, errorText);
      throw new Error(`Server error (${res.status}): ${errorText || res.statusText}`);
    }
    return res.json();
  } catch (e: any) {
    if (e.message.includes("fetch")) {
      throw new Error("Cannot connect to server. Make sure the backend is running.");
    }
    throw e;
  }
}

export const getGestures = (): Promise<CustomGesture[]> =>
  apiFetch("/gestures");

export const saveGestures = (gestures: CustomGesture[]) =>
  apiFetch("/gestures", { method: "POST", body: JSON.stringify(gestures) });

export const getCommunitySignsFromDB = (): Promise<CommunitySigns[]> =>
  apiFetch("/community-signs");

export const postCommunitySigns = (sign: CommunitySigns) =>
  apiFetch("/community-signs", { method: "POST", body: JSON.stringify({ sign }) });

export const updateCommunitySignsInDB = (signs: CommunitySigns[]) =>
  apiFetch("/community-signs", { method: "PUT", body: JSON.stringify(signs) });

export interface CustomGesture {
  id: string;
  name: string;
  phrase: string;
  samples: number[][];
  createdAt: string;
}

export interface CommunitySigns {
  id: string;
  name: string;
  phrase: string;
  description: string;
  authorName: string;
  likes: number;
  tags: string[];
  createdAt: string;
}
