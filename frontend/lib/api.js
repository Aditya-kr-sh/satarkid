export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

export async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || data?.detail || "Request failed. Please retry.");
  return data;
}
