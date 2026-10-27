// The shape of GET /data, matching backend/app/models.py

export type Source = {
  id: string;
  title: string;
  source: string;
  favicon: string | null;
  // The number the answer's links use for this source, or null if it isn't cited
  citation: number | null;
};

export type Item = {
  category: string;
  question: string;
  sources: Source[];
  content: string;
};

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function getData(): Promise<Item[]> {
  const response = await fetch(`${BACKEND_URL}/data`);
  if (!response.ok) {
    throw new Error(`GET /data failed with ${response.status}`);
  }
  return response.json();
}
